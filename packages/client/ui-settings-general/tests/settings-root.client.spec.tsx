// @vitest-environment jsdom
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEffect, useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SettingsRootComponentProps } from '../src/client/shell-contract.ts'
import type {
  SettingsNavigationRequest, SettingsOnboardingSectionRequest,
} from '@deepseek-ai/dsh-client-ui-settings/client'
import { SettingsRoot } from '../src/client/SettingsRoot.tsx'
import { en, zh } from '../src/client/locales.ts'

// Every fixture carries the resource hook the resources plugin merges into GlobalStandardProps.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

type Row = { id: string; order: number; label: string }
type Step = { id: string; order: number }

/** Slot-content stand-ins: the shell renders whatever the seats contribute. */
const SEAT_CONTENT: Record<string, string> = {
  'settings.trigger': 'Settings',
  'settings.header': 'Settings Title',
  'settings.action': 'Open configuration file',
  'settings.close': 'Close',
}

type AttentionSnapshot = Parameters<Parameters<SettingsRootComponentProps['useSessionPendingInteraction']>[0]>[0]
type ConnectionSnapshot = Parameters<Parameters<SettingsRootComponentProps['useConnectionState']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionPendingInteraction: SettingsRootComponentProps['useSessionPendingInteraction'] = selector => selector(noAttention)

function mount({
  wide = true,
  dictionary = en,
  connectionState = 'connected',
  onboardingActive = true,
  rows = [
    { id: 'general', order: 0, label: 'General' },
    { id: 'models', order: 10, label: 'Models' },
    { id: 'agent-presets', order: 20, label: 'Agent presets' },
  ],
  steps = [
    { id: 'welcome', order: -100 },
    { id: 'credential', order: 0 },
  ],
  sectionOrder = [],
  navigation,
}: {
  wide?: boolean
  dictionary?: typeof en | typeof zh
  onboardingActive?: boolean
  rows?: Row[]
  steps?: Step[]
  sectionOrder?: readonly string[]
  navigation?: SettingsNavigationRequest
  connectionState?: ConnectionSnapshot
} = {}) {
  // Mutable row source standing in for the bound useSections hook; bump()
  // plays a ledger change through the same observable contract.
  let current = rows
  let currentConnectionState = connectionState
  const listeners = new Set<() => void>()
  const connectionListeners = new Set<() => void>()
  const reconnect = vi.fn()
  const renderSlot = vi.fn(
    ((key: string, _owner: unknown, opts?: { only?: string }) => {
      if (key === 'settings.section') return <div data-testid={`section-${opts?.only ?? 'all'}`} />
      return SEAT_CONTENT[key]
    }) as SettingsRootComponentProps['renderSlot'],
  )
  const useSessions = ((select: (state: unknown) => unknown) => select(onboardingActive
    ? { phase: 'ready', current: undefined, byId: {} }
    : {
      phase: 'ready',
      current: 'active-session',
      byId: { 'active-session': { blank: false } },
    })) as never
  const unusedHook = (() => { throw new Error('unused by SettingsRoot') }) as never
  const setSectionOrder = vi.fn<(ids: readonly string[]) => Promise<void>>(() => Promise.resolve())
  const props: SettingsRootComponentProps = {
    useSessions,
    useSessionPendingInteraction,
    usePanelInfo, useResource,
    useWorkspaces: unusedHook,
    wide,
    reconnect,
    t: makeTranslate(dictionary),
    useConnectionState: (select) => {
      const [, force] = useState(0)
      useEffect(() => {
        const listener = () => { force(n => n + 1) }
        connectionListeners.add(listener)
        return () => { connectionListeners.delete(listener) }
      }, [])
      return select(currentConnectionState)
    },
    useOnboardingSteps: select => select(steps),
    useNavigation: select => select(navigation),
    useSectionOrder: select => select(sectionOrder),
    setSectionOrder,
    useSections: (select) => {
      const [, force] = useState(0)
      useEffect(() => {
        const listener = () => { force(n => n + 1) }
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      }, [])
      return select(current)
    },
    renderSlot,
  }
  const view = render(<SettingsRoot {...props} />)
  const bump = (next: Row[]) => {
    act(() => {
      current = next
      for (const fn of [...listeners]) fn()
    })
  }
  const setConnectionState = (next: typeof currentConnectionState) => {
    act(() => {
      currentConnectionState = next
      for (const fn of [...connectionListeners]) fn()
    })
  }
  return { view, renderSlot, bump, listeners, reconnect, setConnectionState, setSectionOrder }
}

function openPanel() {
  const trigger = screen.getByRole('button', { name: 'Settings' })
  trigger.focus()
  fireEvent.click(trigger)
  return trigger
}

function installPointerGeometry() {
  const list = screen.getByRole('list')
  Object.defineProperty(list, 'scrollTop', { configurable: true, writable: true, value: 0 })
  vi.spyOn(list, 'getBoundingClientRect').mockReturnValue({
    top: 100, bottom: 232, left: 0, right: 188, width: 188, height: 132, x: 0, y: 100,
    toJSON: () => ({}),
  })
  const items = [...list.querySelectorAll<HTMLElement>('[role="listitem"]')]
  items.forEach((item, index) => {
    const top = 100 + index * 44
    vi.spyOn(item, 'getBoundingClientRect').mockReturnValue({
      top, bottom: top + 40, left: 0, right: 164, width: 164, height: 40, x: 0, y: top,
      toJSON: () => ({}),
    })
  })
  let nextFrame = 0
  const frames = new Map<number, FrameRequestCallback>()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++nextFrame
    frames.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
  return {
    list,
    items,
    flushFrame: () => {
      act(() => {
        const pending = [...frames.values()]
        frames.clear()
        pending.forEach((callback) => { callback(performance.now()) })
      })
    },
  }
}

describe('SettingsRoot trigger', () => {
  it.each([
    { column: 'expanded English', wide: true, dictionary: en, name: 'Settings' },
    { column: 'collapsed English', wide: false, dictionary: en, name: 'Settings' },
    { column: 'expanded Chinese', wide: true, dictionary: zh, name: '设置' },
    { column: 'collapsed Chinese', wide: false, dictionary: zh, name: '设置' },
  ])('uses the locale name and accepts keyboard-style activation for the $column trigger', ({
    wide, dictionary, name,
  }) => {
    const { renderSlot } = mount({ wide, dictionary })
    const trigger = screen.getByRole('button', { name })
    expect(trigger.getAttribute('aria-label')).toBe(name)
    expect(renderSlot).toHaveBeenCalledWith('settings.trigger', { wide })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    trigger.focus()
    fireEvent.click(trigger, { detail: 0 })
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('button', { name, expanded: true })).toBeTruthy()
  })

  it('shows outage, retry progress, and a two-second recovery confirmation', () => {
    vi.useFakeTimers()
    const mounted = mount()
    expect(screen.queryByRole('button', { name: 'Disconnected, reconnect now' })).toBeNull()

    mounted.setConnectionState('disconnected')
    const indicator = screen.getByRole('button', { name: 'Disconnected, reconnect now' })
    expect(indicator.textContent).toContain('Disconnected')
    expect(indicator.hasAttribute('title')).toBe(false)
    expect(indicator.querySelector('svg')).toBeTruthy()
    fireEvent.click(indicator)
    expect(mounted.reconnect).toHaveBeenCalledOnce()

    mounted.setConnectionState('connecting')
    expect(screen.getByRole('button', { name: 'Reconnecting automatically, reconnect now' }).textContent)
      .toContain('Reconnecting...')

    mounted.setConnectionState('connected')
    expect(screen.getByRole('status', { name: 'Connected' })).toBeTruthy()
    act(() => { vi.advanceTimersByTime(1_999) })
    expect(screen.getByRole('status', { name: 'Connected' })).toBeTruthy()
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('keeps the reconnect indicator out of the collapsed rail', () => {
    mount({ wide: false, connectionState: 'disconnected' })
    expect(screen.queryByRole('button', { name: 'Disconnected, reconnect now' })).toBeNull()
  })
})

describe('SettingsPanel chrome seats', () => {
  it('names the dialog via aria-labelledby pointing at the header seat node', () => {
    mount()
    openPanel()
    const dialog = screen.getByRole('dialog')
    const titleId = dialog.getAttribute('aria-labelledby')!
    expect(titleId).toBeTruthy()
    const title = document.getElementById(titleId)!
    expect(title.textContent).toBe('Settings Title')
    expect(screen.getByRole('dialog', { name: 'Settings Title' })).toBeTruthy()
  })

  it('names the close button through the visually-hidden close seat text', () => {
    mount()
    openPanel()
    const close = screen.getByRole('button', { name: 'Close' })
    expect(close.hasAttribute('aria-label')).toBe(false)
    expect(close.textContent).toContain('Close')
  })

  it('renders header actions before the shell-owned close control', () => {
    const { renderSlot } = mount()
    openPanel()
    expect(screen.getByText('Open configuration file')).toBeTruthy()
    expect(renderSlot).toHaveBeenCalledWith('settings.action', {})
  })
})

describe('SettingsPanel close paths', () => {
  it('closes via the header button and restores trigger focus', async () => {
    mount()
    const trigger = openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await vi.waitFor(() => { expect(document.activeElement).toBe(trigger) })
  })

  it('closes via a mask click and restores trigger focus', async () => {
    mount()
    const trigger = openPanel()
    const dialog = screen.getByRole('dialog')
    fireEvent.click(dialog.parentElement!.firstElementChild!)
    expect(screen.queryByRole('dialog')).toBeNull()
    await vi.waitFor(() => { expect(document.activeElement).toBe(trigger) })
  })

  it('closes via document-level Escape, restores trigger focus, and unhooks the listener', async () => {
    mount()
    const trigger = openPanel()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    await vi.waitFor(() => { expect(document.activeElement).toBe(trigger) })
    // Ignored while closed (listener removed with the panel) and non-Escape
    // keys are ignored while open.
    fireEvent.keyDown(document, { key: 'Escape' })
    openPanel()
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('lands focus on the close button when the dialog opens', () => {
    mount()
    openPanel()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
  })
})

describe('SettingsPanel navigation', () => {
  it('opens a requested section and forwards its subsection', () => {
    const { renderSlot } = mount({
      navigation: { sectionId: 'models', subsectionId: 'provider', revision: 1 },
    })
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByTestId('section-models')).toBeTruthy()
    expect(renderSlot).toHaveBeenCalledWith(
      'settings.section',
      expect.objectContaining({ preferredSubsectionId: 'provider' }),
      { only: 'models' },
    )
  })

  it('projects rows, marks the first active, and renders only that section', () => {
    mount()
    openPanel()
    expect(screen.getByRole('button', { name: 'General' }).getAttribute('aria-current')).toBe('true')
    expect(screen.getByRole('button', { name: 'Models' }).getAttribute('aria-current')).toBeNull()
    expect(screen.getByTestId('section-general')).toBeTruthy()
  })

  it('gives every section a nav glyph, distinct for the ids the shell knows', () => {
    mount({
      rows: [
        { id: 'general', order: 0, label: 'General' },
        { id: 'models', order: 10, label: 'Models' },
        { id: 'agent-presets', order: 20, label: 'Agent presets' },
        { id: 'plugins', order: 30, label: 'Plugins' },
        { id: 'contributed', order: 40, label: 'Contributed' },
      ],
    })
    openPanel()
    // Glyphs carry no id of their own, so the drawn paths are what tells them apart.
    const glyphs = ['General', 'Models', 'Agent presets', 'Plugins', 'Contributed']
      .map(name => screen.getByRole('button', { name }).querySelector('svg')?.innerHTML)

    expect(glyphs.every(glyph => glyph !== undefined && glyph !== '')).toBe(true)
    // The three ids the shell names get their own glyph; every other section —
    // including one this package never heard of — shares the gear.
    expect(new Set(glyphs.slice(0, 4)).size).toBe(4)
    expect(glyphs[4]).toBe(glyphs[0])
  })

  it('switches the rendered section on nav click', () => {
    mount()
    openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Models' }))
    expect(screen.getByRole('button', { name: 'Models' }).getAttribute('aria-current')).toBe('true')
    expect(screen.getByTestId('section-models')).toBeTruthy()
    expect(screen.queryByTestId('section-general')).toBeNull()
  })

  it('follows the pointer, animates a full-row gap, then persists exactly once after settling', () => {
    vi.useFakeTimers()
    const { setSectionOrder } = mount({ sectionOrder: ['models', 'general', 'agent-presets'] })
    openPanel()
    const { list, items, flushFrame } = installPointerGeometry()
    expect([...list.querySelectorAll('[role="listitem"]')].map(item => item.textContent)).toEqual([
      expect.stringContaining('Models'),
      expect.stringContaining('General'),
      expect.stringContaining('Agent presets'),
    ])

    const modelsHandle = screen.getByRole('button', { name: `${en['nav.reorder']}: Models` })
    fireEvent.pointerDown(modelsHandle, {
      button: 0, isPrimary: true, pointerId: 7, clientX: 150, clientY: 120,
    })
    fireEvent.pointerMove(modelsHandle, { pointerId: 7, clientX: 150, clientY: 220 })
    flushFrame()

    expect(list.dataset.sorting).toBe('true')
    expect(items[0]?.dataset.placeholder).toBe('true')
    expect(items[1]?.style.transform).toBe('translateY(-44px)')
    expect(items[2]?.style.transform).toBe('translateY(-44px)')
    const ghost = document.querySelector<HTMLElement>('[data-phase="dragging"]')
    expect(ghost?.style.transform).toBe('translateY(100px)')
    expect(setSectionOrder).not.toHaveBeenCalled()

    fireEvent.pointerUp(modelsHandle, { pointerId: 7, clientX: 150, clientY: 220 })
    expect(setSectionOrder).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(180) })

    expect(setSectionOrder).toHaveBeenCalledOnce()
    expect(setSectionOrder).toHaveBeenCalledWith(['general', 'agent-presets', 'models'])
    expect(screen.getByRole('button', { name: 'Models' }).getAttribute('aria-current')).toBeNull()
    expect(screen.getByRole('button', { name: 'General' }).getAttribute('aria-current')).toBe('true')
  })

  it('moves the last contributed section into the first slot', () => {
    vi.useFakeTimers()
    const { setSectionOrder } = mount()
    openPanel()
    const { items, flushFrame } = installPointerGeometry()
    const handle = screen.getByRole('button', { name: `${en['nav.reorder']}: Agent presets` })
    fireEvent.pointerDown(handle, {
      button: 0, isPrimary: true, pointerId: 10, clientX: 150, clientY: 208,
    })
    fireEvent.pointerMove(handle, { pointerId: 10, clientX: 150, clientY: 105 })
    flushFrame()
    expect(items[0]?.style.transform).toBe('translateY(44px)')
    expect(items[1]?.style.transform).toBe('translateY(44px)')
    fireEvent.pointerUp(handle, { pointerId: 10, clientX: 150, clientY: 105 })
    act(() => { vi.advanceTimersByTime(180) })
    expect(setSectionOrder).toHaveBeenCalledWith(['agent-presets', 'general', 'models'])
  })

  it('auto-scrolls a long navigation rail near its bottom edge', () => {
    vi.useFakeTimers()
    mount()
    openPanel()
    const { list, flushFrame } = installPointerGeometry()
    const handle = screen.getByRole('button', { name: `${en['nav.reorder']}: Models` })
    fireEvent.pointerDown(handle, {
      button: 0, isPrimary: true, pointerId: 11, clientX: 150, clientY: 164,
    })
    fireEvent.pointerMove(handle, { pointerId: 11, clientX: 150, clientY: 229 })
    flushFrame()
    expect(list.scrollTop).toBeGreaterThan(0)
    fireEvent.keyDown(document, { key: 'Escape' })
    act(() => { vi.advanceTimersByTime(180) })
  })

  it('does not start sorting from the row or before the handle passes the four-pixel threshold', () => {
    const { setSectionOrder } = mount()
    openPanel()
    const { list, flushFrame } = installPointerGeometry()
    const models = screen.getByRole('button', { name: 'Models' })
    fireEvent.pointerDown(models, { pointerId: 3, clientX: 80, clientY: 164 })
    fireEvent.pointerMove(models, { pointerId: 3, clientX: 80, clientY: 220 })
    expect(list.dataset.sorting).toBeUndefined()

    const handle = screen.getByRole('button', { name: `${en['nav.reorder']}: Models` })
    fireEvent.pointerDown(handle, {
      button: 0, isPrimary: true, pointerId: 4, clientX: 150, clientY: 164,
    })
    fireEvent.pointerMove(handle, { pointerId: 4, clientX: 152, clientY: 166 })
    flushFrame()
    fireEvent.pointerUp(handle, { pointerId: 4, clientX: 152, clientY: 166 })
    expect(list.dataset.sorting).toBeUndefined()
    expect(setSectionOrder).not.toHaveBeenCalled()
  })

  it.each(['outside', 'cancel', 'escape'] as const)(
    'restores the original order without persisting on %s cancellation',
    (method) => {
      vi.useFakeTimers()
      const { setSectionOrder } = mount()
      openPanel()
      const { list, items, flushFrame } = installPointerGeometry()
      const handle = screen.getByRole('button', { name: `${en['nav.reorder']}: Models` })
      fireEvent.pointerDown(handle, {
        button: 0, isPrimary: true, pointerId: 8, clientX: 150, clientY: 164,
      })
      fireEvent.pointerMove(handle, { pointerId: 8, clientX: 150, clientY: 215 })
      flushFrame()
      expect(list.dataset.sorting).toBe('true')

      if (method === 'outside') {
        fireEvent.pointerUp(handle, { pointerId: 8, clientX: 240, clientY: 215 })
      } else if (method === 'cancel') {
        fireEvent.pointerCancel(handle, { pointerId: 8 })
      } else {
        fireEvent.keyDown(document, { key: 'Escape' })
      }
      expect(items.every(item => item.style.transform === 'translateY(0px)')).toBe(true)
      act(() => { vi.advanceTimersByTime(180) })
      expect(setSectionOrder).not.toHaveBeenCalled()
      expect(list.dataset.sorting).toBeUndefined()
      expect(screen.getByRole('dialog')).toBeTruthy()
    },
  )

  it('skips the settle delay when reduced motion is requested', () => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
    const { setSectionOrder } = mount()
    openPanel()
    const { flushFrame } = installPointerGeometry()
    const handle = screen.getByRole('button', { name: `${en['nav.reorder']}: Models` })
    fireEvent.pointerDown(handle, {
      button: 0, isPrimary: true, pointerId: 9, clientX: 150, clientY: 164,
    })
    fireEvent.pointerMove(handle, { pointerId: 9, clientX: 150, clientY: 215 })
    flushFrame()
    fireEvent.pointerUp(handle, { pointerId: 9, clientX: 150, clientY: 215 })
    expect(setSectionOrder).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(0) })
    expect(setSectionOrder).toHaveBeenCalledOnce()
  })

  it('supports keyboard reordering from the same drag handle', () => {
    const { setSectionOrder } = mount()
    openPanel()
    fireEvent.keyDown(screen.getByRole('button', { name: `${en['nav.reorder']}: Models` }), { key: 'ArrowUp' })
    expect(setSectionOrder).toHaveBeenCalledWith(['models', 'general', 'agent-presets'])
  })

  it('mounts onboarding steps in order and transfers ownership only on completion', () => {
    const { renderSlot } = mount()
    const first = renderSlot.mock.calls.find(call => call[0] === 'settings.onboarding')
    expect(first?.[1]).toMatchObject({ stepId: 'welcome' })
    expect(first?.[2]).toEqual({ only: 'welcome' })
    act(() => {
      (first?.[1] as { complete: () => void }).complete()
      ;(first?.[1] as { complete: () => void }).complete()
    })
    const onboardingCalls = renderSlot.mock.calls.filter(call => call[0] === 'settings.onboarding')
    const second = onboardingCalls.at(-1)
    expect(second?.[1]).toMatchObject({ stepId: 'credential' })
    expect(second?.[2]).toEqual({ only: 'credential' })

    const finishSection = vi.fn()
    act(() => {
      (second?.[1] as {
        openSection: (request: {
          sectionId: string
          subsectionId?: string
          step: 1 | 2 | 3 | 4
          complete: () => void
        }) => void
      }).openSection({
        sectionId: 'models',
        subsectionId: 'provider',
        step: 1,
        complete: finishSection,
      })
    })
    expect(screen.getByRole('dialog', { name: en['onboarding.start'] })).toBeTruthy()
    expect(screen.getByRole('dialog', { name: en['onboarding.start'] }).parentElement?.parentElement)
      .toBe(document.body)
    expect(screen.getByTestId('section-models')).toBeTruthy()
    expect(renderSlot).toHaveBeenCalledWith(
      'settings.section',
      expect.objectContaining({ preferredSubsectionId: 'provider' }),
      { only: 'models' },
    )
    expect(screen.queryByRole('button', { name: 'General' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en['onboarding.done'] }))
    expect(finishSection).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog', { name: en['onboarding.start'] })).toBeNull()

    cleanup()
    const inactive = mount({ onboardingActive: false }).renderSlot.mock.calls
      .filter(call => call[0] === 'settings.onboarding')
    expect(inactive).toHaveLength(0)
  })

  it('never presents a blank onboarding page while an optional settings section is unavailable', () => {
    const { renderSlot, bump } = mount()
    const step = renderSlot.mock.calls.find(call => call[0] === 'settings.onboarding')
    act(() => {
      (step?.[1] as {
        openSection: (request: SettingsOnboardingSectionRequest) => void
      }).openSection({
        sectionId: 'pocket',
        step: 2,
        complete: vi.fn(),
      })
    })

    expect(screen.getByRole('status').textContent).toContain(en['onboarding.sectionUnavailable.title'])
    expect((screen.getByRole('button', { name: en['onboarding.done'] }) as HTMLButtonElement).disabled).toBe(true)
    expect(renderSlot).not.toHaveBeenCalledWith('settings.section', expect.anything(), { only: 'pocket' })

    bump([
      { id: 'general', order: 0, label: 'General' },
      { id: 'models', order: 10, label: 'Models' },
      { id: 'pocket', order: 15, label: 'Phone access' },
    ])
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByTestId('section-pocket')).toBeTruthy()
    expect((screen.getByRole('button', { name: en['onboarding.done'] }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('paints no takeover chrome of its own around the mounted step', () => {
    // The chrome (mask, opaque stage, #root inert) belongs to the step via
    // the step-owned dialog surface — a mounted-but-deciding step that
    // renders null must show and block nothing (the reload white-flash fix;
    // onboarding-surface.spec.tsx pins the primitive's half).
    const appRoot = document.createElement('div')
    appRoot.id = 'root'
    document.body.append(appRoot)
    const { view } = mount()
    expect(view.container.querySelector('[class*="onboarding"]')).toBeNull()
    expect(document.body.querySelector('[class*="onboarding"]')).toBeNull()
    expect(appRoot.inert).not.toBe(true)
    view.unmount()
    appRoot.remove()
  })

  it('falls back to the first row when the active entry unregisters', () => {
    const { bump } = mount()
    openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Models' }))
    bump([{ id: 'general', order: 0, label: 'General' }])
    expect(screen.queryByRole('button', { name: 'Models' })).toBeNull()
    expect(screen.getByTestId('section-general')).toBeTruthy()
  })

  it('renders an empty content column when the ledger is empty', () => {
    const { renderSlot } = mount({ rows: [] })
    openPanel()
    expect(screen.getByRole('dialog')).toBeTruthy()
    const sectionCalls = renderSlot.mock.calls.filter(c => c[0] === 'settings.section')
    expect(sectionCalls).toHaveLength(0)
  })

  it('drops the ledger subscription on unmount', () => {
    const { view, listeners } = mount()
    expect(listeners.size).toBe(1)
    view.unmount()
    expect(listeners.size).toBe(0)
  })
})

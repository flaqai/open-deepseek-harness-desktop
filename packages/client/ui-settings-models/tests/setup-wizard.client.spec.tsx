// @vitest-environment jsdom
/** First-run checklist routing, completion, skip, and acknowledgement behavior. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { SetupWizard } from '../src/client/SetupWizard.tsx'
import type { SetupWizardProps } from '../src/client/SetupWizard.tsx'
import { ModelsSettingsStore } from '../src/client/store.ts'
import { WelcomeNoticeStore } from '../src/client/welcome-store.ts'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
})

function mount({ modelReady = false, acknowledge = true }: {
  modelReady?: boolean
  acknowledge?: boolean
} = {}) {
  const appRoot = document.createElement('div')
  appRoot.id = 'root'
  document.body.append(appRoot)
  const modelsController = new ModelsSettingsStore({} as never, {} as never, {} as never)
  modelsController.store.update((state) => {
    state.status = 'ready'
    state.writable = true
    state.rows = modelReady ? [{
      entry: {
        provider: 'ready-provider', displayName: 'Ready', settingsNs: '',
        settingsPath: [], active: true,
      },
      configured: true,
      removable: false,
      apiKeyEnv: undefined,
      credential: undefined,
    }] : []
  })
  const welcomeController = new WelcomeNoticeStore({
    getSnapshot: () => ({
      status: 'unavailable', value: undefined, base: undefined, user: undefined,
      revision: undefined, writable: false, mode: 'memory',
    }),
    subscribe: () => () => {},
    set: async () => {},
    unset: async () => {},
  } as never)
  welcomeController.store.update((state) => { state.status = 'ready' })
  const acknowledgeSpy = vi.spyOn(welcomeController, 'acknowledge')
    .mockImplementation(async () => acknowledge)
  const complete = vi.fn()
  const openSection = vi.fn()
  const localeStore = createSnapshotStore({
    active: 'zh',
    locales: [{ id: 'zh', label: '中文' }, { id: 'en', label: 'English' }],
    revision: 0,
  })
  const setLocale = vi.fn((id: string) => {
    const current = localeStore.getSnapshot()
    localeStore.set({ ...current, active: id, revision: current.revision + 1 })
  })
  const unusedHook = (() => { throw new Error('unused standard hook') }) as never
  const props: SetupWizardProps = {
    stepId: 'setup-wizard',
    complete,
    openSection,
    useSessions: unusedHook,
    useWorkspaces: unusedHook,
    modelsController,
    welcomeController,
    useModels: bindSnapshotSelector(modelsController.store),
    useWelcome: bindSnapshotSelector(welcomeController.store),
    useLocale: bindSnapshotSelector(localeStore),
    setLocale,
    t: key => zh[key],
  }
  return {
    ...render(<SetupWizard {...props} />), appRoot, complete, openSection,
    acknowledgeSpy, modelsController, welcomeController, setLocale,
  }
}

describe('SetupWizard', () => {
  it('opens the existing Models page and marks the task complete on its callback', () => {
    const h = mount()
    expect(screen.getByRole('dialog', { name: zh['setup.title'] })).toBeTruthy()
    expect(h.appRoot.inert).toBe(true)

    fireEvent.click(screen.getAllByRole('button', { name: zh['setup.configure'] })[0]!)
    expect(h.openSection).toHaveBeenCalledOnce()
    const request = h.openSection.mock.calls[0]![0]
    expect(request).toMatchObject({ sectionId: 'models', step: 1 })
    act(() => { request.complete() })

    expect(screen.getByText(zh['setup.completed'])).toBeTruthy()
    expect(screen.getByText(zh['setup.progress'].replace('{count}', '1'))).toBeTruthy()
  })

  it('switches the app locale from the top-right language menu', () => {
    const h = mount()
    fireEvent.click(screen.getAllByRole('button', { name: zh['setup.skip'] })[0]!)
    expect(screen.getByText(zh['setup.progress'].replace('{count}', '1'))).toBeTruthy()
    const trigger = screen.getByRole('button', { name: `${zh['setup.language']}: 中文` })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: 'English' }))
    expect(h.setLocale).toHaveBeenCalledWith('en')
    expect(screen.getByRole('button', { name: `${zh['setup.language']}: English` })).toBeTruthy()
    expect(screen.getByText(zh['setup.progress'].replace('{count}', '1'))).toBeTruthy()
  })

  it('opens the IM tab in the Plugins page and reaches the success welcome', () => {
    const h = mount({ modelReady: true })
    fireEvent.click(screen.getByRole('button', { name: zh['setup.configure'] }))
    const request = h.openSection.mock.calls[0]![0]
    expect(request).toMatchObject({ sectionId: 'plugins', subsectionId: 'im', step: 2 })
    act(() => { request.complete() })

    expect(screen.getByRole('heading', { name: zh['setup.success'] })).toBeTruthy()
    expect(screen.getByRole('button', { name: zh['setup.experience'] })).toBeTruthy()
  })

  it('can skip every task and persist the final acknowledgement before completing', async () => {
    const h = mount()
    fireEvent.click(screen.getByRole('button', { name: zh['setup.skipAll'] }))
    expect(screen.getByRole('heading', { name: zh['setup.ready'] })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: zh['setup.experience'] }))
    await waitFor(() => { expect(h.acknowledgeSpy).toHaveBeenCalledOnce() })
    expect(h.complete).toHaveBeenCalledOnce()
  })

  it('keeps the welcome open and reports a failed acknowledgement', async () => {
    const h = mount({ acknowledge: false })
    fireEvent.click(screen.getByRole('button', { name: zh['setup.skipAll'] }))
    fireEvent.click(screen.getByRole('button', { name: zh['setup.experience'] }))
    await waitFor(() => { expect(h.acknowledgeSpy).toHaveBeenCalledOnce() })
    expect(h.complete).not.toHaveBeenCalled()
  })

  it('completes without painting when the current wizard version was already acknowledged', () => {
    const h = mount()
    act(() => {
      h.welcomeController.store.update((state) => { state.acknowledged = true })
    })
    expect(h.complete).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

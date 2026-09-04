// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SettingsNavigation } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject } from '../src/client/index.ts'
import { DesktopPreferencesRow } from '../src/client/DesktopPreferencesRow.tsx'
import { DesktopUpdateBadge } from '../src/client/DesktopUpdateBadge.tsx'
import { DesktopSidebarUpdateButton } from '../src/client/DesktopSidebarUpdateButton.tsx'

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).deepSeekHarnessDesktop
})

function installBridge(): ReturnType<typeof vi.fn> {
  const reportReadiness = vi.fn()
  ;(globalThis as unknown as Record<string, unknown>).deepSeekHarnessDesktop = {
    shell: {
      getCapabilities: vi.fn(() => Promise.resolve({
        platform: 'darwin', packaged: true, launchAtLoginAvailable: true, sourceUpdateAvailable: false,
        commandLineAvailable: true,
      })),
      getDataHome: vi.fn(() => Promise.resolve({
        activePath: '/desktop/dsh-home', activeKind: 'desktop', desktopPath: '/desktop/dsh-home',
        officialPath: '/home/user/.dsh', officialAvailable: true, managedExternally: false,
      })),
      chooseDataHome: vi.fn(), switchDataHome: vi.fn(),
      getPreferences: vi.fn(() => Promise.resolve({
        closeBehavior: 'tray', notificationsEnabled: true, launchAtLoginEnabled: false,
      })),
      updatePreferences: vi.fn(), onPreferences: vi.fn(() => () => {}), openLog: vi.fn(),
      getCommandLine: vi.fn(() => Promise.resolve({
        phase: 'uninstalled', commandPath: '/desktop/cli/bin/dsh', dataHome: '/desktop/dsh-home',
      })),
      installCommandLine: vi.fn(), removeCommandLine: vi.fn(),
      reportReadiness,
    },
    releases: {
      getStatus: vi.fn(() => Promise.resolve({ phase: 'current', currentVersion: '0.1.0' })),
      check: vi.fn(), onStatus: vi.fn(() => () => {}), openDownload: vi.fn(),
      getDownloadStatus: vi.fn(() => Promise.resolve({ phase: 'idle' })),
      startDownload: vi.fn(), cancelDownload: vi.fn(), openInstaller: vi.fn(),
      onDownloadStatus: vi.fn(() => () => {}),
    },
  }
  return reportReadiness
}

async function bench() {
  const ctx = new Context()
  let generation: { id: number; host: { home: string } } | undefined
  const generationListeners = new Set<() => void>()
  const stateListeners = new Set<() => void>()
  ctx.provide('connection', {
    isLoopback: true,
    state: {
      getSnapshot: () => generation === undefined ? 'connecting' : 'connected',
      subscribe: (listener: () => void) => { stateListeners.add(listener); return () => { stateListeners.delete(listener) } },
    },
    generation: {
      getSnapshot: () => generation,
      subscribe: (listener: () => void) => {
        generationListeners.add(listener)
        return () => { generationListeners.delete(listener) }
      },
    },
  } as never)
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      'settings.general.item': { kind: 'list', scope: 'root' },
      'settings.section': { kind: 'list', scope: 'root' },
      'settings.action': { kind: 'list', scope: 'root' },
      'sidebar.settings.action': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  return {
    ctx,
    slots,
    connect: () => {
      generation = { id: 1, host: { home: '/desktop/dsh-home' } }
      for (const listener of generationListeners) listener()
      for (const listener of stateListeners) listener()
    },
  }
}

describe('ui-desktop-shell apply', () => {
  it('owns one native menu subscription and reports connection readiness through service injection', async () => {
    installBridge()
    const bridge = (globalThis as unknown as { deepSeekHarnessDesktop: Record<string, unknown> }).deepSeekHarnessDesktop
    let command: ((value: string) => void) | undefined
    const unsubscribe = vi.fn()
    const reportState = vi.fn()
    bridge.menu = {
      reportState,
      onCommand: (callback: (value: string) => void) => { command = callback; return unsubscribe },
    }
    const b = await bench()
    const startSession = vi.fn()
    b.ctx.provide('uiWorkspace', { startSession } as never)
    new SettingsNavigation(b.ctx)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(reportState).toHaveBeenLastCalledWith(expect.objectContaining({ ready: false }))
    b.connect()
    expect(reportState).toHaveBeenLastCalledWith(expect.objectContaining({ ready: true }))
    expect(command).toBeTypeOf('function')
    command?.('new-session')
    expect(startSession).toHaveBeenCalledOnce()
    expect(() => command?.('market')).toThrow()
    await fiber.dispose()
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(reportState).toHaveBeenLastCalledWith(expect.objectContaining({ ready: false }))
  })
  it('registers nothing in an ordinary browser', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.general.item')).toEqual([])
    await fiber.dispose()
  })

  it('registers desktop preferences and Release checks when the bridge exists', async () => {
    const reportReadiness = installBridge()
    const b = await bench()
    new SettingsNavigation(b.ctx)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(reportReadiness).toHaveBeenCalledWith('client')
    expect(reportReadiness).not.toHaveBeenCalledWith('event-dispatch')
    b.connect()
    expect(reportReadiness).toHaveBeenCalledWith('event-dispatch')
    expect(b.slots.entries('settings.general.item')[0]?.component).toBe(DesktopPreferencesRow)
    expect(b.slots.entries('settings.action')[0]?.component).toBe(DesktopUpdateBadge)
    expect(b.slots.entries('sidebar.settings.action')[0]?.component).toBe(DesktopSidebarUpdateButton)
    await fiber.dispose()
    expect(b.slots.entries('settings.general.item')).toEqual([])
    expect(b.slots.entries('settings.action')).toEqual([])
    expect(b.slots.entries('sidebar.settings.action')).toEqual([])
  })
})

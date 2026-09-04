import { describe, expect, it, vi } from 'vitest'
import type { DesktopBridge, DesktopPreferences, DesktopReleaseStatus } from '../src/client/bridge.ts'
import { DesktopShellController } from '../src/client/controller.ts'

function bench(initialRelease: DesktopReleaseStatus = { phase: 'idle', currentVersion: '0.1.0-rc.7' }) {
  let preferences: DesktopPreferences = {
    closeBehavior: 'tray', notificationsEnabled: true, launchAtLoginEnabled: false,
  }
  let release: DesktopReleaseStatus = initialRelease
  const openDownload = vi.fn(() => Promise.resolve({ error: '' }))
  const startDownload = vi.fn(() => Promise.resolve({
    phase: 'ready' as const, version: '0.1.0-rc.8', fileName: 'DeepSeek-Harness-macos-arm64.dmg',
  }))
  const openInstaller = vi.fn(() => Promise.resolve({ error: '' }))
  const bridge: DesktopBridge = {
    shell: {
      getCapabilities: vi.fn(() => Promise.resolve({
        platform: 'darwin', packaged: true, launchAtLoginAvailable: true, sourceUpdateAvailable: false,
        commandLineAvailable: true,
      })),
      getDataHome: vi.fn(() => Promise.resolve({
        activePath: '/desktop/dsh-home', activeKind: 'desktop' as const,
        desktopPath: '/desktop/dsh-home', officialPath: '/home/user/.dsh',
        officialAvailable: true, managedExternally: false,
      })),
      chooseDataHome: vi.fn(() => Promise.resolve({ status: 'cancelled' as const })),
      switchDataHome: vi.fn(() => Promise.resolve({ restarting: true, activePath: '/home/user/.dsh' })),
      getPreferences: vi.fn(() => Promise.resolve(preferences)),
      updatePreferences: vi.fn((patch: Partial<DesktopPreferences>) => {
        preferences = { ...preferences, ...patch }
        return Promise.resolve(preferences)
      }),
      onPreferences: vi.fn(() => () => {}),
      openLog: vi.fn(),
      getCommandLine: vi.fn(() => Promise.resolve({
        phase: 'uninstalled' as const, commandPath: '/desktop/cli/bin/dsh', dataHome: '/desktop/dsh-home',
      })),
      installCommandLine: vi.fn(() => Promise.resolve({
        phase: 'installed' as const, commandPath: '/desktop/cli/bin/dsh', dataHome: '/desktop/dsh-home',
      })),
      removeCommandLine: vi.fn(() => Promise.resolve({
        phase: 'uninstalled' as const, commandPath: '/desktop/cli/bin/dsh', dataHome: '/desktop/dsh-home',
      })),
      reportReadiness: vi.fn(),
    },
    releases: {
      getStatus: vi.fn(() => Promise.resolve(release)),
      check: vi.fn(() => {
        release = {
          phase: 'available', currentVersion: '0.1.0-rc.7', latestVersion: '0.1.0-rc.8',
          tagName: 'dsh-v0.1.0-rc.8',
          publishedAt: '2026-08-20T00:00:00Z', releaseUrl: 'https://github.com/flaqai/open-deepseek-harness-desktop/releases/tag/dsh-v0.1.0-rc.8',
        }
        return Promise.resolve(release)
      }),
      onStatus: vi.fn(() => () => {}),
      openDownload,
      getDownloadStatus: vi.fn(() => Promise.resolve({ phase: 'idle' as const })),
      startDownload,
      cancelDownload: vi.fn(() => Promise.resolve({ phase: 'cancelled' as const, version: '0.1.0-rc.8' })),
      openInstaller,
      onDownloadStatus: vi.fn(() => () => {}),
    },
  }
  const controller = new DesktopShellController(bridge)
  return { bridge, controller, openDownload, startDownload, openInstaller }
}

describe('DesktopShellController', () => {
  it('publishes one shared simulated-update state in development mode', async () => {
    const b = bench({ phase: 'unsupported' })
    b.controller.start()
    await vi.waitFor(() => { expect(b.controller.getSnapshot().preferences).not.toBeNull() })
    expect(b.controller.getSnapshot().simulatedReleaseAvailable).toBe(false)
    b.controller.toggleSimulatedRelease()
    expect(b.controller.getSnapshot().simulatedReleaseAvailable).toBe(true)
    b.controller.toggleSimulatedRelease()
    expect(b.controller.getSnapshot().simulatedReleaseAvailable).toBe(false)
    b.controller.dispose()
  })

  it('loads bridge state, writes preferences, and opens an available Release', async () => {
    const b = bench()
    b.controller.start()
    await vi.waitFor(() => { expect(b.controller.getSnapshot().preferences?.closeBehavior).toBe('tray') })
    await b.controller.setPreference({ closeBehavior: 'quit' })
    expect(b.controller.getSnapshot().preferences?.closeBehavior).toBe('quit')
    await b.controller.checkRelease()
    expect(b.controller.getSnapshot().release.phase).toBe('available')
    await b.controller.openRelease()
    expect(b.openDownload).toHaveBeenCalledOnce()
    await b.controller.downloadRelease()
    expect(b.controller.getSnapshot().releaseDownload.phase).toBe('ready')
    await b.controller.openInstaller()
    expect(b.openInstaller).toHaveBeenCalledOnce()
    await b.controller.installCommandLine()
    expect(b.controller.getSnapshot().commandLine?.phase).toBe('installed')
    await b.controller.removeCommandLine()
    expect(b.controller.getSnapshot().commandLine?.phase).toBe('uninstalled')
    await b.controller.chooseDataHome('existing')
    expect(b.controller.getSnapshot().dataHomeSelection?.status).toBe('cancelled')
    await b.controller.switchDataHome({ kind: 'official' })
    expect(b.controller.getSnapshot().restartPending).toBe(true)
    b.controller.dispose()
  })
})

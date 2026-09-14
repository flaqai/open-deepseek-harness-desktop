import { describe, expect, it, vi } from 'vitest'
import type {
  DesktopBridge, DesktopPreferences, DesktopReleaseStatus, DownloadNetworkSettings,
} from '../src/client/bridge.ts'
import { DesktopShellController } from '../src/client/controller.ts'

function bench(initialRelease: DesktopReleaseStatus = { phase: 'idle', currentVersion: '0.1.0-rc.7' }) {
  let preferences: DesktopPreferences = {
    closeBehavior: 'tray', notificationsEnabled: true, launchAtLoginEnabled: false, openBrowserOnStartup: false,
  }
  let release: DesktopReleaseStatus = initialRelease
  const openDownload = vi.fn(() => Promise.resolve({ error: '' }))
  const startDownload = vi.fn(() => Promise.resolve({
    phase: 'ready' as const, version: '0.1.0-rc.8', fileName: 'DeepSeek-Harness-macos-arm64.dmg',
  }))
  const openInstaller = vi.fn(() => Promise.resolve({ error: '' }))
  const openDesktopWeb = vi.fn(() => Promise.resolve({ opened: true as const, hidden: true }))
  const enterRecoveryMode = vi.fn(() => Promise.resolve({ entered: true as const }))
  let downloadNetwork: DownloadNetworkSettings = {
    schema: 'open-dsh-desktop/download-network/v1' as const, revision: 0,
    application: { source: 'github' as const, proxy: { mode: 'system' as const, passwordSet: false } },
    npm: { registry: 'npmmirror' as const, proxy: { mode: 'existing' as const, passwordSet: false } },
    github: { download: 'original' as const, proxy: { mode: 'existing' as const, passwordSet: false } },
  }
  const updateDownloadNetwork = vi.fn((patch: Parameters<NonNullable<DesktopBridge['downloadNetwork']>['update']>[0]) => {
    if (patch.application !== undefined) downloadNetwork = {
      ...downloadNetwork, revision: downloadNetwork.revision + 1,
      application: { ...patch.application, proxy: { ...patch.application.proxy, passwordSet: false } },
    }
    return Promise.resolve(downloadNetwork)
  })
  const bridge: DesktopBridge = {
    shell: {
      getCapabilities: vi.fn(() => Promise.resolve({
        platform: 'darwin', packaged: true, launchAtLoginAvailable: true, sourceUpdateAvailable: false,
        commandLineAvailable: true, developmentRecoveryAvailable: false,
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
      openLogDirectory: vi.fn(() => Promise.resolve({ error: '' })),
      openSettingsDocument: vi.fn(() => Promise.resolve({ error: '' })),
      getCommandLine: vi.fn(() => Promise.resolve({
        phase: 'uninstalled' as const, commandPath: '/desktop/cli/bin/dsh', dataHome: '/desktop/dsh-home',
      })),
      installCommandLine: vi.fn(() => Promise.resolve({
        phase: 'installed' as const, commandPath: '/desktop/cli/bin/dsh', dataHome: '/desktop/dsh-home',
      })),
      removeCommandLine: vi.fn(() => Promise.resolve({
        phase: 'uninstalled' as const, commandPath: '/desktop/cli/bin/dsh', dataHome: '/desktop/dsh-home',
      })),
      enterRecoveryMode,
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
    downloadNetwork: {
      get: vi.fn(() => Promise.resolve(downloadNetwork)),
      update: updateDownloadNetwork,
      reset: vi.fn(() => Promise.resolve(downloadNetwork)),
      getTestStatus: vi.fn(() => Promise.resolve({ phase: 'idle' as const })),
      test: vi.fn(() => Promise.resolve({ phase: 'succeeded' as const, target: 'application' as const,
        stage: 'metadata' as const, elapsedMs: 1 })),
      onSettings: vi.fn(() => () => {}), onTestStatus: vi.fn(() => () => {}),
    },
    desktopWeb: {
      getStatus: vi.fn(() => Promise.resolve({ phase: 'ready' as const })),
      open: openDesktopWeb,
      onStatus: vi.fn(() => () => {}),
    },
  }
  const controller = new DesktopShellController(bridge)
  return {
    bridge, controller, openDownload, startDownload, openInstaller, openDesktopWeb, enterRecoveryMode, updateDownloadNetwork,
  }
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
    b.controller.setOpenBrowserOnStartup(true)
    await vi.waitFor(() => { expect(b.controller.getSnapshot().preferences?.openBrowserOnStartup).toBe(true) })
    await b.controller.openDesktopWeb()
    expect(b.openDesktopWeb).toHaveBeenCalledOnce()
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
    await b.controller.enterRecoveryMode()
    expect(b.enterRecoveryMode).toHaveBeenCalledOnce()
    await b.controller.chooseDataHome('existing')
    expect(b.controller.getSnapshot().dataHomeSelection?.status).toBe('cancelled')
    await b.controller.switchDataHome({ kind: 'official' })
    expect(b.controller.getSnapshot().restartPending).toBe(true)
    b.controller.dispose()
  })

  it('switches update sources only after an explicit retry action', async () => {
    const b = bench()
    await b.controller.switchReleaseSource()
    expect(b.updateDownloadNetwork).toHaveBeenCalledOnce()
    const patch = b.updateDownloadNetwork.mock.calls[0]?.[0]
    expect(patch?.target).toBe('application')
    expect(patch?.application?.source).toBe('cnb')
    expect(b.controller.getSnapshot().release.phase).toBe('available')
  })
})

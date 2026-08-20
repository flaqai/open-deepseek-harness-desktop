import { describe, expect, it, vi } from 'vitest'
import type { DesktopBridge, DesktopPreferences, DesktopReleaseStatus } from '../src/client/bridge.ts'
import { DesktopShellController } from '../src/client/controller.ts'

function bench() {
  let preferences: DesktopPreferences = {
    closeBehavior: 'tray', notificationsEnabled: true, launchAtLoginEnabled: false,
  }
  let release: DesktopReleaseStatus = { phase: 'idle', currentVersion: '0.1.0-rc.7' }
  const bridge: DesktopBridge = {
    shell: {
      getCapabilities: vi.fn(() => Promise.resolve({
        platform: 'darwin', packaged: true, launchAtLoginAvailable: true, sourceUpdateAvailable: false,
      })),
      getPreferences: vi.fn(() => Promise.resolve(preferences)),
      updatePreferences: vi.fn((patch) => {
        preferences = { ...preferences, ...patch }
        return Promise.resolve(preferences)
      }),
      onPreferences: vi.fn(() => () => {}),
      openLog: vi.fn(),
    },
    releases: {
      getStatus: vi.fn(() => Promise.resolve(release)),
      check: vi.fn(() => {
        release = {
          phase: 'available', currentVersion: '0.1.0-rc.7', latestVersion: '0.1.0-rc.8',
          publishedAt: '2026-08-20T00:00:00Z', releaseUrl: 'https://github.com/flaqai/open-deepseek-harness-desktop/releases/tag/dsh-v0.1.0-rc.8',
        }
        return Promise.resolve(release)
      }),
      onStatus: vi.fn(() => () => {}),
      openDownload: vi.fn(() => Promise.resolve({ error: '' })),
    },
  }
  const controller = new DesktopShellController(bridge)
  return { bridge, controller }
}

describe('DesktopShellController', () => {
  it('loads bridge state, writes preferences, and opens an available Release', async () => {
    const b = bench()
    b.controller.start()
    await vi.waitFor(() => { expect(b.controller.getSnapshot().preferences?.closeBehavior).toBe('tray') })
    await b.controller.setPreference({ closeBehavior: 'quit' })
    expect(b.controller.getSnapshot().preferences?.closeBehavior).toBe('quit')
    await b.controller.checkRelease()
    expect(b.controller.getSnapshot().release.phase).toBe('available')
    await b.controller.openRelease()
    expect(b.bridge.releases.openDownload).toHaveBeenCalledOnce()
    b.controller.dispose()
  })
})

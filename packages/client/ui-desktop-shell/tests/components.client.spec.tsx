// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { DesktopBridge } from '../src/client/bridge.ts'
import { DesktopShellController } from '../src/client/controller.ts'
import { DesktopPreferencesRow, type DesktopPreferencesRowProps } from '../src/client/DesktopPreferencesRow.tsx'
import { ReleaseFooterAction, type ReleaseFooterActionProps } from '../src/client/ReleaseFooterAction.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: string, params?: Record<string, string | number>) => {
  let value = (en as Record<string, string>)[key] ?? key
  for (const [name, replacement] of Object.entries(params ?? {})) value = value.replace(`{${name}}`, String(replacement))
  return value
}) as never

function setup() {
  const updatePreferences = vi.fn((patch: Record<string, unknown>) => Promise.resolve({
    closeBehavior: patch.closeBehavior === 'quit' ? 'quit' as const : 'tray' as const,
    notificationsEnabled: patch.notificationsEnabled !== false,
    launchAtLoginEnabled: patch.launchAtLoginEnabled === true,
  }))
  const bridge: DesktopBridge = {
    shell: {
      getCapabilities: () => Promise.resolve({
        platform: 'darwin', packaged: true, launchAtLoginAvailable: true, sourceUpdateAvailable: false,
      }),
      getPreferences: () => Promise.resolve({
        closeBehavior: 'tray', notificationsEnabled: true, launchAtLoginEnabled: false,
      }),
      updatePreferences,
      onPreferences: () => () => {},
      openLog: vi.fn(),
    },
    releases: {
      getStatus: () => Promise.resolve({
        phase: 'available', currentVersion: '0.1.0-rc.7', latestVersion: '0.1.0-rc.8',
        publishedAt: '2026-08-20T00:00:00Z', releaseUrl: 'https://github.com/flaqai/open-deepseek-harness-desktop/releases/tag/dsh-v0.1.0-rc.8',
      }),
      check: vi.fn(), onStatus: () => () => {}, openDownload: vi.fn(() => Promise.resolve({ error: '' })),
    },
  }
  const controller = new DesktopShellController(bridge)
  controller.start()
  return { controller, bridge, updatePreferences }
}

describe('desktop shell components', () => {
  it('shows preferences and sends toggle updates', async () => {
    const b = setup()
    render(<DesktopPreferencesRow {...({ controller: b.controller, t } as DesktopPreferencesRowProps)} />)
    const notifications = await screen.findByRole('switch', { name: 'System notifications' })
    fireEvent.click(notifications)
    await waitFor(() => { expect(b.updatePreferences).toHaveBeenCalledWith({ notificationsEnabled: false }) })
    expect(screen.getByText('Version 0.1.0-rc.8 is available')).toBeTruthy()
    b.controller.dispose()
  })

  it('renders the available-version badge with one update dot and opens its Release', async () => {
    const b = setup()
    const view = render(<ReleaseFooterAction {...({ wide: true, controller: b.controller, t } as ReleaseFooterActionProps)} />)
    const action = await screen.findByRole('button', { name: 'Version 0.1.0-rc.8' })
    expect(view.container.querySelectorAll('[data-desktop-release]')).toHaveLength(1)
    expect(view.container.querySelectorAll('[data-update-dot]')).toHaveLength(1)
    fireEvent.click(action)
    await waitFor(() => { expect(b.bridge.releases.openDownload).toHaveBeenCalledOnce() })
    b.controller.dispose()
  })
})

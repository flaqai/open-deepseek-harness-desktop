// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  DesktopBridge, DesktopCliStatus, DesktopDownloadNetworkBridge, DesktopReleaseDownloadStatus, DesktopReleaseStatus, DesktopWebStatus,
} from '../src/client/bridge.ts'
import { DesktopShellController } from '../src/client/controller.ts'
import { DesktopPreferencesRow, type DesktopPreferencesRowProps } from '../src/client/DesktopPreferencesRow.tsx'
import { DesktopUpdateBadge, type DesktopUpdateBadgeProps } from '../src/client/DesktopUpdateBadge.tsx'
import {
  DesktopSidebarUpdateButton, type DesktopSidebarUpdateButtonProps,
} from '../src/client/DesktopSidebarUpdateButton.tsx'
import {
  DesktopBrowserReturnButton, type DesktopBrowserReturnButtonProps,
} from '../src/client/DesktopBrowserReturnButton.tsx'
import {
  DesktopLogDirectoryAction, type DesktopLogDirectoryActionProps,
} from '../src/client/DesktopLogDirectoryAction.tsx'
import { en } from '../src/client/locales.ts'
import { DownloadNetworkSettings } from '../src/client/DownloadNetworkSettings.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const t = ((key: string, params?: Record<string, string | number>) => {
  let value = (en as Record<string, string>)[key] ?? key
  for (const [name, replacement] of Object.entries(params ?? {})) value = value.replace(`{${name}}`, String(replacement))
  return value
}) as never

const downloadSettings = {
  schema: 'open-dsh-desktop/download-network/v1' as const, revision: 0,
  application: { source: 'github' as const, proxy: { mode: 'system' as const, passwordSet: false } },
  npm: { registry: 'npmmirror' as const, proxy: { mode: 'existing' as const, passwordSet: false } },
  github: { download: 'original' as const, proxy: { mode: 'existing' as const, passwordSet: false } },
}

function createDownloadNetworkBridge() {
  const update = vi.fn(() => Promise.resolve({ ...downloadSettings, revision: 1 }))
  const bridge: DesktopDownloadNetworkBridge = {
    get: () => Promise.resolve(downloadSettings), update,
    reset: () => Promise.resolve(downloadSettings), getTestStatus: () => Promise.resolve({ phase: 'idle' }),
    test: target => Promise.resolve({ phase: 'succeeded', target, stage: 'metadata', elapsedMs: 12 }),
    onSettings: () => () => {}, onTestStatus: () => () => {},
  }
  return { bridge, update }
}

function setup(releaseStatus: DesktopReleaseStatus = {
  phase: 'available', currentVersion: '0.1.0-rc.7', latestVersion: '0.1.0-rc.8',
  tagName: 'dsh-v0.1.0-rc.8',
  publishedAt: '2026-08-20T00:00:00Z', releaseUrl: 'https://github.com/flaqai/open-deepseek-harness-desktop/releases/tag/dsh-v0.1.0-rc.8',
}, commandLine: DesktopCliStatus = {
  phase: 'uninstalled', commandPath: '/desktop/cli/bin/dsh', dataHome: '/desktop/dsh-home',
}, downloadStatus: DesktopReleaseDownloadStatus = { phase: 'idle' }, desktopWebStatus: DesktopWebStatus = {
  phase: 'ready',
}, platform: 'darwin' | 'win32' | 'linux' = 'darwin', packaged = true) {
  const updatePreferences = vi.fn((patch: Record<string, unknown>) => Promise.resolve({
    closeBehavior: patch.closeBehavior === 'quit' ? 'quit' as const : 'tray' as const,
    notificationsEnabled: patch.notificationsEnabled !== false,
    launchAtLoginEnabled: patch.launchAtLoginEnabled === true,
    openBrowserOnStartup: patch.openBrowserOnStartup === true,
  }))
  const openDownload = vi.fn(() => Promise.resolve({ error: '' }))
  const startDownload = vi.fn(() => Promise.resolve({
    phase: 'ready' as const, version: '0.1.0-rc.8', fileName: 'DeepSeek-Harness-macos-arm64.dmg',
  }))
  const cancelDownload = vi.fn(() => Promise.resolve({ phase: 'cancelled' as const, version: '0.1.0-rc.8' }))
  const openInstaller = vi.fn(() => Promise.resolve({ error: '' }))
  const openDesktopWeb = vi.fn(() => Promise.resolve({ opened: true as const, hidden: true }))
  const enterRecoveryMode = vi.fn(() => Promise.resolve({ entered: true as const }))
  const installCommandLine = vi.fn(() => Promise.resolve({
    phase: 'installed' as const, commandPath: '/desktop/cli/bin/dsh', dataHome: '/desktop/dsh-home',
  }))
  const chooseDataHome = vi.fn((selectionKind: 'existing' | 'empty') => Promise.resolve({
    status: 'selected' as const,
    selectionKind,
    selectionId: '11111111-1111-4111-8111-111111111111',
    path: selectionKind === 'empty' ? '/Volumes/Portable/New DSH' : '/Volumes/Portable/.dsh',
    entries: selectionKind === 'empty' ? [] : ['settings.yaml'],
  }))
  const switchDataHome = vi.fn(() => Promise.resolve({
    restarting: true,
    activePath: '/home/user/.dsh',
  }))
  const bridge: DesktopBridge = {
    shell: {
      getCapabilities: () => Promise.resolve({
        platform, packaged, launchAtLoginAvailable: true, sourceUpdateAvailable: false,
        commandLineAvailable: true, developmentRecoveryAvailable: !packaged,
      }),
      getDataHome: () => Promise.resolve({
        activePath: '/desktop/dsh-home', activeKind: 'desktop' as const,
        desktopPath: '/desktop/dsh-home', officialPath: '/home/user/.dsh',
        officialAvailable: true, managedExternally: false,
      }),
      chooseDataHome,
      switchDataHome,
      getPreferences: () => Promise.resolve({
        closeBehavior: 'tray', notificationsEnabled: true, launchAtLoginEnabled: false, openBrowserOnStartup: false,
      }),
      updatePreferences,
      onPreferences: () => () => {},
      openLog: vi.fn(),
      openLogDirectory: vi.fn(() => Promise.resolve({ error: '' })),
      openSettingsDocument: vi.fn(() => Promise.resolve({ error: '' })),
      getCommandLine: () => Promise.resolve(commandLine),
      installCommandLine,
      removeCommandLine: vi.fn(() => Promise.resolve({
        phase: 'uninstalled' as const, commandPath: '/desktop/cli/bin/dsh', dataHome: '/desktop/dsh-home',
      })),
      enterRecoveryMode,
      reportReadiness: vi.fn(),
    },
    releases: {
      getStatus: () => Promise.resolve(releaseStatus),
      check: vi.fn(), onStatus: () => () => {}, openDownload,
      getDownloadStatus: () => Promise.resolve(downloadStatus),
      startDownload,
      cancelDownload,
      openInstaller,
      onDownloadStatus: () => () => {},
    },
    desktopWeb: {
      getStatus: () => Promise.resolve(desktopWebStatus),
      open: openDesktopWeb,
      onStatus: () => () => {},
    },
  }
  const controller = new DesktopShellController(bridge)
  controller.start()
  return {
    controller, updatePreferences, openDownload, startDownload, cancelDownload, openInstaller, installCommandLine,
    chooseDataHome, switchDataHome, openDesktopWeb, enterRecoveryMode,
  }
}

describe('desktop shell components', () => {
  it('opens the fixed persistent diagnostic log and permits retry after an error', async () => {
    const openLog = vi.fn()
      .mockResolvedValueOnce({ error: 'permission denied' })
      .mockResolvedValueOnce({ error: '' })
    render(<DesktopLogDirectoryAction {...({ openLog, t } as DesktopLogDirectoryActionProps)} />)

    fireEvent.click(screen.getByRole('button', { name: 'Open diagnostic log' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Could not open the diagnostic log')

    fireEvent.click(screen.getByRole('button', { name: 'Open diagnostic log' }))
    await waitFor(() => { expect(screen.queryByRole('alert')).toBeNull() })
    expect(openLog).toHaveBeenCalledTimes(2)
  })

  it('shows the desktop-owned npm registry choices while market-owned GitHub policy is unavailable', async () => {
    const { bridge, update } = createDownloadNetworkBridge()
    const longT = ((key: string, params?: Record<string, string | number>) => {
      let value = (en as Record<string, string>)[key] ?? key
      for (const [name, replacement] of Object.entries(params ?? {})) {
        value = value.replace(`{${name}}`, String(replacement))
      }
      return `${value} ${'übersetzter langer Text '.repeat(2)}`
    }) as never
    render(<DownloadNetworkSettings bridge={bridge} t={longT} />)
    expect(await screen.findByText(/Downloads and proxies/u)).toBeTruthy()
    fireEvent.change(screen.getAllByRole('combobox')[0]!, { target: { value: 'cnb' } })
    fireEvent.click(screen.getAllByRole('button', { name: /Save/u })[0]!)
    await waitFor(() => { expect(update).toHaveBeenCalledWith(expect.objectContaining({ target: 'application' })) })
    expect(screen.getAllByRole('button', { name: /Test connection/u })).toHaveLength(2)
    const registries = screen.getAllByRole('combobox').find(select =>
      Array.from(select.querySelectorAll('option')).some(option => option.value === 'npmmirror'))!
    expect((registries as HTMLSelectElement).value).toBe('npmmirror')
    expect(Array.from(registries.querySelectorAll('option')).map(option => option.value))
      .toEqual(['npmmirror', 'npmjs', 'custom'])
    expect(screen.queryByText(/GitHub plugins/u)).toBeNull()
  })

  it('returns from a browser to Desktop and permits retry after failure', async () => {
    const returnToDesktop = vi.fn()
      .mockRejectedValueOnce(new Error('closed'))
      .mockResolvedValueOnce(undefined)
    render(<DesktopBrowserReturnButton {...({
      returnToDesktop, t, wide: true,
    } as DesktopBrowserReturnButtonProps)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Return to Desktop' }))
    await waitFor(() => { expect(screen.getByTitle(/Could not reveal Desktop/u)).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: 'Return to Desktop' }))
    await waitFor(() => { expect(returnToDesktop).toHaveBeenCalledTimes(2) })
  })

  it('shows a quiet header badge only for an available update and opens its settings row', async () => {
    const b = setup()
    const openUpdates = vi.fn()
    render(<DesktopUpdateBadge {...({ controller: b.controller, openUpdates, t } as DesktopUpdateBadgeProps)} />)
    const badge = await screen.findByRole('button', { name: 'Version 0.1.0-rc.8' })
    fireEvent.click(badge)
    expect(openUpdates).toHaveBeenCalledOnce()
    b.controller.dispose()
  })

  it('shows the blue sidebar action only for an available update in wide mode', async () => {
    const b = setup()
    const openUpdates = vi.fn()
    const view = render(<DesktopSidebarUpdateButton {...({
      controller: b.controller, openUpdates, t, wide: true,
    } as DesktopSidebarUpdateButtonProps)} />)
    const action = await screen.findByRole('button', { name: 'Version 0.1.0-rc.8' })
    expect(action.textContent).toBe('Update')
    fireEvent.click(action)
    expect(openUpdates).toHaveBeenCalledOnce()

    view.rerender(<DesktopSidebarUpdateButton {...({
      controller: b.controller, openUpdates, t, wide: false,
    } as DesktopSidebarUpdateButtonProps)} />)
    expect(screen.queryByRole('button', { name: 'Version 0.1.0-rc.8' })).toBeNull()
    b.controller.dispose()
  })

  it('keeps the sidebar update action hidden while no update is available', async () => {
    const b = setup({ phase: 'current', currentVersion: '0.1.0-rc.8' })
    render(<DesktopSidebarUpdateButton {...({
      controller: b.controller, openUpdates: vi.fn(), t, wide: true,
    } as DesktopSidebarUpdateButtonProps)} />)
    await waitFor(() => { expect(b.controller.getSnapshot().release.phase).toBe('current') })
    expect(screen.queryByRole('button')).toBeNull()
    b.controller.dispose()
  })

  it('shows preferences and sends toggle updates', async () => {
    const b = setup()
    render(<DesktopPreferencesRow {...({ controller: b.controller, t } as DesktopPreferencesRowProps)} />)
    const notifications = await screen.findByRole('switch', { name: 'System notifications' })
    fireEvent.click(notifications)
    await waitFor(() => { expect(b.updatePreferences).toHaveBeenCalledWith({ notificationsEnabled: false }) })
    expect(screen.getByText('Version 0.1.0-rc.8 is available')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open in browser' }))
    await waitFor(() => { expect(b.openDesktopWeb).toHaveBeenCalledOnce() })
    fireEvent.click(screen.getByRole('switch', { name: 'Open browser after startup' }))
    await waitFor(() => { expect(b.updatePreferences).toHaveBeenCalledWith({ openBrowserOnStartup: true }) })
    b.controller.dispose()
  })

  it('disables the browser handoff while Harness is starting', async () => {
    const b = setup(undefined, undefined, undefined, { phase: 'starting' })
    render(<DesktopPreferencesRow {...({ controller: b.controller, t } as DesktopPreferencesRowProps)} />)
    const button = await screen.findByRole('button', { name: 'Starting…' })
    expect(button.hasAttribute('disabled')).toBe(true)
    expect(b.openDesktopWeb).not.toHaveBeenCalled()
    b.controller.dispose()
  })

  it('shows a browser handoff error and permits a manual retry', async () => {
    const b = setup(undefined, undefined, undefined, { phase: 'error', message: 'Browser launch was blocked' })
    render(<DesktopPreferencesRow {...({ controller: b.controller, t } as DesktopPreferencesRowProps)} />)
    expect(await screen.findByText('Could not open the browser: Browser launch was blocked')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open in browser' }))
    await waitFor(() => { expect(b.openDesktopWeb).toHaveBeenCalledOnce() })
    b.controller.dispose()
  })

  it('does not expose local browser mode on Linux', async () => {
    const b = setup(undefined, undefined, undefined, { phase: 'ready' }, 'linux')
    render(<DesktopPreferencesRow {...({ controller: b.controller, t } as DesktopPreferencesRowProps)} />)
    await screen.findByText('When closing the window')
    expect(screen.queryByText('Use in a browser')).toBeNull()
    expect(screen.queryByRole('switch', { name: 'Open browser after startup' })).toBeNull()
    b.controller.dispose()
  })

  it('reveals the update row after the settings panel has completed layout', async () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const b = setup()
    render(<DesktopPreferencesRow {...({ controller: b.controller, t } as DesktopPreferencesRowProps)} />)
    await screen.findAllByText('Check for updates')
    const updateRegion = screen.getByRole('region', { name: 'Check for updates' })
    const scrollIntoView = vi.fn()
    Object.defineProperty(updateRegion, 'scrollIntoView', { configurable: true, value: scrollIntoView })

    act(() => { b.controller.navigate('updates') })
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(b.controller.getSnapshot().menuDestination).toBe('updates')
    act(() => { frames.shift()?.(0) })
    expect(scrollIntoView).not.toHaveBeenCalled()
    act(() => { frames.shift()?.(16) })
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
    expect(b.controller.getSnapshot().menuDestination).toBeUndefined()
    b.controller.dispose()
  })

  it('downloads and opens a verified installer inside General Settings', async () => {
    const b = setup()
    render(<DesktopPreferencesRow {...({ controller: b.controller, t } as DesktopPreferencesRowProps)} />)
    expect(await screen.findByText('Version 0.1.0-rc.8 is available')).toBeTruthy()
    expect(screen.getByText('Choose Replace when installing. If macOS says the app is in use, quit it completely from the menu bar first.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Download in app' }))
    await waitFor(() => { expect(b.startDownload).toHaveBeenCalledOnce() })
    fireEvent.click(screen.getByRole('button', { name: 'Open installer' }))
    await waitFor(() => { expect(b.openInstaller).toHaveBeenCalledOnce() })
    b.controller.dispose()
  })

  it('shows determinate installer progress and permits cancellation', async () => {
    const b = setup(undefined, undefined, {
      phase: 'downloading' as const,
      version: '0.1.0-rc.8',
      fileName: 'DeepSeek-Harness-macos-arm64.dmg',
      transferredBytes: 25,
      totalBytes: 100,
      percent: 25,
    })
    render(<DesktopPreferencesRow {...({ controller: b.controller, t } as DesktopPreferencesRowProps)} />)
    expect(await screen.findByText('Downloading 25% · 25 B / 100 B')).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: 'Installer download progress' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel download' }))
    await waitFor(() => { expect(b.cancelDownload).toHaveBeenCalledOnce() })
    b.controller.dispose()
  })

  it('shows fallback and restart download states while keeping cancellation available', async () => {
    const fallback = setup(undefined, undefined, {
      phase: 'switching', version: '0.1.0-rc.8',
      fileName: 'DeepSeek-Harness-macos-arm64.dmg',
      transferredBytes: 25, totalBytes: 100, resumeFromBytes: 25,
    })
    const fallbackView = render(<DesktopPreferencesRow {...({
      controller: fallback.controller, t,
    } as DesktopPreferencesRowProps)} />)
    expect(await screen.findByText('The system network failed. Switching to the fallback channel…')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel download' }))
    await waitFor(() => { expect(fallback.cancelDownload).toHaveBeenCalledOnce() })
    fallback.controller.dispose()
    fallbackView.unmount()

    const restart = setup(undefined, undefined, {
      phase: 'switching', version: '0.1.0-rc.8',
      fileName: 'DeepSeek-Harness-macos-arm64.dmg',
      transferredBytes: 25, totalBytes: 100, resumeFromBytes: 0,
    })
    render(<DesktopPreferencesRow {...({ controller: restart.controller, t } as DesktopPreferencesRowProps)} />)
    expect(await screen.findByText('The fallback channel cannot resume this transfer. Downloading again…')).toBeTruthy()
    restart.controller.dispose()
  })

  it('keeps the update check inside General Settings when the client is current', async () => {
    const b = setup({ phase: 'current', currentVersion: '0.1.0-rc.8' })
    render(<DesktopPreferencesRow {...({ controller: b.controller, t } as DesktopPreferencesRowProps)} />)
    expect(await screen.findByText('This is the latest version')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeTruthy()
    b.controller.dispose()
  })

  it('toggles simulated current and available update states in development mode', async () => {
    const b = setup({ phase: 'unsupported' })
    const network = createDownloadNetworkBridge()
    const openUpdates = vi.fn()
    render(<>
      <DesktopPreferencesRow {...({
        controller: b.controller, downloadNetwork: network.bridge, t,
      } as DesktopPreferencesRowProps)} />
      <DesktopUpdateBadge {...({ controller: b.controller, openUpdates, t } as DesktopUpdateBadgeProps)} />
      <DesktopSidebarUpdateButton {...({
        controller: b.controller, openUpdates, t, wide: true,
      } as DesktopSidebarUpdateButtonProps)} />
    </>)

    expect(await screen.findByText('Development mode: this is the latest version')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Check for updates' }).contains(screen.getByText('Application updates'))).toBe(true)
    fireEvent.change(screen.getAllByRole('combobox')[0]!, { target: { value: 'cnb' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]!)
    await waitFor(() => { expect(network.update).toHaveBeenCalledWith(expect.objectContaining({ target: 'application' })) })
    expect(screen.queryAllByRole('button', { name: 'Version 0.1.1-rc.3' })).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    expect(screen.getByText('Development mode: simulated version 0.1.1-rc.3 is available')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Version 0.1.1-rc.3' })).toHaveLength(2)
    fireEvent.click(screen.getByText('Update'))
    expect(openUpdates).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Update now' }))
    expect(screen.getByText('Development mode: this is the latest version')).toBeTruthy()
    expect(screen.queryAllByRole('button', { name: 'Version 0.1.1-rc.3' })).toHaveLength(0)
    expect(b.openDownload).not.toHaveBeenCalled()
    b.controller.dispose()
  })

  it('installs and removes the app-owned dsh command', async () => {
    const b = setup()
    render(<DesktopPreferencesRow {...({ controller: b.controller, t } as DesktopPreferencesRowProps)} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Install dsh' }))
    await waitFor(() => { expect(screen.getByText('dsh is installed. Use it from a new terminal window.')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: 'Check and repair' }))
    await waitFor(() => { expect(b.installCommandLine).toHaveBeenCalledTimes(2) })
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Install dsh' })).toBeTruthy() })
    b.controller.dispose()
  })

  it('shows the dsh setting in development mode without offering a non-functional install action', async () => {
    const b = setup(undefined, {
      phase: 'unsupported', commandPath: '/desktop/cli/bin/dsh', dataHome: '/desktop/development/dsh-home',
    })
    render(<DesktopPreferencesRow {...({ controller: b.controller, t } as DesktopPreferencesRowProps)} />)

    expect(await screen.findByText('dsh terminal command')).toBeTruthy()
    expect(screen.getByText('Development mode does not modify PATH. Install or remove dsh from a packaged app.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Install dsh' })).toBeNull()
    expect(b.installCommandLine).not.toHaveBeenCalled()
    b.controller.dispose()
  })

  it('opens the startup recovery page only from a development build', async () => {
    const b = setup(undefined, undefined, undefined, undefined, 'darwin', false)
    render(<DesktopPreferencesRow {...({ controller: b.controller, t } as DesktopPreferencesRowProps)} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Enter recovery mode' }))
    await waitFor(() => { expect(b.enterRecoveryMode).toHaveBeenCalledOnce() })
    b.controller.dispose()
  })

  it('requires explicit confirmation before shadowing another dsh command', async () => {
    const b = setup(undefined, {
      phase: 'conflict', commandPath: '/desktop/cli/bin/dsh', dataHome: '/desktop/dsh-home',
      conflictPath: '/usr/local/bin/dsh',
    })
    render(<DesktopPreferencesRow {...({ controller: b.controller, t } as DesktopPreferencesRowProps)} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Install dsh' }))
    expect(screen.getByText('/usr/local/bin/dsh was found. Continuing gives the desktop-managed dsh higher priority without deleting the existing command.')).toBeTruthy()
    expect(b.installCommandLine).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Install anyway' }))
    await waitFor(() => { expect(b.installCommandLine).toHaveBeenCalledWith(true) })
    b.controller.dispose()
  })

  it('switches only to built-in or native-picker-selected data homes', async () => {
    const b = setup()
    render(<DesktopPreferencesRow {...({ controller: b.controller, t } as DesktopPreferencesRowProps)} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Switch directory' }))
    expect(screen.getByText(/Switching does not copy, move, or delete data/u)).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: /Official DSH directory/u }))
    fireEvent.click(screen.getByRole('button', { name: 'Switch and restart' }))
    await waitFor(() => { expect(b.switchDataHome).toHaveBeenCalledWith({ kind: 'official' }) })
    b.controller.dispose()
  })

  it('uses an opaque native selection when switching to another existing directory', async () => {
    const b = setup()
    render(<DesktopPreferencesRow {...({ controller: b.controller, t } as DesktopPreferencesRowProps)} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Switch directory' }))
    fireEvent.click(screen.getByRole('radio', { name: /Another existing directory/u }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose directory' }))
    expect(b.chooseDataHome).toHaveBeenCalledWith('existing')
    await waitFor(() => { expect(screen.getByText('/Volumes/Portable/.dsh')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: 'Switch and restart' }))
    await waitFor(() => {
      expect(b.switchDataHome).toHaveBeenCalledWith({
        kind: 'custom', selectionId: '11111111-1111-4111-8111-111111111111',
      })
    })
    b.controller.dispose()
  })

  it('creates a fresh configuration only in a native-picker-selected empty folder', async () => {
    const b = setup()
    render(<DesktopPreferencesRow {...({ controller: b.controller, t } as DesktopPreferencesRowProps)} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Switch directory' }))
    fireEvent.click(screen.getByRole('radio', { name: /Create a new configuration in an empty folder/u }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose empty folder' }))
    expect(b.chooseDataHome).toHaveBeenCalledWith('empty')
    await waitFor(() => { expect(screen.getByText('/Volumes/Portable/New DSH')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: 'Switch and restart' }))
    await waitFor(() => {
      expect(b.switchDataHome).toHaveBeenCalledWith({
        kind: 'create', selectionId: '11111111-1111-4111-8111-111111111111',
      })
    })
    b.controller.dispose()
  })
})

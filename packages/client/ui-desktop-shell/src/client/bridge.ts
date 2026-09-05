/** Browser-side copy of the narrow Electron preload protocol. */
import type { DesktopIconsBridge } from './icon-protocol.ts'

/** Closing hides the window in the tray or quits the desktop application. */
export type CloseBehavior = 'tray' | 'quit'

/** Persisted preference values exposed by the desktop main process. */
export interface DesktopPreferences {
  closeBehavior: CloseBehavior
  notificationsEnabled: boolean
  launchAtLoginEnabled: boolean
  openBrowserOnStartup: boolean
}

/** URL-free state of the system-browser handoff. */
export type DesktopWebStatus =
  | { phase: 'starting' | 'ready' | 'opening' }
  | { phase: 'error'; message: string }

/** Restricted local-browser operations exposed by Electron. */
export interface DesktopWebBridge {
  getStatus(): Promise<DesktopWebStatus>
  open(): Promise<{ opened: true; hidden: boolean }>
  onStatus(callback: (status: DesktopWebStatus) => void): () => void
}

/** Platform and build-mode support reported by Electron. */
export interface DesktopCapabilities {
  platform: string
  packaged: boolean
  launchAtLoginAvailable: boolean
  sourceUpdateAvailable: boolean
  commandLineAvailable: boolean
}

/** Active Harness home and the two built-in switch targets. */
export interface DesktopDataHomeStatus {
  activePath: string
  activeKind: 'desktop' | 'official' | 'custom' | 'external'
  desktopPath: string
  officialPath: string
  officialAvailable: boolean
  managedExternally: boolean
}

/** Native directory-picker result; only its opaque id can be activated. */
export type DesktopDataHomeSelectionResult =
  | { status: 'cancelled' }
  | { status: 'invalid' | 'not-empty' | 'unreadable'; path: string }
  | {
    status: 'selected'
    selectionKind: DesktopDataHomeSelectionKind
    selectionId: string
    path: string
    entries: readonly string[]
  }

/** Fixed native-picker validation mode selected by the settings UI. */
export type DesktopDataHomeSelectionKind = 'existing' | 'empty'

/** Allowlisted switch target accepted by the Electron main process. */
export type DesktopDataHomeSwitchRequest =
  | { kind: 'desktop' }
  | { kind: 'official' }
  | { kind: 'custom'; selectionId: string }
  | { kind: 'create'; selectionId: string }

/** Restart state after persisting one data-home choice. */
export interface DesktopDataHomeSwitchResult {
  restarting: boolean
  activePath: string
}

/** Desktop-owned terminal command state mirrored from the Electron main process. */
export interface DesktopCliStatus {
  phase: 'unsupported' | 'uninstalled' | 'installed' | 'conflict' | 'broken' | 'setup-required' | 'unsupported-shell'
  commandPath: string
  dataHome: string
  conflictPath?: string
  shellProfile?: string
  reason?: 'setup-damaged' | 'setup-invalid' | 'runtime-unavailable' | 'runtime-incomplete' | 'launcher-missing' | 'profile-damaged'
  message?: string
}

/** Release discovery phases mirrored from the desktop wire protocol. */
export type DesktopReleaseStatus =
  | { phase: 'unsupported' }
  | { phase: 'idle' | 'checking' | 'current'; currentVersion: string }
  | {
    phase: 'available'
    currentVersion: string
    latestVersion: string
    tagName: string
    publishedAt: string
    releaseUrl: string
  }
  | { phase: 'error'; currentVersion: string; message: string }

/** Installer download phases mirrored from the desktop wire protocol. */
export type DesktopReleaseDownloadStatus =
  | { phase: 'unsupported' | 'idle' }
  | { phase: 'resolving'; version: string }
  | {
    phase: 'downloading'
    version: string
    fileName: string
    transferredBytes: number
    totalBytes: number
    percent: number
  }
  | { phase: 'verifying'; version: string; fileName: string }
  | { phase: 'ready'; version: string; fileName: string }
  | { phase: 'cancelled'; version: string }
  | { phase: 'error'; version?: string; message: string }

/** Preference and fixed-log operations exposed by the preload. */
export interface DesktopShellBridge {
  getCapabilities(): Promise<DesktopCapabilities>
  getDataHome(): Promise<DesktopDataHomeStatus>
  chooseDataHome(kind: DesktopDataHomeSelectionKind): Promise<DesktopDataHomeSelectionResult>
  switchDataHome(request: DesktopDataHomeSwitchRequest): Promise<DesktopDataHomeSwitchResult>
  getPreferences(): Promise<DesktopPreferences>
  updatePreferences(patch: Partial<DesktopPreferences>): Promise<DesktopPreferences>
  onPreferences(callback: (preferences: DesktopPreferences) => void): () => void
  openLog(): Promise<{ kind: 'file' | 'directory'; error: string }>
  getCommandLine(): Promise<DesktopCliStatus>
  installCommandLine(force: boolean): Promise<DesktopCliStatus>
  removeCommandLine(): Promise<DesktopCliStatus>
  reportReadiness(phase: 'client' | 'event-dispatch'): void
}

/** Release discovery plus verified installer download operations. */
export interface DesktopReleasesBridge {
  getStatus(): Promise<DesktopReleaseStatus>
  check(): Promise<DesktopReleaseStatus>
  onStatus(callback: (status: DesktopReleaseStatus) => void): () => void
  openDownload(releaseUrl: string): Promise<{ error: string }>
  getDownloadStatus(): Promise<DesktopReleaseDownloadStatus>
  startDownload(): Promise<DesktopReleaseDownloadStatus>
  cancelDownload(): Promise<DesktopReleaseDownloadStatus>
  openInstaller(): Promise<{ error: string }>
  onDownloadStatus(callback: (status: DesktopReleaseDownloadStatus) => void): () => void
}

/** Complete Electron-only browser bridge consumed by this plugin. */
export interface DesktopBridge {
  menu?: {
    reportState(state: { ready: boolean; locale: string }): void
    onCommand(callback: (command: string) => void | Promise<void>): () => void
  }
  shell: DesktopShellBridge
  releases: DesktopReleasesBridge
  desktopWeb: DesktopWebBridge
  icons?: DesktopIconsBridge
}

/**
 * Read a complete bridge or return null in an ordinary browser.
 * @returns the validated bridge pair, or null when either half is absent.
 */
export function readDesktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null
  const candidate = (globalThis as typeof globalThis & { deepSeekHarnessDesktop?: unknown }).deepSeekHarnessDesktop as {
    shell?: DesktopShellBridge
    releases?: DesktopReleasesBridge
    desktopWeb?: DesktopWebBridge
    icons?: DesktopIconsBridge
    menu?: DesktopBridge['menu']
  } | undefined
  return candidate?.shell === undefined || candidate.releases === undefined || candidate.desktopWeb === undefined
    ? null
    : { shell: candidate.shell, releases: candidate.releases, desktopWeb: candidate.desktopWeb,
      ...(candidate.menu === undefined ? {} : { menu: candidate.menu }),
      ...(candidate.icons === undefined ? {} : { icons: candidate.icons }) }
}

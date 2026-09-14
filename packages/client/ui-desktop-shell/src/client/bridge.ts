/** Browser-side copy of the narrow Electron preload protocol. */
import type { DesktopIconsBridge } from './icon-protocol.ts'

/** Closing hides the window in the tray or quits the desktop application. */
export type CloseBehavior = 'tray' | 'quit'
/** Desktop download policy whose credentials never enter the renderer. */
export type DownloadNetworkTarget = 'application' | 'npm' | 'github'
/** Allowed connection policies for one download target. */
export type DownloadProxyMode = 'existing' | 'system' | 'direct' | 'custom'

/** Redacted proxy selection visible to the desktop settings UI. */
export interface DownloadProxySettings {
  mode: DownloadProxyMode
  url?: string
  username?: string
  passwordSet: boolean
}

/** Current application, npm, and GitHub download policy. */
export interface DownloadNetworkSettings {
  schema: 'open-dsh-desktop/download-network/v1'
  revision: number
  application: { source: 'github' | 'cnb'; proxy: DownloadProxySettings }
  npm: { registry: 'npmjs' | 'npmmirror' | 'custom'; registryUrl?: string; proxy: DownloadProxySettings }
  github: { download: 'original' | 'custom'; acceleratorUrl?: string; proxy: DownloadProxySettings }
}

/** One validated per-target settings update. */
export interface DownloadNetworkPatch {
  target: DownloadNetworkTarget
  application?: { source: 'github' | 'cnb'; proxy: Omit<DownloadProxySettings, 'passwordSet'>; password?: string }
  npm?: { registry: DownloadNetworkSettings['npm']['registry']; registryUrl?: string; proxy: Omit<DownloadProxySettings, 'passwordSet'>; password?: string }
  github?: { download: 'original' | 'custom'; acceleratorUrl?: string; proxy: Omit<DownloadProxySettings, 'passwordSet'>; password?: string }
}

/** Bounded metadata or download probe reported by the main process. */
export type DownloadNetworkTestStatus =
  | { phase: 'idle' }
  | { phase: 'testing'; target: DownloadNetworkTarget; stage: 'metadata' | 'download' }
  | { phase: 'succeeded'; target: DownloadNetworkTarget; stage: 'metadata' | 'download'; elapsedMs: number }
  | { phase: 'failed'; target: DownloadNetworkTarget; stage: 'metadata' | 'download'; message: string }

/** Narrow desktop bridge for managing local download routing. */
export interface DesktopDownloadNetworkBridge {
  get(): Promise<DownloadNetworkSettings>
  update(patch: DownloadNetworkPatch): Promise<DownloadNetworkSettings>
  reset(target: DownloadNetworkTarget): Promise<DownloadNetworkSettings>
  getTestStatus(): Promise<DownloadNetworkTestStatus>
  test(target: DownloadNetworkTarget): Promise<DownloadNetworkTestStatus>
  onSettings(callback: (settings: DownloadNetworkSettings) => void): () => void
  onTestStatus(callback: (status: DownloadNetworkTestStatus) => void): () => void
}

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

/** Redacted managed process state from Electron. */
export interface DesktopProcessSnapshot {
  schema: 'open-dsh-desktop/managed-process/v1'
  id: string
  label: string
  lifecycle: 'task' | 'client' | 'legacy-child'
  plugin?: string
  phase: 'running' | 'stopping' | 'failed'
  startedAt: string
  containment: string
  stoppable: boolean
}

/** Opaque process-management operations; no PID or command is exposed. */
export interface DesktopProcessesBridge {
  list(): Promise<readonly DesktopProcessSnapshot[]>
  stop(id: string): Promise<readonly DesktopProcessSnapshot[]>
  persistentServices(): Promise<readonly DesktopPersistentServiceSummary[]>
  approvePersistentService(key: string): Promise<readonly DesktopPersistentServiceSummary[]>
  revokePersistentService(key: string): Promise<readonly DesktopPersistentServiceSummary[]>
  preparePluginUninstall(pluginName: string): Promise<{ readonly prepared: true }>
}

/** Redacted declaration awaiting or holding a user's persistent-service approval. */
export interface DesktopPersistentServiceSummary {
  key: string
  pluginName: string
  pluginVersion: string
  serviceId: string
  purpose: string
  specFingerprint: string
  status: 'pending' | 'approved'
  requestedAt: string
  approvedAt?: string
}

/** Platform and build-mode support reported by Electron. */
export interface DesktopCapabilities {
  platform: string
  packaged: boolean
  launchAtLoginAvailable: boolean
  sourceUpdateAvailable: boolean
  commandLineAvailable: boolean
  developmentRecoveryAvailable: boolean
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
    phase: 'switching'
    version: string
    fileName: string
    transferredBytes: number
    totalBytes: number
    resumeFromBytes: number
  }
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
  openLogDirectory(): Promise<{ error: string }>
  openSettingsDocument(): Promise<{ error: string }>
  getCommandLine(): Promise<DesktopCliStatus>
  installCommandLine(force: boolean): Promise<DesktopCliStatus>
  removeCommandLine(): Promise<DesktopCliStatus>
  enterRecoveryMode(): Promise<{ entered: true }>
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
  downloadNetwork?: DesktopDownloadNetworkBridge
  desktopWeb: DesktopWebBridge
  icons?: DesktopIconsBridge
  processes?: DesktopProcessesBridge
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
    downloadNetwork?: DesktopDownloadNetworkBridge
    desktopWeb?: DesktopWebBridge
    icons?: DesktopIconsBridge
    processes?: DesktopProcessesBridge
    menu?: DesktopBridge['menu']
  } | undefined
  return candidate?.shell === undefined || candidate.releases === undefined || candidate.desktopWeb === undefined
    ? null
    : { shell: candidate.shell, releases: candidate.releases, desktopWeb: candidate.desktopWeb,
      ...(candidate.downloadNetwork === undefined ? {} : { downloadNetwork: candidate.downloadNetwork }),
      ...(candidate.menu === undefined ? {} : { menu: candidate.menu }),
      ...(candidate.icons === undefined ? {} : { icons: candidate.icons }),
      ...(candidate.processes === undefined ? {} : { processes: candidate.processes }) }
}

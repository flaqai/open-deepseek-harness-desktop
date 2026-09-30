/** Renderer-visible values and capabilities from the narrow Electron preload protocol. */
import type { NasDeviceSummary } from '@deepseek-ai/dsh-nas-protocol'
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

/** Durable choice between the Local Runtime and one saved NAS Runtime. */
export type DesktopRuntimeSelection = { readonly kind: 'local' } | { readonly kind: 'nas'; readonly serverId: string }

/** Renderer-safe metadata for one saved NAS Runtime. */
export interface NasRuntimeRecord {
  readonly id: string
  readonly name: string
  readonly baseUrl: string
  readonly certificateFingerprint?: string
  readonly deviceId?: string
  readonly credentialExpiresAt?: string
  readonly lastConnectedAt?: string
}

/** Renderer-safe Runtime Selection, saved NAS Runtimes, and active metadata. */
export interface NasRuntimeStatus {
  readonly selection: DesktopRuntimeSelection
  readonly servers: readonly NasRuntimeRecord[]
  readonly secureStorageAvailable: boolean
  readonly active?: NasRuntimeRecord
}
export type { NasDeviceSummary } from '@deepseek-ai/dsh-nas-protocol'
/** Untrusted LAN address suggestion that still requires the Pairing Ceremony. */
export interface NasDiscoveryCandidate {
  readonly baseUrl: string
  readonly name: string
}

/** Fixed renderer intents for NAS Runtime discovery, pairing, and management. */
export interface DesktopNasBridge {
  get(): Promise<NasRuntimeStatus>
  discover(): Promise<readonly NasDiscoveryCandidate[]>
  inspect(baseUrl: string): Promise<{ readonly fingerprint: string }>
  pair(request: {
    readonly baseUrl: string
    readonly code: string
    readonly deviceName: string
    readonly certificateFingerprint: string
  }): Promise<NasRuntimeStatus>
  select(selection: DesktopRuntimeSelection): Promise<{ readonly restarting: true }>
  remove(serverId: string): Promise<NasRuntimeStatus>
  test(serverId: string): Promise<{ readonly healthy: true; readonly version: string }>
  devices(serverId: string): Promise<readonly NasDeviceSummary[]>
  revokeDevice(serverId: string, deviceId: string): Promise<readonly NasDeviceSummary[]>
  onStatus(callback: (status: NasRuntimeStatus) => void): () => void
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
  runtimeKind: 'local' | 'nas'
  platform: string
  packaged: boolean
  desktopVersion: string
  launchAtLoginAvailable: boolean
  sourceUpdateAvailable: boolean
  commandLineAvailable: boolean
  developmentRecoveryAvailable: boolean
}

/** User-authored fields accepted by the Desktop community feedback host. */
export interface CommunityFeedbackInput {
  kind: 'bug' | 'idea' | 'other'
  title: string
  body: string
  replyEmail?: string
  requestId: string
}

/** Fixed-destination feedback and mail operations. */
export interface CommunityFeedbackBridge {
  status(): Promise<{ enabled: boolean }>
  submit(input: CommunityFeedbackInput): Promise<{ status: 'received' | 'unavailable' | 'rate-limited' | 'failed'; id?: string }>
  openMail(input?: Omit<CommunityFeedbackInput, 'requestId'>): Promise<void>
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

/** Device-local operations that are intentionally absent from the NAS renderer. */
export interface DesktopLocalShellBridge {
  getDataHome(): Promise<DesktopDataHomeStatus>
  openDataHomeChooser(): Promise<{ restarting: boolean }>
  openLog(): Promise<{ kind: 'file' | 'directory'; error: string }>
  openLogDirectory(): Promise<{ error: string }>
  openSettingsDocument(): Promise<{ error: string }>
  getCommandLine(): Promise<DesktopCliStatus>
  installCommandLine(force: boolean): Promise<DesktopCliStatus>
  removeCommandLine(): Promise<DesktopCliStatus>
  enterRecoveryMode(): Promise<{ entered: true }>
}

/** Preference bridge shared by local and NAS renderer projections. */
export interface DesktopShellBridge extends Partial<DesktopLocalShellBridge> {
  getCapabilities(): Promise<DesktopCapabilities>
  getPreferences(): Promise<DesktopPreferences>
  updatePreferences(patch: Partial<DesktopPreferences>): Promise<DesktopPreferences>
  onPreferences(callback: (preferences: DesktopPreferences) => void): () => void
  reportReadiness(phase: 'client' | 'event-dispatch'): void
}

/**
 * Return the complete local projection, or undefined when the renderer is remote.
 * @param shell - renderer bridge that may be the reduced NAS projection.
 * @returns complete local capabilities only when every required method exists.
 */
export function readDesktopLocalShell(shell: DesktopShellBridge): DesktopLocalShellBridge | undefined {
  const candidate = shell as Partial<DesktopLocalShellBridge>
  return typeof candidate.getDataHome === 'function'
    && typeof candidate.openDataHomeChooser === 'function'
    && typeof candidate.openLog === 'function'
    && typeof candidate.openLogDirectory === 'function'
    && typeof candidate.openSettingsDocument === 'function'
    && typeof candidate.getCommandLine === 'function'
    && typeof candidate.installCommandLine === 'function'
    && typeof candidate.removeCommandLine === 'function'
    && typeof candidate.enterRecoveryMode === 'function'
    ? candidate as DesktopLocalShellBridge
    : undefined
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
  communityFeedback?: CommunityFeedbackBridge
  externalBrowser?: { open(url: string): Promise<void> }
  menu?: {
    reportState(state: { available: boolean; ready: boolean; locale: string }): void
    onCommand(callback: (command: string) => void | Promise<void>): () => void
  }
  shell: DesktopShellBridge
  releases: DesktopReleasesBridge
  downloadNetwork?: DesktopDownloadNetworkBridge
  desktopWeb: DesktopWebBridge
  icons?: DesktopIconsBridge
  processes?: DesktopProcessesBridge
  /** NAS runtime management, absent on older desktop hosts and ordinary Web. */
  nas?: DesktopNasBridge
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
    nas?: DesktopNasBridge
    menu?: DesktopBridge['menu']
    communityFeedback?: CommunityFeedbackBridge
    externalBrowser?: DesktopBridge['externalBrowser']
  } | undefined
  return candidate?.shell === undefined || candidate.releases === undefined || candidate.desktopWeb === undefined
    ? null
    : { shell: candidate.shell, releases: candidate.releases, desktopWeb: candidate.desktopWeb,
      ...(candidate.communityFeedback === undefined ? {} : { communityFeedback: candidate.communityFeedback }),
      ...(candidate.externalBrowser === undefined ? {} : { externalBrowser: candidate.externalBrowser }),
      ...(candidate.downloadNetwork === undefined ? {} : { downloadNetwork: candidate.downloadNetwork }),
      ...(candidate.nas === undefined ? {} : { nas: candidate.nas }),
      ...(candidate.menu === undefined ? {} : { menu: candidate.menu }),
      ...(candidate.icons === undefined ? {} : { icons: candidate.icons }),
      ...(candidate.processes === undefined ? {} : { processes: candidate.processes }) }
}

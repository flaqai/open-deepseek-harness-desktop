/** Browser-side copy of the narrow Electron preload protocol. */

export type CloseBehavior = 'tray' | 'quit'

/** Persisted preference values exposed by the desktop main process. */
export interface DesktopPreferences {
  closeBehavior: CloseBehavior
  notificationsEnabled: boolean
  launchAtLoginEnabled: boolean
}

/** Platform and build-mode support reported by Electron. */
export interface DesktopCapabilities {
  platform: string
  packaged: boolean
  launchAtLoginAvailable: boolean
  sourceUpdateAvailable: boolean
}

/** Release discovery phases mirrored from the desktop wire protocol. */
export type DesktopReleaseStatus =
  | { phase: 'unsupported' }
  | { phase: 'idle' | 'checking' | 'current'; currentVersion: string }
  | { phase: 'available'; currentVersion: string; latestVersion: string; publishedAt: string; releaseUrl: string }
  | { phase: 'error'; currentVersion: string; message: string }

/** Preference and fixed-log operations exposed by the preload. */
export interface DesktopShellBridge {
  getCapabilities(): Promise<DesktopCapabilities>
  getPreferences(): Promise<DesktopPreferences>
  updatePreferences(patch: Partial<DesktopPreferences>): Promise<DesktopPreferences>
  onPreferences(callback: (preferences: DesktopPreferences) => void): () => void
  openLog(): Promise<{ kind: 'file' | 'directory'; error: string }>
}

/** Read-only Release discovery and validated external-link operations. */
export interface DesktopReleasesBridge {
  getStatus(): Promise<DesktopReleaseStatus>
  check(): Promise<DesktopReleaseStatus>
  onStatus(callback: (status: DesktopReleaseStatus) => void): () => void
  openDownload(releaseUrl: string): Promise<{ error: string }>
}

/** Complete Electron-only browser bridge consumed by this plugin. */
export interface DesktopBridge {
  shell: DesktopShellBridge
  releases: DesktopReleasesBridge
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
  } | undefined
  return candidate?.shell === undefined || candidate.releases === undefined
    ? null
    : { shell: candidate.shell, releases: candidate.releases }
}

/** Narrow reader for desktop-owned imported plugin restoration. */

export type ImportedPluginRestoreState =
  | 'pending'
  | 'installing'
  | 'provided'
  | 'succeeded'
  | 'failed'
  | 'ignored'

/** Sanitized imported plugin entry exposed by the desktop host. */
export interface ImportedPluginRestoreEntry {
  readonly restoreId: string
  readonly packageName: string
  readonly declaredSpec: string
  readonly category: 'plugin' | 'external-tool'
  readonly tool?: 'codex' | 'claude-code'
  readonly defaultSelected: boolean
  readonly recoverable: boolean
  readonly unsupportedReason?: 'local-source' | 'credentialed-source' | 'invalid-spec'
  readonly state: ImportedPluginRestoreState
  readonly diagnostic?: string
  readonly availability: 'checking' | 'available' | 'unavailable' | 'unknown' | 'provided'
  readonly availabilityDiagnostic?: string
}

/** Current restoration state used by the first-entry dialog and settings card. */
export interface ImportedPluginRestoreSnapshot {
  readonly firstPromptDismissed: boolean
  readonly ignored: boolean
  readonly sourceIssues: readonly string[]
  readonly entries: readonly ImportedPluginRestoreEntry[]
  readonly active: boolean
  readonly sourceCheckActive: boolean
  readonly restartRequired: boolean
}

/** Narrow desktop capability for restoring entries by opaque identifier only. */
export interface ImportedPluginRestoreBridge {
  readonly development?: true
  get(): Promise<ImportedPluginRestoreSnapshot | undefined>
  checkSources(): Promise<ImportedPluginRestoreSnapshot | undefined>
  start(restoreIds: readonly string[]): Promise<ImportedPluginRestoreSnapshot>
  chooseLocalDirectory(restoreId: string): Promise<ImportedPluginRestoreSnapshot | undefined>
  chooseLocalArchive(restoreId: string): Promise<ImportedPluginRestoreSnapshot | undefined>
  choosePortableBundle?(): Promise<ImportedPluginRestoreSnapshot | undefined>
  inspectExport?(): Promise<{
    selectionId: string
    host: { platform: 'darwin' | 'win32' | 'linux'; architecture: 'arm64' | 'x64'; osVersion: string }
    candidates: readonly { packageName: string; version: string }[]
    omitted: readonly { packageName: string; reason: string }[]
  } | undefined>
  exportBundle?(request: {
    selectionId: string
    target: { platform: 'darwin' | 'win32' | 'linux'; architecture: 'arm64' | 'x64'; osVersion: string }
    packageNames: readonly string[]
  }): Promise<{ status: 'saved' | 'cancelled' }>
  dismiss(): Promise<ImportedPluginRestoreSnapshot | undefined>
  ignore(): Promise<ImportedPluginRestoreSnapshot | undefined>
}

/**
 * Resolve the fixed Electron bridge, or no capability in ordinary browsers.
 *
 * @returns The validated restoration bridge when running in the desktop host.
 */
export function readImportedPluginRestoreBridge(): ImportedPluginRestoreBridge | undefined {
  const desktop = (globalThis as typeof globalThis & { deepSeekHarnessDesktop?: unknown }).deepSeekHarnessDesktop
  if (desktop === null || typeof desktop !== 'object') return undefined
  const imported = (desktop as { importedPlugins?: unknown }).importedPlugins
  if (imported === null || typeof imported !== 'object') return undefined
  const candidate = imported as Partial<ImportedPluginRestoreBridge>
  if (typeof candidate.get !== 'function' || typeof candidate.checkSources !== 'function'
    || typeof candidate.start !== 'function' || typeof candidate.chooseLocalDirectory !== 'function'
    || typeof candidate.chooseLocalArchive !== 'function'
    || typeof candidate.dismiss !== 'function' || typeof candidate.ignore !== 'function') return undefined
  return candidate as ImportedPluginRestoreBridge
}

/** Narrow update bridge for the trusted Harness renderer. */

import { contextBridge, ipcRenderer } from 'electron'
import { CLIENT_COMMANDS } from './application-menu.ts'
import { DESKTOP_IPC } from './desktop-ipc-protocol.ts'
import type {
  DesktopShortcutInput, ShortcutConfigSnapshot, ShortcutDefinition, ShortcutEdit, ShortcutRevision, ShortcutSaveResult,
} from '@deepseek-ai/dsh-client-shortcuts/protocol'
import type { DesktopIconsBridge, DesktopIconStatus, IconSelection } from './icon-protocol.ts'
import type { OpenLogResult } from './log-reveal.ts'
import type { DesktopPreferences, DesktopPreferencesPatch } from './preferences.ts'
import type { DesktopReleaseStatus } from './release-checker.ts'
import type { DesktopReleaseDownloadStatus } from './release-downloader.ts'
import type { SourceUpdateResult, SourceUpdateStatus } from './source-updater.ts'
import type { DesktopCliStatus } from './desktop-cli-registration.ts'
import type {
  DesktopDataHomeStatus,
} from './desktop-data-home.ts'
import type { DesktopChatBackground } from './chat-background-store.ts'
import type {
  BundledPluginDeferredStartResult,
  BundledPluginInstallSnapshot,
  BundledPluginStartResult,
} from './bundled-plugin-installer.ts'
import type { ImportedPluginRestoreSnapshot } from './imported-plugin-restore.ts'
import type {
  DiagnosticLabRunSnapshot,
  DiagnosticLabScenario,
  DiagnosticLabStartRequest,
} from './diagnostic-lab.ts'
import type {
  PluginSnapshotRestoreSnapshot,
  PluginSnapshotSummary,
} from './plugin-snapshot-manager.ts'
import type {
  DesktopExternalToolId,
  ExternalToolInstallResolution,
} from './external-tool-compatibility-manifest.ts'
import { installLoadingPage } from './loading-page.ts'
import type { StartupDiagnosticIncident } from './startup-diagnostics.ts'
import type { DesktopProcessSnapshot } from './process-observer.ts'
import type { PersistentServiceSummary } from '@deepseek-ai/dsh-subprocess'
import type { DesktopWebOpenResult, DesktopWebStatus } from './desktop-web-access.ts'
import type {
  DownloadNetworkPatch, DownloadNetworkSettings, DownloadNetworkTarget, DownloadNetworkTestStatus,
} from './download-network-settings.ts'
import type {
  DesktopRuntimeSelection, NasDeviceSummary, NasDiscoveryCandidate, NasPairingRequest, NasRuntimeStatus,
} from './nas-runtime.ts'
import type {
  WorkspaceRuntimeJobSnapshot,
  WorkspaceRuntimeOutputRead,
  WorkspaceRuntimeSnapshot,
} from './workspace-runtime-manager.ts'
import type { WorkspaceRuntimeCapability } from './workspace-runtime-manifest.ts'

/** Renderer-visible update methods; no generic process or filesystem access is exposed. */
export interface DesktopUpdateBridge {
  check(): Promise<SourceUpdateStatus>
  upgrade(expectedCommit: string): Promise<SourceUpdateResult>
  restart(): Promise<{ restarting: true }>
}

const bridge: DesktopUpdateBridge = {
  check: () => ipcRenderer.invoke(DESKTOP_IPC.sourceUpdateCheck) as Promise<SourceUpdateStatus>,
  upgrade: expectedCommit => ipcRenderer.invoke(DESKTOP_IPC.sourceUpdateUpgrade, expectedCommit) as Promise<SourceUpdateResult>,
  restart: () => ipcRenderer.invoke(DESKTOP_IPC.sourceUpdateRestart) as Promise<{ restarting: true }>,
}

/** Capability flags returned by the trusted main process. */
export interface DesktopCapabilities {
  runtimeKind: 'local' | 'nas'
  platform: NodeJS.Platform
  packaged: boolean
  launchAtLoginAvailable: boolean
  sourceUpdateAvailable: boolean
  commandLineAvailable: boolean
  developmentRecoveryAvailable: boolean
}

/** Device-local shell operations that must never cross the NAS renderer boundary implicitly. */
export interface DesktopLocalShellBridge {
  getDataHome(): Promise<DesktopDataHomeStatus>
  openDataHomeChooser(): Promise<{ restarting: boolean }>
  openLog(): Promise<OpenLogResult>
  openLogDirectory(): Promise<{ error: string }>
  openSettingsDocument(): Promise<{ error: string }>
  backupAndResetSettings(): Promise<{ backupName?: string; restarting: true }>
  restart(): Promise<{ restarting: true }>
  getCommandLine(): Promise<DesktopCliStatus>
  installCommandLine(force: boolean): Promise<DesktopCliStatus>
  removeCommandLine(): Promise<DesktopCliStatus>
  enterRecoveryMode(): Promise<{ entered: true }>
}

/** Narrow desktop-shell bridge shared by local and NAS renderer projections. */
export interface DesktopShellBridge extends Partial<DesktopLocalShellBridge> {
  getCapabilities(): Promise<DesktopCapabilities>
  getPreferences(): Promise<DesktopPreferences>
  updatePreferences(patch: DesktopPreferencesPatch): Promise<DesktopPreferences>
  onPreferences(callback: (preferences: DesktopPreferences) => void): () => void
  restart(): Promise<{ restarting: true }>
  reportReadiness(phase: 'client' | 'event-dispatch'): void
}

/** Release discovery and verified system-assisted installer download bridge. */
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

/** Validated routing settings for desktop-owned downloads. */
export interface DesktopDownloadNetworkBridge {
  get(): Promise<DownloadNetworkSettings>
  update(patch: DownloadNetworkPatch): Promise<DownloadNetworkSettings>
  reset(target: DownloadNetworkTarget): Promise<DownloadNetworkSettings>
  getTestStatus(): Promise<DownloadNetworkTestStatus>
  test(target: DownloadNetworkTarget): Promise<DownloadNetworkTestStatus>
  onSettings(callback: (settings: DownloadNetworkSettings) => void): () => void
  onTestStatus(callback: (status: DownloadNetworkTestStatus) => void): () => void
}

/** URL-free access to the main process's authenticated local Web handoff. */
export interface DesktopWebBridge {
  getStatus(): Promise<DesktopWebStatus>
  open(): Promise<DesktopWebOpenResult>
  onStatus(callback: (status: DesktopWebStatus) => void): () => void
}

/** Saved NAS runtimes and fixed pairing operations; tokens never reach the renderer. */
export interface DesktopNasBridge {
  get(): Promise<NasRuntimeStatus>
  discover(): Promise<readonly NasDiscoveryCandidate[]>
  inspect(baseUrl: string): Promise<{ readonly fingerprint: string }>
  pair(request: NasPairingRequest): Promise<NasRuntimeStatus>
  select(selection: DesktopRuntimeSelection): Promise<{ readonly restarting: true }>
  remove(serverId: string): Promise<NasRuntimeStatus>
  test(serverId: string): Promise<{ readonly healthy: true; readonly version: string }>
  devices(serverId: string): Promise<readonly NasDeviceSummary[]>
  revokeDevice(serverId: string, deviceId: string): Promise<readonly NasDeviceSummary[]>
  onStatus(callback: (status: NasRuntimeStatus) => void): () => void
}

/** Exact allowlisted bundled-plugin operations; no arbitrary package path is exposed. */
export interface DesktopBundledPluginsBridge {
  startInstall(request: { profile: string; packageSpec: string }): Promise<BundledPluginStartResult>
  startDeferred(request: { profile: string; packageSpec: string }): Promise<BundledPluginDeferredStartResult>
  getInstall(installId: string): Promise<BundledPluginInstallSnapshot>
}

/** Closed external-tool ids resolved to signed, exact coordinates by main. */
export interface DesktopExternalToolsBridge {
  resolve(toolId: DesktopExternalToolId): Promise<ExternalToolInstallResolution>
}

/** Closed optional-runtime operations; renderer input contains no URL, path, or package coordinate. */
export interface DesktopWorkspaceRuntimesBridge {
  get(): Promise<WorkspaceRuntimeSnapshot>
  choosePython(): Promise<WorkspaceRuntimeSnapshot | undefined>
  useManagedPython(): Promise<WorkspaceRuntimeSnapshot>
  installOffice(allowPackageChanges: boolean): Promise<WorkspaceRuntimeSnapshot>
  start(capabilityId: WorkspaceRuntimeCapability): Promise<WorkspaceRuntimeJobSnapshot>
  getJob(jobId: string): Promise<WorkspaceRuntimeJobSnapshot>
  readOutput(jobId: string, offset: number): Promise<WorkspaceRuntimeOutputRead>
  pause(jobId: string): Promise<WorkspaceRuntimeJobSnapshot>
  cancel(jobId: string): Promise<WorkspaceRuntimeJobSnapshot>
  activate(capabilityId: WorkspaceRuntimeCapability): Promise<WorkspaceRuntimeSnapshot>
  remove(capabilityId: WorkspaceRuntimeCapability): Promise<WorkspaceRuntimeSnapshot>
}

/** Opaque-id restore operations; package specs never cross from renderer to main. */
export interface DesktopImportedPluginsBridge {
  readonly development?: true
  get(): Promise<ImportedPluginRestoreSnapshot | undefined>
  checkSources(): Promise<ImportedPluginRestoreSnapshot | undefined>
  start(restoreIds: readonly string[]): Promise<ImportedPluginRestoreSnapshot>
  chooseLocalDirectory(restoreId: string): Promise<ImportedPluginRestoreSnapshot | undefined>
  chooseLocalArchive(restoreId: string): Promise<ImportedPluginRestoreSnapshot | undefined>
  choosePortableBundle(): Promise<ImportedPluginRestoreSnapshot | undefined>
  inspectExport(): Promise<{
    selectionId: string
    host: { platform: 'darwin' | 'win32' | 'linux'; architecture: 'arm64' | 'x64'; osVersion: string }
    candidates: readonly { packageName: string; version: string }[]
    omitted: readonly { packageName: string; reason: string }[]
  } | undefined>
  exportBundle(request: {
    selectionId: string
    target: { platform: 'darwin' | 'win32' | 'linux'; architecture: 'arm64' | 'x64'; osVersion: string }
    packageNames: readonly string[]
  }): Promise<{ status: 'saved' | 'cancelled' }>
  dismiss(): Promise<ImportedPluginRestoreSnapshot | undefined>
  ignore(): Promise<ImportedPluginRestoreSnapshot | undefined>
}

/** Fixed desktop diagnostic exercises; no renderer-supplied path or command is accepted. */
export interface DesktopDiagnosticLabBridge {
  catalog(): Promise<readonly DiagnosticLabScenario[]>
  current(): Promise<DiagnosticLabRunSnapshot | undefined>
  start(request: DiagnosticLabStartRequest): Promise<DiagnosticLabRunSnapshot>
  getRun(runId: string): Promise<DiagnosticLabRunSnapshot>
  cancel(runId: string): Promise<DiagnosticLabRunSnapshot>
  restoreAll(runId: string): Promise<DiagnosticLabRunSnapshot>
  exportReport(runId: string): Promise<string>
  onStatus(callback: (snapshot: DiagnosticLabRunSnapshot) => void): () => void
}

/** Opaque Profile plugin snapshot operations owned by Electron. */
export interface DesktopPluginSnapshotsBridge {
  list(): Promise<readonly PluginSnapshotSummary[]>
  create(label?: string): Promise<{ readonly snapshotId: string }>
  remove(snapshotId: string): Promise<readonly PluginSnapshotSummary[]>
  startRestore(snapshotId: string, networkAllowed: boolean): Promise<PluginSnapshotRestoreSnapshot>
  getRestore(operationId: string): Promise<PluginSnapshotRestoreSnapshot>
  onStatus(callback: (snapshot: PluginSnapshotRestoreSnapshot) => void): () => void
}

/** Read-only startup incidents and a fixed log action. */
export interface DesktopStartupDiagnosticsBridge {
  list(): Promise<readonly StartupDiagnosticIncident[]>
  retry(incidentId: string): Promise<{
    readonly status: 'plugin-started' | 'restarting' | 'unsupported'
    readonly installId?: string
  }>
  openLog(): Promise<OpenLogResult>
}

/** Redacted desktop process inventory and opaque stop operation. */
export interface DesktopProcessesBridge {
  list(): Promise<readonly DesktopProcessSnapshot[]>
  stop(id: string): Promise<readonly DesktopProcessSnapshot[]>
  persistentServices(): Promise<readonly PersistentServiceSummary[]>
  approvePersistentService(key: string): Promise<readonly PersistentServiceSummary[]>
  revokePersistentService(key: string): Promise<readonly PersistentServiceSummary[]>
  preparePluginUninstall(pluginName: string): Promise<{ readonly prepared: true }>
}

/** Device-local background persistence owned by the desktop data directory. */
export interface DesktopChatBackgroundBridge {
  read(): Promise<DesktopChatBackground | undefined>
  write(background: DesktopChatBackground): Promise<DesktopChatBackground>
}

const shellBridge: DesktopShellBridge = {
  getCapabilities: () => ipcRenderer.invoke(DESKTOP_IPC.capabilities) as Promise<DesktopCapabilities>,
  getDataHome: () => ipcRenderer.invoke(DESKTOP_IPC.dataHomeGet) as Promise<DesktopDataHomeStatus>,
  openDataHomeChooser: () => ipcRenderer.invoke(
    DESKTOP_IPC.dataHomeOpenChooser,
  ) as Promise<{ restarting: boolean }>,
  getPreferences: () => ipcRenderer.invoke(DESKTOP_IPC.preferencesGet) as Promise<DesktopPreferences>,
  updatePreferences: patch => ipcRenderer.invoke(DESKTOP_IPC.preferencesUpdate, patch) as Promise<DesktopPreferences>,
  onPreferences(callback) {
    const listener = (_event: Electron.IpcRendererEvent, next: DesktopPreferences): void => { callback(next) }
    ipcRenderer.on(DESKTOP_IPC.preferencesChanged, listener)
    return () => { ipcRenderer.removeListener(DESKTOP_IPC.preferencesChanged, listener) }
  },
  openLog: () => ipcRenderer.invoke(DESKTOP_IPC.logOpen) as Promise<OpenLogResult>,
  openLogDirectory: () => ipcRenderer.invoke(DESKTOP_IPC.logDirectoryOpen) as Promise<{ error: string }>,
  openSettingsDocument: () => ipcRenderer.invoke(DESKTOP_IPC.settingsOpen) as Promise<{ error: string }>,
  backupAndResetSettings: () => ipcRenderer.invoke(
    DESKTOP_IPC.settingsReset,
  ) as Promise<{ backupName?: string; restarting: true }>,
  restart: () => ipcRenderer.invoke(DESKTOP_IPC.restart) as Promise<{ restarting: true }>,
  getCommandLine: () => ipcRenderer.invoke(DESKTOP_IPC.cliGet) as Promise<DesktopCliStatus>,
  installCommandLine: force => ipcRenderer.invoke(DESKTOP_IPC.cliInstall, force) as Promise<DesktopCliStatus>,
  removeCommandLine: () => ipcRenderer.invoke(DESKTOP_IPC.cliRemove) as Promise<DesktopCliStatus>,
  enterRecoveryMode: () => ipcRenderer.invoke(
    DESKTOP_IPC.recoveryEnter,
  ) as Promise<{ entered: true }>,
  reportReadiness: (phase) => { ipcRenderer.send(DESKTOP_IPC.readiness, phase) },
}

const releasesBridge: DesktopReleasesBridge = {
  getStatus: () => ipcRenderer.invoke(DESKTOP_IPC.releasesGet) as Promise<DesktopReleaseStatus>,
  check: () => ipcRenderer.invoke(DESKTOP_IPC.releasesCheck) as Promise<DesktopReleaseStatus>,
  onStatus(callback) {
    const listener = (_event: Electron.IpcRendererEvent, next: DesktopReleaseStatus): void => { callback(next) }
    ipcRenderer.on(DESKTOP_IPC.releaseStatus, listener)
    return () => { ipcRenderer.removeListener(DESKTOP_IPC.releaseStatus, listener) }
  },
  openDownload: releaseUrl => ipcRenderer.invoke(DESKTOP_IPC.releasesOpen, releaseUrl) as Promise<{ error: string }>,
  getDownloadStatus: () => ipcRenderer.invoke(
    DESKTOP_IPC.releasesDownloadGet,
  ) as Promise<DesktopReleaseDownloadStatus>,
  startDownload: () => ipcRenderer.invoke(
    DESKTOP_IPC.releasesDownloadStart,
  ) as Promise<DesktopReleaseDownloadStatus>,
  cancelDownload: () => ipcRenderer.invoke(
    DESKTOP_IPC.releasesDownloadCancel,
  ) as Promise<DesktopReleaseDownloadStatus>,
  openInstaller: () => ipcRenderer.invoke(
    DESKTOP_IPC.releasesDownloadOpen,
  ) as Promise<{ error: string }>,
  onDownloadStatus(callback) {
    const listener = (_event: Electron.IpcRendererEvent, next: DesktopReleaseDownloadStatus): void => { callback(next) }
    ipcRenderer.on(DESKTOP_IPC.releaseDownloadStatus, listener)
    return () => { ipcRenderer.removeListener(DESKTOP_IPC.releaseDownloadStatus, listener) }
  },
}

const downloadNetworkBridge: DesktopDownloadNetworkBridge = {
  get: () => ipcRenderer.invoke(DESKTOP_IPC.downloadNetworkGet) as Promise<DownloadNetworkSettings>,
  update: patch => ipcRenderer.invoke(DESKTOP_IPC.downloadNetworkUpdate, patch) as Promise<DownloadNetworkSettings>,
  reset: target => ipcRenderer.invoke(DESKTOP_IPC.downloadNetworkReset, target) as Promise<DownloadNetworkSettings>,
  getTestStatus: () => ipcRenderer.invoke(DESKTOP_IPC.downloadNetworkTestGet) as Promise<DownloadNetworkTestStatus>,
  test: target => ipcRenderer.invoke(DESKTOP_IPC.downloadNetworkTest, target) as Promise<DownloadNetworkTestStatus>,
  onSettings(callback) {
    const listener = (_event: Electron.IpcRendererEvent, settings: DownloadNetworkSettings): void => { callback(settings) }
    ipcRenderer.on(DESKTOP_IPC.downloadNetworkChanged, listener)
    return () => { ipcRenderer.removeListener(DESKTOP_IPC.downloadNetworkChanged, listener) }
  },
  onTestStatus(callback) {
    const listener = (_event: Electron.IpcRendererEvent, status: DownloadNetworkTestStatus): void => { callback(status) }
    ipcRenderer.on(DESKTOP_IPC.downloadNetworkTestStatus, listener)
    return () => { ipcRenderer.removeListener(DESKTOP_IPC.downloadNetworkTestStatus, listener) }
  },
}

const nasBridge: DesktopNasBridge = {
  get: () => ipcRenderer.invoke(DESKTOP_IPC.nasGet) as Promise<NasRuntimeStatus>,
  discover: () => ipcRenderer.invoke(DESKTOP_IPC.nasDiscover) as Promise<readonly NasDiscoveryCandidate[]>,
  inspect: baseUrl => ipcRenderer.invoke(DESKTOP_IPC.nasInspect, baseUrl) as Promise<{ fingerprint: string }>,
  pair: request => ipcRenderer.invoke(DESKTOP_IPC.nasPair, request) as Promise<NasRuntimeStatus>,
  select: selection => ipcRenderer.invoke(DESKTOP_IPC.nasSelect, selection) as Promise<{ restarting: true }>,
  remove: serverId => ipcRenderer.invoke(DESKTOP_IPC.nasRemove, serverId) as Promise<NasRuntimeStatus>,
  test: serverId => ipcRenderer.invoke(DESKTOP_IPC.nasTest, serverId) as Promise<{ healthy: true; version: string }>,
  devices: serverId => ipcRenderer.invoke(DESKTOP_IPC.nasDevices, serverId) as Promise<readonly NasDeviceSummary[]>,
  revokeDevice: (serverId, deviceId) => ipcRenderer.invoke(
    DESKTOP_IPC.nasRevokeDevice, serverId, deviceId,
  ) as Promise<readonly NasDeviceSummary[]>,
  onStatus(callback) {
    const listener = (_event: Electron.IpcRendererEvent, status: NasRuntimeStatus): void => { callback(status) }
    ipcRenderer.on(DESKTOP_IPC.nasStatus, listener)
    return () => { ipcRenderer.removeListener(DESKTOP_IPC.nasStatus, listener) }
  },
}

const desktopWebBridge: DesktopWebBridge = {
  getStatus: () => ipcRenderer.invoke(DESKTOP_IPC.webGet) as Promise<DesktopWebStatus>,
  open: () => ipcRenderer.invoke(DESKTOP_IPC.webOpen) as Promise<DesktopWebOpenResult>,
  onStatus(callback) {
    const listener = (_event: Electron.IpcRendererEvent, status: DesktopWebStatus): void => { callback(status) }
    ipcRenderer.on(DESKTOP_IPC.webStatus, listener)
    return () => { ipcRenderer.removeListener(DESKTOP_IPC.webStatus, listener) }
  },
}

const bundledPluginsBridge: DesktopBundledPluginsBridge = {
  startInstall: request => ipcRenderer.invoke(DESKTOP_IPC.bundledPluginsStart, request) as Promise<BundledPluginStartResult>,
  startDeferred: request => ipcRenderer.invoke(
    DESKTOP_IPC.bundledPluginsStartDeferred, request,
  ) as Promise<BundledPluginDeferredStartResult>,
  getInstall: installId => ipcRenderer.invoke(DESKTOP_IPC.bundledPluginsGet, installId) as Promise<BundledPluginInstallSnapshot>,
}

const externalToolsBridge: DesktopExternalToolsBridge = {
  resolve: toolId => ipcRenderer.invoke(
    DESKTOP_IPC.externalToolsResolve, toolId,
  ) as Promise<ExternalToolInstallResolution>,
}

const workspaceRuntimesBridge: DesktopWorkspaceRuntimesBridge = {
  get: () => ipcRenderer.invoke(DESKTOP_IPC.workspaceRuntimesGet) as Promise<WorkspaceRuntimeSnapshot>,
  choosePython: () => ipcRenderer.invoke(DESKTOP_IPC.workspaceRuntimesChoosePython) as Promise<WorkspaceRuntimeSnapshot | undefined>,
  useManagedPython: () => ipcRenderer.invoke(DESKTOP_IPC.workspaceRuntimesManagedPython) as Promise<WorkspaceRuntimeSnapshot>,
  installOffice: allowPackageChanges => ipcRenderer.invoke(
    DESKTOP_IPC.workspaceRuntimesInstallOffice, allowPackageChanges,
  ) as Promise<WorkspaceRuntimeSnapshot>,
  start: capabilityId => ipcRenderer.invoke(
    DESKTOP_IPC.workspaceRuntimesStart, capabilityId,
  ) as Promise<WorkspaceRuntimeJobSnapshot>,
  getJob: jobId => ipcRenderer.invoke(DESKTOP_IPC.workspaceRuntimesGetJob, jobId) as Promise<WorkspaceRuntimeJobSnapshot>,
  readOutput: (jobId, offset) => ipcRenderer.invoke(
    DESKTOP_IPC.workspaceRuntimesOutput, jobId, offset,
  ) as Promise<WorkspaceRuntimeOutputRead>,
  pause: jobId => ipcRenderer.invoke(DESKTOP_IPC.workspaceRuntimesPause, jobId) as Promise<WorkspaceRuntimeJobSnapshot>,
  cancel: jobId => ipcRenderer.invoke(DESKTOP_IPC.workspaceRuntimesCancel, jobId) as Promise<WorkspaceRuntimeJobSnapshot>,
  activate: capabilityId => ipcRenderer.invoke(
    DESKTOP_IPC.workspaceRuntimesActivate, capabilityId,
  ) as Promise<WorkspaceRuntimeSnapshot>,
  remove: capabilityId => ipcRenderer.invoke(
    DESKTOP_IPC.workspaceRuntimesRemove, capabilityId,
  ) as Promise<WorkspaceRuntimeSnapshot>,
}

const remoteWorkspaceRuntimeUnavailable = (): Promise<never> => Promise.reject(
  new Error('desktop workspace runtimes require the local runtime'),
)
const remoteWorkspaceRuntimesBridge: DesktopWorkspaceRuntimesBridge = {
  get: () => Promise.resolve({
    currentHome: '',
    python: { source: 'managed' },
    capabilities: {
      office: { capabilityId: 'office', phase: 'nas-unavailable' },
      ptc: { capabilityId: 'ptc', phase: 'nas-unavailable' },
    },
  }),
  choosePython: remoteWorkspaceRuntimeUnavailable,
  useManagedPython: remoteWorkspaceRuntimeUnavailable,
  installOffice: remoteWorkspaceRuntimeUnavailable,
  start: remoteWorkspaceRuntimeUnavailable,
  getJob: remoteWorkspaceRuntimeUnavailable,
  readOutput: remoteWorkspaceRuntimeUnavailable,
  pause: remoteWorkspaceRuntimeUnavailable,
  cancel: remoteWorkspaceRuntimeUnavailable,
  activate: remoteWorkspaceRuntimeUnavailable,
  remove: remoteWorkspaceRuntimeUnavailable,
}

const importedPluginsBridge: DesktopImportedPluginsBridge = {
  get: () => ipcRenderer.invoke(DESKTOP_IPC.importedPluginsGet) as Promise<ImportedPluginRestoreSnapshot | undefined>,
  checkSources: () => ipcRenderer.invoke(
    DESKTOP_IPC.importedPluginsCheckSources,
  ) as Promise<ImportedPluginRestoreSnapshot | undefined>,
  start: restoreIds => ipcRenderer.invoke(
    DESKTOP_IPC.importedPluginsStart, [...restoreIds],
  ) as Promise<ImportedPluginRestoreSnapshot>,
  chooseLocalDirectory: restoreId => ipcRenderer.invoke(
    DESKTOP_IPC.importedPluginsChooseDirectory, restoreId,
  ) as Promise<ImportedPluginRestoreSnapshot | undefined>,
  chooseLocalArchive: restoreId => ipcRenderer.invoke(
    DESKTOP_IPC.importedPluginsChooseArchive, restoreId,
  ) as Promise<ImportedPluginRestoreSnapshot | undefined>,
  choosePortableBundle: () => ipcRenderer.invoke(
    DESKTOP_IPC.importedPluginsChoosePortable,
  ) as Promise<ImportedPluginRestoreSnapshot | undefined>,
  inspectExport: () => ipcRenderer.invoke(DESKTOP_IPC.importedPluginsInspectExport) as ReturnType<DesktopImportedPluginsBridge['inspectExport']>,
  exportBundle: request => ipcRenderer.invoke(DESKTOP_IPC.importedPluginsExport, request) as ReturnType<DesktopImportedPluginsBridge['exportBundle']>,
  dismiss: () => ipcRenderer.invoke(
    DESKTOP_IPC.importedPluginsDismiss,
  ) as Promise<ImportedPluginRestoreSnapshot | undefined>,
  ignore: () => ipcRenderer.invoke(
    DESKTOP_IPC.importedPluginsIgnore,
  ) as Promise<ImportedPluginRestoreSnapshot | undefined>,
}

const diagnosticLabBridge: DesktopDiagnosticLabBridge = {
  catalog: () => ipcRenderer.invoke(DESKTOP_IPC.diagnosticLabCatalog) as Promise<readonly DiagnosticLabScenario[]>,
  current: () => ipcRenderer.invoke(DESKTOP_IPC.diagnosticLabCurrent) as Promise<DiagnosticLabRunSnapshot | undefined>,
  start: request => ipcRenderer.invoke(DESKTOP_IPC.diagnosticLabStart, request) as Promise<DiagnosticLabRunSnapshot>,
  getRun: runId => ipcRenderer.invoke(DESKTOP_IPC.diagnosticLabGet, runId) as Promise<DiagnosticLabRunSnapshot>,
  cancel: runId => ipcRenderer.invoke(DESKTOP_IPC.diagnosticLabCancel, runId) as Promise<DiagnosticLabRunSnapshot>,
  restoreAll: runId => ipcRenderer.invoke(DESKTOP_IPC.diagnosticLabRestoreAll, runId) as Promise<DiagnosticLabRunSnapshot>,
  exportReport: runId => ipcRenderer.invoke(DESKTOP_IPC.diagnosticLabExport, runId) as Promise<string>,
  onStatus(callback) {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: DiagnosticLabRunSnapshot): void => { callback(snapshot) }
    ipcRenderer.on(DESKTOP_IPC.diagnosticLabStatus, listener)
    return () => { ipcRenderer.removeListener(DESKTOP_IPC.diagnosticLabStatus, listener) }
  },
}

const pluginSnapshotsBridge: DesktopPluginSnapshotsBridge = {
  list: () => ipcRenderer.invoke(DESKTOP_IPC.pluginSnapshotsList) as Promise<readonly PluginSnapshotSummary[]>,
  create: label => ipcRenderer.invoke(DESKTOP_IPC.pluginSnapshotsCreate, label) as Promise<{ readonly snapshotId: string }>,
  remove: snapshotId => ipcRenderer.invoke(
    DESKTOP_IPC.pluginSnapshotsRemove, snapshotId,
  ) as Promise<readonly PluginSnapshotSummary[]>,
  startRestore: (snapshotId, networkAllowed) => ipcRenderer.invoke(
    DESKTOP_IPC.pluginSnapshotsRestore, snapshotId, networkAllowed,
  ) as Promise<PluginSnapshotRestoreSnapshot>,
  getRestore: operationId => ipcRenderer.invoke(
    DESKTOP_IPC.pluginSnapshotsRestoreGet, operationId,
  ) as Promise<PluginSnapshotRestoreSnapshot>,
  onStatus(callback) {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: PluginSnapshotRestoreSnapshot): void => { callback(snapshot) }
    ipcRenderer.on(DESKTOP_IPC.pluginSnapshotsStatus, listener)
    return () => { ipcRenderer.removeListener(DESKTOP_IPC.pluginSnapshotsStatus, listener) }
  },
}

const startupDiagnosticsBridge: DesktopStartupDiagnosticsBridge = {
  list: () => ipcRenderer.invoke(
    DESKTOP_IPC.startupDiagnosticsList,
  ) as Promise<readonly StartupDiagnosticIncident[]>,
  retry: incidentId => ipcRenderer.invoke(
    DESKTOP_IPC.startupDiagnosticsRetry, incidentId,
  ) as Promise<{
    readonly status: 'plugin-started' | 'restarting' | 'unsupported'
    readonly installId?: string
  }>,
  openLog: () => ipcRenderer.invoke(DESKTOP_IPC.logOpen) as Promise<OpenLogResult>,
}

const processesBridge: DesktopProcessesBridge = {
  list: () => ipcRenderer.invoke(DESKTOP_IPC.processesList) as Promise<readonly DesktopProcessSnapshot[]>,
  stop: id => ipcRenderer.invoke(DESKTOP_IPC.processesStop, id) as Promise<readonly DesktopProcessSnapshot[]>,
  persistentServices: () => ipcRenderer.invoke(DESKTOP_IPC.persistentServicesList) as Promise<readonly PersistentServiceSummary[]>,
  approvePersistentService: key => ipcRenderer.invoke(
    DESKTOP_IPC.persistentServicesApprove, key,
  ) as Promise<readonly PersistentServiceSummary[]>,
  revokePersistentService: key => ipcRenderer.invoke(
    DESKTOP_IPC.persistentServicesRevoke, key,
  ) as Promise<readonly PersistentServiceSummary[]>,
  preparePluginUninstall: pluginName => ipcRenderer.invoke(
    DESKTOP_IPC.persistentServicesPreparePluginUninstall, pluginName,
  ) as Promise<{ readonly prepared: true }>,
}

const chatBackgroundBridge: DesktopChatBackgroundBridge = {
  read: () => ipcRenderer.invoke(DESKTOP_IPC.chatBackgroundRead) as Promise<DesktopChatBackground | undefined>,
  write: background => ipcRenderer.invoke(
    DESKTOP_IPC.chatBackgroundWrite, background,
  ) as Promise<DesktopChatBackground>,
}

const sourceMode = process.argv.includes('--dsh-source')
const nasMode = process.argv.includes('--dsh-nas-runtime')

// Shared Client shortcuts must identify the visiting Desktop device, including macOS
// where the Harness URL has no desktop-mode query parameters.
const markDesktopPlatform = (): void => { document.documentElement.dataset.platform = process.platform }
const documentRoot = typeof document === 'undefined' ? null : document.documentElement as HTMLElement | null
if (documentRoot === null) window.addEventListener('DOMContentLoaded', markDesktopPlatform, { once: true })
else markDesktopPlatform()

if (!nasMode && location.protocol === 'dsh-app:' && location.hostname === 'app') {
  contextBridge.exposeInMainWorld('__DSH_DIRECTORY_PICKER__', Object.freeze({
    pick: () => ipcRenderer.invoke(DESKTOP_IPC.directoryPick) as Promise<string | null>,
  }))
}

function installClientBootFailureBridge(): void {
  if (nasMode) return
  let reported = false
  const publish = (): void => {
    if (reported) return
    const failure = document.querySelector<HTMLElement>('[data-dsh-boot-failure]')
    const message = failure?.dataset.dshBootFailure
    if (message === undefined || message.length === 0) return
    reported = true
    ipcRenderer.send(DESKTOP_IPC.clientBootFailure, { message: message.slice(0, 2_000) })
  }
  const observer = new MutationObserver(publish)
  observer.observe(document.documentElement, {
    attributes: true, attributeFilter: ['data-dsh-boot-failure'], subtree: true,
  })
  publish()
  window.addEventListener('unload', () => { observer.disconnect() }, { once: true })
}

const iconsBridge: DesktopIconsBridge = {
  getStatus: () => ipcRenderer.invoke(DESKTOP_IPC.iconsGet) as Promise<DesktopIconStatus>,
  choose: () => ipcRenderer.invoke(DESKTOP_IPC.iconsChoose) as Promise<IconSelection | null>,
  discard: id => ipcRenderer.invoke(DESKTOP_IPC.iconsDiscard, id) as Promise<void>,
  apply: (id, target, crop) => ipcRenderer.invoke(DESKTOP_IPC.iconsApply, id, target, crop) as Promise<DesktopIconStatus>,
  followTray: follow => ipcRenderer.invoke(DESKTOP_IPC.iconsFollow, follow) as Promise<DesktopIconStatus>,
  reset: target => ipcRenderer.invoke(DESKTOP_IPC.iconsReset, target) as Promise<DesktopIconStatus>,
  repairShortcuts: () => ipcRenderer.invoke(DESKTOP_IPC.iconsRepair) as Promise<DesktopIconStatus>,
  createShortcut: () => ipcRenderer.invoke(DESKTOP_IPC.iconsCreateShortcut) as Promise<DesktopIconStatus>,
  onStatus(callback) {
    const listener = (_event: Electron.IpcRendererEvent, status: DesktopIconStatus): void => { callback(status) }
    ipcRenderer.on(DESKTOP_IPC.iconsStatus, listener)
    return () => { ipcRenderer.removeListener(DESKTOP_IPC.iconsStatus, listener) }
  },
}
const unavailableInNasMode = (): Promise<never> => Promise.reject(new Error(
  'desktop: this device-local operation is unavailable while connected to a NAS runtime',
))
const remoteShellBridge: DesktopShellBridge = {
  getCapabilities: () => shellBridge.getCapabilities(),
  getPreferences: () => shellBridge.getPreferences(),
  updatePreferences: patch => shellBridge.updatePreferences(patch),
  onPreferences: callback => shellBridge.onPreferences(callback),
  restart: () => shellBridge.restart(),
  reportReadiness: (phase) => { shellBridge.reportReadiness(phase) },
}
const remoteDesktopWebBridge: DesktopWebBridge = {
  getStatus: () => Promise.resolve({ phase: 'error', message: 'Open the paired NAS HTTPS address in a browser.' }),
  open: unavailableInNasMode,
  onStatus: () => () => {},
}

const commonDesktopBridge = {
  menu: Object.freeze({
    reportState(state: { available: boolean; ready: boolean; locale: string }): void {
      ipcRenderer.send(DESKTOP_IPC.menuClientState, state)
    },
    onCommand(callback: (command: string) => void | Promise<void>): () => void {
      const listener = (_event: Electron.IpcRendererEvent, request: { id: string; command: string }): void => {
        if (typeof request.id !== 'string' || !(CLIENT_COMMANDS as readonly string[]).includes(request.command)) return
        void Promise.resolve().then(() => callback(request.command)).then(
          () => { ipcRenderer.send(DESKTOP_IPC.menuResult, { id: request.id }) },
          (error: unknown) => { ipcRenderer.send(DESKTOP_IPC.menuResult, { id: request.id, error: String(error).slice(0, 1000) }) },
        )
      }
      ipcRenderer.on(DESKTOP_IPC.menuCommand, listener)
      return () => { ipcRenderer.removeListener(DESKTOP_IPC.menuCommand, listener) }
    },
  }),
  shell: Object.freeze(nasMode ? remoteShellBridge : shellBridge),
  releases: Object.freeze(releasesBridge),
  nas: Object.freeze(nasBridge),
  desktopWeb: Object.freeze(nasMode ? remoteDesktopWebBridge : desktopWebBridge),
  workspaceRuntimes: Object.freeze(nasMode ? remoteWorkspaceRuntimesBridge : workspaceRuntimesBridge),
}
const shortcutBridge = Object.freeze({
  protocolVersion: 1,
  keyboard: Object.freeze({
    closeWindow: (revision: ShortcutRevision) => ipcRenderer.invoke(DESKTOP_IPC.shortcutsCloseWindow, revision) as Promise<void>,
    subscribe(listener: (input: DesktopShortcutInput) => void): () => void {
      const handle = (_event: Electron.IpcRendererEvent, input: DesktopShortcutInput): void => { listener(input) }
      ipcRenderer.on(DESKTOP_IPC.shortcutsInput, handle)
      return () => { ipcRenderer.removeListener(DESKTOP_IPC.shortcutsInput, handle) }
    },
  }),
  shortcuts: Object.freeze({
    get: (definitions: readonly ShortcutDefinition[]) =>
      ipcRenderer.invoke(DESKTOP_IPC.shortcutsGet, definitions) as Promise<ShortcutConfigSnapshot>,
    edit: (edit: ShortcutEdit, revision: ShortcutRevision) =>
      ipcRenderer.invoke(DESKTOP_IPC.shortcutsEdit, edit, revision) as Promise<ShortcutSaveResult>,
    recording: (active: boolean) => ipcRenderer.invoke(DESKTOP_IPC.shortcutsRecording, active) as Promise<void>,
    subscribe(listener: (snapshot: ShortcutConfigSnapshot) => void): () => void {
      const handle = (_event: Electron.IpcRendererEvent, snapshot: ShortcutConfigSnapshot): void => { listener(snapshot) }
      ipcRenderer.on(DESKTOP_IPC.shortcutsChanged, handle)
      return () => { ipcRenderer.removeListener(DESKTOP_IPC.shortcutsChanged, handle) }
    },
  }),
})
contextBridge.exposeInMainWorld('dshDesktop', shortcutBridge)
contextBridge.exposeInMainWorld('deepSeekHarnessDesktop', Object.freeze({
  ...commonDesktopBridge,
  ...(nasMode ? {} : {
    icons: Object.freeze(iconsBridge),
    downloadNetwork: Object.freeze(downloadNetworkBridge),
    bundledPlugins: Object.freeze(bundledPluginsBridge),
    externalTools: Object.freeze(externalToolsBridge),
    importedPlugins: Object.freeze(sourceMode
      ? { ...importedPluginsBridge, development: true as const }
      : importedPluginsBridge),
    diagnosticLab: Object.freeze(diagnosticLabBridge),
    pluginSnapshots: Object.freeze(pluginSnapshotsBridge),
    startupDiagnostics: Object.freeze(startupDiagnosticsBridge),
    processes: Object.freeze(processesBridge),
    chatBackground: Object.freeze(chatBackgroundBridge),
    ...(sourceMode ? {
      updater: Object.freeze(bridge),
    } : {}),
  }),
}))

type DesktopThemeSource = 'system' | 'light' | 'dark'

function readDesktopThemeSource(): DesktopThemeSource | undefined {
  const source = document.documentElement.getAttribute('data-dsh-color-scheme-source')
  return source === 'system' || source === 'light' || source === 'dark' ? source : undefined
}

function installDesktopThemeSync(): void {
  const root = document.documentElement
  let published: DesktopThemeSource | undefined
  const publish = (): void => {
    const source = readDesktopThemeSource()
    if (source === undefined || source === published) return
    published = source
    ipcRenderer.send(DESKTOP_IPC.themeSource, source)
  }
  publish()
  const observer = new MutationObserver(publish)
  observer.observe(root, { attributes: true, attributeFilter: ['data-dsh-color-scheme-source'] })
  window.addEventListener('unload', () => { observer.disconnect() }, { once: true })
}

window.addEventListener('DOMContentLoaded', () => {
  installDesktopThemeSync()
  installClientBootFailureBridge()
  installLoadingPage(ipcRenderer)
}, { once: true })

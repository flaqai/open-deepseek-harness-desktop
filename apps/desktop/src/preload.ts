/** Narrow update bridge for the trusted Harness renderer. */

import { contextBridge, ipcRenderer } from 'electron'
import { CLIENT_COMMANDS } from './application-menu.ts'
import type { DesktopIconsBridge, DesktopIconStatus, IconSelection } from './icon-protocol.ts'
import type { OpenLogResult } from './log-reveal.ts'
import type { DesktopPreferences, DesktopPreferencesPatch } from './preferences.ts'
import type { DesktopReleaseStatus } from './release-checker.ts'
import type { DesktopReleaseDownloadStatus } from './release-downloader.ts'
import type { SourceUpdateResult, SourceUpdateStatus } from './source-updater.ts'
import type { DesktopCliStatus } from './desktop-cli-registration.ts'
import type {
  DesktopDataHomeSelectionResult,
  DesktopDataHomeSelectionKind,
  DesktopDataHomeStatus,
  DesktopDataHomeSwitchRequest,
  DesktopDataHomeSwitchResult,
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
import type { PersistentServiceSummary } from '@deepseek-ai/dsh-subprocess/persistent'
import type { DesktopWebOpenResult, DesktopWebStatus } from './desktop-web-access.ts'
import type {
  DownloadNetworkPatch, DownloadNetworkSettings, DownloadNetworkTarget, DownloadNetworkTestStatus,
} from './download-network-settings.ts'

/** Renderer-visible update methods; no generic process or filesystem access is exposed. */
export interface DesktopUpdateBridge {
  check(): Promise<SourceUpdateStatus>
  upgrade(expectedCommit: string): Promise<SourceUpdateResult>
  restart(): Promise<{ restarting: true }>
}

const bridge: DesktopUpdateBridge = {
  check: () => ipcRenderer.invoke('dsh:source-update:check') as Promise<SourceUpdateStatus>,
  upgrade: expectedCommit => ipcRenderer.invoke('dsh:source-update:upgrade', expectedCommit) as Promise<SourceUpdateResult>,
  restart: () => ipcRenderer.invoke('dsh:source-update:restart') as Promise<{ restarting: true }>,
}

/** Capability flags returned by the trusted main process. */
export interface DesktopCapabilities {
  platform: NodeJS.Platform
  packaged: boolean
  launchAtLoginAvailable: boolean
  sourceUpdateAvailable: boolean
  commandLineAvailable: boolean
  developmentRecoveryAvailable: boolean
}

/** Narrow desktop-shell preference and diagnostics bridge. */
export interface DesktopShellBridge {
  getCapabilities(): Promise<DesktopCapabilities>
  getDataHome(): Promise<DesktopDataHomeStatus>
  chooseDataHome(kind: DesktopDataHomeSelectionKind): Promise<DesktopDataHomeSelectionResult>
  switchDataHome(request: DesktopDataHomeSwitchRequest): Promise<DesktopDataHomeSwitchResult>
  getPreferences(): Promise<DesktopPreferences>
  updatePreferences(patch: DesktopPreferencesPatch): Promise<DesktopPreferences>
  onPreferences(callback: (preferences: DesktopPreferences) => void): () => void
  openLog(): Promise<OpenLogResult>
  openLogDirectory(): Promise<{ error: string }>
  openSettingsDocument(): Promise<{ error: string }>
  backupAndResetSettings(): Promise<{ backupName?: string; restarting: true }>
  restart(): Promise<{ restarting: true }>
  getCommandLine(): Promise<DesktopCliStatus>
  installCommandLine(force: boolean): Promise<DesktopCliStatus>
  removeCommandLine(): Promise<DesktopCliStatus>
  enterRecoveryMode(): Promise<{ entered: true }>
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

/** Opaque-id restore operations; package specs never cross from renderer to main. */
export interface DesktopImportedPluginsBridge {
  readonly development?: true
  get(): Promise<ImportedPluginRestoreSnapshot | undefined>
  checkSources(): Promise<ImportedPluginRestoreSnapshot | undefined>
  start(restoreIds: readonly string[]): Promise<ImportedPluginRestoreSnapshot>
  chooseLocalDirectory(restoreId: string): Promise<ImportedPluginRestoreSnapshot | undefined>
  chooseLocalArchive(restoreId: string): Promise<ImportedPluginRestoreSnapshot | undefined>
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
  getCapabilities: () => ipcRenderer.invoke('dsh:desktop:capabilities') as Promise<DesktopCapabilities>,
  getDataHome: () => ipcRenderer.invoke('dsh:desktop:data-home:get') as Promise<DesktopDataHomeStatus>,
  chooseDataHome: kind => ipcRenderer.invoke(
    'dsh:desktop:data-home:choose', kind,
  ) as Promise<DesktopDataHomeSelectionResult>,
  switchDataHome: request => ipcRenderer.invoke(
    'dsh:desktop:data-home:switch', request,
  ) as Promise<DesktopDataHomeSwitchResult>,
  getPreferences: () => ipcRenderer.invoke('dsh:desktop:preferences:get') as Promise<DesktopPreferences>,
  updatePreferences: patch => ipcRenderer.invoke('dsh:desktop:preferences:update', patch) as Promise<DesktopPreferences>,
  onPreferences(callback) {
    const listener = (_event: Electron.IpcRendererEvent, next: DesktopPreferences): void => { callback(next) }
    ipcRenderer.on('dsh:desktop:preferences', listener)
    return () => { ipcRenderer.removeListener('dsh:desktop:preferences', listener) }
  },
  openLog: () => ipcRenderer.invoke('dsh:desktop:log:open') as Promise<OpenLogResult>,
  openLogDirectory: () => ipcRenderer.invoke('dsh:desktop:log-directory:open') as Promise<{ error: string }>,
  openSettingsDocument: () => ipcRenderer.invoke('dsh:desktop:settings:open') as Promise<{ error: string }>,
  backupAndResetSettings: () => ipcRenderer.invoke(
    'dsh:desktop:settings:reset',
  ) as Promise<{ backupName?: string; restarting: true }>,
  restart: () => ipcRenderer.invoke('dsh:desktop:restart') as Promise<{ restarting: true }>,
  getCommandLine: () => ipcRenderer.invoke('dsh:desktop:cli:get') as Promise<DesktopCliStatus>,
  installCommandLine: force => ipcRenderer.invoke('dsh:desktop:cli:install', force) as Promise<DesktopCliStatus>,
  removeCommandLine: () => ipcRenderer.invoke('dsh:desktop:cli:remove') as Promise<DesktopCliStatus>,
  enterRecoveryMode: () => ipcRenderer.invoke(
    'dsh:desktop:recovery:enter',
  ) as Promise<{ entered: true }>,
  reportReadiness: (phase) => { ipcRenderer.send('dsh:desktop:readiness', phase) },
}

const releasesBridge: DesktopReleasesBridge = {
  getStatus: () => ipcRenderer.invoke('dsh:desktop:releases:get') as Promise<DesktopReleaseStatus>,
  check: () => ipcRenderer.invoke('dsh:desktop:releases:check') as Promise<DesktopReleaseStatus>,
  onStatus(callback) {
    const listener = (_event: Electron.IpcRendererEvent, next: DesktopReleaseStatus): void => { callback(next) }
    ipcRenderer.on('dsh:desktop:release-status', listener)
    return () => { ipcRenderer.removeListener('dsh:desktop:release-status', listener) }
  },
  openDownload: releaseUrl => ipcRenderer.invoke('dsh:desktop:releases:open', releaseUrl) as Promise<{ error: string }>,
  getDownloadStatus: () => ipcRenderer.invoke(
    'dsh:desktop:releases:download:get',
  ) as Promise<DesktopReleaseDownloadStatus>,
  startDownload: () => ipcRenderer.invoke(
    'dsh:desktop:releases:download:start',
  ) as Promise<DesktopReleaseDownloadStatus>,
  cancelDownload: () => ipcRenderer.invoke(
    'dsh:desktop:releases:download:cancel',
  ) as Promise<DesktopReleaseDownloadStatus>,
  openInstaller: () => ipcRenderer.invoke(
    'dsh:desktop:releases:download:open',
  ) as Promise<{ error: string }>,
  onDownloadStatus(callback) {
    const listener = (_event: Electron.IpcRendererEvent, next: DesktopReleaseDownloadStatus): void => { callback(next) }
    ipcRenderer.on('dsh:desktop:release-download-status', listener)
    return () => { ipcRenderer.removeListener('dsh:desktop:release-download-status', listener) }
  },
}

const downloadNetworkBridge: DesktopDownloadNetworkBridge = {
  get: () => ipcRenderer.invoke('dsh:desktop:download-network:get') as Promise<DownloadNetworkSettings>,
  update: patch => ipcRenderer.invoke('dsh:desktop:download-network:update', patch) as Promise<DownloadNetworkSettings>,
  reset: target => ipcRenderer.invoke('dsh:desktop:download-network:reset', target) as Promise<DownloadNetworkSettings>,
  getTestStatus: () => ipcRenderer.invoke('dsh:desktop:download-network:test:get') as Promise<DownloadNetworkTestStatus>,
  test: target => ipcRenderer.invoke('dsh:desktop:download-network:test', target) as Promise<DownloadNetworkTestStatus>,
  onSettings(callback) {
    const listener = (_event: Electron.IpcRendererEvent, settings: DownloadNetworkSettings): void => { callback(settings) }
    ipcRenderer.on('dsh:desktop:download-network', listener)
    return () => { ipcRenderer.removeListener('dsh:desktop:download-network', listener) }
  },
  onTestStatus(callback) {
    const listener = (_event: Electron.IpcRendererEvent, status: DownloadNetworkTestStatus): void => { callback(status) }
    ipcRenderer.on('dsh:desktop:download-network:test-status', listener)
    return () => { ipcRenderer.removeListener('dsh:desktop:download-network:test-status', listener) }
  },
}

const desktopWebBridge: DesktopWebBridge = {
  getStatus: () => ipcRenderer.invoke('dsh:desktop:web:get') as Promise<DesktopWebStatus>,
  open: () => ipcRenderer.invoke('dsh:desktop:web:open') as Promise<DesktopWebOpenResult>,
  onStatus(callback) {
    const listener = (_event: Electron.IpcRendererEvent, status: DesktopWebStatus): void => { callback(status) }
    ipcRenderer.on('dsh:desktop:web:status', listener)
    return () => { ipcRenderer.removeListener('dsh:desktop:web:status', listener) }
  },
}

const bundledPluginsBridge: DesktopBundledPluginsBridge = {
  startInstall: request => ipcRenderer.invoke('dsh:desktop:bundled-plugins:start', request) as Promise<BundledPluginStartResult>,
  startDeferred: request => ipcRenderer.invoke('dsh:desktop:bundled-plugins:start-deferred', request) as Promise<BundledPluginDeferredStartResult>,
  getInstall: installId => ipcRenderer.invoke('dsh:desktop:bundled-plugins:get', installId) as Promise<BundledPluginInstallSnapshot>,
}

const externalToolsBridge: DesktopExternalToolsBridge = {
  resolve: toolId => ipcRenderer.invoke(
    'dsh:desktop:external-tools:resolve', toolId,
  ) as Promise<ExternalToolInstallResolution>,
}

const importedPluginsBridge: DesktopImportedPluginsBridge = {
  get: () => ipcRenderer.invoke('dsh:desktop:imported-plugins:get') as Promise<ImportedPluginRestoreSnapshot | undefined>,
  checkSources: () => ipcRenderer.invoke(
    'dsh:desktop:imported-plugins:check-sources',
  ) as Promise<ImportedPluginRestoreSnapshot | undefined>,
  start: restoreIds => ipcRenderer.invoke(
    'dsh:desktop:imported-plugins:start', [...restoreIds],
  ) as Promise<ImportedPluginRestoreSnapshot>,
  chooseLocalDirectory: restoreId => ipcRenderer.invoke(
    'dsh:desktop:imported-plugins:choose-directory', restoreId,
  ) as Promise<ImportedPluginRestoreSnapshot | undefined>,
  chooseLocalArchive: restoreId => ipcRenderer.invoke(
    'dsh:desktop:imported-plugins:choose-archive', restoreId,
  ) as Promise<ImportedPluginRestoreSnapshot | undefined>,
  dismiss: () => ipcRenderer.invoke(
    'dsh:desktop:imported-plugins:dismiss',
  ) as Promise<ImportedPluginRestoreSnapshot | undefined>,
  ignore: () => ipcRenderer.invoke(
    'dsh:desktop:imported-plugins:ignore',
  ) as Promise<ImportedPluginRestoreSnapshot | undefined>,
}

const diagnosticLabBridge: DesktopDiagnosticLabBridge = {
  catalog: () => ipcRenderer.invoke('dsh:desktop:diagnostic-lab:catalog') as Promise<readonly DiagnosticLabScenario[]>,
  current: () => ipcRenderer.invoke('dsh:desktop:diagnostic-lab:current') as Promise<DiagnosticLabRunSnapshot | undefined>,
  start: request => ipcRenderer.invoke('dsh:desktop:diagnostic-lab:start', request) as Promise<DiagnosticLabRunSnapshot>,
  getRun: runId => ipcRenderer.invoke('dsh:desktop:diagnostic-lab:get', runId) as Promise<DiagnosticLabRunSnapshot>,
  cancel: runId => ipcRenderer.invoke('dsh:desktop:diagnostic-lab:cancel', runId) as Promise<DiagnosticLabRunSnapshot>,
  restoreAll: runId => ipcRenderer.invoke('dsh:desktop:diagnostic-lab:restore-all', runId) as Promise<DiagnosticLabRunSnapshot>,
  exportReport: runId => ipcRenderer.invoke('dsh:desktop:diagnostic-lab:export', runId) as Promise<string>,
  onStatus(callback) {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: DiagnosticLabRunSnapshot): void => { callback(snapshot) }
    ipcRenderer.on('dsh:desktop:diagnostic-lab:status', listener)
    return () => { ipcRenderer.removeListener('dsh:desktop:diagnostic-lab:status', listener) }
  },
}

const pluginSnapshotsBridge: DesktopPluginSnapshotsBridge = {
  list: () => ipcRenderer.invoke('dsh:desktop:plugin-snapshots:list') as Promise<readonly PluginSnapshotSummary[]>,
  create: label => ipcRenderer.invoke('dsh:desktop:plugin-snapshots:create', label) as Promise<{ readonly snapshotId: string }>,
  remove: snapshotId => ipcRenderer.invoke(
    'dsh:desktop:plugin-snapshots:remove', snapshotId,
  ) as Promise<readonly PluginSnapshotSummary[]>,
  startRestore: (snapshotId, networkAllowed) => ipcRenderer.invoke(
    'dsh:desktop:plugin-snapshots:restore', snapshotId, networkAllowed,
  ) as Promise<PluginSnapshotRestoreSnapshot>,
  getRestore: operationId => ipcRenderer.invoke(
    'dsh:desktop:plugin-snapshots:restore:get', operationId,
  ) as Promise<PluginSnapshotRestoreSnapshot>,
  onStatus(callback) {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: PluginSnapshotRestoreSnapshot): void => { callback(snapshot) }
    ipcRenderer.on('dsh:desktop:plugin-snapshots:status', listener)
    return () => { ipcRenderer.removeListener('dsh:desktop:plugin-snapshots:status', listener) }
  },
}

const startupDiagnosticsBridge: DesktopStartupDiagnosticsBridge = {
  list: () => ipcRenderer.invoke(
    'dsh:desktop:startup-diagnostics:list',
  ) as Promise<readonly StartupDiagnosticIncident[]>,
  retry: incidentId => ipcRenderer.invoke(
    'dsh:desktop:startup-diagnostics:retry', incidentId,
  ) as Promise<{
    readonly status: 'plugin-started' | 'restarting' | 'unsupported'
    readonly installId?: string
  }>,
  openLog: () => ipcRenderer.invoke('dsh:desktop:log:open') as Promise<OpenLogResult>,
}

const processesBridge: DesktopProcessesBridge = {
  list: () => ipcRenderer.invoke('dsh:desktop:processes:list') as Promise<readonly DesktopProcessSnapshot[]>,
  stop: id => ipcRenderer.invoke('dsh:desktop:processes:stop', id) as Promise<readonly DesktopProcessSnapshot[]>,
  persistentServices: () => ipcRenderer.invoke('dsh:desktop:persistent-services:list') as Promise<readonly PersistentServiceSummary[]>,
  approvePersistentService: key => ipcRenderer.invoke(
    'dsh:desktop:persistent-services:approve', key,
  ) as Promise<readonly PersistentServiceSummary[]>,
  revokePersistentService: key => ipcRenderer.invoke(
    'dsh:desktop:persistent-services:revoke', key,
  ) as Promise<readonly PersistentServiceSummary[]>,
  preparePluginUninstall: pluginName => ipcRenderer.invoke(
    'dsh:desktop:persistent-services:prepare-plugin-uninstall', pluginName,
  ) as Promise<{ readonly prepared: true }>,
}

const chatBackgroundBridge: DesktopChatBackgroundBridge = {
  read: () => ipcRenderer.invoke('dsh:desktop:chat-background:read') as Promise<DesktopChatBackground | undefined>,
  write: background => ipcRenderer.invoke(
    'dsh:desktop:chat-background:write', background,
  ) as Promise<DesktopChatBackground>,
}

const sourceMode = process.argv.includes('--dsh-source')
const iconsBridge: DesktopIconsBridge = {
  getStatus: () => ipcRenderer.invoke('dsh:desktop:icons:get') as Promise<DesktopIconStatus>,
  choose: () => ipcRenderer.invoke('dsh:desktop:icons:choose') as Promise<IconSelection | null>,
  discard: id => ipcRenderer.invoke('dsh:desktop:icons:discard', id) as Promise<void>,
  apply: (id, target, crop) => ipcRenderer.invoke('dsh:desktop:icons:apply', id, target, crop) as Promise<DesktopIconStatus>,
  followTray: follow => ipcRenderer.invoke('dsh:desktop:icons:follow', follow) as Promise<DesktopIconStatus>,
  reset: target => ipcRenderer.invoke('dsh:desktop:icons:reset', target) as Promise<DesktopIconStatus>,
  repairShortcuts: () => ipcRenderer.invoke('dsh:desktop:icons:repair') as Promise<DesktopIconStatus>,
  createShortcut: () => ipcRenderer.invoke('dsh:desktop:icons:create-shortcut') as Promise<DesktopIconStatus>,
  onStatus(callback) {
    const listener = (_event: Electron.IpcRendererEvent, status: DesktopIconStatus): void => { callback(status) }
    ipcRenderer.on('dsh:desktop:icons:status', listener)
    return () => { ipcRenderer.removeListener('dsh:desktop:icons:status', listener) }
  },
}
contextBridge.exposeInMainWorld('deepSeekHarnessDesktop', Object.freeze({
  menu: Object.freeze({
    reportState(state: { ready: boolean; locale: string }): void {
      ipcRenderer.send('dsh:menu:client-state', state)
    },
    onCommand(callback: (command: string) => void | Promise<void>): () => void {
      const listener = (_event: Electron.IpcRendererEvent, request: { id: string; command: string }): void => {
        if (typeof request.id !== 'string' || !(CLIENT_COMMANDS as readonly string[]).includes(request.command)) return
        void Promise.resolve().then(() => callback(request.command)).then(
          () => { ipcRenderer.send('dsh:menu:result', { id: request.id }) },
          (error: unknown) => { ipcRenderer.send('dsh:menu:result', { id: request.id, error: String(error).slice(0, 1000) }) },
        )
      }
      ipcRenderer.on('dsh:menu:command', listener)
      return () => { ipcRenderer.removeListener('dsh:menu:command', listener) }
    },
  }),
  shell: Object.freeze(shellBridge),
  icons: Object.freeze(iconsBridge),
  releases: Object.freeze(releasesBridge),
  downloadNetwork: Object.freeze(downloadNetworkBridge),
  desktopWeb: Object.freeze(desktopWebBridge),
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
    ipcRenderer.send('dsh:desktop:theme-source', source)
  }
  publish()
  const observer = new MutationObserver(publish)
  observer.observe(root, { attributes: true, attributeFilter: ['data-dsh-color-scheme-source'] })
  window.addEventListener('unload', () => { observer.disconnect() }, { once: true })
}

window.addEventListener('DOMContentLoaded', () => {
  installDesktopThemeSync()
  installLoadingPage(ipcRenderer)
}, { once: true })

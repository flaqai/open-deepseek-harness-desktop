/** Electron application host for the existing DeepSeek Harness Web GUI. */

import { randomUUID } from 'node:crypto'
import {
  loadProcessObserver,
  quarantineProcessRecoveryJournal,
  type DesktopProcessObserver,
} from './process-observer.ts'
import { appendFile, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir, userInfo } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, net, Notification, safeStorage, session, shell, Tray,
  type Session,
  type MenuItemConstructorOptions, type MessageBoxOptions, type WebContents, type WebPreferences,
} from 'electron'
import { appendBundledPluginFailure, verifyBundledPluginArchive } from './bundled-plugin-seed.ts'
import { BundledPluginStartupCooldown } from './bundled-plugin-cooldown.ts'
import {
  BundledPluginInstaller,
  installBundledPluginSource,
  parseBundledPluginManifest,
  resolveBundledPluginResourcesDirectory,
  type BundledPluginDeferredStartResult,
  type BundledPluginStartResult,
  type BundledPluginInstallSnapshot,
} from './bundled-plugin-installer.ts'
import {
  resolveDevelopmentLaunchOptions,
  resolveHarnessInvocation,
  resolveHarnessLaunch,
  type DesktopLaunchOptions,
  type HarnessLaunch,
} from './launch.ts'
import {
  DesktopOperationSupervisor,
  HarnessInvocationError,
} from './harness-invocation.ts'
import {
  harnessPermissionDecisionKeys,
  harnessPermissionName,
  isSilentHarnessPermission,
  isTrustedHarnessPermissionRequest,
  type HarnessPermissionDetails,
} from './permissions.ts'
import { ensurePackagedRuntime, packagedRuntimeArchiveRoot } from './packaged-runtime.ts'
import { HarnessSupervisor, type HarnessFailure, type HarnessState } from './supervisor.ts'
import { ProfileTransactionManager } from './profile-transaction-manager.ts'
import { terminateWindowsProcessTree } from './windows-process-tree.ts'
import { revealHarnessLog, type OpenLogResult } from './log-reveal.ts'
import { createNotificationThrottle, desktopNotificationDictionary } from './notifications.ts'
import {
  createDesktopPreferencesStore, DEFAULT_DESKTOP_PREFERENCES, parseDesktopPreferencesPatch,
  type DesktopPreferences, type DesktopPreferencesStore,
} from './preferences.ts'
import { DesktopReleaseChecker, fetchGitHubReleases, isAllowedReleaseUrl, type DesktopReleaseStatus } from './release-checker.ts'
import { DesktopReleaseDownloader, type DesktopReleaseDownloadStatus, type ReleaseFetch } from './release-downloader.ts'
import { fetchCnbReleaseIndex, isAllowedCnbUrl, selectCnbRelease } from './cnb-release-source.ts'
import {
  DownloadNetworkSettingsStore, type DownloadNetworkSettings, type DownloadNetworkTarget,
  type DownloadNetworkTestStatus,
} from './download-network-settings.ts'
import {
  pluginDownloadEnvironment, startPluginDownloadProxy, type PluginDownloadProxy,
} from './plugin-download-proxy.ts'
import { SourceUpdater } from './source-updater.ts'
import { DesktopIconManager, type DesktopIconImages } from './desktop-icons.ts'
import { loadDefaultApplicationIcon } from './icon-image.ts'
import { updateIconShortcuts } from './icon-shortcuts.ts'
import type { IconSurfaceResult, IconTarget } from './icon-protocol.ts'
import { ExternalToolCompatibilityManager } from './external-tool-compatibility.ts'
import { EXTERNAL_TOOL_IDS, type DesktopExternalToolId } from './external-tool-compatibility-manifest.ts'
import { createDesktopLifecycle, type DesktopLifecycle } from './window-lifecycle.ts'
import { ApplicationMenuController } from './application-menu-controller.ts'
import { CLIENT_COMMANDS, menuCopy, type DesktopCommand } from './application-menu.ts'
import { inspectProfileMutationLock, menuMutationActive } from './menu-mutation-guard.ts'
import { isDesktopRenderer, withDesktopWindowMetadata } from './window-frame.ts'
import {
  createDesktopWindowSurface,
  type DesktopWindowSurface,
} from './desktop-window-surface.ts'
import {
  DiagnosticLabManager,
  type DiagnosticLabDoctorResult,
  type DiagnosticLabRunSnapshot,
  type DiagnosticLabStartRequest,
} from './diagnostic-lab.ts'
import { parseStartupBuildApproval } from './startup-build-approval.ts'
import {
  desktopDataHomeSetup,
  desktopDataHomesOverlap,
  hasDesktopData,
  IMPORTED_ONBOARDING_RESET_VERSION,
  copyCommunityDesktopData,
  importOfficialDesktopData,
  inspectDesktopDataHomeStatus,
  readDesktopDataHomeSetup,
  resetImportedDesktopOnboarding,
  resolveDesktopApplicationDataRoot,
  resolveDesktopDataHomeSwitch,
  resolveDesktopDataHomeSource,
  resolveCommunityDataHomeSource,
  resolveDesktopDataHomeRecoverySelection,
  resolveEmptyDesktopDataHome,
  resolveRecordedDesktopDataHome,
  resolveDesktopDataHomeLayout,
  writeDesktopDataHomeSetup,
  type DesktopDataHomeSource,
  type DesktopDataHomeLayout,
  type DesktopDataHomeSelectionResult,
  type DesktopDataHomeSelectionKind,
  type DesktopDataHomeSwitchRequest,
  type DesktopDataHomeSwitchResult,
} from './desktop-data-home.ts'
import { mapBundledPluginProgress, type DesktopStartupProgress } from './startup-progress.ts'
import {
  isRecoveryPluginPackageName,
  readRecoveryPluginInventory,
} from './recovery-plugins.ts'
import {
  DesktopCliManager,
  type DesktopCliRuntime,
  type DesktopCliStatus,
} from './desktop-cli-registration.ts'
import {
  createDesktopChatBackgroundStore,
  type DesktopChatBackgroundStore,
} from './chat-background-store.ts'
import {
  desktopThemeBackground,
  isDesktopThemeSource,
  readDesktopThemeSource,
  type DesktopThemeSource,
} from './desktop-theme.ts'
import {
  classifyImportedPluginSourceFailure,
  ImportedPluginRestoreManager,
  mergeImportedAllowBuilds,
  type ImportedPluginRestoreSnapshot,
} from './imported-plugin-restore.ts'
import {
  importedPluginVersionDiffers,
  stageImportedPluginArchive,
  stageImportedPluginDirectory,
  type StagedImportedPlugin,
} from './imported-plugin-local-source.ts'
import { resolveSystemProxyEnvironment } from './system-proxy.ts'
import {
  PluginSnapshotManager,
  type PluginSnapshotRestoreSnapshot,
  type PluginSnapshotSummary,
} from './plugin-snapshot-manager.ts'
import { backupAndResetDesktopSettings } from './settings-recovery.ts'
import {
  readStartupDiagnostics,
  recordStartupDiagnostic,
  type StartupDiagnosticCode,
  type StartupDiagnosticIncident,
} from './startup-diagnostics.ts'
import { DesktopWebAccess, type DesktopWebStatus } from './desktop-web-access.ts'
import { shellMessages, trayMessages, dataHomeMessages } from './locales/shell.ts'
import { DesktopReturnControl } from './desktop-return-control.ts'
import { createDesktopLocaleStore, type DesktopLocaleStore } from './desktop-locale-store.ts'
import { resolveDesktopLocale } from './desktop-locale.ts'
import {
  FilePersistentServiceAuthorizer,
  FilePersistentServiceRuntimeRegistry,
  persistentProfileFingerprint,
  type PersistentServiceSummary,
} from '@deepseek-ai/dsh-subprocess/persistent'

const APP_NAME = 'DeepSeek Harness'
const DESKTOP_WEB_SUPPORTED = process.platform === 'darwin' || process.platform === 'win32'
const LOADING_PAGE = fileURLToPath(new URL('./loading.html', import.meta.url))
const WINDOW_ICON = fileURLToPath(new URL('./icon.png', import.meta.url))
const MACOS_TRAY_ICON = fileURLToPath(new URL('./tray-iconTemplate.png', import.meta.url))
const PRELOAD = fileURLToPath(new URL('./preload.cjs', import.meta.url))
const TITLEBAR_PAGE = fileURLToPath(new URL('./titlebar.html', import.meta.url))
const TITLEBAR_PRELOAD = fileURLToPath(new URL('./titlebar-preload.cjs', import.meta.url))
const DATA_HOME_PAGE = fileURLToPath(new URL('./data-home.html', import.meta.url))
const DATA_HOME_PRELOAD = fileURLToPath(new URL('./data-home-preload.cjs', import.meta.url))
const DATA_HOME_SELECTION_LIFETIME_MS = 5 * 60_000
const DESKTOP_PNPM_VERSION = '11.7.0'
const PROFILE_CHECK_TIMEOUT_MS = 15_000
const PROFILE_LOCK_WAIT_MS = 5_000
const PROFILE_REPAIR_TIMEOUT_MS = 60_000
const BUILD_APPROVAL_TIMEOUT_MS = 15_000
const BUNDLED_PLUGIN_INSTALL_TIMEOUT_MS = 10 * 60_000
const SNAPSHOT_COMMAND_TIMEOUT_MS = 15_000
const IMPORTED_PLUGIN_INSTALL_TIMEOUT_MS = 10 * 60_000
const BOOTABLE_SNAPSHOT_DELAY_MS = 30_000
const DEFAULT_SOURCE_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const DESKTOP_APPLICATION_DATA_ROOT = resolveDesktopApplicationDataRoot(
  app.getPath('appData'),
  app.isPackaged,
  process.env,
)
const DESKTOP_DATA_HOME = resolveDesktopDataHomeLayout(
  DESKTOP_APPLICATION_DATA_ROOT,
  homedir(),
  app.isPackaged,
  process.env,
)

app.setName('Open DSH Desktop')
app.setPath('userData', DESKTOP_DATA_HOME.desktopRoot)
app.setPath('sessionData', DESKTOP_DATA_HOME.sessionData)
app.setAppLogsPath(DESKTOP_DATA_HOME.logs)

let mainWindow: BrowserWindow | undefined
let iconManager: DesktopIconManager | undefined
let mainSurface: DesktopWindowSurface | undefined
let supervisor: HarnessSupervisor | undefined
let harnessOrigin: string | undefined
let desktopWebAccess: DesktopWebAccess | undefined
let desktopReturnControl: DesktopReturnControl | undefined
let lifecycle: DesktopLifecycle | undefined
let applicationMenu: ApplicationMenuController | undefined
let disposeApplicationMenu: (() => void) | undefined
let activeMenuHome: string | undefined
let menuLocale = 'en'
let desktopLocaleStore: DesktopLocaleStore | undefined
let persistedProfileLocale: string | undefined
let menuClientReady = false
let snapshotMutationActive = false
let recoveryHarnessSuspended = false
let recoveryCandidateHome: (() => string | undefined) | undefined
let recoveryActivateCandidate: (() => Promise<void>) | undefined
let recoveryDiscardCandidate: (() => Promise<void>) | undefined
let recoveryRestartRequired = false
let recoveryPluginRemove: ((packageName: string) => Promise<void>) | undefined
let blockedProcessRecoveryPath: string | undefined
let latestRecoveryFailure: string | undefined
let processObserver: DesktopProcessObserver | undefined
let processObservationFailure: unknown
let persistentServiceAuthority: FilePersistentServiceAuthorizer | undefined
let persistentServiceRuntime: FilePersistentServiceRuntimeRegistry | undefined
async function stopPersistentServicesForActiveProfile(): Promise<void> {
  if (persistentServiceAuthority === undefined || persistentServiceRuntime === undefined) return
  const runtime = processObserver
  for (const service of persistentServiceAuthority.list()) {
    const identities = persistentServiceRuntime.identities(service.key)
    if (identities.length === 0) continue
    if (runtime === undefined) throw new Error('desktop: persistent services cannot be stopped safely')
    await runtime.stopRecovered(service.key, `${service.pluginName}: ${service.serviceId}`, identities)
    persistentServiceRuntime.clear(service.key)
  }
}
async function stopAndRevokePersistentServicesForPlugin(pluginName: string): Promise<void> {
  if (persistentServiceAuthority === undefined || persistentServiceRuntime === undefined) return
  const services = persistentServiceAuthority.list().filter(service => service.pluginName === pluginName)
  for (const service of services) {
    const identities = persistentServiceRuntime.identities(service.key)
    if (identities.length > 0) {
      if (processObserver === undefined) throw new Error('desktop: persistent services cannot be stopped safely')
      await processObserver.stopRecovered(service.key, `${service.pluginName}: ${service.serviceId}`, identities)
      persistentServiceRuntime.clear(service.key)
    }
    persistentServiceAuthority.revoke(service.key)
  }
}
async function preservePersistentServicesForActiveProfile(): Promise<void> {
  if (persistentServiceAuthority === undefined || persistentServiceRuntime === undefined || processObserver === undefined) return
  const identities = persistentServiceAuthority.list().flatMap(service => persistentServiceRuntime?.identities(service.key) ?? [])
  await processObserver.preserve(identities)
}
function observeProcess(pid: number, label: string): void {
  try { processObserver?.register(pid, label) } catch (error) { processObservationFailure = error }
}
const oneShotOperations = new DesktopOperationSupervisor(observeProcess, () => processObserver)
let bootableSnapshotTimer: NodeJS.Timeout | undefined
const startupWarnings: string[] = []
let trayUnavailable = false
let trayWarningOpen = false
const pendingMenuCommands = new Map<string, { resolve(): void; reject(error: Error): void; timer: NodeJS.Timeout }>()
let permissionPromptQueue: Promise<void> = Promise.resolve()
const pendingPermissionPrompts = new Map<string, Promise<boolean>>()

function runDesktopInvocation(
  launch: HarnessLaunch,
  kind: string,
  timeoutMs: number,
  acceptedExitCodes: readonly number[] = [0],
  allowDuringDisposal = false,
): Promise<string> {
  return oneShotOperations.run(launch, {
    kind, timeoutMs, acceptedExitCodes,
    ...(allowDuringDisposal ? { allowDuringDisposal: true } : {}),
  })
}

function cancelBootableSnapshot(): void {
  if (bootableSnapshotTimer === undefined) return
  clearTimeout(bootableSnapshotTimer)
  bootableSnapshotTimer = undefined
}

function scheduleBootableSnapshot(manager: PluginSnapshotManager): void {
  cancelBootableSnapshot()
  bootableSnapshotTimer = setTimeout(() => {
    bootableSnapshotTimer = undefined
    if (harnessOrigin === undefined || lifecycle?.isQuitting === true || supervisor?.isDiagnosticMode === true) return
    if (menuBusy()) {
      void appendDesktopStartupLog(
        'Bootable plugin snapshot stability window restarted because a managed operation is active.',
      )
      scheduleBootableSnapshot(manager)
      return
    }
    void (async () => {
      await appendDesktopStartupLog('Creating post-readiness plugin snapshot after stable runtime.')
      await manager.markBootable()
      await appendDesktopStartupLog('Post-readiness plugin snapshot retained.')
    })().catch(async (error: unknown) => {
      await appendDesktopStartupLog(
        `Post-readiness plugin snapshot failed without interrupting Harness: ${error instanceof Error ? error.message : String(error)}`,
      )
      console.warn('desktop: could not retain the latest bootable plugin snapshot', error)
    })
  }, BOOTABLE_SNAPSHOT_DELAY_MS)
}

function restartBootableSnapshotStabilityWindow(reason: string): void {
  cancelBootableSnapshot()
  const manager = pluginSnapshotManager
  if (manager === undefined || harnessOrigin === undefined
    || lifecycle?.isQuitting === true || supervisor?.isDiagnosticMode === true || reportedDesktopReadiness.size !== 2) return
  void appendDesktopStartupLog(`Restarting bootable plugin snapshot stability window: ${reason}.`)
  scheduleBootableSnapshot(manager)
}

function profileDoctorStatus(output: string): 'failed' | 'healthy' | 'quarantined' | 'repaired' | undefined {
  const start = output.indexOf('{')
  const end = output.lastIndexOf('}')
  if (start < 0 || end < start) return undefined
  try {
    const value = JSON.parse(output.slice(start, end + 1)) as { status?: unknown }
    return typeof value.status === 'string'
      && ['failed', 'healthy', 'quarantined', 'repaired'].includes(value.status)
      ? value.status as 'failed' | 'healthy' | 'quarantined' | 'repaired'
      : undefined
  } catch {
    return undefined
  }
}

function menuBusy(): boolean {
  const lab = diagnosticLabManager?.current()
  return snapshotMutationActive || lab?.phase === 'running' || lab?.phase === 'queued' || lab?.phase === 'restoring'
    || (activeMenuHome !== undefined && menuMutationActive(activeMenuHome))
}

function reportMenuError(error: unknown): void {
  if (quitReleased || lifecycle?.isQuitting === true) return
  dialog.showErrorBox(menuCopy(menuLocale).error, error instanceof Error ? error.message : String(error))
}

function rejectPendingMenuCommands(): void {
  for (const pending of pendingMenuCommands.values()) {
    clearTimeout(pending.timer)
    pending.reject(new Error(menuCopy(menuLocale).unavailable))
  }
  pendingMenuCommands.clear()
}

async function executeProductMenu(command: DesktopCommand): Promise<void> {
  if ((CLIENT_COMMANDS as readonly string[]).includes(command)) {
    lifecycle?.showWindow()
    const id = randomUUID()
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingMenuCommands.delete(id)
        reject(new Error(menuCopy(menuLocale).unavailable))
      }, 5000)
      pendingMenuCommands.set(id, { resolve, reject, timer })
      mainSurface?.send('dsh:menu:command', { id, command })
    })
    return
  }
  switch (command) {
    case 'show': lifecycle?.showWindow(); return
    case 'open-web':
      if (desktopWebAccess === undefined) throw new Error(menuCopy(menuLocale).unavailable)
      await desktopWebAccess.open()
      return
    case 'restart': requestDesktopRestart(); return
    case 'quit':
      if (lifecycle === undefined) { quitReleased = true; app.quit() }
      else await lifecycle.requestQuit()
      return
    case 'open-config': {
      const result = await openSettingsDocument()
      if (result.error !== '') throw new Error(result.error)
      return
    }
    case 'logs': {
      const error = await shell.openPath(DESKTOP_DATA_HOME.logs)
      if (error !== '') throw new Error(error)
      return
    }
    case 'about': {
      const manifest = JSON.parse(await readFile(new URL('./harness-version.json', import.meta.url), 'utf8')) as { version: string }
      await dialog.showMessageBox({ type: 'info', title: menuCopy(menuLocale).about,
        message: shellMessages(menuLocale).productName,
        detail: `${app.getVersion()}\nHarness ${manifest.version}\n\n${menuCopy(menuLocale).community}` })
      return
    }
    case 'docs': await shell.openExternal('https://github.com/flaqai/open-deepseek-harness-desktop#readme'); return
    case 'repository': await shell.openExternal('https://github.com/flaqai/open-deepseek-harness-desktop'); return
    case 'feedback': await shell.openExternal('https://github.com/flaqai/open-deepseek-harness-desktop/issues'); return
    default: throw new Error(`desktop: unhandled menu command ${command}`)
  }
}

async function openSettingsDocument(): Promise<{ error: string }> {
  const dshHome = activeMenuHome
  if (dshHome === undefined) throw new Error(menuCopy(menuLocale).unavailable)
  const settingsPath = join(dshHome, 'settings.yaml')
  try { await lstat(settingsPath) } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
    return { error: await shell.openPath(dshHome) }
  }
  const error = await shell.openPath(settingsPath)
  if (error === '') return { error }
  shell.showItemInFolder(settingsPath)
  return { error }
}
let preferencesStore: DesktopPreferencesStore | undefined
let preferences: DesktopPreferences = { ...DEFAULT_DESKTOP_PREFERENCES }
let tray: Tray | undefined
let quitReleased = false
let hiddenLaunch = false
let harnessLogPath = ''
let releaseChecker: DesktopReleaseChecker | undefined
let releaseDownloader: DesktopReleaseDownloader | undefined
let stopReleaseChecks: (() => void) | undefined
let downloadNetworkStore: DownloadNetworkSettingsStore | undefined
let downloadNetworkProxy: PluginDownloadProxy | undefined
let applicationDownloadSession: Session | undefined
let pluginDownloadSession: Session | undefined
let downloadNetworkTestStatus: DownloadNetworkTestStatus = { phase: 'idle' }
let externalToolCompatibility: ExternalToolCompatibilityManager | undefined
let bundledPluginInstaller: BundledPluginInstaller | undefined
let bundledPluginCooldown: BundledPluginStartupCooldown | undefined
let importedPluginRestoreManager: ImportedPluginRestoreManager | undefined
let desktopCliManager: DesktopCliManager | undefined
let chatBackgroundStore: DesktopChatBackgroundStore | undefined
let diagnosticLabManager: DiagnosticLabManager | undefined
let pluginSnapshotManager: PluginSnapshotManager | undefined
let startupProgress: DesktopStartupProgress = { stage: 'preparing-desktop', progress: 4 }
let desktopThemeSource: DesktopThemeSource = 'system'
const reportedDesktopReadiness = new Set<'client' | 'event-dispatch'>()
let profileTransactionManager: ProfileTransactionManager | undefined
const pendingDataHomeSelections = new Map<string, {
  readonly rendererId: number
  readonly selectionKind: DesktopDataHomeSelectionKind
  readonly path: string
  readonly expiresAt: number
}>()

async function appendDesktopStartupLog(message: string): Promise<void> {
  if (harnessLogPath === '') return
  await mkdir(dirname(harnessLogPath), { recursive: true })
  await appendFile(harnessLogPath, `[desktop] ${new Date().toISOString()} ${message}\n`)
}

type DataHomeSelection = 'copied' | 'reused' | 'fresh'
type ExistingDataHomeSourceKind = 'official' | 'community'

type DataHomeChoice =
  | { readonly mode: 'fresh'; readonly target: string; readonly customTarget: boolean }
  | {
    readonly mode: 'copied'
    readonly sourceKind: ExistingDataHomeSourceKind
    readonly source: string
    readonly target: string
    readonly customTarget: boolean
  }
  | { readonly mode: 'reused'; readonly source: string }

type DataHomeChoiceRequest =
  | {
    readonly mode: 'fresh'
    readonly target: { readonly kind: 'default' } | { readonly kind: 'custom'; readonly selectionId: string }
  }
  | {
    readonly mode: 'copied'
    readonly sourceKind: ExistingDataHomeSourceKind
    readonly source: string
    readonly target: { readonly kind: 'default' } | { readonly kind: 'custom'; readonly selectionId: string }
  }
  | { readonly mode: 'reused'; readonly source: string }

type DataHomeSourceResult =
  | { readonly status: 'valid'; readonly path: string; readonly entries: readonly string[] }
  | { readonly status: 'invalid' | 'unreadable'; readonly path: string }
  | { readonly status: 'cancelled' }

type DataHomeTargetResult =
  | { readonly status: 'selected'; readonly selectionId: string; readonly path: string }
  | { readonly status: 'not-empty' | 'overlap' | 'unreadable'; readonly path: string }
  | { readonly status: 'cancelled' }

class DesktopDataHomeSelectionCancelledError extends Error {
  constructor() {
    super('desktop: data-home selection was cancelled')
    this.name = 'DesktopDataHomeSelectionCancelledError'
  }
}

interface DesktopCapabilities {
  platform: NodeJS.Platform
  packaged: boolean
  launchAtLoginAvailable: boolean
  sourceUpdateAvailable: boolean
  commandLineAvailable: boolean
  developmentRecoveryAvailable: boolean
}

function applyDesktopThemeSource(source: DesktopThemeSource): void {
  desktopThemeSource = source
  nativeTheme.themeSource = source
  const window = mainWindow
  if (window !== undefined && !window.isDestroyed()) {
    const background = desktopThemeBackground(source, nativeTheme.shouldUseDarkColors)
    mainSurface?.setBackgroundColor(background)
    mainSurface?.sendTitlebar('dsh:window:theme', nativeTheme.shouldUseDarkColors)
    if (mainSurface === undefined) window.setBackgroundColor(background)
  }
}

function desktopCapabilities(): DesktopCapabilities {
  return {
    platform: process.platform,
    packaged: app.isPackaged,
    launchAtLoginAvailable: app.isPackaged && process.platform === 'darwin',
    sourceUpdateAvailable: !app.isPackaged,
    // Keep the row discoverable in source builds as well. DesktopCliManager
    // reports `unsupported` there, while packaged macOS/Windows builds expose
    // the real install, repair, and remove actions.
    commandLineAvailable: process.platform === 'win32' || process.platform === 'darwin',
    developmentRecoveryAvailable: !app.isPackaged,
  }
}

function desktopCopy() { return trayMessages(menuLocale) }

function dataHomeCopy() { return dataHomeMessages(app.getLocale()) }

function isDataHomeSelection(value: unknown): value is DataHomeSelection {
  return value === 'copied' || value === 'reused' || value === 'fresh'
}

function isDataHomeChoiceRequest(value: unknown): value is DataHomeChoiceRequest {
  if (typeof value !== 'object' || value === null || !('mode' in value)
    || !isDataHomeSelection(value.mode)) return false
  if (value.mode === 'reused') {
    return 'source' in value && typeof value.source === 'string' && value.source.trim().length > 0
  }
  if (value.mode === 'copied'
    && (!('source' in value) || typeof value.source !== 'string' || value.source.trim().length === 0
      || !('sourceKind' in value) || (value.sourceKind !== 'official' && value.sourceKind !== 'community'))) return false
  if (!('target' in value) || typeof value.target !== 'object' || value.target === null
    || !('kind' in value.target)) return false
  if (value.target.kind === 'default') return true
  return value.target.kind === 'custom'
    && 'selectionId' in value.target
    && typeof value.target.selectionId === 'string'
    && /^[0-9a-f-]{36}$/u.test(value.target.selectionId)
}

function isDesktopDataHomeSwitchRequest(value: unknown): value is DesktopDataHomeSwitchRequest {
  if (typeof value !== 'object' || value === null || !('kind' in value)) return false
  if (value.kind === 'desktop' || value.kind === 'official') return true
  return (value.kind === 'custom' || value.kind === 'create')
    && 'selectionId' in value
    && typeof value.selectionId === 'string'
    && /^[0-9a-f-]{36}$/u.test(value.selectionId)
}

async function showDataHomeChooser(
  officialSource: DesktopDataHomeSource | undefined,
  officialSourceUnreadable: boolean,
  officialSourceCandidate: string,
  communitySource: DesktopDataHomeSource | undefined,
  communitySourceUnreadable: boolean,
  communitySourceCandidate: string,
  defaultTarget: string,
): Promise<DataHomeChoice> {
  const chooser = new BrowserWindow({
    title: APP_NAME,
    width: 1080,
    height: 720,
    useContentSize: true,
    minWidth: 920,
    minHeight: 620,
    backgroundColor: desktopThemeBackground('system', nativeTheme.shouldUseDarkColors),
    icon: desktopWindowIcon(),
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: DATA_HOME_PRELOAD,
    },
  })
  chooser.webContents.on('will-navigate', (event) => { event.preventDefault() })
  chooser.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  return new Promise<DataHomeChoice>((resolve, reject) => {
    let settled = false
    const pendingTargets = new Map<string, { readonly path: string; readonly expiresAt: number }>()
    const cleanup = (): void => {
      ipcMain.removeListener('dsh:data-home:selected', handleSelection)
      ipcMain.removeListener('dsh:data-home:cancelled', handleCancellation)
      ipcMain.removeHandler('dsh:data-home:choose-source')
      ipcMain.removeHandler('dsh:data-home:choose-target')
      pendingTargets.clear()
    }
    const closeChooser = (): void => {
      cleanup()
      if (!chooser.isDestroyed()) chooser.destroy()
    }
    const finish = (selection?: DataHomeChoice): void => {
      if (settled) return
      settled = true
      closeChooser()
      if (selection === undefined) reject(new DesktopDataHomeSelectionCancelledError())
      else resolve(selection)
    }
    const fail = (error: unknown): void => {
      if (settled) return
      settled = true
      closeChooser()
      reject(error instanceof Error ? error : new Error(String(error)))
    }
    const handleSelection = (event: Electron.IpcMainEvent, value: unknown): void => {
      if (event.sender !== chooser.webContents || !isDataHomeChoiceRequest(value)) return
      void (async () => {
        let source: DesktopDataHomeSource | undefined
        if (value.mode !== 'fresh') {
          try {
            source = await resolveDesktopDataHomeSource(value.source)
          } catch {
            if (!settled) event.sender.send('dsh:data-home:source-error', { status: 'unreadable', path: value.source })
            return
          }
          if (source === undefined) {
            if (!settled) event.sender.send('dsh:data-home:source-error', { status: 'invalid', path: value.source })
            return
          }
        }
        if (value.mode === 'reused') {
          if (source === undefined) return
          finish({ mode: 'reused', source: source.path })
          return
        }
        let target = defaultTarget
        let customTarget = false
        if (value.target.kind === 'custom') {
          const pending = pendingTargets.get(value.target.selectionId)
          if (pending === undefined || pending.expiresAt < Date.now()) {
            pendingTargets.delete(value.target.selectionId)
            event.sender.send('dsh:data-home:target-error', { status: 'unreadable', path: '' })
            return
          }
          pendingTargets.delete(value.target.selectionId)
          let resolvedTarget: string | undefined
          try {
            resolvedTarget = await resolveEmptyDesktopDataHome(pending.path)
          } catch {
            event.sender.send('dsh:data-home:target-error', { status: 'unreadable', path: pending.path })
            return
          }
          if (resolvedTarget === undefined) {
            event.sender.send('dsh:data-home:target-error', { status: 'not-empty', path: pending.path })
            return
          }
          target = resolvedTarget
          customTarget = true
        }
        if (value.mode === 'copied' && source !== undefined && desktopDataHomesOverlap(source.path, target)) {
          event.sender.send('dsh:data-home:target-error', { status: 'overlap', path: target })
          return
        }
        if (value.mode === 'fresh') finish({ mode: 'fresh', target, customTarget })
        else {
          if (source === undefined) return
          finish({ mode: 'copied', sourceKind: value.sourceKind, source: source.path, target, customTarget })
        }
      })().catch(fail)
    }
    const handleCancellation = (event: Electron.IpcMainEvent): void => {
      if (event.sender === chooser.webContents) finish()
    }
    ipcMain.on('dsh:data-home:selected', handleSelection)
    ipcMain.on('dsh:data-home:cancelled', handleCancellation)
    ipcMain.handle('dsh:data-home:choose-source', async (event, origin: unknown): Promise<DataHomeSourceResult> => {
      if (event.sender !== chooser.webContents) throw new Error('desktop: invalid data-home source requester')
      if (origin !== 'official' && origin !== 'community') throw new Error('desktop: invalid data-home source category')
      const result = await dialog.showOpenDialog(chooser, {
        title: shellMessages(app.getLocale()).chooseSource,
        properties: ['openDirectory'],
      })
      const candidate = result.filePaths[0]
      if (result.canceled || candidate === undefined) return { status: 'cancelled' }
      try {
        const source = await (origin === 'community' ? resolveCommunityDataHomeSource(candidate) : resolveDesktopDataHomeSource(candidate))
        return source === undefined
          ? { status: 'invalid', path: candidate }
          : { status: 'valid', path: source.path, entries: source.entries }
      } catch {
        return { status: 'unreadable', path: candidate }
      }
    })
    ipcMain.handle('dsh:data-home:choose-target', async (event): Promise<DataHomeTargetResult> => {
      if (event.sender !== chooser.webContents) throw new Error('desktop: invalid data-home target requester')
      const result = await dialog.showOpenDialog(chooser, {
        title: shellMessages(app.getLocale()).chooseTarget,
        properties: ['openDirectory', 'createDirectory'],
      })
      const candidate = result.filePaths[0]
      if (result.canceled || candidate === undefined) return { status: 'cancelled' }
      let path: string | undefined
      try {
        path = await resolveEmptyDesktopDataHome(candidate)
      } catch {
        return { status: 'unreadable', path: candidate }
      }
      if (path === undefined) return { status: 'not-empty', path: candidate }
      const selectionId = randomUUID()
      for (const [id, pending] of pendingTargets) {
        if (pending.expiresAt < Date.now()) pendingTargets.delete(id)
      }
      pendingTargets.set(selectionId, { path, expiresAt: Date.now() + DATA_HOME_SELECTION_LIFETIME_MS })
      return { status: 'selected', selectionId, path }
    })
    chooser.once('closed', () => { finish() })
    chooser.once('ready-to-show', () => {
      chooser.show()
      chooser.focus()
    })
    void chooser.loadFile(DATA_HOME_PAGE, { query: {
      locale: menuLocale,
      selected: officialSource === undefined && communitySource === undefined ? 'fresh' : 'imported',
      selectedSource: officialSource === undefined && communitySource !== undefined ? 'community' : 'official',
      officialSource: officialSource?.path ?? '',
      officialDefaultSource: officialSource?.path ?? '',
      officialSourceCandidate,
      officialSourceStatus: officialSourceUnreadable ? 'unreadable' : officialSource === undefined ? 'missing' : 'valid',
      communitySource: communitySource?.path ?? '',
      communityDefaultSource: communitySource?.path ?? '',
      communitySourceCandidate,
      communitySourceStatus: communitySourceUnreadable ? 'unreadable' : communitySource === undefined ? 'missing' : 'valid',
      defaultTarget,
      development: app.isPackaged ? 'false' : 'true',
    } }).catch(fail)
  })
}

async function prepareDesktopDshHome(layout: DesktopDataHomeLayout): Promise<string> {
  let previous = await readDesktopDataHomeSetup(layout.setupFile)
  if (previous?.mode === 'imported'
    && previous.importedOnboardingReset !== IMPORTED_ONBOARDING_RESET_VERSION) {
    await resetImportedDesktopOnboarding(previous.dshHome)
    previous = { ...previous, importedOnboardingReset: IMPORTED_ONBOARDING_RESET_VERSION }
    await writeDesktopDataHomeSetup(layout.setupFile, previous)
  }
  if (layout.explicitDshHome) {
    await writeDesktopDataHomeSetup(
      layout.setupFile,
      desktopDataHomeSetup('explicit', layout.dshHome),
    )
    return layout.dshHome
  }
  const recordedHome = resolveRecordedDesktopDataHome(layout, previous)
  if (recordedHome !== undefined && previous?.mode !== 'reused') return recordedHome
  if (recordedHome !== undefined) {
    try {
      const recordedSource = await resolveDesktopDataHomeSource(recordedHome)
      if (recordedSource?.path === recordedHome) return recordedHome
    } catch {
      // An unreadable reused source returns to the chooser below.
    }
  }
  if (await hasDesktopData(layout.dshHome)) {
    await writeDesktopDataHomeSetup(
      layout.setupFile,
      desktopDataHomeSetup('existing', layout.dshHome),
    )
    return layout.dshHome
  }
  let defaultSource: DesktopDataHomeSource | undefined
  let defaultSourceUnreadable = false
  try {
    defaultSource = await resolveDesktopDataHomeSource(layout.officialDshHome)
  } catch {
    defaultSourceUnreadable = true
  }
  let communitySource: DesktopDataHomeSource | undefined
  let communitySourceUnreadable = false
  try {
    communitySource = await resolveCommunityDataHomeSource(layout.communityDesktopRoot)
  } catch {
    communitySourceUnreadable = true
  }

  const copy = dataHomeCopy()
  const selection = await showDataHomeChooser(
    defaultSource,
    defaultSourceUnreadable,
    layout.officialDshHome,
    communitySource,
    communitySourceUnreadable,
    layout.communityDesktopRoot,
    layout.dshHome,
  )
  if (selection.mode === 'copied') {
    try {
      if (selection.sourceKind === 'official') {
        await importOfficialDesktopData(selection.source, selection.target)
      } else {
        await copyCommunityDesktopData(selection.source, selection.target)
      }
      await writeDesktopDataHomeSetup(
        layout.setupFile,
        desktopDataHomeSetup(selection.sourceKind === 'official' ? 'imported' : 'copied', selection.target, selection.source),
      )
      await dialog.showMessageBox({
        type: 'info', title: copy.completeTitle, message: copy.completeMessage,
        detail: selection.target, buttons: ['OK'], noLink: true,
      })
      return selection.target
    } catch (error) {
      dialog.showErrorBox(copy.failedTitle, error instanceof Error ? error.message : String(error))
      throw error
    }
  }
  if (selection.mode === 'reused') {
    await writeDesktopDataHomeSetup(
      layout.setupFile,
      desktopDataHomeSetup('reused', selection.source, selection.source),
    )
    return selection.source
  }
  await writeDesktopDataHomeSetup(
    layout.setupFile,
    desktopDataHomeSetup(selection.customTarget ? 'created' : 'fresh', selection.target),
  )
  return selection.target
}

function applyLaunchAtLogin(enabled: boolean): void {
  if (!desktopCapabilities().launchAtLoginAvailable) return
  app.setLoginItemSettings({ openAtLogin: enabled })
}

function publishPreferences(): void {
  mainSurface?.send('dsh:desktop:preferences', preferences)
  refreshTrayMenu()
}

function publishDesktopWebStatus(status: DesktopWebStatus): void {
  mainSurface?.send('dsh:desktop:web:status', status)
  applicationMenu?.refresh()
  refreshTrayMenu()
}

function updatePreferences(raw: unknown): DesktopPreferences {
  const patch = parseDesktopPreferencesPatch(raw)
  if (patch.launchAtLoginEnabled !== undefined) {
    if (!desktopCapabilities().launchAtLoginAvailable && patch.launchAtLoginEnabled) {
      throw new Error('desktop: launch at login is available only in a packaged macOS application')
    }
    applyLaunchAtLogin(patch.launchAtLoginEnabled)
  }
  preferences = { ...preferences, ...patch }
  preferencesStore?.write(preferences)
  publishPreferences()
  return preferences
}

async function openHarnessLog(): Promise<OpenLogResult> {
  const result = await revealHarnessLog(harnessLogPath, shell)
  if (result.error !== '') dialog.showErrorBox(desktopCopy().logErrorTitle, result.error)
  return result
}

function requestDesktopRestart(): void {
  if (lifecycle !== undefined) {
    void lifecycle.requestRestart(() => { app.relaunch() })
    return
  }
  app.relaunch()
  quitReleased = true
  app.quit()
}

function buildTrayMenu(): Menu {
  const copy = desktopCopy()
  const capabilities = desktopCapabilities()
  const template: MenuItemConstructorOptions[] = [
    { label: copy.open, click: () => { lifecycle?.showWindow() } },
    ...(DESKTOP_WEB_SUPPORTED ? [{
      label: copy.openWeb,
      enabled: desktopWebAccess?.canOpen() ?? false,
      click: () => { applicationMenu?.execute('open-web') },
    }] : []),
    {
      label: copy.restart,
      click: () => { applicationMenu?.execute('restart') },
    },
    { label: copy.openLog, click: () => { applicationMenu?.execute('logs') } },
    { type: 'separator' },
    {
      label: copy.launchAtLogin,
      type: 'checkbox',
      visible: capabilities.launchAtLoginAvailable,
      checked: preferences.launchAtLoginEnabled,
      click: (item) => { updatePreferences({ launchAtLoginEnabled: item.checked }) },
    },
    {
      label: copy.notifications,
      type: 'checkbox',
      checked: preferences.notificationsEnabled,
      click: (item) => { updatePreferences({ notificationsEnabled: item.checked }) },
    },
    { type: 'separator' },
    { label: copy.quit, click: () => { applicationMenu?.execute('quit') } },
  ]
  return Menu.buildFromTemplate(template)
}

function refreshTrayMenu(): void {
  tray?.setContextMenu(buildTrayMenu())
}

function createTray(): void {
  const images = iconManager?.images()
  tray = new Tray(images === undefined ? nativeImage.createFromPath(WINDOW_ICON) : desktopTrayImage(images))
  tray.setToolTip(APP_NAME)
  refreshTrayMenu()
  // A macOS tray with a context menu opens that menu on a primary click. Do
  // not also focus the application window: doing so lets an auto-hidden menu
  // bar collapse behind the still-open tray menu. Other platforms retain the
  // conventional primary-click shortcut for restoring the window.
  if (process.platform !== 'darwin') {
    tray.on('click', () => { lifecycle?.showWindow() })
  }
  tray.on('right-click', refreshTrayMenu)
}

/** Apply the saved Dock preference before either setup or the main window appears. */
function applyStartupDockIcon(): void {
  if (process.platform !== 'darwin') return
  try { app.dock?.setIcon(iconManager?.images().application ?? loadDefaultApplicationIcon(process.platform)) }
  catch { console.warn('desktop: Dock icon could not be applied') }
}

function desktopTrayImage(images: DesktopIconImages): Electron.NativeImage {
  if (images.trayTemplate) {
    images.tray.setTemplateImage(true)
    return images.tray
  }
  const image = nativeImage.createEmpty()
  const size = process.platform === 'darwin' ? 22 : 16
  for (const scaleFactor of [1, 2]) image.addRepresentation({
    scaleFactor, buffer: images.tray.resize({ width: size * scaleFactor, height: size * scaleFactor, quality: 'best' }).toPNG(),
  })
  image.setTemplateImage(false)
  return image
}

function desktopWindowIcon(): Electron.NativeImage | string {
  const images = iconManager?.images()
  if (process.platform === 'win32' && images?.applicationIco !== null && images?.applicationIco !== undefined) {
    return images.applicationIco
  }
  return images?.application ?? WINDOW_ICON
}

function applyDesktopIcons(images: DesktopIconImages, shortcuts: boolean, createShortcut: boolean): IconSurfaceResult[] {
  applicationMenu?.refresh()
  const results: IconSurfaceResult[] = []
  try {
    if (process.platform === 'darwin') {
      if (app.dock === undefined) throw new Error('Dock unavailable')
      app.dock.setIcon(images.application)
    } else {
      for (const window of BrowserWindow.getAllWindows()) window.setIcon(images.applicationIco ?? images.application)
      if (app.isPackaged) {
        for (const window of BrowserWindow.getAllWindows()) window.setAppDetails({
          appId: 'ai.flaq.deepseek-harness', appIconPath: images.applicationIco ?? process.execPath,
          appIconIndex: 0, relaunchCommand: `"${process.execPath}"`, relaunchDisplayName: APP_NAME,
        })
      }
    }
    results.push({ surface: 'application', status: 'applied' })
  } catch { results.push({ surface: 'application', status: 'unavailable' }) }
  try {
    if (tray === undefined) throw new Error('Tray unavailable')
    tray.setImage(desktopTrayImage(images))
    results.push({ surface: 'tray', status: 'applied' })
  } catch { results.push({ surface: 'tray', status: 'unavailable' }) }
  if (process.platform === 'win32') {
    results.push({ surface: 'taskbar', status: 'repin' })
    if (app.isPackaged && shortcuts) {
      try {
        results.push(...updateIconShortcuts({
          desktop: app.getPath('desktop'),
          startMenu: join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
          executable: process.execPath, managedDirectory: join(app.getPath('userData'), 'icons'),
          appId: 'ai.flaq.deepseek-harness', read: path => shell.readShortcutLink(path),
          write: (path, operation, options) => shell.writeShortcutLink(path, operation, options),
        }, images.applicationIco ?? process.execPath, createShortcut))
      } catch { results.push({ surface: 'desktop', status: 'unavailable' }, { surface: 'start-menu', status: 'unavailable' }) }
    }
  }
  return results
}

const PLUGIN_SNAPSHOT_JSON_MARKER = 'dsh:plugin-snapshot-json '

function parsePluginSnapshotJson(output: string): unknown {
  const line = output.split(/\r?\n/u).find(candidate => candidate.startsWith(PLUGIN_SNAPSHOT_JSON_MARKER))
  if (line === undefined) throw new Error(`desktop: plugin snapshot command returned no structured result: ${output.slice(-2000)}`)
  return JSON.parse(line.slice(PLUGIN_SNAPSHOT_JSON_MARKER.length)) as unknown
}

function parseDiagnosticLabDoctorOutput(output: string): DiagnosticLabDoctorResult {
  const start = output.indexOf('{')
  const end = output.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error(`desktop: Doctor returned no structured report: ${output.slice(-2000)}`)
  const report = JSON.parse(output.slice(start, end + 1)) as {
    status?: unknown
    issues?: Array<{ code?: unknown }>
  }
  if (typeof report.status !== 'string' || !Array.isArray(report.issues)) {
    throw new Error('desktop: Doctor returned an invalid structured report')
  }
  return {
    status: report.status,
    issueCodes: report.issues.flatMap(issue => typeof issue.code === 'string' ? [issue.code] : []),
    output,
  }
}

class PackageManagerInvocationError extends Error {
  readonly timedOut: boolean

  constructor(message: string, timedOut: boolean) {
    super(message)
    this.timedOut = timedOut
  }
}

async function runPackageManagerInvocation(
  args: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
  options: DesktopLaunchOptions,
  timeoutMs = 10 * 60_000,
): Promise<string> {
  const packageManager = options.packageManagerBin
  if (packageManager === undefined) throw new Error('desktop: bundled pnpm is unavailable')
  const javaScriptEntry = /\.(?:cjs|mjs|js)$/iu.test(packageManager)
  const command = javaScriptEntry
    ? environment.DSH_DESKTOP_NODE_BIN ?? options.nodeCommand ?? 'node'
    : packageManager
  const commandArgs = javaScriptEntry ? [packageManager, ...args] : [...args]
  try {
    if (args[0] === 'install' && environment.DSH_HOME !== undefined
      && cwd === join(environment.DSH_HOME, 'profiles', 'web')) {
      return await runDesktopInvocation(resolveHarnessInvocation(environment, [
        'plugin', '--profile', 'web', 'snapshot', 'materialize', ...args.slice(1),
      ], options), 'package-manager', timeoutMs)
    }
    return await runDesktopInvocation({
      command,
      args: commandArgs,
      cwd,
      environment,
    }, 'package-manager', timeoutMs)
  } catch (error) {
    throw new PackageManagerInvocationError(
      error instanceof Error ? error.message : String(error),
      error instanceof HarnessInvocationError && error.timedOut,
    )
  }
}

async function inspectImportedPluginSource(
  packageSpec: string,
  environment: NodeJS.ProcessEnv,
  options: DesktopLaunchOptions,
) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-plugin-source-check-'))
  try {
    await writeFile(join(directory, 'package.json'), '{"private":true}\n', { mode: 0o600 })
    try {
      await runPackageManagerInvocation([
        'add', '--lockfile-only', '--ignore-scripts', '--save-exact', packageSpec,
      ], directory, environment, options)
      return { availability: 'available' as const }
    } catch (error) {
      return classifyImportedPluginSourceFailure(
        error instanceof Error ? error.message : String(error),
        error instanceof PackageManagerInvocationError && error.timedOut,
      )
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function showDesktopMessageBox(options: MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  return mainWindow === undefined
    ? dialog.showMessageBox(options)
    : dialog.showMessageBox(mainWindow, options)
}

async function resolveStartupBuildApproval(
  diagnostic: string,
  environment: NodeJS.ProcessEnv,
  launchOptions: DesktopLaunchOptions,
): Promise<string> {
  const approval = parseStartupBuildApproval(diagnostic)
  if (approval === undefined) return diagnostic
  const chinese = app.getLocale().toLowerCase().startsWith('zh')
  const result = await showDesktopMessageBox({
    type: 'warning',
    title: shellMessages(app.getLocale()).buildBlockedTitle,
    message: shellMessages(app.getLocale()).buildBlockedMessage,
    detail: chinese
      ? `pnpm 已阻止 ${approval.packageBuildKey} 的构建脚本。该插件已被安全隔离，因此即使不允许也可以继续进入应用。仅在你信任插件来源时允许。`
      : `pnpm blocked the build script for ${approval.packageBuildKey}. The plugin is already safely isolated, so you can continue without allowing it. Only allow a source you trust.`,
    buttons: chinese
      ? ['允许构建并恢复插件', '不允许，保持隔离', '退出应用']
      : ['Allow and restore plugin', 'Keep isolated', 'Quit'],
    defaultId: 1,
    cancelId: 2,
    noLink: true,
  })
  if (result.response === 2) throw new DesktopDataHomeSelectionCancelledError()
  if (result.response !== 0) return diagnostic

  const recoveryDiagnostics: string[] = []
  try {
    recoveryDiagnostics.push(await runDesktopInvocation(resolveHarnessInvocation(environment, [
      'plugin', '--profile', 'web', 'approve-build-key', approval.packageBuildKey,
    ], launchOptions), 'build-approval-recovery', BUILD_APPROVAL_TIMEOUT_MS))
    for (const quarantineId of approval.quarantineIds) {
      recoveryDiagnostics.push(await runDesktopInvocation(resolveHarnessInvocation(environment, [
        'plugin', '--profile', 'web', 'doctor', '--retry', quarantineId,
      ], launchOptions), 'quarantine-retry', PROFILE_REPAIR_TIMEOUT_MS, [0, 10, 11]))
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    await showDesktopMessageBox({
      type: 'warning',
      title: shellMessages(app.getLocale()).recoveryFailedTitle,
      message: shellMessages(app.getLocale()).recoveryFailedMessage,
      detail: chinese
        ? `构建许可未能安全完成或插件仍有其他问题。插件会继续保持隔离，可稍后在“诊断”中重试。\n\n${detail.slice(-2000)}`
        : `The approval could not be completed safely or the plugin has another issue. It remains isolated and can be retried later in Diagnostics.\n\n${detail.slice(-2000)}`,
      buttons: [chinese ? '继续' : 'Continue'],
    })
    return `${diagnostic}\n[desktop] Build approval recovery failed: ${detail}`
  }
  return `${diagnostic}\n[desktop] User approved ${JSON.stringify(approval.packageBuildKey)} and restored ${approval.quarantineIds.length} quarantined plugin(s).\n${recoveryDiagnostics.join('\n')}`
}

function assertMainRenderer(sender: Electron.WebContents): void {
  if (mainSurface === undefined || mainSurface.window.isDestroyed()
    || !isDesktopRenderer(sender, mainSurface.renderer)) {
    throw new Error('desktop: request came from an untrusted renderer')
  }
}

function publishStartupProgress(next: DesktopStartupProgress): void {
  startupProgress = {
    ...next,
    startedAt: next.startedAt ?? Date.now(),
    state: next.state ?? 'running',
  }
  mainSurface?.send('dsh:startup-progress', startupProgress)
}

function showLoading(
  state: HarnessState,
  failure?: HarnessFailure & { logPath: string },
  mode?: 'shutdown',
): void {
  if (mainSurface === undefined || mainSurface.window.isDestroyed() || state === 'ready' || state === 'stopped') return
  if (failure !== undefined) latestRecoveryFailure = failure.message
  void mainSurface.loadFile(LOADING_PAGE, {
    query: {
      state,
      locale: menuLocale,
      ...(mode === 'shutdown' || startupProgress.stage === 'waiting-background-tasks'
        || startupProgress.stage === 'stopping-harness'
        || startupProgress.stage === 'reclaiming-processes'
        || startupProgress.stage === 'checking-shutdown')
        ? { mode: 'shutdown' }
        : {},
      stage: startupProgress.stage,
      progress: String(startupProgress.progress),
      ...(startupProgress.detail === undefined ? {} : { detail: startupProgress.detail }),
      ...(failure === undefined ? {} : { message: failure.message, logPath: failure.logPath }),
    },
  }).catch((error: unknown) => {
    // A newer loading stage or the ready page can supersede this navigation.
    if (error instanceof Error && 'code' in error && error.code === 'ERR_ABORTED') return
    console.error('desktop: loading page navigation failed', error)
  })
}

function configureNavigation(renderer: WebContents): void {
  const permissionGrants = new Set<string>()
  const permissionDetails = (details: object): HarnessPermissionDetails => ({
    ...('mediaType' in details && details.mediaType !== undefined
      ? { mediaType: details.mediaType as Exclude<HarnessPermissionDetails['mediaType'], undefined> }
      : {}),
    ...('mediaTypes' in details && Array.isArray(details.mediaTypes)
      ? { mediaTypes: details.mediaTypes as ('video' | 'audio')[] }
      : {}),
  })
  const originGrantKey = (origin: string, key: string): string => `${origin}\n${key}`
  const requestPermissionConsent = (
    permission: string,
    details: HarnessPermissionDetails,
    origin: string,
  ): Promise<boolean> => {
    const decisionKeys = harnessPermissionDecisionKeys(permission, details)
    if (decisionKeys.length === 0) return Promise.resolve(false)
    const promptKey = `${renderer.id}\n${origin}\n${decisionKeys.join(',')}`
    const existing = pendingPermissionPrompts.get(promptKey)
    if (existing !== undefined) return existing

    const chinese = app.getLocale().toLowerCase().startsWith('zh')
    const capability = harnessPermissionName(permission, details, chinese ? 'zh' : 'en')
    const options: MessageBoxOptions = {
      type: 'question',
      title: shellMessages(app.getLocale()).permissionTitle(APP_NAME),
      message: shellMessages(app.getLocale()).permissionMessage(capability),
      detail: chinese
        ? '仅在你确认后，当前本机 Harness 页面才能使用此能力。拒绝不会影响其他功能。'
        : 'Only the current local Harness page can use this capability after you approve it. Denying it will not affect other features.',
      buttons: chinese ? ['拒绝', '允许'] : ['Deny', 'Allow'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    }
    const decision = permissionPromptQueue.then(async () => {
      if (renderer.isDestroyed() || harnessOrigin !== origin) return false
      const owner = BrowserWindow.fromWebContents(renderer)
      const result = owner === null
        ? await dialog.showMessageBox(options)
        : await dialog.showMessageBox(owner, options)
      return result.response === 1 && !renderer.isDestroyed() && harnessOrigin === origin
    })
    permissionPromptQueue = decision.then(() => undefined, () => undefined)
    pendingPermissionPrompts.set(promptKey, decision)
    void decision.then(
      () => pendingPermissionPrompts.delete(promptKey),
      () => pendingPermissionPrompts.delete(promptKey),
    )
    return decision
  }

  renderer.on('will-navigate', (event, target) => {
    if (harnessOrigin !== undefined && new URL(target).origin === harnessOrigin) return
    event.preventDefault()
  })
  renderer.setWindowOpenHandler(({ url }) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return { action: 'deny' }
    }
    if (parsed.protocol === 'https:') void shell.openExternal(parsed.href)
    return { action: 'deny' }
  })
  renderer.session.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
    const origin = harnessOrigin
    const trustedContents = contents === renderer
      || (contents === null && details.embeddingOrigin === undefined)
    if (!trustedContents || !isTrustedHarnessPermissionRequest(
      permission, details.requestingUrl ?? requestingOrigin, origin, details.isMainFrame,
    )) return false
    if (isSilentHarnessPermission(permission)) return true
    if (origin === undefined) return false
    const keys = harnessPermissionDecisionKeys(permission, permissionDetails(details))
    return keys.length > 0 && keys.every(key => permissionGrants.has(originGrantKey(origin, key)))
  })
  renderer.session.setPermissionRequestHandler((contents, permission, callback, details) => {
    const requestingUrl = details.requestingUrl
    const isMainFrame = 'isMainFrame' in details && details.isMainFrame
    const origin = harnessOrigin
    if (contents !== renderer || !isTrustedHarnessPermissionRequest(
      permission, requestingUrl, origin, isMainFrame,
    )) {
      callback(false)
      return
    }
    if (isSilentHarnessPermission(permission)) {
      callback(true)
      return
    }
    if (origin === undefined) {
      callback(false)
      return
    }
    const parsedDetails = permissionDetails(details)
    const keys = harnessPermissionDecisionKeys(permission, parsedDetails)
    if (keys.length > 0 && keys.every(key => permissionGrants.has(originGrantKey(origin, key)))) {
      callback(true)
      return
    }
    void requestPermissionConsent(permission, parsedDetails, origin).then((allowed) => {
      if (allowed) for (const key of keys) permissionGrants.add(originGrantKey(origin, key))
      callback(allowed)
    }, () => { callback(false) })
  })
}

function createWindow(): BrowserWindow {
  const rendererPreferences: WebPreferences = {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    preload: PRELOAD,
    additionalArguments: [app.isPackaged ? '--dsh-packaged' : '--dsh-source'],
  }
  const surface = createDesktopWindowSurface({
    platform: process.platform,
    window: {
      title: APP_NAME,
      width: 1440,
      height: 920,
      minWidth: 960,
      minHeight: 640,
      backgroundColor: desktopThemeBackground(desktopThemeSource, nativeTheme.shouldUseDarkColors),
      icon: desktopWindowIcon(),
      show: false,
    },
    rendererPreferences,
    titlebarPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: TITLEBAR_PRELOAD,
    },
    titlebarPage: TITLEBAR_PAGE,
    onSplitFailure: (error) => {
      console.error('desktop: could not create split title-bar renderer; using the native frame', error)
      void appendDesktopStartupLog(`Split title-bar renderer unavailable: ${error instanceof Error ? error.message : String(error)}`)
    },
  })
  const { window } = surface
  configureNavigation(surface.renderer)
  surface.renderer.on('page-title-updated', (_event, title) => {
    if (title !== '') surface.sendTitlebar('dsh:window:title', title)
  })
  if (surface.titlebarRenderer !== undefined) {
    const syncTitlebarState = (): void => {
      surface.layout()
      surface.sendTitlebar('dsh:window:maximized', window.isMaximized())
      surface.sendTitlebar('dsh:window:title', surface.renderer.getTitle() || APP_NAME)
      surface.sendTitlebar('dsh:window:theme', nativeTheme.shouldUseDarkColors)
    }
    window.on('maximize', syncTitlebarState)
    window.on('unmaximize', syncTitlebarState)
    void surface.initialize().then(syncTitlebarState, (error: unknown) => {
      console.error('desktop: could not load the custom title bar', error)
    })
  }
  window.once('ready-to-show', () => {
    if (!hiddenLaunch && lifecycle?.isQuitting !== true) window.show()
  })
  window.on('close', (event) => {
    lifecycle?.onWindowClose(event)
    if (!event.defaultPrevented) surface.dispose()
  })
  window.on('closed', () => {
    surface.dispose()
    if (mainSurface === surface) mainSurface = undefined
    if (mainWindow === window) mainWindow = undefined
  })
  mainWindow = window
  mainSurface = surface
  applicationMenu?.attach(surface)
  applicationMenu?.refresh()
  const refreshMenu = (): void => { applicationMenu?.refresh() }
  window.on('maximize', refreshMenu)
  window.on('unmaximize', refreshMenu)
  window.on('enter-full-screen', refreshMenu)
  window.on('leave-full-screen', refreshMenu)
  surface.titlebarRenderer?.on('did-finish-load', () => { applicationMenu?.refresh() })
  const rendererId = surface.renderer.id
  surface.renderer.on('destroyed', () => { iconManager?.discardOwner(rendererId); rejectPendingMenuCommands() })
  surface.renderer.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) {
      iconManager?.discardOwner(rendererId)
      menuClientReady = false
      rejectPendingMenuCommands()
      applicationMenu?.refresh()
    }
  })
  if (iconManager !== undefined && tray !== undefined) iconManager.refresh(app.isPackaged)
  if (harnessOrigin === undefined) showLoading('starting')
  else void surface.loadURL(withDesktopWindowMetadata(harnessOrigin, process.platform))
  return window
}

async function startApplication(): Promise<void> {
  if (process.platform === 'win32') app.setAppUserModelId('ai.flaq.deepseek-harness')
  await app.whenReady()
  desktopLocaleStore = createDesktopLocaleStore(join(app.getPath('userData'), 'desktop-locale.json'))
  menuLocale = desktopLocaleStore.read(app.getLocale())
  applicationMenu = new ApplicationMenuController({
    surface: () => mainSurface,
    state: () => ({ platform: process.platform, locale: menuLocale, ready: menuClientReady && harnessOrigin !== undefined,
      busy: menuBusy(), maximized: mainWindow?.isMaximized() ?? false,
      fullscreen: mainWindow?.isFullScreen() ?? false, development: !app.isPackaged }),
    icon: () => (iconManager?.images().application ?? nativeImage.createFromPath(WINDOW_ICON))
      .resize({ width: 20, height: 20 }).toDataURL(),
    execute: executeProductMenu, reportError: reportMenuError,
  })
  disposeApplicationMenu = applicationMenu.register(ipcMain)
  applicationMenu.refresh()
  if (process.platform === 'darwin' || process.platform === 'win32') {
    iconManager = new DesktopIconManager({
      directory: join(app.getPath('userData'), 'icons'), platform: process.platform, packaged: app.isPackaged,
      defaultApplication: loadDefaultApplicationIcon(process.platform),
      defaultTray: nativeImage.createFromPath(process.platform === 'darwin' ? MACOS_TRAY_ICON : WINDOW_ICON),
      apply: applyDesktopIcons,
      notify: status => mainSurface?.send('dsh:desktop:icons:status', status),
    })
  }
  applyStartupDockIcon()
  const dshHome = await prepareDesktopDshHome(DESKTOP_DATA_HOME)
  const preserveCopiedPlugins = (await readDesktopDataHomeSetup(DESKTOP_DATA_HOME.setupFile))?.mode === 'copied'
  activeMenuHome = dshHome
  const persistentServicesPath = join(app.getPath('userData'), 'managed-processes', 'persistent-services-v1.json')
  persistentServiceAuthority = new FilePersistentServiceAuthorizer(
    persistentServicesPath,
    persistentProfileFingerprint(dshHome),
  )
  persistentServiceRuntime = new FilePersistentServiceRuntimeRegistry(
    persistentServicesPath,
    persistentProfileFingerprint(dshHome),
  )
  const retainStartupWarning = async (
    code: StartupDiagnosticCode,
    operation: string,
    actions: StartupDiagnosticIncident['actions'],
    packageName?: string,
  ): Promise<void> => {
    startupWarnings.push(`${code}: ${packageName ?? operation}`)
    await recordStartupDiagnostic(dshHome, {
      code, operation, actions,
      ...(packageName === undefined ? {} : { packageName }),
    })
  }
  applyDesktopThemeSource(await readDesktopThemeSource(
    dshHome,
    (error) => { console.warn('desktop: could not read theme preference; following the system appearance', error) },
  ))
  const downloadNetworkFile = join(app.getPath('userData'), 'download-network-v1.json')
  downloadNetworkStore = new DownloadNetworkSettingsStore(
    downloadNetworkFile,
    {
      available: () => safeStorage.isEncryptionAvailable(),
      encrypt: value => safeStorage.encryptString(value),
      decrypt: value => safeStorage.decryptString(value),
    },
    (error) => { console.error('desktop: could not read download network settings; using defaults', error) },
  )
  downloadNetworkProxy = await startPluginDownloadProxy(downloadNetworkStore)
  let harnessEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    DSH_HOME: dshHome,
    DSH_DESKTOP_APPLICATION_VERSION: app.getVersion(),
    DSH_DESKTOP_PNPM_VERSION: DESKTOP_PNPM_VERSION,
    DSH_PROFILE_SAFE_MODE_ON_FAILURE: '1',
    DSH_DESKTOP_PERSISTENT_SERVICES: persistentServicesPath,
    DSH_DESKTOP_PERSISTENT_PROFILE: persistentProfileFingerprint(dshHome),
    DSH_DESKTOP_DOWNLOAD_NETWORK_FILE: downloadNetworkFile,
    ...pluginDownloadEnvironment(downloadNetworkStore, downloadNetworkProxy.pluginUrl),
  }
  try {
    const resolvedProxy = await resolveSystemProxyEnvironment(
      harnessEnvironment,
      url => session.defaultSession.resolveProxy(url),
    )
    harnessEnvironment = resolvedProxy.environment
    if (resolvedProxy.applied) console.info('desktop: system proxy resolved for Codex only; package-manager proxy configuration unchanged')
  } catch {
    console.warn('desktop: system proxy resolution failed; preserving explicit proxy configuration (resolver details omitted for privacy)')
  }
  let launchOptions: DesktopLaunchOptions = app.isPackaged
    ? {}
    : resolveDevelopmentLaunchOptions(DEFAULT_SOURCE_ROOT)
  harnessLogPath = join(app.getPath('logs'), 'harness.log')
  preferencesStore = createDesktopPreferencesStore(
    join(app.getPath('userData'), 'desktop-preferences.json'),
    (error) => { console.error('desktop: could not read preferences; using defaults', error) },
  )
  preferences = preferencesStore.read()
  chatBackgroundStore = createDesktopChatBackgroundStore(
    join(app.getPath('userData'), 'chat-background.json'),
    (error) => { console.error('desktop: could not read chat background; using browser fallback', error) },
  )
  if (!desktopCapabilities().launchAtLoginAvailable) preferences.launchAtLoginEnabled = false
  applyLaunchAtLogin(preferences.launchAtLoginEnabled)
  hiddenLaunch = (DESKTOP_WEB_SUPPORTED && preferences.openBrowserOnStartup) || (process.platform === 'darwin'
    && preferences.launchAtLoginEnabled
    && app.getLoginItemSettings().wasOpenedAtLogin)
  const updater = new SourceUpdater({
    sourceRoot: process.env.DSH_DESKTOP_SOURCE_ROOT ?? DEFAULT_SOURCE_ROOT,
    nodeCommand: process.env.DSH_DESKTOP_NODE_BIN ?? 'node',
  })
  const applicationFetch = async (): Promise<ReleaseFetch> => {
    const mode = downloadNetworkStore?.read().application.proxy.mode ?? 'system'
    if (mode === 'system') return (input, init) => net.fetch(input, init)
    applicationDownloadSession ??= session.fromPartition('dsh-download-network', { cache: false })
    if (downloadNetworkProxy === undefined) throw new Error('Application download proxy is unavailable')
    const proxyRules = downloadNetworkProxy.applicationProxyRules
    await applicationDownloadSession.setProxy(mode === 'direct'
      ? { mode: 'direct' }
      : { mode: 'fixed_servers', proxyRules })
    await applicationDownloadSession.closeAllConnections()
    return (input, init) => applicationDownloadSession?.fetch(input, init) ?? Promise.reject(new Error('Application download session is unavailable'))
  }
  const pluginFetch = async (): Promise<ReleaseFetch> => {
    if (downloadNetworkProxy === undefined) throw new Error('Plugin download proxy is unavailable')
    pluginDownloadSession ??= session.fromPartition('dsh-plugin-download-network', { cache: false })
    await pluginDownloadSession.setProxy({ mode: 'fixed_servers', proxyRules: downloadNetworkProxy.pluginProxyRules })
    await pluginDownloadSession.closeAllConnections()
    return (input, init) => pluginDownloadSession?.fetch(input, init) ?? Promise.reject(new Error('Plugin download session is unavailable'))
  }
  app.on('login', (event, webContents, _details, authInfo, callback) => {
    if (!authInfo.isProxy || authInfo.host !== '127.0.0.1' || downloadNetworkProxy === undefined) return
    const credentials = webContents.session === applicationDownloadSession
      ? downloadNetworkProxy.applicationProxyCredentials
      : webContents.session === pluginDownloadSession
        ? downloadNetworkProxy.pluginProxyCredentials
        : undefined
    if (credentials === undefined) return
    event.preventDefault()
    callback(credentials.username, credentials.password)
  })
  const publishDownloadNetworkTest = (status: DownloadNetworkTestStatus): DownloadNetworkTestStatus => {
    downloadNetworkTestStatus = status
    mainSurface?.send('dsh:desktop:download-network:test-status', status)
    return status
  }
  const testDownloadNetwork = async (target: DownloadNetworkTarget): Promise<DownloadNetworkTestStatus> => {
    const startedAt = Date.now()
    publishDownloadNetworkTest({ phase: 'testing', target, stage: 'metadata' })
    try {
      if (target === 'application') {
        const fetcher = await applicationFetch()
        if (downloadNetworkStore?.read().application.source === 'cnb') await fetchCnbReleaseIndex(fetcher)
        else await fetchGitHubReleases(fetcher)
      } else {
        const settings = downloadNetworkStore?.read()
        const fetcher = await pluginFetch()
        const url = target === 'npm'
          ? `${settings === undefined ? 'https://registry.npmjs.org' : settings.npm.registry === 'npmmirror'
            ? 'https://registry.npmmirror.com' : settings.npm.registry === 'custom'
              ? settings.npm.registryUrl : 'https://registry.npmjs.org'}/dshmarket/latest`
          : settings?.github.download === 'custom' && settings.github.acceleratorUrl !== undefined
            ? `${settings.github.acceleratorUrl}/https://github.com/deepseek-ai/deepseek-harness/info/refs?service=git-upload-pack`
            : 'https://github.com/deepseek-ai/deepseek-harness/info/refs?service=git-upload-pack'
        publishDownloadNetworkTest({ phase: 'testing', target, stage: 'download' })
        const response = await fetcher(url, { headers: { 'User-Agent': 'DeepSeek-Harness-Desktop' } })
        if (!response.ok) throw new Error(`${target} metadata returned HTTP ${response.status}`)
        const reader = response.body?.getReader()
        if (reader !== undefined) { await reader.read(); await reader.cancel() }
      }
      const stage = target === 'application' ? 'metadata' : 'download'
      return publishDownloadNetworkTest({ phase: 'succeeded', target, stage, elapsedMs: Date.now() - startedAt })
    } catch (error) {
      const stage = downloadNetworkTestStatus.phase === 'testing' && downloadNetworkTestStatus.target === target
        ? downloadNetworkTestStatus.stage : 'metadata'
      return publishDownloadNetworkTest({ phase: 'failed', target, stage,
        message: error instanceof Error ? error.message : String(error) })
    }
  }
  const configureReleaseServices = async (): Promise<void> => {
    stopReleaseChecks?.(); stopReleaseChecks = undefined
    await releaseDownloader?.dispose()
    if (!app.isPackaged) { releaseChecker = undefined; releaseDownloader = undefined; return }
    const fetcher = await applicationFetch()
    const applicationSettings = downloadNetworkStore?.read().application
    const source = applicationSettings?.source ?? 'github'
    releaseChecker = source === 'cnb'
      ? new DesktopReleaseChecker(app.getVersion(), undefined, async () => {
        return selectCnbRelease(app.getVersion(), await fetchCnbReleaseIndex(fetcher))
      })
      : new DesktopReleaseChecker(app.getVersion(), () => fetchGitHubReleases(fetcher))
    releaseDownloader = new DesktopReleaseDownloader({
      platform: process.platform, arch: process.arch,
      downloadDirectory: join(app.getPath('userData'), 'updates'),
      getRelease: () => releaseChecker?.status ?? { phase: 'unsupported' },
      openPath: path => shell.openPath(path), systemFetch: fetcher,
      ...(applicationSettings?.proxy.mode === 'system' ? {} : { apiFetch: fetcher }),
    })
    releaseChecker.subscribe((status) => {
      releaseDownloader?.resetForRelease(status)
      mainSurface?.send('dsh:desktop:release-status', status)
    })
    releaseDownloader.subscribe((status) => { mainSurface?.send('dsh:desktop:release-download-status', status) })
    stopReleaseChecks = releaseChecker.startPolling()
  }
  await configureReleaseServices()
  externalToolCompatibility = new ExternalToolCompatibilityManager({
    cacheDirectory: join(app.getPath('userData'), 'external-tool-compatibility'),
    desktopVersion: app.getVersion(),
  })
  ipcMain.handle('dsh:desktop:capabilities', (event) => {
    assertMainRenderer(event.sender)
    return desktopCapabilities()
  })
  ipcMain.handle('dsh:desktop:processes:list', (event) => {
    assertMainRenderer(event.sender)
    return processObserver?.list() ?? []
  })
  ipcMain.handle('dsh:desktop:processes:stop', async (event, id: unknown) => {
    assertMainRenderer(event.sender)
    if (typeof id !== 'string' || id.length < 1 || id.length > 128) {
      throw new TypeError('desktop: invalid managed process id')
    }
    const current = processObserver?.list().find(process => process.id === id)
    if (current === undefined || !current.stoppable) throw new Error('desktop: process cannot be stopped from settings')
    await processObserver?.stop(id)
    return processObserver?.list() ?? []
  })
  ipcMain.handle('dsh:desktop:persistent-services:list', (event): readonly PersistentServiceSummary[] => {
    assertMainRenderer(event.sender)
    return persistentServiceAuthority?.list() ?? []
  })
  ipcMain.handle('dsh:desktop:persistent-services:approve', (event, key: unknown): readonly PersistentServiceSummary[] => {
    assertMainRenderer(event.sender)
    if (typeof key !== 'string' || !/^[a-f0-9]{64}$/u.test(key)) {
      throw new TypeError('desktop: invalid persistent service request')
    }
    if (persistentServiceAuthority === undefined) throw new Error('desktop: persistent service authority is unavailable')
    return persistentServiceAuthority.approve(key)
  })
  ipcMain.handle('dsh:desktop:persistent-services:revoke', async (event, key: unknown): Promise<readonly PersistentServiceSummary[]> => {
    assertMainRenderer(event.sender)
    if (typeof key !== 'string' || !/^[a-f0-9]{64}$/u.test(key)) {
      throw new TypeError('desktop: invalid persistent service request')
    }
    if (persistentServiceAuthority === undefined) throw new Error('desktop: persistent service authority is unavailable')
    if (persistentServiceRuntime === undefined) throw new Error('desktop: persistent service runtime registry is unavailable')
    const service = persistentServiceAuthority.list().find(record => record.key === key)
    if (service === undefined) throw new Error('desktop: persistent service request is unavailable')
    const identities = persistentServiceRuntime.identities(key)
    if (identities.length > 0) {
      if (processObserver === undefined) throw new Error('desktop: persistent service cannot be stopped safely')
      await processObserver.stopRecovered(key, `${service.pluginName}: ${service.serviceId}`, identities)
      persistentServiceRuntime.clear(key)
    }
    return persistentServiceAuthority.revoke(key)
  })
  ipcMain.handle('dsh:desktop:persistent-services:prepare-plugin-uninstall', async (event, packageName: unknown) => {
    assertMainRenderer(event.sender)
    if (!isRecoveryPluginPackageName(packageName)) throw new TypeError('desktop: invalid plugin identity')
    await stopAndRevokePersistentServicesForPlugin(packageName)
    return { prepared: true as const }
  })
  ipcMain.handle('dsh:desktop:data-home:get', (event) => {
    assertMainRenderer(event.sender)
    return inspectDesktopDataHomeStatus(DESKTOP_DATA_HOME, dshHome)
  })
  ipcMain.handle('dsh:desktop:data-home:choose', async (
    event,
    selectionKind: unknown,
  ): Promise<DesktopDataHomeSelectionResult> => {
    assertMainRenderer(event.sender)
    if (selectionKind !== 'existing' && selectionKind !== 'empty') {
      throw new TypeError('desktop: invalid data-home selection kind')
    }
    const surface = mainSurface
    if (surface === undefined) throw new Error('desktop: main window is unavailable')
    const result = await dialog.showOpenDialog(surface.window, {
      title: selectionKind === 'empty'
        ? shellMessages(app.getLocale()).chooseEmpty
        : shellMessages(app.getLocale()).chooseExisting,
      properties: ['openDirectory'],
    })
    const candidate = result.filePaths[0]
    if (result.canceled || candidate === undefined) return { status: 'cancelled' }
    let selectedPath: string | undefined
    let entries: readonly string[] = []
    try {
      if (selectionKind === 'empty') {
        selectedPath = await resolveEmptyDesktopDataHome(candidate)
        if (selectedPath === undefined) return { status: 'not-empty', path: candidate }
      } else {
        const source: DesktopDataHomeSource | undefined = await resolveDesktopDataHomeSource(candidate)
        if (source === undefined) return { status: 'invalid', path: candidate }
        selectedPath = source.path
        entries = source.entries
      }
    } catch {
      return { status: 'unreadable', path: candidate }
    }
    const now = Date.now()
    for (const [selectionId, pending] of pendingDataHomeSelections) {
      if (pending.expiresAt <= now || pending.rendererId === event.sender.id) {
        pendingDataHomeSelections.delete(selectionId)
      }
    }
    const selectionId = randomUUID()
    pendingDataHomeSelections.set(selectionId, {
      rendererId: event.sender.id,
      selectionKind,
      path: selectedPath,
      expiresAt: now + DATA_HOME_SELECTION_LIFETIME_MS,
    })
    return { status: 'selected', selectionKind, selectionId, path: selectedPath, entries }
  })
  ipcMain.handle('dsh:desktop:data-home:choose-recovery', async (
    event,
  ): Promise<DesktopDataHomeSelectionResult> => {
    assertMainRenderer(event.sender)
    const surface = mainSurface
    if (surface === undefined) throw new Error('desktop: main window is unavailable')
    const result = await dialog.showOpenDialog(surface.window, {
      title: shellMessages(app.getLocale()).switchData,
      properties: ['openDirectory', 'createDirectory'],
    })
    const candidate = result.filePaths[0]
    if (result.canceled || candidate === undefined) return { status: 'cancelled' }
    let selection
    try {
      selection = await resolveDesktopDataHomeRecoverySelection(candidate)
    } catch {
      return { status: 'unreadable', path: candidate }
    }
    if (selection === undefined) return { status: 'invalid', path: candidate }
    const now = Date.now()
    for (const [selectionId, pending] of pendingDataHomeSelections) {
      if (pending.expiresAt <= now || pending.rendererId === event.sender.id) {
        pendingDataHomeSelections.delete(selectionId)
      }
    }
    const selectionId = randomUUID()
    pendingDataHomeSelections.set(selectionId, {
      rendererId: event.sender.id,
      selectionKind: selection.kind,
      path: selection.path,
      expiresAt: now + DATA_HOME_SELECTION_LIFETIME_MS,
    })
    return {
      status: 'selected',
      selectionKind: selection.kind,
      selectionId,
      path: selection.path,
      entries: selection.kind === 'existing' ? selection.entries : [],
    }
  })
  ipcMain.handle('dsh:desktop:data-home:switch', async (
    event,
    request: unknown,
  ): Promise<DesktopDataHomeSwitchResult> => {
    assertMainRenderer(event.sender)
    if (!isDesktopDataHomeSwitchRequest(request)) throw new TypeError('desktop: invalid data-home switch request')
    let target: { readonly kind: 'desktop' }
      | { readonly kind: 'official' }
      | { readonly kind: 'custom' | 'create'; readonly path: string }
    if (request.kind === 'custom' || request.kind === 'create') {
      const pending = pendingDataHomeSelections.get(request.selectionId)
      const expectedSelectionKind: DesktopDataHomeSelectionKind = request.kind === 'create' ? 'empty' : 'existing'
      if (pending === undefined
        || pending.rendererId !== event.sender.id
        || pending.selectionKind !== expectedSelectionKind
        || pending.expiresAt <= Date.now()) {
        pendingDataHomeSelections.delete(request.selectionId)
        throw new Error('desktop: selected data directory expired; choose it again')
      }
      target = { kind: request.kind, path: pending.path }
    } else {
      target = request
    }
    const decision = await resolveDesktopDataHomeSwitch(
      DESKTOP_DATA_HOME,
      dshHome,
      target,
    )
    if (request.kind === 'custom' || request.kind === 'create') {
      pendingDataHomeSelections.delete(request.selectionId)
    }
    if (!decision.changed) return { restarting: false, activePath: dshHome }
    await stopPersistentServicesForActiveProfile()
    await writeDesktopDataHomeSetup(DESKTOP_DATA_HOME.setupFile, decision.setup)
    setTimeout(requestDesktopRestart, 250)
    return { restarting: true, activePath: decision.path }
  })
  ipcMain.handle('dsh:desktop:preferences:get', (event) => {
    assertMainRenderer(event.sender)
    return preferences
  })
  const requireIcons = (sender: WebContents): DesktopIconManager => {
    assertMainRenderer(sender)
    if (iconManager === undefined) throw new Error('icon.unsupported')
    return iconManager
  }
  ipcMain.handle('dsh:desktop:icons:get', event => requireIcons(event.sender).status())
  ipcMain.handle('dsh:desktop:icons:choose', async (event) => {
    const manager = requireIcons(event.sender)
    const owner = event.sender.id
    const options = {
      properties: ['openFile'] as const,
      filters: [{
        name: process.platform === 'win32' ? 'PNG / JPEG / ICO' : 'PNG / JPEG',
        extensions: process.platform === 'win32' ? ['png', 'jpg', 'jpeg', 'ico'] : ['png', 'jpg', 'jpeg'],
      }],
    }
    const picked = mainWindow === undefined
      ? await dialog.showOpenDialog({ ...options, properties: ['openFile'] })
      : await dialog.showOpenDialog(mainWindow, { ...options, properties: ['openFile'] })
    if (event.sender.isDestroyed()) return null
    assertMainRenderer(event.sender)
    const path = picked.filePaths[0]
    return picked.canceled || path === undefined ? null : manager.select(owner, path)
  })
  ipcMain.handle('dsh:desktop:icons:discard', (event, id: unknown) => {
    requireIcons(event.sender).discard(event.sender.id, id)
  })
  ipcMain.handle('dsh:desktop:icons:apply', (event, id: unknown, target: unknown, crop: unknown) => {
    return requireIcons(event.sender).apply(event.sender.id, id, target, crop)
  })
  ipcMain.handle('dsh:desktop:icons:follow', (event, follow: unknown) => requireIcons(event.sender).followTray(follow))
  ipcMain.handle('dsh:desktop:icons:reset', (event, target: IconTarget) => requireIcons(event.sender).reset(target))
  ipcMain.handle('dsh:desktop:icons:repair', event => requireIcons(event.sender).refresh(true))
  ipcMain.handle('dsh:desktop:icons:create-shortcut', (event) => {
    const manager = requireIcons(event.sender)
    if (!app.isPackaged || process.platform !== 'win32') throw new Error('icon.unsupported')
    return manager.refresh(true, true)
  })
  ipcMain.handle('dsh:desktop:preferences:update', (event, patch: unknown) => {
    assertMainRenderer(event.sender)
    return updatePreferences(patch)
  })
  ipcMain.handle('dsh:desktop:download-network:get', (event): DownloadNetworkSettings => {
    assertMainRenderer(event.sender)
    if (downloadNetworkStore === undefined) throw new Error('desktop: download network settings are unavailable')
    return downloadNetworkStore.read()
  })
  ipcMain.handle('dsh:desktop:download-network:update', async (event, patch: unknown): Promise<DownloadNetworkSettings> => {
    assertMainRenderer(event.sender)
    if (downloadNetworkStore === undefined || downloadNetworkProxy === undefined) throw new Error('desktop: download network settings are unavailable')
    const previous = downloadNetworkStore.read()
    const next = downloadNetworkStore.update(patch)
    delete harnessEnvironment.npm_config_registry
    Object.assign(harnessEnvironment, pluginDownloadEnvironment(downloadNetworkStore, downloadNetworkProxy.pluginUrl))
    mainSurface?.send('dsh:desktop:download-network', next)
    if (previous.application.source !== next.application.source
      || JSON.stringify(previous.application.proxy) !== JSON.stringify(next.application.proxy)) {
      await configureReleaseServices()
      mainSurface?.send('dsh:desktop:release-status', releaseChecker?.status ?? { phase: 'unsupported' })
      mainSurface?.send('dsh:desktop:release-download-status', releaseDownloader?.status ?? { phase: 'unsupported' })
    }
    return next
  })
  ipcMain.handle('dsh:desktop:download-network:reset', async (event, target: unknown): Promise<DownloadNetworkSettings> => {
    assertMainRenderer(event.sender)
    if (!['application', 'npm', 'github'].includes(String(target))) throw new TypeError('desktop: invalid download network target')
    if (downloadNetworkStore === undefined || downloadNetworkProxy === undefined) throw new Error('desktop: download network settings are unavailable')
    const next = downloadNetworkStore.reset(target as DownloadNetworkTarget)
    delete harnessEnvironment.npm_config_registry
    Object.assign(harnessEnvironment, pluginDownloadEnvironment(downloadNetworkStore, downloadNetworkProxy.pluginUrl))
    mainSurface?.send('dsh:desktop:download-network', next)
    if (target === 'application') await configureReleaseServices()
    return next
  })
  ipcMain.handle('dsh:desktop:download-network:test:get', (event): DownloadNetworkTestStatus => {
    assertMainRenderer(event.sender); return downloadNetworkTestStatus
  })
  ipcMain.handle('dsh:desktop:download-network:test', (event, target: unknown) => {
    assertMainRenderer(event.sender)
    if (!['application', 'npm', 'github'].includes(String(target))) throw new TypeError('desktop: invalid download network test target')
    return testDownloadNetwork(target as DownloadNetworkTarget)
  })
  ipcMain.handle('dsh:desktop:web:get', (event) => {
    assertMainRenderer(event.sender)
    return desktopWebAccess?.status() ?? { phase: 'starting' }
  })
  ipcMain.handle('dsh:desktop:web:open', async (event) => {
    assertMainRenderer(event.sender)
    if (desktopWebAccess === undefined) throw new Error('desktop: local Web interface is unavailable')
    return desktopWebAccess.open()
  })
  ipcMain.handle('dsh:desktop:chat-background:read', (event) => {
    assertMainRenderer(event.sender)
    return chatBackgroundStore?.read()
  })
  ipcMain.handle('dsh:desktop:chat-background:write', (event, background: unknown) => {
    assertMainRenderer(event.sender)
    if (chatBackgroundStore === undefined) throw new Error('desktop: chat background store is unavailable')
    return chatBackgroundStore.write(background)
  })
  ipcMain.handle('dsh:desktop:log:open', (event) => {
    assertMainRenderer(event.sender)
    return openHarnessLog()
  })
  ipcMain.handle('dsh:desktop:settings:open', async (event): Promise<{ error: string }> => {
    assertMainRenderer(event.sender)
    return openSettingsDocument()
  })
  ipcMain.handle('dsh:desktop:settings:reset', async (event): Promise<{ backupName?: string; restarting: true }> => {
    assertMainRenderer(event.sender)
    const { backupName } = await backupAndResetDesktopSettings(dshHome)
    setTimeout(() => { requestDesktopRestart() }, 250)
    return { ...(backupName === undefined ? {} : { backupName }), restarting: true }
  })
  ipcMain.handle('dsh:desktop:cli:get', async (event): Promise<DesktopCliStatus> => {
    assertMainRenderer(event.sender)
    if (desktopCliManager === undefined) throw new Error('desktop: command-line manager is unavailable')
    return desktopCliManager.getStatus()
  })
  ipcMain.handle('dsh:desktop:cli:install', async (event, force: unknown): Promise<DesktopCliStatus> => {
    assertMainRenderer(event.sender)
    if (typeof force !== 'boolean') throw new TypeError('desktop: invalid command-line conflict confirmation')
    if (desktopCliManager === undefined) throw new Error('desktop: command-line manager is unavailable')
    return desktopCliManager.install(force)
  })
  ipcMain.handle('dsh:desktop:cli:remove', async (event): Promise<DesktopCliStatus> => {
    assertMainRenderer(event.sender)
    if (desktopCliManager === undefined) throw new Error('desktop: command-line manager is unavailable')
    return desktopCliManager.remove()
  })
  ipcMain.handle('dsh:desktop:startup-progress:get', (event): DesktopStartupProgress => {
    assertMainRenderer(event.sender)
    return startupProgress
  })
  ipcMain.on('dsh:desktop:theme-source', (event, source: unknown) => {
    assertMainRenderer(event.sender)
    if (!isDesktopThemeSource(source)) throw new TypeError('desktop: invalid theme source')
    applyDesktopThemeSource(source)
  })
  ipcMain.on('dsh:desktop:readiness', (event, phase: unknown) => {
    assertMainRenderer(event.sender)
    if (phase !== 'client' && phase !== 'event-dispatch') {
      throw new TypeError('desktop: invalid readiness phase')
    }
    if (harnessOrigin === undefined) return
    if (event.senderFrame === null) return
    let rendererOrigin: string
    try {
      rendererOrigin = new URL(event.senderFrame.url).origin
    } catch {
      return
    }
    if (rendererOrigin !== harnessOrigin || reportedDesktopReadiness.has(phase)) return
    reportedDesktopReadiness.add(phase)
    void appendDesktopStartupLog(phase === 'client' ? 'client ready' : 'event-dispatch is ready')
    if (supervisor?.isDiagnosticMode === true) {
      profileTransactionManager?.failed()
      void appendDesktopStartupLog('Diagnostic Profile readiness does not verify the active Profile or its plugin snapshots.')
      if (phase === 'client') void pluginSnapshotManager?.handleHarnessFailure(
        'The active Profile failed to start; only the installation-owned diagnostic Profile became ready.',
      ).catch((error: unknown) => {
        console.error('desktop: snapshot rollback after diagnostic fallback failed', error)
      })
      return
    }
    const readinessComplete = reportedDesktopReadiness.size === 2
    if (readinessComplete) profileTransactionManager?.ready()
    const manager = pluginSnapshotManager
    if (manager !== undefined) void (async () => {
      await manager.reportReadiness(phase)
      if (readinessComplete) {
        await appendDesktopStartupLog('Scheduling bootable plugin snapshot after 30 stable seconds.')
        scheduleBootableSnapshot(manager)
      }
    })().catch(async (error: unknown) => {
      await appendDesktopStartupLog(
        `Post-readiness plugin snapshot failed without interrupting Harness: ${error instanceof Error ? error.message : String(error)}`,
      )
      console.warn('desktop: could not retain the latest bootable plugin snapshot', error)
    })
  })
  ipcMain.handle('dsh:desktop:releases:get', (event): DesktopReleaseStatus => {
    assertMainRenderer(event.sender)
    return releaseChecker?.status ?? { phase: 'unsupported' }
  })
  ipcMain.handle('dsh:desktop:releases:check', (event) => {
    assertMainRenderer(event.sender)
    return releaseChecker?.check() ?? Promise.resolve({ phase: 'unsupported' } satisfies DesktopReleaseStatus)
  })
  ipcMain.handle('dsh:desktop:releases:open', async (event, releaseUrl: unknown) => {
    assertMainRenderer(event.sender)
    if (typeof releaseUrl !== 'string' || (!isAllowedReleaseUrl(releaseUrl) && !isAllowedCnbUrl(releaseUrl))) {
      throw new TypeError('desktop: invalid Release URL')
    }
    return { error: await shell.openExternal(releaseUrl).then(() => '') }
  })
  ipcMain.handle('dsh:desktop:releases:download:get', (event): DesktopReleaseDownloadStatus => {
    assertMainRenderer(event.sender)
    return releaseDownloader?.status ?? { phase: 'unsupported' }
  })
  ipcMain.handle('dsh:desktop:releases:download:start', async (event) => {
    assertMainRenderer(event.sender)
    if (releaseChecker === undefined || releaseDownloader === undefined) {
      return { phase: 'unsupported' } satisfies DesktopReleaseDownloadStatus
    }
    await releaseChecker.check()
    return releaseDownloader.start()
  })
  ipcMain.handle('dsh:desktop:releases:download:cancel', (event): DesktopReleaseDownloadStatus => {
    assertMainRenderer(event.sender)
    return releaseDownloader?.cancel() ?? { phase: 'unsupported' }
  })
  ipcMain.handle('dsh:desktop:releases:download:open', (event) => {
    assertMainRenderer(event.sender)
    return releaseDownloader?.open() ?? Promise.resolve({ error: 'Release downloads are unavailable.' })
  })
  ipcMain.handle('dsh:source-update:check', (event) => {
    assertMainRenderer(event.sender)
    return updater.check()
  })
  ipcMain.handle('dsh:source-update:upgrade', (event, expectedCommit: unknown) => {
    assertMainRenderer(event.sender)
    if (typeof expectedCommit !== 'string' || !/^[0-9a-f]{40}$/u.test(expectedCommit)) {
      throw new TypeError('desktop: invalid expected update commit')
    }
    return updater.upgrade(expectedCommit)
  })
  ipcMain.handle('dsh:source-update:restart', (event) => {
    assertMainRenderer(event.sender)
    setTimeout(() => {
      requestDesktopRestart()
    }, 250)
    return { restarting: true as const }
  })
  ipcMain.handle('dsh:desktop:restart', (event) => {
    assertMainRenderer(event.sender)
    setTimeout(() => {
      requestDesktopRestart()
    }, 250)
    return { restarting: true as const }
  })
  ipcMain.handle('dsh:desktop:recovery:enter', (event) => {
    assertMainRenderer(event.sender)
    if (app.isPackaged) throw new Error('desktop: recovery preview is available only in development mode')
    if (harnessOrigin === undefined) throw new Error('desktop: Harness must be ready before opening recovery mode')
    if (menuBusy()) throw new Error(menuCopy(menuLocale).busy)
    showLoading('failed', {
      message: shellMessages(app.getLocale()).recoveryPreview,
      logPath: harnessLogPath,
    })
    return { entered: true as const }
  })
  ipcMain.handle('dsh:desktop:recovery-plugins:list', (event) => {
    assertMainRenderer(event.sender)
    if (activeMenuHome === undefined) throw new Error('desktop: active Profile is unavailable')
    return readRecoveryPluginInventory(recoveryCandidateHome?.() ?? activeMenuHome)
  })
  ipcMain.handle('dsh:desktop:recovery-plugins:remove', async (event, packageName: unknown) => {
    assertMainRenderer(event.sender)
    if (!isRecoveryPluginPackageName(packageName)) throw new TypeError('desktop: invalid recovery plugin identity')
    if (activeMenuHome === undefined || recoveryPluginRemove === undefined) {
      throw new Error('desktop: recovery plugin removal is not ready')
    }
    const inventory = await readRecoveryPluginInventory(recoveryCandidateHome?.() ?? activeMenuHome)
    if (!inventory.plugins.some(plugin => plugin.packageName === packageName)) {
      throw new Error('desktop: recovery plugin is not a direct removable dependency')
    }
    await recoveryPluginRemove(packageName)
    return readRecoveryPluginInventory(recoveryCandidateHome?.() ?? activeMenuHome)
  })
  ipcMain.handle('dsh:desktop:recovery:export', async (event) => {
    assertMainRenderer(event.sender)
    if (activeMenuHome === undefined) throw new Error('desktop: active Profile is unavailable')
    const surface = mainSurface
    if (surface === undefined) throw new Error('desktop: main window is unavailable')
    const inventory = await readRecoveryPluginInventory(activeMenuHome)
    const day = new Date().toISOString().slice(0, 10)
    const result = await dialog.showSaveDialog(surface.window, {
      title: shellMessages(app.getLocale()).exportDiagnostics,
      defaultPath: join(app.getPath('documents'), `DeepSeek-Harness-diagnostic-${day}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (result.canceled) return { saved: false as const }
    const redact = (value: string): string => value
      .replaceAll(activeMenuHome ?? '', '<dsh-home>')
      .replace(/\b(api[ _-]?key|token|password|secret|authorization|cookie)(\s*[:=]\s*)([^\s,;]+)/giu, '$1$2<redacted>')
      .slice(0, 8_192)
    await writeFile(result.filePath, `${JSON.stringify({
      schema: 'dsh/desktop-recovery-diagnostic/v1',
      generatedAt: new Date().toISOString(),
      desktopVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      startup: {
        stage: startupProgress.stage,
        progress: startupProgress.progress,
        detail: startupProgress.detail,
        state: startupProgress.state,
        ...(latestRecoveryFailure === undefined ? {} : { failure: redact(latestRecoveryFailure) }),
      },
      plugins: inventory,
    }, undefined, 2)}\n`, { mode: 0o600 })
    return { saved: true as const, fileName: basename(result.filePath) }
  })
  ipcMain.handle('dsh:desktop:process-recovery:get', (event) => {
    assertMainRenderer(event.sender)
    return { resetAvailable: blockedProcessRecoveryPath !== undefined }
  })
  ipcMain.handle('dsh:desktop:process-recovery:reset', async (event) => {
    assertMainRenderer(event.sender)
    const path = blockedProcessRecoveryPath
    if (path === undefined) throw new Error('desktop: no blocked process recovery journal is available')
    await quarantineProcessRecoveryJournal(path)
    blockedProcessRecoveryPath = undefined
    setTimeout(() => { requestDesktopRestart() }, 150)
    return { restarting: true as const }
  })
  ipcMain.handle('dsh:desktop:recovery:exit', async (event) => {
    assertMainRenderer(event.sender)
    if (recoveryCandidateHome?.() !== undefined) await recoveryDiscardCandidate?.()
    else if (menuBusy()) throw new Error(menuCopy(menuLocale).busy)
    setTimeout(() => { void lifecycle?.requestQuit() }, 0)
    return { exiting: true as const }
  })
  ipcMain.handle('dsh:desktop:shutdown:retry', (event) => {
    assertMainRenderer(event.sender)
    setTimeout(() => { void lifecycle?.requestQuit() }, 0)
    return { started: true as const }
  })
  ipcMain.handle('dsh:harness:retry', async (event) => {
    assertMainRenderer(event.sender)
    await recoveryActivateCandidate?.()
    if (recoveryRestartRequired) {
      setTimeout(() => { requestDesktopRestart() }, 150)
      return { started: true }
    }
    if (recoveryHarnessSuspended) {
      recoveryHarnessSuspended = false
      return { started: supervisor?.resume() ?? false }
    }
    if (supervisor?.isDiagnosticMode === true) {
      await supervisor.stop()
      harnessOrigin = undefined
      return { started: supervisor.resume() }
    }
    const started = supervisor?.retry() ?? false
    if (!started && harnessOrigin !== undefined && mainSurface !== undefined && !mainSurface.window.isDestroyed()) {
      void mainSurface.loadURL(withDesktopWindowMetadata(harnessOrigin, process.platform))
    }
    return { started }
  })
  ipcMain.handle('dsh:harness:open-logs', (event) => {
    assertMainRenderer(event.sender)
    return openHarnessLog()
  })
  ipcMain.handle('dsh:desktop:bundled-plugins:start', (event, request: unknown): BundledPluginStartResult => {
    assertMainRenderer(event.sender)
    if (request === null || typeof request !== 'object') throw new TypeError('desktop: invalid bundled plugin request')
    const { profile, packageSpec } = request as { profile?: unknown; packageSpec?: unknown }
    if (typeof profile !== 'string' || typeof packageSpec !== 'string') {
      throw new TypeError('desktop: invalid bundled plugin request')
    }
    return bundledPluginInstaller?.startManual(profile, packageSpec) ?? { handled: false }
  })
  ipcMain.handle('dsh:desktop:external-tools:resolve', async (event, toolId: unknown) => {
    assertMainRenderer(event.sender)
    if (typeof toolId !== 'string' || !EXTERNAL_TOOL_IDS.includes(toolId as DesktopExternalToolId)) {
      throw new TypeError('desktop: invalid external tool id')
    }
    if (externalToolCompatibility === undefined) {
      throw new Error('desktop: external-tool compatibility resolver is unavailable')
    }
    return externalToolCompatibility.resolve(toolId as DesktopExternalToolId)
  })
  ipcMain.handle('dsh:desktop:bundled-plugins:start-deferred', async (
    event,
    request: unknown,
  ): Promise<BundledPluginDeferredStartResult> => {
    assertMainRenderer(event.sender)
    if (request === null || typeof request !== 'object') throw new TypeError('desktop: invalid bundled plugin request')
    const { profile, packageSpec } = request as { profile?: unknown; packageSpec?: unknown }
    if (typeof profile !== 'string' || typeof packageSpec !== 'string') {
      throw new TypeError('desktop: invalid bundled plugin request')
    }
    return bundledPluginInstaller?.startDeferred(profile, packageSpec) ?? { handled: false }
  })
  ipcMain.handle('dsh:desktop:bundled-plugins:get', (event, installId: unknown): BundledPluginInstallSnapshot => {
    assertMainRenderer(event.sender)
    if (typeof installId !== 'string') throw new TypeError('desktop: invalid bundled plugin install id')
    if (bundledPluginInstaller === undefined) throw new Error('desktop: bundled plugin installer is unavailable')
    return bundledPluginInstaller.getInstall(installId)
  })
  ipcMain.handle('dsh:desktop:imported-plugins:get', (event): ImportedPluginRestoreSnapshot | undefined => {
    assertMainRenderer(event.sender)
    return importedPluginRestoreManager?.snapshot()
  })
  ipcMain.handle('dsh:desktop:imported-plugins:check-sources', (event): ImportedPluginRestoreSnapshot | undefined => {
    assertMainRenderer(event.sender)
    return importedPluginRestoreManager?.startSourceCheck()
  })
  ipcMain.handle('dsh:desktop:imported-plugins:start', async (
    event,
    restoreIds: unknown,
  ): Promise<ImportedPluginRestoreSnapshot> => {
    assertMainRenderer(event.sender)
    if (!Array.isArray(restoreIds) || restoreIds.some(value => typeof value !== 'string')) {
      throw new TypeError('desktop: invalid imported plugin restore ids')
    }
    if (importedPluginRestoreManager === undefined) {
      throw new Error('desktop: imported plugin restore manager is unavailable')
    }
    cancelBootableSnapshot()
    try {
      return await importedPluginRestoreManager.start(restoreIds)
    } finally {
      restartBootableSnapshotStabilityWindow('imported plugin restore settled')
    }
  })
  ipcMain.handle('dsh:desktop:imported-plugins:dismiss', async (
    event,
  ): Promise<ImportedPluginRestoreSnapshot | undefined> => {
    assertMainRenderer(event.sender)
    return importedPluginRestoreManager?.dismissPrompt()
  })
  ipcMain.handle('dsh:desktop:imported-plugins:ignore', async (
    event,
  ): Promise<ImportedPluginRestoreSnapshot | undefined> => {
    assertMainRenderer(event.sender)
    return importedPluginRestoreManager?.ignorePending()
  })
  const installSelectedImportedPlugin = async (
    restoreId: unknown,
    kind: 'directory' | 'archive',
  ): Promise<ImportedPluginRestoreSnapshot | undefined> => {
    if (typeof restoreId !== 'string' || importedPluginRestoreManager === undefined) {
      throw new TypeError('desktop: invalid imported plugin local restore request')
    }
    const entry = importedPluginRestoreManager.localEntry(restoreId)
    const chinese = app.getLocale().toLowerCase().startsWith('zh')
    const chooser = mainWindow
    const result = await (chooser === undefined
      ? dialog.showOpenDialog({
        title: shellMessages(app.getLocale()).choosePluginSource,
        properties: kind === 'directory' ? ['openDirectory'] : ['openFile'],
        ...(kind === 'archive' ? { filters: [{ name: 'npm package', extensions: ['tgz'] }] } : {}),
      })
      : dialog.showOpenDialog(chooser, {
        title: shellMessages(app.getLocale()).choosePluginSource,
        properties: kind === 'directory' ? ['openDirectory'] : ['openFile'],
        ...(kind === 'archive' ? { filters: [{ name: 'npm package', extensions: ['tgz'] }] } : {}),
      }))
    const selectedPath = result.filePaths[0]
    if (result.canceled || selectedPath === undefined) return importedPluginRestoreManager.snapshot()
    let staged: StagedImportedPlugin | undefined
    try {
      staged = kind === 'archive'
        ? await stageImportedPluginArchive(selectedPath, entry.packageName)
        : await stageImportedPluginDirectory(selectedPath, entry.packageName, async (source, destination) => {
          await runPackageManagerInvocation([
            'pack', '--ignore-scripts', '--pack-destination', destination,
          ], source, harnessEnvironment, launchOptions, 60_000)
        })
      if (importedPluginVersionDiffers(entry.declaredSpec, staged.manifest.version)) {
        const confirmation = await showDesktopMessageBox({
          type: 'warning',
          title: shellMessages(app.getLocale()).pluginVersionDiffers,
          message: shellMessages(app.getLocale()).confirmPlugin(entry.packageName),
          detail: chinese
            ? `原声明：${entry.declaredSpec}\n本地版本：${staged.manifest.version ?? '未知'}\n本地包将安装到桌面版独立环境。`
            : `Imported declaration: ${entry.declaredSpec}\nLocal version: ${staged.manifest.version ?? 'unknown'}\nThe local package will install into the independent Desktop environment.`,
          buttons: chinese ? ['取消', '继续安装'] : ['Cancel', 'Install anyway'],
          defaultId: 0,
          cancelId: 0,
        })
        if (confirmation.response !== 1) return importedPluginRestoreManager.snapshot()
      }
      cancelBootableSnapshot()
      try {
        return await importedPluginRestoreManager.installLocal(restoreId, staged.archivePath)
      } finally {
        restartBootableSnapshotStabilityWindow('local plugin restore settled')
      }
    } finally {
      await staged?.cleanup()
    }
  }
  ipcMain.handle('dsh:desktop:imported-plugins:choose-directory', async (event, restoreId: unknown) => {
    assertMainRenderer(event.sender)
    return installSelectedImportedPlugin(restoreId, 'directory')
  })
  ipcMain.handle('dsh:desktop:imported-plugins:choose-archive', async (event, restoreId: unknown) => {
    assertMainRenderer(event.sender)
    return installSelectedImportedPlugin(restoreId, 'archive')
  })
  ipcMain.handle('dsh:desktop:diagnostic-lab:catalog', (event) => {
    assertMainRenderer(event.sender)
    if (diagnosticLabManager === undefined) throw new Error('desktop: diagnostic lab is unavailable')
    return diagnosticLabManager.catalog()
  })
  ipcMain.handle('dsh:desktop:startup-diagnostics:list', async (event) => {
    assertMainRenderer(event.sender)
    if (activeMenuHome === undefined) return []
    return readStartupDiagnostics(activeMenuHome)
  })
  ipcMain.handle('dsh:desktop:startup-diagnostics:retry', async (event, incidentId: unknown) => {
    assertMainRenderer(event.sender)
    if (activeMenuHome === undefined || typeof incidentId !== 'string' || incidentId.length > 80) {
      throw new TypeError('desktop: invalid startup diagnostic retry request')
    }
    const incident = (await readStartupDiagnostics(activeMenuHome))
      .find(candidate => candidate.incidentId === incidentId)
    if (incident === undefined) throw new Error('desktop: startup diagnostic incident was not found')
    if (incident.code === 'runtime.profile-check-timeout'
      || incident.code === 'runtime.profile-repair-timeout'
      || incident.code === 'runtime.profile-repair-failed') {
      requestDesktopRestart()
      return { status: 'restarting' as const }
    }
    if ((incident.code === 'runtime.bundled-plugin-timeout'
      || incident.code === 'runtime.bundled-plugin-failed')
      && incident.packageName !== undefined
      && bundledPluginInstaller !== undefined) {
      await bundledPluginCooldown?.clear(incident.packageName)
      const started = bundledPluginInstaller.startManual('web', incident.packageName)
      if (started.handled) {
        return { status: 'plugin-started' as const, installId: started.snapshot.installId }
      }
    }
    return { status: 'unsupported' as const }
  })
  ipcMain.handle('dsh:desktop:diagnostic-lab:current', (event) => {
    assertMainRenderer(event.sender)
    if (diagnosticLabManager === undefined) throw new Error('desktop: diagnostic lab is unavailable')
    return diagnosticLabManager.current()
  })
  ipcMain.handle('dsh:desktop:diagnostic-lab:start', (event, request: unknown) => {
    assertMainRenderer(event.sender)
    if (diagnosticLabManager === undefined) throw new Error('desktop: diagnostic lab is unavailable')
    if (request === null || typeof request !== 'object') throw new TypeError('desktop: invalid diagnostic lab request')
    return diagnosticLabManager.start(request as DiagnosticLabStartRequest)
  })
  ipcMain.handle('dsh:desktop:diagnostic-lab:get', (event, runId: unknown) => {
    assertMainRenderer(event.sender)
    if (diagnosticLabManager === undefined || typeof runId !== 'string') {
      throw new TypeError('desktop: invalid diagnostic lab run id')
    }
    return diagnosticLabManager.get(runId)
  })
  ipcMain.handle('dsh:desktop:diagnostic-lab:cancel', (event, runId: unknown) => {
    assertMainRenderer(event.sender)
    if (diagnosticLabManager === undefined || typeof runId !== 'string') {
      throw new TypeError('desktop: invalid diagnostic lab run id')
    }
    return diagnosticLabManager.cancel(runId)
  })
  ipcMain.handle('dsh:desktop:diagnostic-lab:restore-all', async (event, runId: unknown) => {
    assertMainRenderer(event.sender)
    if (diagnosticLabManager === undefined || typeof runId !== 'string') {
      throw new TypeError('desktop: invalid diagnostic lab run id')
    }
    return diagnosticLabManager.restoreAll(runId)
  })
  ipcMain.handle('dsh:desktop:diagnostic-lab:export', (event, runId: unknown) => {
    assertMainRenderer(event.sender)
    if (diagnosticLabManager === undefined || typeof runId !== 'string') {
      throw new TypeError('desktop: invalid diagnostic lab run id')
    }
    return diagnosticLabManager.exportReport(runId)
  })
  ipcMain.handle('dsh:desktop:plugin-snapshots:list', (event): Promise<readonly PluginSnapshotSummary[]> => {
    assertMainRenderer(event.sender)
    if (pluginSnapshotManager === undefined) throw new Error('desktop: plugin snapshots are unavailable')
    return pluginSnapshotManager.list()
  })
  ipcMain.handle('dsh:desktop:plugin-snapshots:create', (event, label: unknown) => {
    assertMainRenderer(event.sender)
    if (label !== undefined && typeof label !== 'string') throw new TypeError('desktop: invalid plugin snapshot label')
    if (pluginSnapshotManager === undefined) throw new Error('desktop: plugin snapshots are unavailable')
    return pluginSnapshotManager.create(label)
  })
  ipcMain.handle('dsh:desktop:plugin-snapshots:remove', (event, snapshotId: unknown) => {
    assertMainRenderer(event.sender)
    if (typeof snapshotId !== 'string') throw new TypeError('desktop: invalid plugin snapshot id')
    if (pluginSnapshotManager === undefined) throw new Error('desktop: plugin snapshots are unavailable')
    return pluginSnapshotManager.remove(snapshotId)
  })
  ipcMain.handle('dsh:desktop:plugin-snapshots:restore', (
    event,
    snapshotId: unknown,
    networkAllowed: unknown,
  ): PluginSnapshotRestoreSnapshot => {
    assertMainRenderer(event.sender)
    if (typeof snapshotId !== 'string' || typeof networkAllowed !== 'boolean') {
      throw new TypeError('desktop: invalid plugin snapshot restore request')
    }
    if (pluginSnapshotManager === undefined) throw new Error('desktop: plugin snapshots are unavailable')
    return pluginSnapshotManager.startRestore(snapshotId, networkAllowed)
  })
  ipcMain.handle('dsh:desktop:plugin-snapshots:restore:get', (event, operationId: unknown) => {
    assertMainRenderer(event.sender)
    if (typeof operationId !== 'string') throw new TypeError('desktop: invalid plugin snapshot restore operation')
    if (pluginSnapshotManager === undefined) throw new Error('desktop: plugin snapshots are unavailable')
    return pluginSnapshotManager.current(operationId)
  })
  ipcMain.on('dsh:window:minimize', (event) => {
    const surface = mainSurface
    if (surface !== undefined && isDesktopRenderer(event.sender, surface.titlebarRenderer)) surface.window.minimize()
  })
  ipcMain.on('dsh:window:toggle-maximize', (event) => {
    const surface = mainSurface
    if (surface === undefined || !isDesktopRenderer(event.sender, surface.titlebarRenderer)) return
    const window = surface.window
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })
  ipcMain.on('dsh:window:close', (event) => {
    const surface = mainSurface
    if (surface !== undefined && isDesktopRenderer(event.sender, surface.titlebarRenderer)) surface.window.close()
  })
  ipcMain.on('dsh:menu:client-state', (event, state: unknown) => {
    if (event.sender !== mainSurface?.renderer || typeof state !== 'object' || state === null) return
    const { ready, locale } = state as { ready?: unknown; locale?: unknown }
    if (typeof ready !== 'boolean' || typeof locale !== 'string' || locale.length > 64) return
    menuClientReady = ready
    menuLocale = resolveDesktopLocale(locale)
    if (persistedProfileLocale !== menuLocale) {
      try {
        desktopLocaleStore?.write(menuLocale)
        persistedProfileLocale = menuLocale
      } catch (error) {
        console.warn('desktop: could not persist active locale', error)
      }
    }
    applicationMenu?.refresh()
    refreshTrayMenu()
  })
  ipcMain.on('dsh:menu:result', (event, result: unknown) => {
    if (event.sender !== mainSurface?.renderer || typeof result !== 'object' || result === null) return
    const { id, error } = result as { id?: unknown; error?: unknown }
    if (typeof id !== 'string' || (error !== undefined && typeof error !== 'string')) return
    const pending = pendingMenuCommands.get(id)
    if (pending === undefined) return
    pendingMenuCommands.delete(id)
    clearTimeout(pending.timer)
    if (typeof error === 'string') pending.reject(new Error(error.slice(0, 1000)))
    else pending.resolve()
  })
  lifecycle = createDesktopLifecycle({
    getWindow: () => mainWindow,
    createWindow,
    readCloseBehavior: () => preferences.closeBehavior,
    canQuit: () => {
      if (!menuBusy()) return true
      reportMenuError(new Error(menuCopy(menuLocale).busy))
      return false
    },
    canHideToTray: () => !trayUnavailable,
    onTrayUnavailable: () => {
      if (trayWarningOpen) return
      trayWarningOpen = true
      const copy = menuCopy(menuLocale)
      void dialog.showMessageBox({ type: 'warning', message: copy.tray,
        buttons: [copy.cancel, copy.quit], defaultId: 0, cancelId: 0,
      }).then((result) => { if (result.response === 1) void lifecycle?.requestQuit() })
        .finally(() => { trayWarningOpen = false })
    },
    disposeHost: async () => {
      cancelBootableSnapshot()
      publishStartupProgress({ stage: 'waiting-background-tasks', progress: 12 })
      showLoading('restarting')
      const outcomes: PromiseSettledResult<unknown>[] = []
      outcomes.push(...await Promise.allSettled([
        releaseDownloader?.dispose(), downloadNetworkProxy?.close(), oneShotOperations.dispose(), profileTransactionManager?.dispose(),
      ]))
      const taskFailures = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')
      if (taskFailures.length > 0) {
        throw new AggregateError(taskFailures.map(outcome => outcome.reason as unknown), 'desktop: managed task cleanup failed')
      }
      // Do not stop Harness until every authorized persistent identity has
      // been removed from both normal and crash-recovery cleanup scopes.
      await preservePersistentServicesForActiveProfile()
      publishStartupProgress({ stage: 'stopping-harness', progress: 38 })
      outcomes.push(...await Promise.allSettled([supervisor?.stop(), desktopReturnControl?.close()]))
      publishStartupProgress({ stage: 'reclaiming-processes', progress: 72 })
      outcomes.push(...await Promise.allSettled([processObserver?.stopAll()]))
      publishStartupProgress({ stage: 'checking-shutdown', progress: 94 })
      if (activeMenuHome !== undefined && inspectProfileMutationLock(activeMenuHome).active) {
        outcomes.push({ status: 'rejected', reason: new Error('desktop: Profile mutation lock remains active after process cleanup') })
      }
      if (processObservationFailure !== undefined) outcomes.push({
        status: 'rejected', reason: new Error('desktop: process identity registration failed', { cause: processObservationFailure }),
      })
      const failures = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')
      if (failures.length > 0) throw new AggregateError(failures.map(outcome => outcome.reason as unknown), 'desktop: process cleanup failed')
      publishStartupProgress({ stage: 'checking-shutdown', progress: 100 })
    },
    releaseQuit: () => {
      quitReleased = true
      disposeApplicationMenu?.()
      tray?.destroy()
      tray = undefined
      app.quit()
    },
    reportError: (error) => {
      console.error('desktop: shutdown failed', error)
      showLoading('failed', {
        message: menuCopy(menuLocale).shutdownFailed,
        logPath: harnessLogPath,
      }, 'shutdown')
    },
  })
  desktopReturnControl = DESKTOP_WEB_SUPPORTED ? new DesktopReturnControl({
    showWindow: () => { lifecycle?.showWindow() },
  }) : undefined
  try {
    await desktopReturnControl?.start()
  } catch (error) {
    desktopReturnControl = undefined
    console.error('desktop: browser return control is unavailable', error)
  }
  desktopWebAccess = DESKTOP_WEB_SUPPORTED ? new DesktopWebAccess({
    openExternal: url => shell.openExternal(url),
    decorateUrl: (url) => {
      const returnUrl = desktopReturnControl?.returnUrl()
      if (returnUrl === undefined) return url
      const external = new URL(url)
      external.hash = `dsh-desktop-return=${encodeURIComponent(returnUrl)}`
      return external.href
    },
    canHideWindow: () => !trayUnavailable,
    hideWindow: () => { mainWindow?.hide() },
    showWindow: () => { lifecycle?.showWindow() },
    publish: publishDesktopWebStatus,
  }) : undefined
  try { createTray() } catch (error) {
    hiddenLaunch = false
    trayUnavailable = true
    console.error('desktop: system tray unavailable; closing will keep the window accessible', error)
  }
  createWindow()

  publishStartupProgress(app.isPackaged
    ? { stage: 'preparing-runtime', progress: 10 }
    : { stage: 'preparing-desktop', progress: 24 })
  const packagedRuntimeRoot = app.isPackaged
    ? packagedRuntimeArchiveRoot(process.platform, process.arch)
    : undefined
  const packagedRuntime = packagedRuntimeRoot !== undefined
    ? await ensurePackagedRuntime({
      archivePath: join(process.resourcesPath, 'harness-runtime.tar.gz'),
      destination: join(app.getPath('userData'), 'runtime', app.getVersion()),
      archiveRoot: packagedRuntimeRoot,
    })
    : undefined
  const packageRuntimeBin = packagedRuntime === undefined
    ? undefined
    : join(packagedRuntime, 'package-runtime', 'bin')
  let desktopCliRuntime: DesktopCliRuntime | undefined
  if (app.isPackaged) {
    if (process.platform === 'win32') {
      const windowsRuntime = join(process.resourcesPath, 'runtime', 'win32-x64')
      const harnessBin = join(process.resourcesPath, 'harness', 'lib', 'bin.js')
      const nodeCommand = join(windowsRuntime, 'node.exe')
      const packageManagerBin = join(windowsRuntime, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
      launchOptions = {
        harnessBin,
        nodeCommand,
        packageManagerBin,
        runtimeBinPath: windowsRuntime,
      }
      desktopCliRuntime = {
        harnessBin,
        nodeBin: nodeCommand,
        pnpmBin: packageManagerBin,
        launcherSource: join(process.resourcesPath, 'cli', 'desktop-cli.mjs'),
      }
    } else if (packagedRuntime !== undefined && packageRuntimeBin !== undefined) {
      const harnessBin = join(packagedRuntime, 'lib', 'bin.js')
      const nodeCommand = join(packageRuntimeBin, 'node')
      const packageManagerBin = join(packageRuntimeBin, 'pnpm')
      launchOptions = {
        harnessBin,
        nodeCommand,
        packageManagerBin,
        runtimeBinPath: packageRuntimeBin,
      }
      desktopCliRuntime = {
        harnessBin,
        nodeBin: nodeCommand,
        pnpmBin: packageManagerBin,
        launcherSource: join(process.resourcesPath, 'cli', 'desktop-cli.mjs'),
      }
    } else {
      throw new Error(`desktop: packaged runtime is unavailable for ${process.platform}-${process.arch}`)
    }

  }
  const desktopShellPath = process.env.SHELL ?? (process.platform === 'darwin' ? userInfo().shell ?? '' : '')
  desktopCliManager = new DesktopCliManager({
    platform: process.platform,
    packaged: app.isPackaged,
    desktopRoot: DESKTOP_DATA_HOME.desktopRoot,
    setupFile: DESKTOP_DATA_HOME.setupFile,
    homeDirectory: homedir(),
    resourcesPath: process.resourcesPath,
    environment: process.env,
    ...(desktopShellPath === '' ? {} : { shellPath: desktopShellPath }),
    ...(desktopCliRuntime === undefined ? {} : { runtime: desktopCliRuntime }),
  })
  try {
    await desktopCliManager.refresh()
  } catch (error) {
    console.warn('desktop: could not refresh the registered dsh command', error)
  }
  recoveryPluginRemove = async (packageName) => {
    if (!recoveryHarnessSuspended && supervisor !== undefined) {
      cancelBootableSnapshot()
      await supervisor.stop()
      recoveryHarnessSuspended = true
      harnessOrigin = undefined
      desktopReturnControl?.clear()
      desktopWebAccess?.clear()
    } else if (supervisor === undefined) {
      recoveryRestartRequired = true
    }
    await stopAndRevokePersistentServicesForPlugin(packageName)
    await appendDesktopStartupLog(`Recovery mode is removing external plugin ${packageName}.`)
    const remove = () => runDesktopInvocation(resolveHarnessInvocation(harnessEnvironment, [
      'plugin', '--profile', 'web', 'remove', packageName,
    ], launchOptions), `recovery-plugin-remove:${packageName}`, BUNDLED_PLUGIN_INSTALL_TIMEOUT_MS)
    if (supervisor === undefined) await remove()
    else {
      if (recoveryMutationBusy || managedCandidateActive || (desktopCandidateId !== undefined && !recoveryOwnsCandidate)) {
        throw new Error('desktop: another plugin mutation is active')
      }
      recoveryMutationBusy = true
      recoveryOwnsCandidate = true
      try { await withProfileMutationSafety('recovery-plugin-remove', remove) } finally { recoveryMutationBusy = false }
    }
    await appendDesktopStartupLog(`Recovery mode removed external plugin ${packageName}.`)
  }
  const runSnapshotCommand = async <T>(
    args: readonly string[],
    timeoutMs?: number,
    allowDuringDisposal = false,
  ): Promise<T> => {
    const output = await runDesktopInvocation(resolveHarnessInvocation(harnessEnvironment, [
      'plugin', '--profile', 'web', 'snapshot', ...args,
    ], launchOptions), `plugin-snapshot:${args[0] ?? 'unknown'}`,
    timeoutMs ?? SNAPSHOT_COMMAND_TIMEOUT_MS, [0], allowDuringDisposal)
    return parsePluginSnapshotJson(output) as T
  }
  const startupSafety = { rollbackFailed: false }
  let desktopCandidateId: string | undefined
  const mutationHome = (): string => harnessEnvironment.DSH_HOME ?? dshHome
  const candidateEnvironment = (id: string): NodeJS.ProcessEnv => ({
    ...harnessEnvironment, DSH_HOME: dshHome,
    DSH_PLUGIN_TRANSACTION_ORIGIN: undefined,
    DSH_PLUGIN_SNAPSHOT_LEASE_TOKEN: id,
  })
  const beginDesktopCandidate = async (): Promise<void> => {
    if (desktopCandidateId !== undefined) return
    cancelBootableSnapshot()
    const output = await runDesktopInvocation(resolveHarnessInvocation({
      ...harnessEnvironment, DSH_HOME: dshHome, DSH_DESKTOP_MUTATION_OWNER_PID: String(process.pid),
      ...(supervisor === undefined ? { DSH_PLUGIN_SNAPSHOT_BATCH: '1' } : {}),
    }, ['plugin', '--profile', 'web', 'transaction', 'prepare'], launchOptions), 'plugin-candidate-prepare', 60_000)
    const parsed = parsePluginSnapshotJson(output) as { id?: unknown }
    if (typeof parsed.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(parsed.id)) {
      throw new Error('desktop: invalid prepared transaction ID')
    }
    desktopCandidateId = parsed.id
    harnessEnvironment.DSH_HOME = join(dshHome, 'plugin-transactions', 'web', parsed.id, 'candidate')
    harnessEnvironment.DSH_PLUGIN_TRANSACTION_ORIGIN = dshHome
    harnessEnvironment.DSH_PLUGIN_SNAPSHOT_LEASE_TOKEN = parsed.id
    harnessEnvironment.DSH_PLUGIN_SNAPSHOT_LEASE_OWNER_PID = String(process.pid)
  }
  const clearCandidateEnvironment = (): void => {
    desktopCandidateId = undefined
    harnessEnvironment.DSH_HOME = dshHome
    delete harnessEnvironment.DSH_PLUGIN_TRANSACTION_ORIGIN
    delete harnessEnvironment.DSH_PLUGIN_SNAPSHOT_LEASE_TOKEN
    delete harnessEnvironment.DSH_PLUGIN_SNAPSHOT_LEASE_OWNER_PID
  }
  const discardDesktopCandidate = async (): Promise<void> => {
    const id = desktopCandidateId
    if (id === undefined) return
    const environment = candidateEnvironment(id)
    clearCandidateEnvironment()
    await runDesktopInvocation(resolveHarnessInvocation(environment,
      ['plugin', '--profile', 'web', 'transaction', 'rollback', id], launchOptions), 'plugin-candidate-discard', 60_000, [0], true)
    await runDesktopInvocation(resolveHarnessInvocation(environment,
      ['plugin', '--profile', 'web', 'snapshot', 'end-restore-lease'], launchOptions), 'plugin-candidate-release', 15_000, [0], true)
  }
  const activateDesktopCandidate = async (resume: boolean): Promise<void> => {
    const id = desktopCandidateId
    if (id === undefined) return
    await runDesktopInvocation(resolveHarnessInvocation(harnessEnvironment,
      ['plugin', '--profile', 'web', 'doctor'], launchOptions), 'plugin-candidate-check', PROFILE_CHECK_TIMEOUT_MS)
    await runDesktopInvocation(resolveHarnessInvocation(candidateEnvironment(id),
      ['plugin', '--profile', 'web', 'transaction', 'ready', id], launchOptions), 'plugin-candidate-ready', 15_000)
    clearCandidateEnvironment()
    if (profileTransactionManager === undefined) throw new Error('desktop: plugin activation manager unavailable')
    try { await profileTransactionManager.activatePrepared(id, resume) } catch (error) {
      desktopCandidateId = id
      throw error
    }
    if (resume && !await profileTransactionManager.waitForSettlement(id)) {
      throw new Error('desktop: plugin startup failed; the previous Profile was restored')
    }
  }
  profileTransactionManager = new ProfileTransactionManager({
    home: dshHome,
    command: async (args, token) => {
      const environment: NodeJS.ProcessEnv = { ...harnessEnvironment, DSH_HOME: dshHome, DSH_PLUGIN_TRANSACTION_ORIGIN: undefined }
      if (token !== undefined) environment.DSH_PLUGIN_SNAPSHOT_LEASE_TOKEN = token
      await runDesktopInvocation(resolveHarnessInvocation(environment, [
        'plugin', '--profile', 'web', ...args,
      ], launchOptions), 'profile-transaction', 60_000)
    },
    stopHarness: async () => { await supervisor?.stop() },
    resumeHarness: () => { supervisor?.resume() },
    onActivation: () => {
      cancelBootableSnapshot()
      publishStartupProgress({ stage: 'starting-harness', progress: 88 })
    },
    onRollback: () => {
      void appendDesktopStartupLog('Plugin activation failed; the previous Profile was restored and is restarting.')
    },
    onError: (error) => {
      startupSafety.rollbackFailed = true
      cancelBootableSnapshot()
      console.error('desktop: plugin transaction requires recovery', error)
      void appendDesktopStartupLog('Plugin transaction could not be settled; its recovery journal was retained.')
      if (supervisor !== undefined) void supervisor.stop().then(() => {
        showLoading('failed', {
          message: shellMessages(app.getLocale()).transactionRecoveryFailed,
          logPath: harnessLogPath,
        })
      })
    },
  })
  try { await profileTransactionManager.recoverBeforeStartup() } catch (error) {
    startupSafety.rollbackFailed = true
    await appendDesktopStartupLog('Interrupted plugin transaction recovery failed; using diagnostic mode.')
    console.error('desktop: interrupted plugin transaction recovery failed', error)
  }
  const withProfileMutationSafety = async <T>(
    operationKind: string,
    operation: () => Promise<T>,
  ): Promise<T> => {
    await beginDesktopCandidate()
    let safetySnapshotId: string | undefined
    try {
      const safety = await runSnapshotCommand<{ snapshotId: string }>(['create-safety'], SNAPSHOT_COMMAND_TIMEOUT_MS)
      safetySnapshotId = safety.snapshotId
      try {
        const result = await operation()
        return result
      } catch (operationError) {
        try {
          await runSnapshotCommand(['restore-files', safety.snapshotId], SNAPSHOT_COMMAND_TIMEOUT_MS, true)
          await runDesktopInvocation(resolveHarnessInvocation(harnessEnvironment, [
            'plugin', '--profile', 'web', 'install', '--offline', '--frozen-lockfile',
          ], launchOptions), `${operationKind}:rollback`, BUNDLED_PLUGIN_INSTALL_TIMEOUT_MS, [0], true)
          await appendDesktopStartupLog(`Rolled back candidate mutation ${operationKind}.`)
        } catch (rollbackError) {
          startupSafety.rollbackFailed = true
          safetySnapshotId = undefined
          const detail = rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
          await retainStartupWarning(
            'runtime.startup-rollback-failed',
            `${operationKind}:rollback`,
            ['diagnostics', 'open-log', 'snapshot-restore'],
          )
          throw new Error(`desktop: could not roll back startup mutation ${operationKind}: ${detail}`, {
            cause: operationError,
          })
        }
        throw operationError
      }
    } finally {
      try {
        if (safetySnapshotId !== undefined) {
          await runSnapshotCommand(['settle-safety', safetySnapshotId], SNAPSHOT_COMMAND_TIMEOUT_MS, true)
        }
      } finally {
        if (startupSafety.rollbackFailed) await discardDesktopCandidate()
      }
    }
  }
  let managedCandidateActive = false
  let recoveryOwnsCandidate = false
  let recoveryMutationBusy = false
  recoveryCandidateHome = () => recoveryOwnsCandidate && desktopCandidateId !== undefined ? mutationHome() : undefined
  recoveryActivateCandidate = async () => {
    if (!recoveryOwnsCandidate) return
    if (recoveryMutationBusy) throw new Error('desktop: recovery plugin removal is still running')
    try { await activateDesktopCandidate(false) } finally { recoveryOwnsCandidate = desktopCandidateId !== undefined }
  }
  recoveryDiscardCandidate = async () => {
    if (!recoveryOwnsCandidate) return
    if (recoveryMutationBusy) throw new Error('desktop: recovery plugin removal is still running')
    try { await discardDesktopCandidate() } finally { recoveryOwnsCandidate = desktopCandidateId !== undefined }
  }
  const runManagedPluginMutation = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (managedCandidateActive || desktopCandidateId !== undefined) throw new Error('desktop: another plugin mutation is active')
    managedCandidateActive = true
    try {
      await beginDesktopCandidate()
      const result = await operation()
      await activateDesktopCandidate(true)
      return result
    } catch (error) {
      try { await discardDesktopCandidate() } catch (rollbackError) {
        startupSafety.rollbackFailed = true
        console.error('desktop: managed plugin recovery journal retained', rollbackError)
        await supervisor?.stop()
      }
      throw error
    } finally {
      managedCandidateActive = false
      restartBootableSnapshotStabilityWindow('managed plugin mutation settled')
    }
  }
  const profileCheckStartedAt = Date.now()
  publishStartupProgress({
    stage: 'checking-profile', progress: 28,
    detail: 'profile-read-only-check',
    startedAt: profileCheckStartedAt,
    deadlineAt: profileCheckStartedAt + PROFILE_CHECK_TIMEOUT_MS,
  })
  let initialProfileRepairDiagnostic = ''
  const observerLaunch = resolveHarnessInvocation(harnessEnvironment, [], launchOptions)
  const observerBin = observerLaunch.args[0]
  if (observerBin === undefined) throw new Error('desktop: Harness entry is unavailable for process ownership')
  const processRecoveryPath = join(app.getPath('userData'), 'managed-processes', 'recovery-v1.json')
  try {
    processObserver = await loadProcessObserver(
      observerBin,
      observerLaunch.command,
      processRecoveryPath,
      `${persistentServicesPath}.runtime`,
    )
  } catch (error) {
    blockedProcessRecoveryPath = processRecoveryPath
    const detail = error instanceof Error ? error.message : String(error)
    await appendDesktopStartupLog(`Managed process recovery could not prove quiescence: ${detail}`)
    publishStartupProgress({
      stage: 'checking-profile', progress: 28,
      detail: 'process-recovery-blocked', state: 'degraded',
    })
    showLoading('failed', {
      message: shellMessages(app.getLocale()).processRecoveryFailed(detail),
      logPath: harnessLogPath,
    })
    return
  }
  const profileManifestPath = join(dshHome, 'profiles', 'web', 'package.json')
  const profileInitialized = await lstat(profileManifestPath).then(stat => stat.isFile(), () => false)
  let profileMutationLock = inspectProfileMutationLock(dshHome)
  if (profileMutationLock.active) {
    const lockWaitStartedAt = Date.now()
    publishStartupProgress({
      stage: 'checking-profile', progress: 28,
      detail: 'profile-lock-wait',
      startedAt: lockWaitStartedAt,
      deadlineAt: lockWaitStartedAt + PROFILE_LOCK_WAIT_MS,
    })
    await new Promise<void>((resolve) => { setTimeout(resolve, PROFILE_LOCK_WAIT_MS) })
    profileMutationLock = inspectProfileMutationLock(dshHome)
  }
  const profileMutationBlocked = profileMutationLock.active
  let startupProfileMutationAllowed = !profileMutationBlocked && !startupSafety.rollbackFailed
  let profileNeedsRepair = !profileInitialized && startupProfileMutationAllowed
  if (profileMutationBlocked) {
    const created = profileMutationLock.createdAt === undefined
      ? undefined
      : Date.parse(profileMutationLock.createdAt)
    const heldMs = created === undefined || !Number.isFinite(created)
      ? undefined
      : Math.max(0, Date.now() - created)
    const owner = [
      `state=${profileMutationLock.state}`,
      `operation=${profileMutationLock.operationKind ?? 'unknown'}`,
      ...(profileMutationLock.pid === undefined ? [] : [`pid=${profileMutationLock.pid}`]),
      ...(heldMs === undefined ? [] : [`heldMs=${heldMs}`]),
      `lock=${profileMutationLock.lockPath}`,
    ].join(' ')
    const warning = `runtime.profile-mutation-lock-busy: ${owner}; opening Diagnostics without reading the active Profile`
    await retainStartupWarning(
      'runtime.profile-mutation-lock-busy',
      `profile-lock-check:${profileMutationLock.operationKind ?? profileMutationLock.state}`,
      ['diagnostics', 'open-log', 'switch-profile'],
    )
    await appendDesktopStartupLog(warning)
    publishStartupProgress({
      stage: 'checking-profile', progress: 34,
      detail: 'profile-lock-diagnostics',
      state: 'degraded',
    })
  } else if (profileInitialized && !startupSafety.rollbackFailed) {
    try {
      await appendDesktopStartupLog('Checking Web Profile compatibility without modifying it.')
      const inspection = await runDesktopInvocation(resolveHarnessInvocation(harnessEnvironment, [
        'plugin', '--profile', 'web', 'doctor',
      ], launchOptions), 'profile-check', PROFILE_CHECK_TIMEOUT_MS, [0, 2])
      profileNeedsRepair = profileDoctorStatus(inspection) !== 'healthy'
      await appendDesktopStartupLog(profileNeedsRepair
        ? 'Web Profile compatibility issues require bounded repair.'
        : 'Web Profile compatibility check completed without repair.')
    } catch (error) {
      if (error instanceof HarnessInvocationError && error.timedOut) {
        const warning = 'runtime.profile-check-timeout: compatibility inspection exceeded 15 seconds; continuing without Profile changes'
        await retainStartupWarning(
          'runtime.profile-check-timeout',
          'profile-check',
          ['diagnostics', 'open-log'],
        )
        await appendDesktopStartupLog(warning)
        publishStartupProgress({
          stage: 'checking-profile', progress: 32,
          detail: 'profile-check-timeout',
          state: 'degraded',
        })
        profileNeedsRepair = false
        startupProfileMutationAllowed = false
      } else {
        await appendDesktopStartupLog(
          `Web Profile read-only inspection failed without modifying the Profile: ${error instanceof Error ? error.message : String(error)}`,
        )
        profileNeedsRepair = false
        startupProfileMutationAllowed = false
      }
    }
  }
  if (profileNeedsRepair) {
    try {
      const repairStartedAt = Date.now()
      publishStartupProgress({
        stage: 'checking-profile', progress: 31,
        detail: profileInitialized ? 'profile-repair' : 'profile-initialize',
        startedAt: repairStartedAt,
        deadlineAt: repairStartedAt + PROFILE_REPAIR_TIMEOUT_MS,
      })
      await appendDesktopStartupLog(profileInitialized
        ? 'Repairing Web Profile compatibility with a hard timeout.'
        : 'Initializing the new Web Profile with a hard timeout.')
      const runProfileRepair = (): Promise<string> => runDesktopInvocation(
        resolveHarnessInvocation(harnessEnvironment, [
          'plugin', '--profile', 'web', 'doctor', '--repair',
        ], launchOptions),
        profileInitialized ? 'profile-repair' : 'profile-initialize',
        PROFILE_REPAIR_TIMEOUT_MS,
        [0, 10, 11],
      )
      initialProfileRepairDiagnostic = profileInitialized
        ? await withProfileMutationSafety('profile-repair', runProfileRepair)
        : await runProfileRepair()
      await appendDesktopStartupLog('Web Profile compatibility repair completed.')
    } catch (error) {
      if (!profileInitialized) {
        const message = error instanceof Error ? error.message : String(error)
        await retainStartupWarning(
          'runtime.profile-repair-failed',
          'profile-initialize',
          ['diagnostics', 'open-log', 'switch-profile'],
        )
        await appendDesktopStartupLog(`Web Profile initialization failed: ${message}`)
        publishStartupProgress({
          stage: 'checking-profile', progress: 31,
          detail: 'profile-initialize-failed',
          state: 'degraded',
        })
        showLoading('failed', {
          message: shellMessages(app.getLocale()).initializeFailed(message),
          logPath: harnessLogPath,
        })
        return
      }
      initialProfileRepairDiagnostic = error instanceof Error ? error.message : String(error)
      startupProfileMutationAllowed = false
      const code = error instanceof HarnessInvocationError && error.timedOut
        ? 'runtime.profile-repair-timeout'
        : 'runtime.profile-repair-failed'
      await retainStartupWarning(
        code,
        'profile-repair',
        ['diagnostics', 'open-log', 'snapshot-restore'],
      )
      console.warn('desktop: Profile startup repair did not settle; supervised startup will classify the failure', error)
    }
  }
  const profileRepairDiagnostic = await resolveStartupBuildApproval(
    initialProfileRepairDiagnostic,
    harnessEnvironment,
    launchOptions,
  )
  if (profileRepairDiagnostic.trim() !== '') {
    await appendFile(harnessLogPath, `[desktop] Profile startup repair:\n${profileRepairDiagnostic.trim()}\n`)
  }
  publishStartupProgress({ stage: 'checking-profile', progress: 34 })
  const bundledDirectory = resolveBundledPluginResourcesDirectory(
    app.isPackaged,
    process.resourcesPath,
    DEFAULT_SOURCE_ROOT,
  )
  // Descendant `dsh plugin add` processes (including the plugin market) can
  // restore an absent bundled version without downloading it again. The CLI
  // verifies the manifest and archive before using this directory.
  harnessEnvironment.DSH_DESKTOP_BUNDLED_PLUGINS_DIR = bundledDirectory
  const manifest = parseBundledPluginManifest(
    JSON.parse(await readFile(join(bundledDirectory, 'manifest.json'), 'utf8')) as unknown,
  )
  const startupPluginCooldown = new BundledPluginStartupCooldown(dshHome)
  bundledPluginCooldown = startupPluginCooldown
  const withStartupPluginTransaction = async <T>(
    packageName: string,
    operation: () => Promise<T>,
  ): Promise<T> => {
    if (startupSafety.rollbackFailed) {
      throw new Error('desktop: bundled plugin startup stopped after rollback failure')
    }
    return withProfileMutationSafety(`bundled-plugin:${packageName}`, operation)
  }
  bundledPluginInstaller = new BundledPluginInstaller({
    manifest,
    resourcesDirectory: bundledDirectory,
    get dshHome() { return mutationHome() },
    repairLegacyMarkers: !app.isPackaged,
    startupBudgetMs: 120_000,
    shouldAttemptStartup: plugin => startupPluginCooldown.shouldAttempt(plugin.packageName, plugin.version),
    onStartupSuccess: plugin => startupPluginCooldown.clear(plugin.packageName),
    onManagedMutationStart: () => { cancelBootableSnapshot() },
    onManagedMutationSettled: (plugin) => {
      restartBootableSnapshotStabilityWindow(`bundled plugin ${plugin.packageName} settled`)
    },
    withStartupTransaction: (plugin, operation) => withStartupPluginTransaction(plugin.packageName, operation),
    withManagedTransaction: (_plugin, operation) => runManagedPluginMutation(operation),
    prepare: async (plugin) => {
      await appendDesktopStartupLog(`Preparing bundled plugin ${plugin.packageName}@${plugin.version}.`)
      for (const packageName of plugin.approvedBuilds ?? []) {
        await runDesktopInvocation(resolveHarnessInvocation(harnessEnvironment, [
          'plugin', '--profile', plugin.profile, 'approve-build', packageName,
        ], launchOptions), `bundled-plugin-approve:${plugin.packageName}`, BUILD_APPROVAL_TIMEOUT_MS)
      }
    },
    install: async (archivePath, plugin) => {
      await appendDesktopStartupLog(`Installing bundled plugin ${plugin.packageName}@${plugin.version}.`)
      await installBundledPluginSource(plugin, archivePath, async (packageSpec) => {
        await runDesktopInvocation(resolveHarnessInvocation(harnessEnvironment, [
          'plugin', '--profile', plugin.profile, 'add', '--save-exact', packageSpec,
        ], launchOptions), `bundled-plugin-install:${plugin.packageName}`, BUNDLED_PLUGIN_INSTALL_TIMEOUT_MS)
      })
      await appendDesktopStartupLog(`Bundled plugin ${plugin.packageName}@${plugin.version} installed.`)
    },
    onFailure: async (error, plugin) => {
      await appendBundledPluginFailure(harnessLogPath, error)
      await startupPluginCooldown.record(plugin.packageName, plugin.version)
      const code = error instanceof HarnessInvocationError && error.timedOut
        ? 'runtime.bundled-plugin-timeout'
        : 'runtime.bundled-plugin-failed'
      await retainStartupWarning(
        code,
        'bundled-plugin-install',
        ['diagnostics', 'open-log', 'retry-plugin'],
        plugin.packageName,
      )
      console.error(error)
    },
  })
  // Startup seed is trusted, verified application material. Suppress per-plugin
  // automatic snapshots here and retain one known-bootable point only after the
  // client and event dispatcher both prove the resulting Profile can start.
  harnessEnvironment.DSH_PLUGIN_SNAPSHOT_BATCH = '1'
  try {
    if (startupProfileMutationAllowed && !preserveCopiedPlugins) {
      await bundledPluginInstaller.seedStartup((progress) => {
        publishStartupProgress(mapBundledPluginProgress(
          progress.entry.packageName,
          progress.index,
          progress.total,
          progress.stage,
          progress.progress,
        ))
      })
    } else {
      await appendDesktopStartupLog(
        preserveCopiedPlugins
          ? 'Preserved copied community plugins without startup seeding.'
          : 'Skipped bundled startup plugin mutations because Profile health was not proven safe for writes.',
      )
    }
  } finally {
    delete harnessEnvironment.DSH_PLUGIN_SNAPSHOT_BATCH
  }
  await appendDesktopStartupLog('Bundled startup plugin seeding completed.')
  const installedProfileDependencies: Record<string, string> = {}
  try {
    const profileManifest = JSON.parse(
      await readFile(join(mutationHome(), 'profiles', 'web', 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, unknown> }
    for (const [packageName, declaredSpec] of Object.entries(profileManifest.dependencies ?? {})) {
      if (typeof declaredSpec === 'string') installedProfileDependencies[packageName] = declaredSpec
    }
  } catch (error) {
    console.warn('desktop: could not identify installed startup plugins for imported restore', error)
  }
  importedPluginRestoreManager = new ImportedPluginRestoreManager({
    get dshHome() { return mutationHome() },
    providedDependencies: installedProfileDependencies,
    inspectSource: packageSpec => inspectImportedPluginSource(packageSpec, harnessEnvironment, launchOptions),
    install: packageSpec => runDesktopInvocation(resolveHarnessInvocation(harnessEnvironment, [
      'plugin', '--profile', 'web', 'add', packageSpec,
    ], launchOptions), 'imported-plugin-install', IMPORTED_PLUGIN_INSTALL_TIMEOUT_MS),
    mergeAllowBuilds: (_profileDir, rules) => withProfileMutationSafety(
      'imported-plugin-allow-builds',
      () => mergeImportedAllowBuilds(join(mutationHome(), 'profiles', 'web'), rules),
    ),
    withMutation: operation => runManagedPluginMutation(operation),
  })
  try {
    if (startupProfileMutationAllowed && !preserveCopiedPlugins) await importedPluginRestoreManager.prepare()
    else await appendDesktopStartupLog(
      preserveCopiedPlugins
        ? 'Skipped imported plugin restore preparation to preserve the copied community deployment.'
        : 'Skipped imported plugin restore preparation because Profile health was not proven safe for writes.',
    )
  } catch (error) {
    console.warn('desktop: imported plugin restore metadata is unavailable; startup will continue', error)
    await appendFile(harnessLogPath, `[desktop] Imported plugin restore unavailable: ${error instanceof Error ? error.message : String(error)}\n`)
  }
  try {
    if (startupSafety.rollbackFailed) await discardDesktopCandidate()
    else await activateDesktopCandidate(false)
  } catch (error) {
    try { await discardDesktopCandidate() } catch (rollbackError) {
      startupSafety.rollbackFailed = true
      console.error('desktop: candidate startup rollback needs recovery', rollbackError)
    }
    await appendDesktopStartupLog('Startup candidate could not be activated; preserved the prior Profile.')
    console.error('desktop: startup plugin candidate failed', error)
  }
  publishStartupProgress({ stage: 'starting-harness', progress: 88 })
  await appendDesktopStartupLog('Starting Harness supervisor.')
  const launch = resolveHarnessLaunch({
    ...harnessEnvironment, DSH_DESKTOP_MUTATION_OWNER_PID: String(process.pid),
  }, launchOptions)
  profileTransactionManager.start()
  const notificationCopy = desktopNotificationDictionary(app.getLocale())
  const allowNotification = createNotificationThrottle(5 * 60_000)
  let recovering = false
  const showNotification = (key: string, copy: { title: string; body: string }): void => {
    if (!preferences.notificationsEnabled || !Notification.isSupported() || !allowNotification(key, Date.now())) return
    const notification = new Notification({ title: copy.title, body: copy.body, icon: WINDOW_ICON })
    notification.on('click', () => { lifecycle?.showWindow() })
    notification.show()
  }
  supervisor = new HarnessSupervisor({
    launch,
    onSpawn: (pid) => { observeProcess(pid, 'Harness') },
    logPath: harnessLogPath,
    environment: { ...harnessEnvironment },
    managedRuntime: processObserver,
    ...(profileMutationBlocked || startupSafety.rollbackFailed
      ? {
        initialDiagnosticMode: true,
        initialDiagnosticReason: profileMutationBlocked
          ? 'The active Profile is owned by another plugin mutation operation.'
          : 'A startup plugin mutation could not be rolled back safely.',
      }
      : {}),
    ...(process.platform === 'win32' ? { terminateProcessTree: terminateWindowsProcessTree } : {}),
    onReady: (url) => {
      recoveryHarnessSuspended = false
      recoveryRestartRequired = false
      latestRecoveryFailure = undefined
      harnessOrigin = new URL(url).origin
      desktopReturnControl?.setHarnessOrigin(`${harnessOrigin}/`)
      desktopWebAccess?.setReady(url)
      reportedDesktopReadiness.clear()
      publishStartupProgress({ stage: 'ready', progress: 100 })
      const readyOrigin = harnessOrigin
      setTimeout(() => {
        if (harnessOrigin !== readyOrigin || mainSurface === undefined || mainSurface.window.isDestroyed()) return
        void mainSurface.loadURL(withDesktopWindowMetadata(url, process.platform))
      }, 120)
      if (recovering) {
        recovering = false
        showNotification('recovered', notificationCopy.recovered)
      }
      if (startupWarnings.length > 0) showNotification('startup-warning', {
        ...notificationCopy.startupWarning,
        body: `${notificationCopy.startupWarning.body}\n${startupWarnings.slice(0, 3).join('\n')}`,
      })
      desktopWebAccess?.openAutomatically(preferences.openBrowserOnStartup)
    },
    onDiagnosticReady: (url, failure) => {
      recoveryHarnessSuspended = false
      recoveryRestartRequired = false
      harnessOrigin = new URL(url).origin
      reportedDesktopReadiness.clear()
      desktopReturnControl?.clear()
      desktopWebAccess?.clear()
      publishStartupProgress({
        stage: 'starting-harness',
        progress: 100,
        detail: 'profile-diagnostics-ready',
        state: 'degraded',
      })
      void appendDesktopStartupLog(
        `Diagnostic mode is ready; the active Profile remains paused: ${failure.message}`,
      )
      showLoading('failed', { ...failure, logPath: harnessLogPath })
      showNotification('failed', notificationCopy.failed)
    },
    onState: (state) => {
      if (state === 'restarting' || state === 'failed' || state === 'stopped') {
        cancelBootableSnapshot()
        harnessOrigin = undefined
        desktopReturnControl?.clear()
        desktopWebAccess?.clear()
      }
      if (state !== 'ready') menuClientReady = false
      applicationMenu?.refresh()
      if (state === 'starting') publishStartupProgress({ stage: 'starting-harness', progress: 92 })
      if (state === 'restarting') publishStartupProgress({ stage: 'restarting-harness', progress: 90 })
      if (state !== 'failed') showLoading(state)
      if (state === 'restarting' && !recovering) {
        recovering = true
        showNotification('restart', notificationCopy.restart)
      }
    },
    onFailure: (failure) => {
      profileTransactionManager?.failed()
      if (pluginSnapshotManager === undefined) {
        showLoading('failed', { ...failure, logPath: harnessLogPath })
        showNotification('failed', notificationCopy.failed)
        return
      }
      void pluginSnapshotManager.handleHarnessFailure(failure.message).then((handled) => {
        if (handled) return
        showLoading('failed', { ...failure, logPath: harnessLogPath })
        showNotification('failed', notificationCopy.failed)
      }, (error: unknown) => {
        console.error('desktop: plugin snapshot rollback after startup failure failed', error)
        showLoading('failed', { ...failure, logPath: harnessLogPath })
        showNotification('failed', notificationCopy.failed)
      })
    },
  })
  let restoreLeaseToken: string | undefined
  pluginSnapshotManager = new PluginSnapshotManager({
    listSnapshots: () => runSnapshotCommand<readonly PluginSnapshotSummary[]>(['list'], SNAPSHOT_COMMAND_TIMEOUT_MS),
    createSnapshot: (kind, label) => runSnapshotCommand<{ snapshotId: string; kind: typeof kind }>(
      kind === 'manual'
        ? ['create', ...(label === undefined ? [] : [label])]
        : [kind === 'bootable' ? 'mark-bootable' : 'create-safety'],
      SNAPSHOT_COMMAND_TIMEOUT_MS,
    ),
    removeSnapshot: async (snapshotId) => { await runSnapshotCommand(['remove', snapshotId], SNAPSHOT_COMMAND_TIMEOUT_MS) },
    restoreFiles: async (snapshotId) => { await runSnapshotCommand(['restore-files', snapshotId], SNAPSHOT_COMMAND_TIMEOUT_MS) },
    settleSafety: async (snapshotId) => { await runSnapshotCommand(['settle-safety', snapshotId], SNAPSHOT_COMMAND_TIMEOUT_MS) },
    beginMutationLease: async () => {
      if (restoreLeaseToken !== undefined) throw new Error('desktop: plugin snapshot restore lease is already active')
      const token = randomUUID()
      restoreLeaseToken = token
      harnessEnvironment.DSH_PLUGIN_SNAPSHOT_LEASE_TOKEN = token
      harnessEnvironment.DSH_PLUGIN_SNAPSHOT_LEASE_OWNER_PID = String(process.pid)
      try {
        await runSnapshotCommand(['begin-restore-lease'], SNAPSHOT_COMMAND_TIMEOUT_MS)
      } catch (error) {
        restoreLeaseToken = undefined
        delete harnessEnvironment.DSH_PLUGIN_SNAPSHOT_LEASE_TOKEN
        delete harnessEnvironment.DSH_PLUGIN_SNAPSHOT_LEASE_OWNER_PID
        throw error
      }
    },
    endMutationLease: async () => {
      if (restoreLeaseToken === undefined) return
      try {
        await runSnapshotCommand(['end-restore-lease'], SNAPSHOT_COMMAND_TIMEOUT_MS)
      } finally {
        restoreLeaseToken = undefined
        delete harnessEnvironment.DSH_PLUGIN_SNAPSHOT_LEASE_TOKEN
        delete harnessEnvironment.DSH_PLUGIN_SNAPSHOT_LEASE_OWNER_PID
      }
    },
    suspendHarness: async () => { await supervisor?.stop() },
    resumeHarness: () => { supervisor?.resume() },
    installProfile: async (offline) => {
      await runPackageManagerInvocation(
        ['install', ...(offline ? ['--offline'] : []), '--frozen-lockfile'],
        join(dshHome, 'profiles', 'web'),
        harnessEnvironment,
        launchOptions,
        120_000,
      )
    },
    doctorHealthy: async () => {
      const output = await runDesktopInvocation(resolveHarnessInvocation(harnessEnvironment, [
        'plugin', '--profile', 'web', 'doctor',
      ], launchOptions), 'snapshot-restore-doctor', PROFILE_CHECK_TIMEOUT_MS, [0, 2])
      return parseDiagnosticLabDoctorOutput(output).status === 'healthy'
    },
    onStatus: (snapshot) => {
      snapshotMutationActive = !['needs-network', 'succeeded', 'rolled-back', 'failed'].includes(snapshot.phase)
      applicationMenu?.refresh()
      mainSurface?.send('dsh:desktop:plugin-snapshots:status', snapshot)
    },
    journalPath: join(dshHome, 'plugin-snapshots', 'v1', 'restore-journal.json'),
  })
  diagnosticLabManager = new DiagnosticLabManager({
    root: join(app.getPath('userData'), 'diagnostic-lab'),
    activeDshHome: dshHome,
    logDirectory: join(app.getPath('logs'), 'diagnostic-lab'),
    suspendHarness: async () => { await supervisor?.stop() },
    resumeHarness: () => { supervisor?.resume() },
    runTransactionInterruptionExercise: async () => {
      const home = await mkdtemp(join(tmpdir(), 'dsh-transaction-lab-'))
      const environment: NodeJS.ProcessEnv = { ...harnessEnvironment, DSH_HOME: home, DSH_DIAGNOSTIC_LAB: '1' }
      delete environment.DSH_PLUGIN_SNAPSHOT_LEASE_TOKEN
      try {
        const output = await runDesktopInvocation(resolveHarnessInvocation(environment, [
          'plugin', '--profile', 'web', 'transaction', 'exercise',
        ], launchOptions), 'diagnostic-transaction-interrupt', 15_000)
        const record = parsePluginSnapshotJson(output) as { id?: unknown }
        if (typeof record.id !== 'string' || !/^[a-f0-9-]{36}$/u.test(record.id)) throw new Error('invalid diagnostic transaction ID')
        const journal = join(home, 'plugin-transactions', 'web', 'pending.json')
        const generation = join(home, 'profiles', 'web', 'node_modules', 'diagnostic-generation')
        const interrupted = await readFile(generation, 'utf8') === 'unconfirmed'
          && (JSON.parse(await readFile(journal, 'utf8')) as { phase?: unknown }).phase === 'checking-startup'
        await runDesktopInvocation(resolveHarnessInvocation(environment, [
          'plugin', '--profile', 'web', 'transaction', 'rollback', record.id,
        ], launchOptions), 'diagnostic-transaction-recover', 15_000)
        const recovered = await readFile(generation, 'utf8') === 'healthy'
          && !await lstat(journal).then(() => true, () => false)
        return { interrupted, recovered }
      } finally { await rm(home, { recursive: true, force: true }) }
    },
    runStartupTimeoutExercise: async () => {
      const directory = await mkdtemp(join(tmpdir(), 'dsh-startup-timeout-lab-'))
      const marker = join(directory, 'mutation.marker')
      const script = join(directory, 'fake-cli.cjs')
      try {
        await writeFile(script, [
          "const { writeFileSync } = require('node:fs')",
          `writeFileSync(${JSON.stringify(marker)}, 'partial mutation')`,
          'setInterval(() => {}, 1000)',
          '',
        ].join('\n'), { mode: 0o600 })
        const nodeCommand = launchOptions.nodeCommand
          ?? harnessEnvironment.DSH_DESKTOP_NODE_BIN
          ?? process.execPath
        let cancelled = false
        try {
          await runDesktopInvocation({
            command: nodeCommand,
            args: [script],
            environment: { ...harnessEnvironment, ELECTRON_RUN_AS_NODE: '1' },
          }, 'diagnostic-startup-timeout', 250)
        } catch (error) {
          if (!(error instanceof HarnessInvocationError) || !error.timedOut) throw error
          cancelled = true
        }
        const mutationObserved = await lstat(marker).then(stat => stat.isFile(), () => false)
        await rm(marker, { force: true })
        const rolledBack = mutationObserved && !await lstat(marker).then(() => true, () => false)
        return {
          actualCode: 'runtime.profile-check-timeout' as const,
          cancelled,
          rolledBack,
          continued: true,
        }
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    },
    installProfile: async (home, force) => {
      await runPackageManagerInvocation(
        ['install', '--offline', '--ignore-scripts', ...(force ? ['--force'] : [])],
        join(home, 'profiles', 'web'),
        { ...harnessEnvironment, DSH_HOME: home },
        launchOptions,
        90_000,
      )
    },
    installDiagnosticPlugin: async (home, packageName) => {
      const entry = manifest.plugins.find(candidate => (
        candidate.installPolicy === 'diagnostic'
        && candidate.profile === 'web'
        && candidate.packageName === packageName
      ))
      if (entry === undefined) throw new Error(`desktop: packaged diagnostic plugin ${packageName} is unavailable`)
      const archivePath = await verifyBundledPluginArchive(bundledDirectory, entry)
      await runDesktopInvocation(resolveHarnessInvocation(
        { ...harnessEnvironment, DSH_HOME: home },
        ['plugin', '--profile', entry.profile, 'add', '--save-exact', archivePath],
        launchOptions,
      ), `diagnostic-plugin-install:${entry.packageName}`, BUNDLED_PLUGIN_INSTALL_TIMEOUT_MS)
    },
    runDoctor: async (home, repair) => {
      const environment = { ...harnessEnvironment, DSH_HOME: home }
      const output = await runDesktopInvocation(resolveHarnessInvocation(environment, [
        'plugin', '--profile', 'web', 'doctor', ...(repair ? ['--repair'] : []),
      ], launchOptions), repair ? 'diagnostic-doctor-repair' : 'diagnostic-doctor-check',
      repair ? PROFILE_REPAIR_TIMEOUT_MS : PROFILE_CHECK_TIMEOUT_MS,
      repair ? [0, 10, 11] : [0, 2])
      return parseDiagnosticLabDoctorOutput(output)
    },
    onSnapshot: (snapshot: DiagnosticLabRunSnapshot) => {
      applicationMenu?.refresh()
      mainSurface?.send('dsh:desktop:diagnostic-lab:status', snapshot)
    },
  })
  try {
    await diagnosticLabManager.recoverPending()
  } catch (error) {
    console.error('desktop: diagnostic lab startup recovery failed; continuing with supervised Harness startup', error)
  }
  try {
    await pluginSnapshotManager.recoverPending()
  } catch (error) {
    console.error('desktop: plugin snapshot startup recovery failed; retaining the failure for manual recovery', error)
  }
  supervisor.start()

  app.on('activate', () => {
    lifecycle?.showWindow()
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    lifecycle?.showWindow()
  })
  app.on('window-all-closed', () => {
    // The tray owns application lifetime on every platform.
  })
  app.on('before-quit', (event) => {
    if (quitReleased) return
    event.preventDefault()
    void lifecycle?.requestQuit()
  })
  app.on('will-quit', () => { stopReleaseChecks?.() })
  void startApplication().catch((error: unknown) => {
    if (!(error instanceof DesktopDataHomeSelectionCancelledError)) console.error(error)
    if (lifecycle === undefined) {
      quitReleased = true
      app.quit()
    } else {
      void lifecycle.requestQuit()
    }
  })
}

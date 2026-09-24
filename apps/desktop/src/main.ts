/** Electron application host for the existing DeepSeek Harness Web GUI. */

import { createHash, randomUUID } from 'node:crypto'
import {
  loadProcessObserver,
  quarantineProcessRecoveryJournal,
  type DesktopProcessObserver,
} from './process-observer.ts'
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir, release, tmpdir, userInfo } from 'node:os'
import { basename, delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, net, Notification, safeStorage, session, shell, Tray,
  type Session,
  type MenuItemConstructorOptions, type MessageBoxOptions, type WebContents, type WebPreferences,
} from 'electron'
import { appendBundledPluginFailure, seedBundledPluginsBatch, verifyBundledPluginArchive } from './bundled-plugin-seed.ts'
import { BundledPluginStartupCooldown } from './bundled-plugin-cooldown.ts'
import { FirstStartPreparation } from './first-start-preparation.ts'
import { BundledPresetVersionGate } from './bundled-preset-version-gate.ts'
import { applyFreshProfileDefaults } from './fresh-profile-defaults.ts'
import { deployPrebuiltProfile, readPrebuiltProfile, readProfileBuildApprovals, type PrebuiltProfileManifest } from './prebuilt-profile.ts'
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
import { ensurePackagedPrebuiltProfile, ensurePackagedRuntime, packagedPrebuiltProfileArchiveRoot, packagedRuntimeArchiveRoot } from './packaged-runtime.ts'
import { HarnessSupervisor, type HarnessFailure, type HarnessState } from './supervisor.ts'
import { readRecoveryFailureSummary, type RecoveryFailureSummary } from './recovery-failure.ts'
import { parseClientBootFailure } from './client-boot-failure.ts'
import { clearDeadModuleFallbackLock, inspectModuleFallbackLock } from './module-fallback-lock.ts'
import { DesktopProfileMutation } from './desktop-profile-mutation/index.ts'
import { ensureWorkspacePtcPlugin, hasManagedWorkspacePtcBlock, isWorkspacePtcPluginInstalled, PTC_PLUGIN_NAME } from './workspace-ptc-plugin.ts'
import { DESKTOP_IPC } from './desktop-ipc-protocol.ts'
import { terminateWindowsProcessTree } from './windows-process-tree.ts'
import { revealHarnessLog, type OpenLogResult } from './log-reveal.ts'
import { startDesktopLogSession } from './persistent-log.ts'
import { createNotificationThrottle, desktopNotificationDictionary } from './notifications.ts'
import {
  createDesktopPreferencesStore, DEFAULT_DESKTOP_PREFERENCES, parseDesktopPreferencesPatch,
  type DesktopPreferences, type DesktopPreferencesStore,
} from './preferences.ts'
import { DesktopReleaseChecker, fetchGitHubReleases, isAllowedReleaseUrl, type DesktopReleaseStatus } from './release-checker.ts'
import { DesktopReleaseDownloader, type DesktopReleaseDownloadStatus, type ReleaseFetch } from './release-downloader.ts'
import { fetchCnbReleaseIndex, isAllowedCnbUrl, selectCnbRelease } from './cnb-release-source.ts'
import {
  DownloadNetworkSettingsStore, npmRegistryUrl, type DownloadNetworkSettings, type DownloadNetworkTarget,
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
import { WorkspaceRuntimeCatalog } from './workspace-runtime-catalog.ts'
import { loadBundledWorkspaceRuntimeManifest } from './bundled-workspace-runtime.ts'
import { OptionalRuntimeManager } from './workspace-runtime-manager.ts'
import {
  WORKSPACE_RUNTIME_CAPABILITIES,
  workspaceRuntimeTarget,
  type WorkspaceRuntimeCapability,
} from './workspace-runtime-manifest.ts'
import { configureWorkspaceRuntimeCapability, type WorkspaceRuntimeProfilePaths } from './workspace-runtime-profile.ts'
import { createDesktopLifecycle, type DesktopLifecycle } from './window-lifecycle.ts'
import { ApplicationMenuController } from './application-menu-controller.ts'
import { installDesktopShortcuts } from './keyboard.ts'
import { CLIENT_COMMANDS, menuCopy, type DesktopCommand } from './application-menu.ts'
import { inspectProfileMutationLock, menuMutationActive } from './menu-mutation-guard.ts'
import { CANDIDATE_PREPARATION_TIMEOUT_MS } from './candidate-preparation.ts'
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
  readDesktopDataHomeSetup,
  PORTABLE_PLUGIN_TRANSFER_FILENAME,
  resolveCommunityDataHomeSource,
  resolveDesktopApplicationDataRoot,
  resolveDesktopDataHomeSource,
  shouldPreserveLegacyCopiedProfile,
  resolveDesktopDataHomeLayout,
  type DesktopDataHomeSelectionResult,
  type DesktopDataHomeSwitchResult,
} from './desktop-data-home.ts'
import {
  DesktopDataHomeAuthority,
  DesktopDataHomeSelectionCancelledError,
  type DesktopDataHomeChoice,
  type DesktopDataHomeChooserSession,
  type DesktopDataHomeSourceResult,
  type DesktopDataHomeTargetResult,
  type DesktopDataHomePortableResult,
} from './desktop-data-home-authority.ts'
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
  readImportedPluginRestorePlan,
  type ImportedPluginRestoreSnapshot,
} from './imported-plugin-restore.ts'
import {
  importedPluginVersionDiffers,
  stageImportedPluginArchive,
  stageImportedPluginDirectory,
  type StagedImportedPlugin,
} from './imported-plugin-local-source.ts'
import { planPortablePluginImport } from './portable-plugin-import.ts'
import { installPortablePluginCandidate } from './portable-plugin-install.ts'
import { packPortablePluginBundle, unpackPortablePluginBundle } from './portable-plugin-transfer.ts'
import { parsePortablePluginTarget } from './portable-plugin-bundle.ts'
import { exportPortablePluginsFromHome, planPortablePluginSources } from './portable-plugin-source.ts'
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
import { clearStaleHarnessAuthCookies } from './harness-auth-cookies.ts'
import { shellMessages, trayMessages, dataHomeMessages } from './locales/shell.ts'
import { sourceCopyFor } from './locales/data-home-source.ts'
import { DesktopReturnControl } from './desktop-return-control.ts'
import { createDesktopLocaleStore, type DesktopLocaleStore } from './desktop-locale-store.ts'
import { resolveDesktopLocale } from './desktop-locale.ts'
import { DESKTOP_PRODUCT_NAME, desktopWindowTitle } from './product-name.ts'
import {
  FilePersistentServiceAuthorizer,
  FilePersistentServiceRuntimeRegistry,
  persistentProfileFingerprint,
  type PersistentServiceSummary,
} from '@deepseek-ai/dsh-subprocess'
import {
  NasRuntimeClient,
  NasRuntimeStore,
  discoverNasRuntimes,
  inspectNasCertificate,
  type NasRuntimeRecord,
} from './nas-runtime.ts'
import { DesktopNasRuntimeAuthority } from './nas-runtime-authority.ts'
import { registerNasRuntimeIpc } from './nas-runtime-ipc.ts'

const APP_NAME = DESKTOP_PRODUCT_NAME
const DESKTOP_WEB_SUPPORTED = process.platform === 'darwin' || process.platform === 'win32'
const LOADING_PAGE = fileURLToPath(new URL('./loading.html', import.meta.url))
const WINDOW_ICON = fileURLToPath(new URL('./icon.png', import.meta.url))
const MACOS_TRAY_ICON = fileURLToPath(new URL('./tray-iconTemplate.png', import.meta.url))
const PRELOAD = fileURLToPath(new URL('./preload.cjs', import.meta.url))
const TITLEBAR_PAGE = fileURLToPath(new URL('./titlebar.html', import.meta.url))
const TITLEBAR_PRELOAD = fileURLToPath(new URL('./titlebar-preload.cjs', import.meta.url))
const DATA_HOME_PAGE = fileURLToPath(new URL('./data-home.html', import.meta.url))
const DATA_HOME_PRELOAD = fileURLToPath(new URL('./data-home-preload.cjs', import.meta.url))
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

app.setName(DESKTOP_PRODUCT_NAME)
process.title = DESKTOP_PRODUCT_NAME
app.setPath('userData', DESKTOP_DATA_HOME.desktopRoot)
app.setPath('sessionData', DESKTOP_DATA_HOME.sessionData)
app.setAppLogsPath(DESKTOP_DATA_HOME.logs)
const harnessLogPath = join(DESKTOP_DATA_HOME.logs, 'harness.log')
const desktopLogSession = startDesktopLogSession(harnessLogPath, {
  sessionId: randomUUID(),
  version: app.getVersion(),
  platform: process.platform,
  architecture: process.arch,
  packaged: app.isPackaged,
  pid: process.pid,
})
process.on('uncaughtExceptionMonitor', (error, origin) => {
  desktopLogSession.append('desktop-process', 'error', `uncaught exception origin=${origin}: ${error.stack ?? error.message}`)
})

let mainWindow: BrowserWindow | undefined
let iconManager: DesktopIconManager | undefined
let mainSurface: DesktopWindowSurface | undefined
let supervisor: HarnessSupervisor | undefined
let harnessOrigin: string | undefined
let harnessAuthenticationUrl: string | undefined
let nasRuntimeAuthority: DesktopNasRuntimeAuthority | undefined
let desktopWebAccess: DesktopWebAccess | undefined
let desktopReturnControl: DesktopReturnControl | undefined
let lifecycle: DesktopLifecycle | undefined
let applicationMenu: ApplicationMenuController | undefined
let desktopShortcuts: ReturnType<typeof installDesktopShortcuts> | undefined
let disposeApplicationMenu: (() => void) | undefined
let activeMenuHome: string | undefined
let menuLocale = 'en'
let desktopLocaleStore: DesktopLocaleStore | undefined
let persistedProfileLocale: string | undefined
let menuClientReady = false
let menuClientAvailable = false
let reportedClientBootFailureOrigin: string | undefined
let snapshotMutationActive = false
let recoveryHarnessSuspended = false
let recoveryRestartRequired = false
let blockedProcessRecoveryPath: string | undefined
let latestRecoveryFailure: string | undefined
let latestRecoveryDiagnostic: RecoveryFailureSummary | undefined
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
const prebuiltDeploymentAbort = new AbortController()
let prebuiltDeploymentTask: Promise<void> | undefined
let preparingFirstStart = false
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
      mainSurface?.send(DESKTOP_IPC.menuCommand, { id, command })
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
let profileMutation: DesktopProfileMutation | undefined
let workspaceRuntimeManager: OptionalRuntimeManager | undefined
let dataHomeChooserWindow: BrowserWindow | undefined
const desktopDataHomes = new DesktopDataHomeAuthority({
  layout: DESKTOP_DATA_HOME,
  stopActiveProfile: () => stopPersistentServicesForActiveProfile(),
  scheduleRestart: () => { setTimeout(requestDesktopRestart, 250) },
})

function appendDesktopStartupLog(message: string): Promise<void> {
  desktopLogSession.append('desktop-startup', 'info', message)
  return Promise.resolve()
}

interface DesktopCapabilities {
  runtimeKind: 'local' | 'nas'
  platform: NodeJS.Platform
  packaged: boolean
  launchAtLoginAvailable: boolean
  sourceUpdateAvailable: boolean
  commandLineAvailable: boolean
  developmentRecoveryAvailable: boolean
}

function bootNasRuntime(): NasRuntimeRecord | undefined {
  const bootRuntime = nasRuntimeAuthority?.bootRuntime
  return bootRuntime?.kind === 'nas' ? bootRuntime.runtime : undefined
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
    runtimeKind: bootNasRuntime() === undefined ? 'local' : 'nas',
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

async function showDataHomeChooser(
  session: DesktopDataHomeChooserSession,
  parent?: BrowserWindow,
): Promise<DesktopDataHomeChoice> {
  const presentation = session.presentation
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
    ...(parent === undefined ? {} : { parent }),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: DATA_HOME_PRELOAD,
    },
  })
  dataHomeChooserWindow = chooser
  chooser.webContents.on('will-navigate', (event) => { event.preventDefault() })
  chooser.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  return new Promise<DesktopDataHomeChoice>((resolve, reject) => {
    let settled = false
    const cleanup = (): void => {
      ipcMain.removeListener('dsh:data-home:selected', handleSelection)
      ipcMain.removeListener('dsh:data-home:cancelled', handleCancellation)
      ipcMain.removeHandler('dsh:data-home:choose-source')
      ipcMain.removeHandler('dsh:data-home:choose-target')
      ipcMain.removeHandler('dsh:data-home:choose-portable')
      session.clear()
      if (dataHomeChooserWindow === chooser) dataHomeChooserWindow = undefined
    }
    const closeChooser = (): void => {
      cleanup()
      if (!chooser.isDestroyed()) chooser.destroy()
    }
    const finish = (selection?: DesktopDataHomeChoice): void => {
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
      if (event.sender !== chooser.webContents) return
      void (async () => {
        const submission = await session.submit(value)
        if (submission.status === 'source-error') event.sender.send('dsh:data-home:source-error', submission.result)
        else if (submission.status === 'target-error') event.sender.send('dsh:data-home:target-error', submission.result)
        else if (submission.status === 'selected') finish(submission.choice)
      })().catch(fail)
    }
    const handleCancellation = (event: Electron.IpcMainEvent): void => {
      if (event.sender === chooser.webContents) finish()
    }
    ipcMain.on('dsh:data-home:selected', handleSelection)
    ipcMain.on('dsh:data-home:cancelled', handleCancellation)
    ipcMain.handle('dsh:data-home:choose-source', async (event, origin: unknown): Promise<DesktopDataHomeSourceResult> => {
      if (event.sender !== chooser.webContents) throw new Error('desktop: invalid data-home source requester')
      if (origin !== 'official' && origin !== 'community') throw new Error('desktop: invalid data-home source category')
      const dialogResult = await dialog.showOpenDialog(chooser, {
        title: shellMessages(app.getLocale()).chooseSource,
        properties: ['openDirectory'],
      })
      const candidate = dialogResult.canceled ? undefined : dialogResult.filePaths[0]
      const result = await session.chooseSource(origin, candidate)
      if (result.status !== 'confirmation-required') return result
      const copy = sourceCopyFor(resolveDesktopLocale(app.getLocale()))
      const confirmation = await dialog.showMessageBox(chooser, {
        type: 'warning',
        title: copy.communityConfirmTitle,
        message: copy.communityConfirmMessage,
        detail: `${copy.communityConfirmDetail}\n\n${result.path}`,
        buttons: [copy.communityConfirmCancel, copy.communityConfirmAccept],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      })
      if (confirmation.response !== 1) return { status: 'cancelled' }
      const confirmed = await session.chooseSource('community', result.path, true)
      if (confirmed.status === 'confirmation-required') {
        return { status: 'invalid', path: confirmed.path }
      }
      return confirmed
    })
    ipcMain.handle('dsh:data-home:choose-target', async (event): Promise<DesktopDataHomeTargetResult> => {
      if (event.sender !== chooser.webContents) throw new Error('desktop: invalid data-home target requester')
      const result = await dialog.showOpenDialog(chooser, {
        title: shellMessages(app.getLocale()).chooseTarget,
        properties: ['openDirectory', 'createDirectory'],
      })
      return session.chooseTarget(result.canceled ? undefined : result.filePaths[0])
    })
    ipcMain.handle('dsh:data-home:choose-portable', async (event): Promise<DesktopDataHomePortableResult> => {
      if (event.sender !== chooser.webContents) throw new Error('desktop: invalid offline plugin transfer requester')
      const result = await dialog.showOpenDialog(chooser, {
        properties: ['openFile'], filters: [{ name: 'Offline plugin transfer', extensions: ['tgz'] }],
      })
      const choice = await session.choosePortable(result.canceled ? undefined : result.filePaths[0])
      if (choice.status === 'selected' && (choice.target.platform !== process.platform
        || choice.target.architecture !== process.arch || choice.target.osVersion !== release())) {
        return { status: 'invalid' }
      }
      return choice
    })
    chooser.once('closed', () => { finish() })
    chooser.once('ready-to-show', () => {
      chooser.show()
      chooser.focus()
    })
    void chooser.loadFile(DATA_HOME_PAGE, { query: {
      locale: menuLocale,
      selected: presentation.officialSource === undefined && presentation.communitySource === undefined ? 'fresh' : 'imported',
      selectedSource: presentation.officialSource === undefined && presentation.communitySource !== undefined ? 'community' : 'official',
      officialSource: presentation.officialSource?.path ?? '',
      officialDefaultSource: presentation.officialSource?.path ?? '',
      officialSourceCandidate: presentation.officialSourceCandidate,
      officialSourceStatus: presentation.officialSourceUnreadable
        ? 'unreadable' : presentation.officialSource === undefined ? 'missing' : 'valid',
      communitySource: presentation.communitySource?.path ?? '',
      communityDefaultSource: presentation.communitySource?.path ?? '',
      communitySourceCandidate: presentation.communitySourceCandidate,
      communitySourceStatus: presentation.communitySourceUnreadable
        ? 'unreadable' : presentation.communitySource === undefined ? 'missing' : 'valid',
      defaultTarget: presentation.defaultTarget,
      development: app.isPackaged ? 'false' : 'true',
      returnToMain: presentation.returnToMain ? 'true' : 'false',
      defaultTargetAvailable: presentation.defaultTargetAvailable ? 'true' : 'false',
      hostPlatform: process.platform,
      hostArchitecture: process.arch,
      hostOsVersion: release(),
    } }).catch(fail)
  })
}

async function prepareDesktopDshHome(): Promise<string> {
  const copy = dataHomeCopy()
  try {
    const result = await desktopDataHomes.initialize(async (session) => {
      return showDataHomeChooser(session)
    })
    if (result.copied) {
      await dialog.showMessageBox({
        type: 'info', title: copy.completeTitle, message: copy.completeMessage,
        detail: result.path, buttons: ['OK'], noLink: true,
      })
    }
    return result.path
  } catch (error) {
    if (!(error instanceof DesktopDataHomeSelectionCancelledError)) {
      dialog.showErrorBox(copy.failedTitle, error instanceof Error ? error.message : String(error))
    }
    throw error
  }
}

function applyLaunchAtLogin(enabled: boolean): void {
  if (!desktopCapabilities().launchAtLoginAvailable) return
  app.setLoginItemSettings({ openAtLogin: enabled })
}

function publishPreferences(): void {
  mainSurface?.send(DESKTOP_IPC.preferencesChanged, preferences)
  refreshTrayMenu()
}

function publishDesktopWebStatus(status: DesktopWebStatus): void {
  mainSurface?.send(DESKTOP_IPC.webStatus, status)
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
  failure?: HarnessFailure & { logPath: string } & Partial<RecoveryFailureSummary>,
  mode?: 'shutdown',
): void {
  if (mainSurface === undefined || mainSurface.window.isDestroyed() || state === 'ready' || state === 'stopped') return
  if (failure !== undefined) {
    latestRecoveryFailure = failure.message
    latestRecoveryDiagnostic = failure.diagnosticCode === undefined ? undefined : {
      diagnosticCode: failure.diagnosticCode,
      ...(failure.nativeCode === undefined ? {} : { nativeCode: failure.nativeCode }),
      ...(failure.packageName === undefined ? {} : { packageName: failure.packageName }),
      ...(failure.entryId === undefined ? {} : { entryId: failure.entryId }),
      ...(failure.moduleName === undefined ? {} : { moduleName: failure.moduleName }),
      ...(failure.evidence === undefined ? {} : { evidence: failure.evidence }),
    }
  }
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
      ...(failure === undefined ? {} : {
        message: failure.message,
        logPath: failure.logPath,
        ...(failure.diagnosticCode === undefined ? {} : { diagnosticCode: failure.diagnosticCode }),
        ...(failure.nativeCode === undefined ? {} : { nativeCode: failure.nativeCode }),
        ...(failure.packageName === undefined ? {} : { packageName: failure.packageName }),
        ...(failure.entryId === undefined ? {} : { entryId: failure.entryId }),
        ...(failure.moduleName === undefined ? {} : { moduleName: failure.moduleName }),
        ...(failure.evidence === undefined ? {} : { evidence: failure.evidence }),
      }),
    },
  }).catch((error: unknown) => {
    // A newer loading stage or the ready page can supersede this navigation.
    if (error instanceof Error && 'code' in error && error.code === 'ERR_ABORTED') return
    console.error('desktop: loading page navigation failed', error)
  })
}

async function loadAuthenticatedHarness(surface: DesktopWindowSurface, url: string): Promise<void> {
  const expectedOrigin = new URL(url).origin
  if (mainSurface !== surface || surface.window.isDestroyed() || harnessOrigin !== expectedOrigin) return
  try {
    const removed = await clearStaleHarnessAuthCookies(surface.renderer.session.cookies, url)
    if (removed > 0) await appendDesktopStartupLog(`Removed ${removed} stale Harness authentication cookie(s).`)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.warn('desktop: could not clear stale Harness authentication cookies', error)
    await appendDesktopStartupLog(`Could not clear stale Harness authentication cookies: ${detail}`)
  }
  if (mainSurface !== surface || surface.window.isDestroyed() || harnessOrigin !== expectedOrigin) return
  await surface.loadURL(withDesktopWindowMetadata(url, process.platform))
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
    if (bootNasRuntime() !== undefined && permission !== 'notifications') return false
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
    if (bootNasRuntime() !== undefined && permission !== 'notifications') {
      callback(false)
      return
    }
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
    additionalArguments: [
      app.isPackaged ? '--dsh-packaged' : '--dsh-source',
      ...(bootNasRuntime() === undefined ? [] : ['--dsh-nas-runtime']),
    ],
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
  surface.renderer.session.webRequest.onCompleted({ urls: ['http://127.0.0.1/*', 'https://*/*'] }, (details) => {
    if (details.webContentsId !== surface.renderer.id || details.resourceType !== 'mainFrame'
      || details.statusCode < 400 || lifecycle?.isQuitting === true || harnessOrigin === undefined) return
    let responseOrigin: string
    try { responseOrigin = new URL(details.url).origin } catch { return }
    if (responseOrigin !== harnessOrigin) return
    const evidence = `HTTP ${details.statusCode}`
    void appendDesktopStartupLog(`Harness main page failed with ${evidence}; showing recovery controls.`)
    showLoading('failed', {
      message: shellMessages(app.getLocale()).harnessHttpFailed(details.statusCode),
      diagnosticCode: 'desktop.harness-http-response',
      nativeCode: `HTTP_${details.statusCode}`,
      evidence,
      logPath: harnessLogPath,
    })
  })
  surface.renderer.on('page-title-updated', (_event, title) => {
    surface.sendTitlebar('dsh:window:title', desktopWindowTitle(title))
  })
  if (surface.titlebarRenderer !== undefined) {
    const syncTitlebarState = (): void => {
      surface.layout()
      surface.sendTitlebar('dsh:window:maximized', window.isMaximized())
      surface.sendTitlebar('dsh:window:title', desktopWindowTitle(surface.renderer.getTitle()))
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
  desktopShortcuts?.attach(window)
  applicationMenu?.attach(surface)
  applicationMenu?.refresh()
  const refreshMenu = (): void => { applicationMenu?.refresh() }
  window.on('maximize', refreshMenu)
  window.on('unmaximize', refreshMenu)
  window.on('enter-full-screen', refreshMenu)
  window.on('leave-full-screen', refreshMenu)
  surface.titlebarRenderer?.on('did-finish-load', () => { applicationMenu?.refresh() })
  const rendererId = surface.renderer.id
  surface.renderer.on('destroyed', () => {
    iconManager?.discardOwner(rendererId)
    menuClientAvailable = false
    menuClientReady = false
    rejectPendingMenuCommands()
    applicationMenu?.refresh()
  })
  surface.renderer.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) {
      iconManager?.discardOwner(rendererId)
      menuClientAvailable = false
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
  desktopShortcuts = installDesktopShortcuts(
    () => mainWindow, () => mainSurface?.renderer,
    (rawUrl) => {
      if (harnessOrigin === undefined) return false
      try { return new URL(rawUrl).origin === new URL(harnessOrigin).origin } catch { return false }
    },
    app.getPath('userData'), process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux',
    () => { applicationMenu?.refresh() },
    () => ({ revision: 0, blocked: false }),
  )
  desktopLocaleStore = createDesktopLocaleStore(join(app.getPath('userData'), 'desktop-locale.json'))
  menuLocale = desktopLocaleStore.read(app.getLocale())
  applicationMenu = new ApplicationMenuController({
    surface: () => mainSurface,
    state: () => ({ platform: process.platform, locale: menuLocale,
      clientAvailable: menuClientAvailable && harnessOrigin !== undefined,
      ready: menuClientReady && harnessOrigin !== undefined,
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
      notify: status => mainSurface?.send(DESKTOP_IPC.iconsStatus, status),
    })
  }
  applyStartupDockIcon()
  const nasRuntimeStore = new NasRuntimeStore(
    join(app.getPath('userData'), 'nas-runtimes-v1.json'),
    join(app.getPath('userData'), 'nas-device-credentials-v1.json'),
    {
      available: safeStorage.isEncryptionAvailable(),
      seal: value => safeStorage.encryptString(value).toString('base64'),
      open: value => safeStorage.decryptString(Buffer.from(value, 'base64')),
    },
    (error) => { console.error('desktop: could not read NAS runtime settings', error) },
  )
  const nasRuntimeClient = new NasRuntimeClient(async (url, init) => net.fetch(url, init))
  const authority = new DesktopNasRuntimeAuthority({
    store: nasRuntimeStore,
    network: {
      discover: discoverNasRuntimes,
      inspectCertificate: inspectNasCertificate,
      health: (baseUrl, token) => nasRuntimeClient.health(baseUrl, token),
      pair: request => nasRuntimeClient.pair(request),
      devices: (baseUrl, token) => nasRuntimeClient.devices(baseUrl, token),
      revokeDevice: (baseUrl, token, deviceId) => nasRuntimeClient.revokeDevice(baseUrl, token, deviceId),
    },
    connection: {
      capture: () => {
        const surface = mainSurface
        if (surface === undefined) return undefined
        return {
          isCurrent: runtime => !surface.window.isDestroyed() && mainSurface === surface
            && bootNasRuntime()?.id === runtime.id,
          load: baseUrl => surface.loadURL(withDesktopWindowMetadata(baseUrl, process.platform)),
        }
      },
      begin: (runtime) => {
        harnessOrigin = runtime.baseUrl
        harnessAuthenticationUrl = undefined
        reportedDesktopReadiness.clear()
        publishStartupProgress({ stage: 'starting-harness', progress: 72, detail: 'connecting-nas' })
        showLoading('starting')
      },
      ready: () => { publishStartupProgress({ stage: 'ready', progress: 100, detail: 'nas-ready' }) },
      fail: async (runtime, error) => {
        await appendDesktopStartupLog(`NAS connection failed: ${error.message}`)
        showLoading('failed', {
          message: error.message,
          diagnosticCode: 'desktop.nas-connection-failed',
          evidence: runtime.baseUrl,
          logPath: harnessLogPath,
        })
      },
    },
    lifecycle: {
      stopActiveProfileServices: stopPersistentServicesForActiveProfile,
      restartAfter: (delayMs) => { setTimeout(requestDesktopRestart, delayMs) },
    },
    publishStatus: status => mainSurface?.send(DESKTOP_IPC.nasStatus, status),
  })
  nasRuntimeAuthority = authority
  const activeNasRuntime = bootNasRuntime()
  // A saved NAS selection is a complete runtime choice. Do not force a new device
  // through local Profile import or mutate its local Harness home before connecting.
  const dshHome = activeNasRuntime === undefined
    ? await prepareDesktopDshHome()
    : DESKTOP_DATA_HOME.dshHome
  const dataHomeSetup = activeNasRuntime === undefined
    ? await readDesktopDataHomeSetup(DESKTOP_DATA_HOME.setupFile)
    : undefined
  if (activeNasRuntime === undefined) await applyFreshProfileDefaults(dshHome, dataHomeSetup)
  // Releases before the portable community import copied the complete Profile and did not write a
  // restore plan. Keep those deployments intact; new copies carry a plan and use normal first-start
  // preparation so packaged presets come from local archives before optional plugin restoration.
  const preserveCopiedPlugins = shouldPreserveLegacyCopiedProfile(dataHomeSetup)
  activeMenuHome = activeNasRuntime === undefined ? dshHome : undefined
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
    versions: Pick<StartupDiagnosticIncident, 'recordedVersion' | 'actualVersion' | 'targetVersion'> = {},
  ): Promise<void> => {
    startupWarnings.push(`${code}: ${packageName ?? operation}`)
    await recordStartupDiagnostic(dshHome, {
      code, operation, actions,
      ...(packageName === undefined ? {} : { packageName }),
      ...versions,
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
    ...(app.isPackaged ? { DSH_PROFILE_RESOLUTION_MODE: 'runtime' } : {}),
    DSH_PROFILE_DIAGNOSTIC_MODE_ON_FAILURE: '1',
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
  preferencesStore = createDesktopPreferencesStore(
    join(app.getPath('userData'), 'desktop-preferences.json'),
    (error) => { console.error('desktop: could not read preferences; using defaults', error) },
  )
  preferences = preferencesStore.read()
  app.on('certificate-error', (event, _webContents, url, _error, certificate, callback) => {
    if (authority.acceptsCertificate(url, certificate.fingerprint)) {
      event.preventDefault()
      callback(true)
      return
    }
    callback(false)
  })
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://*/*', 'wss://*/*'] }, (details, callback) => {
    callback({
      requestHeaders: authority.authorizeRequestHeaders(details.url, details.requestHeaders),
    })
  })
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
  app.on('login', (event, _webContents, _details, authInfo, callback) => {
    if (!authInfo.isProxy || downloadNetworkProxy === undefined) return
    const credentials = downloadNetworkProxy.credentialsForProxyAuth(authInfo.host, authInfo.port)
    if (credentials === undefined) return
    event.preventDefault()
    callback(credentials.username, credentials.password)
  })
  const publishDownloadNetworkTest = (status: DownloadNetworkTestStatus): DownloadNetworkTestStatus => {
    downloadNetworkTestStatus = status
    mainSurface?.send(DESKTOP_IPC.downloadNetworkTestStatus, status)
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
          ? `${settings === undefined ? 'https://registry.npmmirror.com' : settings.npm.registry === 'npmmirror'
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
      mainSurface?.send(DESKTOP_IPC.releaseStatus, status)
    })
    releaseDownloader.subscribe((status) => { mainSurface?.send(DESKTOP_IPC.releaseDownloadStatus, status) })
    stopReleaseChecks = releaseChecker.startPolling()
  }
  await configureReleaseServices()
  externalToolCompatibility = new ExternalToolCompatibilityManager({
    cacheDirectory: join(app.getPath('userData'), 'external-tool-compatibility'),
    desktopVersion: app.getVersion(),
  })
  const workspaceRuntimeCatalog = new WorkspaceRuntimeCatalog({
    cacheDirectory: join(app.getPath('userData'), 'optional-runtimes', 'catalog'),
    desktopVersion: app.getVersion(),
    fetch: async (input, init) => (await applicationFetch())(input, init),
    development: !app.isPackaged,
    metadataBaseUrls: () => {
      const tag = `odsh-v${app.getVersion()}`
      const github = `https://github.com/flaqai/open-deepseek-harness-desktop/releases/download/${tag}`
      const cnb = `https://cnb.cool/hecoococ/open-deepseek-harness-desktop/-/releases/download/${tag}`
      return downloadNetworkStore?.read().application.source === 'cnb' ? [cnb, github] : [github, cnb]
    },
    ...(!app.isPackaged && process.env.DSH_WORKSPACE_RUNTIME_MANIFEST_BASE_URL !== undefined
      ? { metadataBaseUrl: process.env.DSH_WORKSPACE_RUNTIME_MANIFEST_BASE_URL }
      : {}),
  })
  const nativeWorkspaceTarget = workspaceRuntimeTarget(process.platform, process.arch)
  const bundledWorkspaceRuntimeRoot = app.isPackaged
    ? join(process.resourcesPath, 'workspace-runtime')
    : join(fileURLToPath(new URL('../../..', import.meta.url)), '.artifacts', 'workspace-runtime')
  workspaceRuntimeManager = new OptionalRuntimeManager({
    cacheRoot: join(app.getPath('userData'), 'optional-runtimes'),
    stateFile: join(app.getPath('userData'), 'optional-runtimes', 'state-v1.json'),
    desktopVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    getHome: () => dshHome,
    isNas: () => bootNasRuntime() !== undefined,
    source: () => downloadNetworkStore?.read().application.source ?? 'github',
    loadManifest: async () => {
      if (nativeWorkspaceTarget !== undefined) {
        try {
          return await loadBundledWorkspaceRuntimeManifest(bundledWorkspaceRuntimeRoot, nativeWorkspaceTarget, app.getVersion())
        } catch (error) {
          if (app.isPackaged) throw error
        }
      }
      return workspaceRuntimeCatalog.load()
    },
    fetch: async (input, init) => (await applicationFetch())(input, init),
    bundledArtifactsRoot: bundledWorkspaceRuntimeRoot,
    requireBundledPython: app.isPackaged,
    ...(nativeWorkspaceTarget === undefined ? {} : { target: nativeWorkspaceTarget }),
  })
  ipcMain.handle(DESKTOP_IPC.capabilities, (event) => {
    assertMainRenderer(event.sender)
    return desktopCapabilities()
  })
  ipcMain.handle(DESKTOP_IPC.directoryPick, async (event): Promise<string | null> => {
    assertMainRenderer(event.sender)
    if (bootNasRuntime() !== undefined) throw new Error('desktop: local directory picker is unavailable in NAS mode')
    const surface = mainSurface
    if (surface === undefined || surface.window.isDestroyed()) {
      throw new Error('desktop: main window is unavailable')
    }
    const result = await dialog.showOpenDialog(surface.window, { properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  ipcMain.handle(DESKTOP_IPC.processesList, (event) => {
    assertMainRenderer(event.sender)
    return processObserver?.list() ?? []
  })
  ipcMain.handle(DESKTOP_IPC.processesStop, async (event, id: unknown) => {
    assertMainRenderer(event.sender)
    if (typeof id !== 'string' || id.length < 1 || id.length > 128) {
      throw new TypeError('desktop: invalid managed process id')
    }
    const current = processObserver?.list().find(process => process.id === id)
    if (current === undefined || !current.stoppable) throw new Error('desktop: process cannot be stopped from settings')
    await processObserver?.stop(id)
    return processObserver?.list() ?? []
  })
  ipcMain.handle(DESKTOP_IPC.persistentServicesList, (event): readonly PersistentServiceSummary[] => {
    assertMainRenderer(event.sender)
    return persistentServiceAuthority?.list() ?? []
  })
  ipcMain.handle(DESKTOP_IPC.persistentServicesApprove, (event, key: unknown): readonly PersistentServiceSummary[] => {
    assertMainRenderer(event.sender)
    if (typeof key !== 'string' || !/^[a-f0-9]{64}$/u.test(key)) {
      throw new TypeError('desktop: invalid persistent service request')
    }
    if (persistentServiceAuthority === undefined) throw new Error('desktop: persistent service authority is unavailable')
    return persistentServiceAuthority.approve(key)
  })
  ipcMain.handle(DESKTOP_IPC.persistentServicesRevoke, async (event, key: unknown): Promise<readonly PersistentServiceSummary[]> => {
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
  ipcMain.handle(DESKTOP_IPC.persistentServicesPreparePluginUninstall, async (event, packageName: unknown) => {
    assertMainRenderer(event.sender)
    if (!isRecoveryPluginPackageName(packageName)) throw new TypeError('desktop: invalid plugin identity')
    await stopAndRevokePersistentServicesForPlugin(packageName)
    return { prepared: true as const }
  })
  ipcMain.handle(DESKTOP_IPC.dataHomeGet, (event) => {
    assertMainRenderer(event.sender)
    return desktopDataHomes.status(dshHome)
  })
  let runningDataHomeChooser: Promise<{ restarting: boolean }> | undefined
  ipcMain.handle(DESKTOP_IPC.dataHomeOpenChooser, (event): Promise<{ restarting: boolean }> => {
    assertMainRenderer(event.sender)
    if (DESKTOP_DATA_HOME.explicitDshHome) {
      throw new Error('desktop: DSH_HOME is managed by the launch environment')
    }
    if (runningDataHomeChooser !== undefined) {
      if (dataHomeChooserWindow !== undefined && !dataHomeChooserWindow.isDestroyed()) {
        dataHomeChooserWindow.show()
        dataHomeChooserWindow.focus()
      }
      return runningDataHomeChooser
    }
    const operation = (async (): Promise<{ restarting: boolean }> => {
      const surface = mainSurface
      if (surface === undefined) throw new Error('desktop: main window is unavailable')
      try {
        const result = await desktopDataHomes.change(
          dshHome,
          session => showDataHomeChooser(session, surface.window),
        )
        return { restarting: result.restarting }
      } catch (error) {
        if (error instanceof DesktopDataHomeSelectionCancelledError) {
          if (!surface.window.isDestroyed()) {
            surface.window.show()
            surface.window.focus()
          }
          return { restarting: false }
        }
        throw error
      }
    })()
    runningDataHomeChooser = operation
    const clearOperation = (): void => {
      if (runningDataHomeChooser === operation) runningDataHomeChooser = undefined
    }
    void operation.then(clearOperation, clearOperation)
    return operation
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
    return desktopDataHomes.chooseDirectory(
      event.sender.id,
      selectionKind,
      result.canceled ? undefined : result.filePaths[0],
    )
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
    return desktopDataHomes.chooseRecoveryDirectory(
      event.sender.id,
      result.canceled ? undefined : result.filePaths[0],
    )
  })
  ipcMain.handle('dsh:desktop:data-home:switch', async (
    event,
    request: unknown,
  ): Promise<DesktopDataHomeSwitchResult> => {
    assertMainRenderer(event.sender)
    return desktopDataHomes.switch(dshHome, event.sender.id, request)
  })
  ipcMain.handle(DESKTOP_IPC.preferencesGet, (event) => {
    assertMainRenderer(event.sender)
    return preferences
  })
  const requireIcons = (sender: WebContents): DesktopIconManager => {
    assertMainRenderer(sender)
    if (iconManager === undefined) throw new Error('icon.unsupported')
    return iconManager
  }
  ipcMain.handle(DESKTOP_IPC.iconsGet, event => requireIcons(event.sender).status())
  ipcMain.handle(DESKTOP_IPC.iconsChoose, async (event) => {
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
  ipcMain.handle(DESKTOP_IPC.iconsDiscard, (event, id: unknown) => {
    requireIcons(event.sender).discard(event.sender.id, id)
  })
  ipcMain.handle(DESKTOP_IPC.iconsApply, (event, id: unknown, target: unknown, crop: unknown) => {
    return requireIcons(event.sender).apply(event.sender.id, id, target, crop)
  })
  ipcMain.handle(DESKTOP_IPC.iconsFollow, (event, follow: unknown) => requireIcons(event.sender).followTray(follow))
  ipcMain.handle(DESKTOP_IPC.iconsReset, (event, target: IconTarget) => requireIcons(event.sender).reset(target))
  ipcMain.handle(DESKTOP_IPC.iconsRepair, event => requireIcons(event.sender).refresh(true))
  ipcMain.handle(DESKTOP_IPC.iconsCreateShortcut, (event) => {
    const manager = requireIcons(event.sender)
    if (!app.isPackaged || process.platform !== 'win32') throw new Error('icon.unsupported')
    return manager.refresh(true, true)
  })
  ipcMain.handle(DESKTOP_IPC.preferencesUpdate, (event, patch: unknown) => {
    assertMainRenderer(event.sender)
    return updatePreferences(patch)
  })
  registerNasRuntimeIpc(ipcMain, { authority, assertRenderer: assertMainRenderer })
  ipcMain.handle(DESKTOP_IPC.downloadNetworkGet, (event): DownloadNetworkSettings => {
    assertMainRenderer(event.sender)
    if (downloadNetworkStore === undefined) throw new Error('desktop: download network settings are unavailable')
    return downloadNetworkStore.read()
  })
  ipcMain.handle(DESKTOP_IPC.downloadNetworkUpdate, async (event, patch: unknown): Promise<DownloadNetworkSettings> => {
    assertMainRenderer(event.sender)
    if (downloadNetworkStore === undefined || downloadNetworkProxy === undefined) throw new Error('desktop: download network settings are unavailable')
    const previous = downloadNetworkStore.read()
    const next = downloadNetworkStore.update(patch)
    delete harnessEnvironment.npm_config_registry
    Object.assign(harnessEnvironment, pluginDownloadEnvironment(downloadNetworkStore, downloadNetworkProxy.pluginUrl))
    mainSurface?.send(DESKTOP_IPC.downloadNetworkChanged, next)
    if (previous.application.source !== next.application.source
      || JSON.stringify(previous.application.proxy) !== JSON.stringify(next.application.proxy)) {
      await configureReleaseServices()
      mainSurface?.send(DESKTOP_IPC.releaseStatus, releaseChecker?.status ?? { phase: 'unsupported' })
      mainSurface?.send(DESKTOP_IPC.releaseDownloadStatus, releaseDownloader?.status ?? { phase: 'unsupported' })
    }
    return next
  })
  ipcMain.handle(DESKTOP_IPC.downloadNetworkReset, async (event, target: unknown): Promise<DownloadNetworkSettings> => {
    assertMainRenderer(event.sender)
    if (!['application', 'npm', 'github'].includes(String(target))) throw new TypeError('desktop: invalid download network target')
    if (downloadNetworkStore === undefined || downloadNetworkProxy === undefined) throw new Error('desktop: download network settings are unavailable')
    const next = downloadNetworkStore.reset(target as DownloadNetworkTarget)
    delete harnessEnvironment.npm_config_registry
    Object.assign(harnessEnvironment, pluginDownloadEnvironment(downloadNetworkStore, downloadNetworkProxy.pluginUrl))
    mainSurface?.send(DESKTOP_IPC.downloadNetworkChanged, next)
    if (target === 'application') await configureReleaseServices()
    return next
  })
  ipcMain.handle(DESKTOP_IPC.downloadNetworkTestGet, (event): DownloadNetworkTestStatus => {
    assertMainRenderer(event.sender); return downloadNetworkTestStatus
  })
  ipcMain.handle(DESKTOP_IPC.downloadNetworkTest, (event, target: unknown) => {
    assertMainRenderer(event.sender)
    if (!['application', 'npm', 'github'].includes(String(target))) throw new TypeError('desktop: invalid download network test target')
    return testDownloadNetwork(target as DownloadNetworkTarget)
  })
  ipcMain.handle(DESKTOP_IPC.webGet, (event) => {
    assertMainRenderer(event.sender)
    return desktopWebAccess?.status() ?? { phase: 'starting' }
  })
  ipcMain.handle(DESKTOP_IPC.webOpen, async (event) => {
    assertMainRenderer(event.sender)
    if (desktopWebAccess === undefined) throw new Error('desktop: local Web interface is unavailable')
    return desktopWebAccess.open()
  })
  ipcMain.handle(DESKTOP_IPC.chatBackgroundRead, (event) => {
    assertMainRenderer(event.sender)
    return chatBackgroundStore?.read()
  })
  ipcMain.handle(DESKTOP_IPC.chatBackgroundWrite, (event, background: unknown) => {
    assertMainRenderer(event.sender)
    if (chatBackgroundStore === undefined) throw new Error('desktop: chat background store is unavailable')
    return chatBackgroundStore.write(background)
  })
  ipcMain.handle(DESKTOP_IPC.logOpen, (event) => {
    assertMainRenderer(event.sender)
    return openHarnessLog()
  })
  ipcMain.handle(DESKTOP_IPC.logDirectoryOpen, async (event): Promise<{ error: string }> => {
    assertMainRenderer(event.sender)
    await mkdir(DESKTOP_DATA_HOME.logs, { recursive: true, mode: 0o700 })
    return { error: await shell.openPath(DESKTOP_DATA_HOME.logs) }
  })
  ipcMain.handle(DESKTOP_IPC.settingsOpen, async (event): Promise<{ error: string }> => {
    assertMainRenderer(event.sender)
    return openSettingsDocument()
  })
  ipcMain.handle(DESKTOP_IPC.settingsReset, async (event): Promise<{ backupName?: string; restarting: true }> => {
    assertMainRenderer(event.sender)
    const { backupName } = await backupAndResetDesktopSettings(dshHome)
    setTimeout(() => { requestDesktopRestart() }, 250)
    return { ...(backupName === undefined ? {} : { backupName }), restarting: true }
  })
  ipcMain.handle(DESKTOP_IPC.cliGet, async (event): Promise<DesktopCliStatus> => {
    assertMainRenderer(event.sender)
    if (desktopCliManager === undefined) throw new Error('desktop: command-line manager is unavailable')
    return desktopCliManager.getStatus()
  })
  ipcMain.handle(DESKTOP_IPC.cliInstall, async (event, force: unknown): Promise<DesktopCliStatus> => {
    assertMainRenderer(event.sender)
    if (typeof force !== 'boolean') throw new TypeError('desktop: invalid command-line conflict confirmation')
    if (desktopCliManager === undefined) throw new Error('desktop: command-line manager is unavailable')
    return desktopCliManager.install(force)
  })
  ipcMain.handle(DESKTOP_IPC.cliRemove, async (event): Promise<DesktopCliStatus> => {
    assertMainRenderer(event.sender)
    if (desktopCliManager === undefined) throw new Error('desktop: command-line manager is unavailable')
    return desktopCliManager.remove()
  })
  ipcMain.handle('dsh:desktop:startup-progress:get', (event): DesktopStartupProgress => {
    assertMainRenderer(event.sender)
    return startupProgress
  })
  ipcMain.on(DESKTOP_IPC.themeSource, (event, source: unknown) => {
    assertMainRenderer(event.sender)
    if (!isDesktopThemeSource(source)) throw new TypeError('desktop: invalid theme source')
    applyDesktopThemeSource(source)
  })
  ipcMain.on(DESKTOP_IPC.readiness, (event, phase: unknown) => {
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
      profileMutation?.observeHarness({ type: 'diagnostic-ready' })
      void appendDesktopStartupLog('Diagnostic Profile readiness does not verify the active Profile or its plugin snapshots.')
      if (phase === 'client') void pluginSnapshotManager?.handleHarnessFailure(
        'The active Profile failed to start; only the installation-owned diagnostic Profile became ready.',
      ).catch((error: unknown) => {
        console.error('desktop: snapshot rollback after diagnostic fallback failed', error)
      })
      return
    }
    const readinessComplete = reportedDesktopReadiness.size === 2
    if (readinessComplete) profileMutation?.observeHarness({ type: 'normal-ready' })
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
  ipcMain.on(DESKTOP_IPC.clientBootFailure, (event, payload: unknown) => {
    assertMainRenderer(event.sender)
    const failure = parseClientBootFailure(payload)
    if (failure === undefined || harnessOrigin === undefined || lifecycle?.isQuitting === true
      || supervisor?.isDiagnosticMode === true || event.senderFrame === null) return
    let rendererOrigin: string
    try { rendererOrigin = new URL(event.senderFrame.url).origin } catch { return }
    if (rendererOrigin !== harnessOrigin || reportedClientBootFailureOrigin === harnessOrigin) return
    reportedClientBootFailureOrigin = harnessOrigin
    cancelBootableSnapshot()
    void appendDesktopStartupLog(
      `Client plugin tree failed before readiness (${failure.diagnosticCode}; ${failure.nativeCode ?? 'unknown'}).`,
    )
    profileMutation?.observeHarness({
      type: 'failed', error: new Error(failure.evidence ?? 'desktop: client plugin tree failed before readiness'),
    })
    showLoading('failed', {
      message: shellMessages(app.getLocale()).clientPluginBootFailed,
      ...failure,
      logPath: harnessLogPath,
    })
    showNotification('failed', notificationCopy.failed)
  })
  ipcMain.handle(DESKTOP_IPC.releasesGet, (event): DesktopReleaseStatus => {
    assertMainRenderer(event.sender)
    return releaseChecker?.status ?? { phase: 'unsupported' }
  })
  ipcMain.handle(DESKTOP_IPC.releasesCheck, (event) => {
    assertMainRenderer(event.sender)
    return releaseChecker?.check() ?? Promise.resolve({ phase: 'unsupported' } satisfies DesktopReleaseStatus)
  })
  ipcMain.handle(DESKTOP_IPC.releasesOpen, async (event, releaseUrl: unknown) => {
    assertMainRenderer(event.sender)
    if (typeof releaseUrl !== 'string' || (!isAllowedReleaseUrl(releaseUrl) && !isAllowedCnbUrl(releaseUrl))) {
      throw new TypeError('desktop: invalid Release URL')
    }
    return { error: await shell.openExternal(releaseUrl).then(() => '') }
  })
  ipcMain.handle(DESKTOP_IPC.releasesDownloadGet, (event): DesktopReleaseDownloadStatus => {
    assertMainRenderer(event.sender)
    return releaseDownloader?.status ?? { phase: 'unsupported' }
  })
  ipcMain.handle(DESKTOP_IPC.releasesDownloadStart, async (event) => {
    assertMainRenderer(event.sender)
    if (releaseChecker === undefined || releaseDownloader === undefined) {
      return { phase: 'unsupported' } satisfies DesktopReleaseDownloadStatus
    }
    await releaseChecker.check()
    return releaseDownloader.start()
  })
  ipcMain.handle(DESKTOP_IPC.releasesDownloadCancel, (event): DesktopReleaseDownloadStatus => {
    assertMainRenderer(event.sender)
    return releaseDownloader?.cancel() ?? { phase: 'unsupported' }
  })
  ipcMain.handle(DESKTOP_IPC.releasesDownloadOpen, (event) => {
    assertMainRenderer(event.sender)
    return releaseDownloader?.open() ?? Promise.resolve({ error: 'Release downloads are unavailable.' })
  })
  ipcMain.handle(DESKTOP_IPC.sourceUpdateCheck, (event) => {
    assertMainRenderer(event.sender)
    return updater.check()
  })
  ipcMain.handle(DESKTOP_IPC.sourceUpdateUpgrade, (event, expectedCommit: unknown) => {
    assertMainRenderer(event.sender)
    if (typeof expectedCommit !== 'string' || !/^[0-9a-f]{40}$/u.test(expectedCommit)) {
      throw new TypeError('desktop: invalid expected update commit')
    }
    return updater.upgrade(expectedCommit)
  })
  ipcMain.handle(DESKTOP_IPC.sourceUpdateRestart, (event) => {
    assertMainRenderer(event.sender)
    setTimeout(() => {
      requestDesktopRestart()
    }, 250)
    return { restarting: true as const }
  })
  ipcMain.handle(DESKTOP_IPC.restart, (event) => {
    assertMainRenderer(event.sender)
    setTimeout(() => {
      requestDesktopRestart()
    }, 250)
    return { restarting: true as const }
  })
  ipcMain.handle(DESKTOP_IPC.recoveryEnter, (event) => {
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
    if (activeMenuHome === undefined || profileMutation === undefined) throw new Error('desktop: active Profile is unavailable')
    return profileMutation.readRecovery(activeMenuHome, readRecoveryPluginInventory)
  })
  ipcMain.handle('dsh:desktop:recovery-plugins:remove', async (event, packageName: unknown) => {
    assertMainRenderer(event.sender)
    if (!isRecoveryPluginPackageName(packageName)) throw new TypeError('desktop: invalid recovery plugin identity')
    if (activeMenuHome === undefined || profileMutation === undefined) {
      throw new Error('desktop: recovery plugin removal is not ready')
    }
    const inventory = await profileMutation.readRecovery(activeMenuHome, readRecoveryPluginInventory)
    if (!inventory.plugins.some(plugin => plugin.packageName === packageName)) {
      throw new Error('desktop: recovery plugin is not a direct removable dependency')
    }
    await profileMutation.stageRecovery({
      operation: `recovery-plugin-remove:${packageName}`,
      run: async (context) => {
        await stopAndRevokePersistentServicesForPlugin(packageName)
        await appendDesktopStartupLog(`Recovery mode is removing external plugin ${packageName}.`)
        await context.write({
          kind: 'remove', packageName, operation: `recovery-plugin-remove:${packageName}`,
          timeoutMs: BUNDLED_PLUGIN_INSTALL_TIMEOUT_MS,
        })
        await appendDesktopStartupLog(`Recovery mode removed external plugin ${packageName}.`)
      },
    })
    return profileMutation.readRecovery(activeMenuHome, readRecoveryPluginInventory)
  })
  ipcMain.handle('dsh:desktop:recovery:export', async (event) => {
    assertMainRenderer(event.sender)
    if (activeMenuHome === undefined) throw new Error('desktop: active Profile is unavailable')
    const surface = mainSurface
    if (surface === undefined) throw new Error('desktop: main window is unavailable')
    const inventory = await readRecoveryPluginInventory(activeMenuHome)
    const moduleFallbackLock = await inspectModuleFallbackLock(activeMenuHome).catch(() => ({ state: 'unavailable' as const }))
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
        ...(latestRecoveryDiagnostic === undefined ? {} : {
          diagnostic: {
            ...latestRecoveryDiagnostic,
            ...(latestRecoveryDiagnostic.evidence === undefined
              ? {} : { evidence: redact(latestRecoveryDiagnostic.evidence) }),
          },
        }),
      },
      moduleFallbackLock,
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
  ipcMain.handle('dsh:desktop:module-fallback-lock:get', async (event) => {
    assertMainRenderer(event.sender)
    if (activeMenuHome === undefined) throw new Error('desktop: active Profile is unavailable')
    return inspectModuleFallbackLock(activeMenuHome)
  })
  ipcMain.handle('dsh:desktop:module-fallback-lock:clear', async (event) => {
    assertMainRenderer(event.sender)
    if (activeMenuHome === undefined) throw new Error('desktop: active Profile is unavailable')
    return clearDeadModuleFallbackLock(activeMenuHome)
  })
  ipcMain.handle('dsh:desktop:recovery:exit', async (event) => {
    assertMainRenderer(event.sender)
    if (profileMutation?.hasRecoveryCandidate === true) await profileMutation.settleRecovery('discard')
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
    if (bootNasRuntime() !== undefined) {
      try {
        await authority.connectSelected()
        return { started: true }
      } catch {
        return { started: false }
      }
    }
    await profileMutation?.settleRecovery('activate')
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
      harnessAuthenticationUrl = undefined
      return { started: supervisor.resume() }
    }
    const started = supervisor?.retry() ?? false
    if (!started && harnessOrigin !== undefined && mainSurface !== undefined && !mainSurface.window.isDestroyed()) {
      const retryUrl = harnessAuthenticationUrl
      if (retryUrl === undefined || new URL(retryUrl).origin !== harnessOrigin) {
        void mainSurface.loadURL(withDesktopWindowMetadata(harnessOrigin, process.platform))
      } else {
        void loadAuthenticatedHarness(mainSurface, retryUrl).catch((error: unknown) => {
          console.error('desktop: Harness authentication retry failed', error)
        })
      }
    }
    return { started }
  })
  ipcMain.handle('dsh:harness:open-logs', (event) => {
    assertMainRenderer(event.sender)
    return openHarnessLog()
  })
  ipcMain.handle(DESKTOP_IPC.bundledPluginsStart, (event, request: unknown): BundledPluginStartResult => {
    assertMainRenderer(event.sender)
    if (request === null || typeof request !== 'object') throw new TypeError('desktop: invalid bundled plugin request')
    const { profile, packageSpec } = request as { profile?: unknown; packageSpec?: unknown }
    if (typeof profile !== 'string' || typeof packageSpec !== 'string') {
      throw new TypeError('desktop: invalid bundled plugin request')
    }
    return bundledPluginInstaller?.startManual(profile, packageSpec) ?? { handled: false }
  })
  ipcMain.handle(DESKTOP_IPC.externalToolsResolve, async (event, toolId: unknown) => {
    assertMainRenderer(event.sender)
    if (typeof toolId !== 'string' || !EXTERNAL_TOOL_IDS.includes(toolId as DesktopExternalToolId)) {
      throw new TypeError('desktop: invalid external tool id')
    }
    if (externalToolCompatibility === undefined) {
      throw new Error('desktop: external-tool compatibility resolver is unavailable')
    }
    return externalToolCompatibility.resolve(toolId as DesktopExternalToolId)
  })
  const requireWorkspaceRuntimes = (sender: WebContents): OptionalRuntimeManager => {
    assertMainRenderer(sender)
    if (workspaceRuntimeManager === undefined) throw new Error('desktop: workspace-runtime manager is unavailable')
    return workspaceRuntimeManager
  }
  const workspaceCapability = (value: unknown): WorkspaceRuntimeCapability => {
    if (typeof value !== 'string' || !WORKSPACE_RUNTIME_CAPABILITIES.includes(value as WorkspaceRuntimeCapability)) {
      throw new TypeError('desktop: invalid workspace-runtime capability id')
    }
    return value as WorkspaceRuntimeCapability
  }
  ipcMain.handle(DESKTOP_IPC.workspaceRuntimesGet, event => requireWorkspaceRuntimes(event.sender).get())
  ipcMain.handle(DESKTOP_IPC.workspaceRuntimesChoosePython, async (event) => {
    const manager = requireWorkspaceRuntimes(event.sender)
    const title = shellMessages(app.getLocale()).choosePythonInterpreter
    const result = mainWindow === undefined
      ? await dialog.showOpenDialog({ title, properties: ['openFile'] })
      : await dialog.showOpenDialog(mainWindow, { title, properties: ['openFile'] })
    const path = result.filePaths[0]
    return path === undefined ? undefined : manager.selectCustomPython(path)
  })
  ipcMain.handle(DESKTOP_IPC.workspaceRuntimesManagedPython, event => (
    requireWorkspaceRuntimes(event.sender).selectManagedPython()
  ))
  ipcMain.handle(DESKTOP_IPC.workspaceRuntimesInstallOffice, (event, allowPackageChanges: unknown) => {
    if (typeof allowPackageChanges !== 'boolean') throw new TypeError('desktop: invalid Office dependency confirmation')
    return requireWorkspaceRuntimes(event.sender).installCustomOffice(allowPackageChanges)
  })
  ipcMain.handle(DESKTOP_IPC.workspaceRuntimesStart, (event, capability: unknown) => (
    requireWorkspaceRuntimes(event.sender).start(workspaceCapability(capability))
  ))
  ipcMain.handle(DESKTOP_IPC.workspaceRuntimesGetJob, (event, jobId: unknown) => {
    if (typeof jobId !== 'string') throw new TypeError('desktop: invalid workspace-runtime job id')
    return requireWorkspaceRuntimes(event.sender).getJob(jobId)
  })
  ipcMain.handle(DESKTOP_IPC.workspaceRuntimesOutput, (event, jobId: unknown, offset: unknown) => {
    if (typeof jobId !== 'string' || !Number.isSafeInteger(offset)) throw new TypeError('desktop: invalid workspace-runtime output request')
    return requireWorkspaceRuntimes(event.sender).readOutput(jobId, offset as number)
  })
  ipcMain.handle(DESKTOP_IPC.workspaceRuntimesPause, (event, jobId: unknown) => {
    if (typeof jobId !== 'string') throw new TypeError('desktop: invalid workspace-runtime job id')
    return requireWorkspaceRuntimes(event.sender).pause(jobId)
  })
  ipcMain.handle(DESKTOP_IPC.workspaceRuntimesCancel, (event, jobId: unknown) => {
    if (typeof jobId !== 'string') throw new TypeError('desktop: invalid workspace-runtime job id')
    return requireWorkspaceRuntimes(event.sender).cancel(jobId)
  })
  ipcMain.handle(DESKTOP_IPC.workspaceRuntimesActivate, (event, capability: unknown) => (
    requireWorkspaceRuntimes(event.sender).activate(workspaceCapability(capability))
  ))
  ipcMain.handle(DESKTOP_IPC.workspaceRuntimesRemove, (event, capability: unknown) => (
    requireWorkspaceRuntimes(event.sender).remove(workspaceCapability(capability))
  ))
  ipcMain.handle(DESKTOP_IPC.bundledPluginsStartDeferred, async (
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
  ipcMain.handle(DESKTOP_IPC.bundledPluginsGet, (event, installId: unknown): BundledPluginInstallSnapshot => {
    assertMainRenderer(event.sender)
    if (typeof installId !== 'string') throw new TypeError('desktop: invalid bundled plugin install id')
    if (bundledPluginInstaller === undefined) throw new Error('desktop: bundled plugin installer is unavailable')
    return bundledPluginInstaller.getInstall(installId)
  })
  ipcMain.handle(DESKTOP_IPC.importedPluginsGet, (event): ImportedPluginRestoreSnapshot | undefined => {
    assertMainRenderer(event.sender)
    return importedPluginRestoreManager?.snapshot()
  })
  ipcMain.handle(DESKTOP_IPC.importedPluginsCheckSources, (event): ImportedPluginRestoreSnapshot | undefined => {
    assertMainRenderer(event.sender)
    return importedPluginRestoreManager?.startSourceCheck()
  })
  ipcMain.handle(DESKTOP_IPC.importedPluginsStart, async (
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
    return importedPluginRestoreManager.start(restoreIds)
  })
  ipcMain.handle(DESKTOP_IPC.importedPluginsDismiss, async (
    event,
  ): Promise<ImportedPluginRestoreSnapshot | undefined> => {
    assertMainRenderer(event.sender)
    return importedPluginRestoreManager?.dismissPrompt()
  })
  ipcMain.handle(DESKTOP_IPC.importedPluginsIgnore, async (
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
        : await stageImportedPluginDirectory(selectedPath, entry.packageName, (args, source, timeoutMs) => (
          runPackageManagerInvocation(args, source, harnessEnvironment, launchOptions, timeoutMs)
        ))
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
  ipcMain.handle(DESKTOP_IPC.importedPluginsChooseDirectory, async (event, restoreId: unknown) => {
    assertMainRenderer(event.sender)
    return installSelectedImportedPlugin(restoreId, 'directory')
  })
  ipcMain.handle(DESKTOP_IPC.importedPluginsChooseArchive, async (event, restoreId: unknown) => {
    assertMainRenderer(event.sender)
    return installSelectedImportedPlugin(restoreId, 'archive')
  })
  ipcMain.handle(DESKTOP_IPC.importedPluginsChoosePortable, async (event): Promise<ImportedPluginRestoreSnapshot | undefined> => {
    assertMainRenderer(event.sender)
    const manager = importedPluginRestoreManager
    if (manager === undefined) throw new Error('desktop: imported plugin restore manager is unavailable')
    const chooser = mainWindow
    const staged = join(dshHome, PORTABLE_PLUGIN_TRANSFER_FILENAME)
    const stagedExists = await lstat(staged).then(stats => stats.isFile(), () => false)
    let selected: string | undefined
    if (stagedExists) {
      const chinese = app.getLocale().toLowerCase().startsWith('zh')
      const response = await showDesktopMessageBox({
        type: 'question',
        title: chinese ? '使用已导入的离线包？' : 'Use the imported offline transfer?',
        message: chinese ? '导入配置时选定的离线包已准备好。' : 'The transfer selected during configuration import is ready.',
        buttons: chinese ? ['取消', '使用此包', '选择其他文件'] : ['Cancel', 'Use this transfer', 'Choose another file'],
        defaultId: 1, cancelId: 0,
      })
      if (response.response === 0) return manager.snapshot()
      if (response.response === 1) selected = staged
    }
    if (selected === undefined) {
      const result = await (chooser === undefined ? dialog.showOpenDialog({
        properties: ['openFile'], filters: [{ name: 'Offline plugin transfer', extensions: ['tgz'] }],
      }) : dialog.showOpenDialog(chooser, {
        properties: ['openFile'], filters: [{ name: 'Offline plugin transfer', extensions: ['tgz'] }],
      }))
      selected = result.filePaths[0]
      if (result.canceled || selected === undefined) return manager.snapshot()
    }
    const transfer = await unpackPortablePluginBundle(selected)
    try {
      const host = parsePortablePluginTarget({
        platform: process.platform, architecture: process.arch, osVersion: release(),
      })
      const plan = await planPortablePluginImport(dshHome, transfer.directory, host,
        async (args, cwd, environment) => {
          await runPackageManagerInvocation(args, cwd, environment, launchOptions, IMPORTED_PLUGIN_INSTALL_TIMEOUT_MS)
        })
      if (plan.ready.length === 0) throw new Error('desktop: offline transfer has no plugins awaiting restore in this Profile')
      const chinese = app.getLocale().toLowerCase().startsWith('zh')
      const approval = await showDesktopMessageBox({
        type: 'question',
        title: chinese ? '确认离线恢复插件' : 'Confirm offline plugin restore',
        message: chinese ? `将离线安装 ${plan.ready.length} 个插件` : `Install ${plan.ready.length} plugins offline`,
        detail: plan.ready.map(item => `${item.packageName}@${item.version}`).join('\n'),
        buttons: chinese ? ['取消', '安装'] : ['Cancel', 'Install'], defaultId: 0, cancelId: 0,
      })
      if (approval.response !== 1) return manager.snapshot()
      cancelBootableSnapshot()
      try {
        const outcome = await manager.installPortable(plan.ready, async () => installPortablePluginCandidate({
          activeHome: dshHome,
          candidateHome: desktopMutations.mutationHome,
          bundleDirectory: transfer.directory,
          selectedPackages: plan.ready.map(item => item.packageName),
          run: (args, environment) => runDesktopInvocation(resolveHarnessInvocation({
            ...harnessEnvironment, ...environment,
          }, ['plugin', '--profile', 'web', ...args], launchOptions),
          'imported-portable-plugin-install', IMPORTED_PLUGIN_INSTALL_TIMEOUT_MS),
        }))
        if (selected === staged && plan.ready.every(item => outcome.entries.some(entry => (
          entry.restoreId === item.restoreId && entry.state === 'succeeded'
        )))) await rm(staged, { force: true }).catch((error: unknown) => {
          console.warn('desktop: restored offline transfer could not be removed', error)
        })
        return outcome
      } finally {
        restartBootableSnapshotStabilityWindow('portable plugin restore settled')
      }
    } finally {
      await transfer.cleanup()
    }
  })
  let portableExportSource: {
    senderId: number
    selectionId: string
    path: string
    candidates: readonly { packageName: string; version: string }[]
    expiresAt: number
  } | undefined
  ipcMain.handle(DESKTOP_IPC.importedPluginsInspectExport, async (event) => {
    assertMainRenderer(event.sender)
    const chooser = mainWindow
    const result = await (chooser === undefined
      ? dialog.showOpenDialog({ properties: ['openDirectory'] })
      : dialog.showOpenDialog(chooser, { properties: ['openDirectory'] }))
    const selected = result.filePaths[0]
    if (result.canceled || selected === undefined) return undefined
    const source = await resolveDesktopDataHomeSource(selected)
      ?? await resolveCommunityDataHomeSource(selected)
    if (source === undefined) throw new Error('desktop: selected directory is not a Harness configuration')
    const plan = await planPortablePluginSources(source.path)
    if (plan.sourceIssues.length > 0) throw new Error('desktop: selected Profile has unresolved plugin metadata')
    const selectionId = randomUUID()
    portableExportSource = {
      senderId: event.sender.id, selectionId, path: source.path,
      candidates: plan.candidates.map(item => ({ packageName: item.packageName, version: item.version })),
      expiresAt: Date.now() + 10 * 60_000,
    }
    return {
      selectionId,
      host: parsePortablePluginTarget({ platform: process.platform, architecture: process.arch, osVersion: release() }),
      candidates: plan.candidates.map(item => ({ packageName: item.packageName, version: item.version })),
      omitted: plan.omitted,
    }
  })
  ipcMain.handle(DESKTOP_IPC.importedPluginsExport, async (event, value: unknown): Promise<{ status: 'saved' | 'cancelled' }> => {
    assertMainRenderer(event.sender)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('desktop: invalid offline plugin export request')
    }
    const request = value as { selectionId?: unknown; target?: unknown; packageNames?: unknown }
    const source = portableExportSource
    if (typeof request.selectionId !== 'string' || source?.selectionId !== request.selectionId
      || source.senderId !== event.sender.id || source.expiresAt <= Date.now()) {
      throw new Error('desktop: offline plugin export source expired; choose it again')
    }
    if (!Array.isArray(request.packageNames) || request.packageNames.some(name => typeof name !== 'string')) {
      throw new TypeError('desktop: invalid offline plugin selection')
    }
    const packageNames = request.packageNames as string[]
    if (packageNames.length === 0 || new Set(packageNames).size !== packageNames.length) {
      throw new TypeError('desktop: select distinct offline plugin packages')
    }
    const target = parsePortablePluginTarget(request.target)
    const confirmedSource = await resolveDesktopDataHomeSource(source.path)
      ?? await resolveCommunityDataHomeSource(source.path)
    if (confirmedSource?.path !== source.path) throw new Error('desktop: offline plugin export source changed')
    const currentPlan = await planPortablePluginSources(source.path)
    if (currentPlan.sourceIssues.length > 0 || packageNames.some((name) => {
      const previous = source.candidates.find(item => item.packageName === name)
      const current = currentPlan.candidates.find(item => item.packageName === name)
      return previous === undefined || current?.version !== previous.version
    })) throw new Error('desktop: selected plugin versions changed; choose the source again')
    const chooser = mainWindow
    const saved = await (chooser === undefined
      ? dialog.showSaveDialog({ defaultPath: 'dsh-offline-plugins.tgz', filters: [{ name: 'Offline plugin transfer', extensions: ['tgz'] }] })
      : dialog.showSaveDialog(chooser, { defaultPath: 'dsh-offline-plugins.tgz', filters: [{ name: 'Offline plugin transfer', extensions: ['tgz'] }] }))
    if (saved.canceled || saved.filePath === '') return { status: 'cancelled' }
    const workspace = await mkdtemp(join(dirname(saved.filePath), '.dsh-portable-export-'))
    try {
      const registry = downloadNetworkStore === undefined
        ? 'https://registry.npmjs.org' : npmRegistryUrl(downloadNetworkStore.read().npm)
      if (registry === undefined) throw new Error('desktop: selected npm registry has no public address')
      const actualHost = parsePortablePluginTarget({
        platform: process.platform, architecture: process.arch, osVersion: release(),
      })
      if (downloadNetworkProxy === undefined) throw new Error('desktop: plugin download proxy is unavailable')
      const fetcher = await pluginFetch()
      const packageProxy = downloadNetworkProxy.pluginUrl
      const bundleDirectory = join(workspace, 'bundle')
      await exportPortablePluginsFromHome(
        source.path, bundleDirectory, target, actualHost, packageNames, registry,
        async (args, cwd, environment) => {
          await runPackageManagerInvocation(args, cwd, {
            ...environment,
            ...(environment.npm_config_offline === 'true' ? {} : {
              HTTP_PROXY: packageProxy, HTTPS_PROXY: packageProxy, ALL_PROXY: packageProxy,
              http_proxy: packageProxy, https_proxy: packageProxy, all_proxy: packageProxy,
            }),
          }, launchOptions, IMPORTED_PLUGIN_INSTALL_TIMEOUT_MS)
        },
        (url, init) => fetcher(url.href, init),
      )
      await packPortablePluginBundle(bundleDirectory, saved.filePath)
      portableExportSource = undefined
      return { status: 'saved' }
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
  ipcMain.handle(DESKTOP_IPC.diagnosticLabCatalog, (event) => {
    assertMainRenderer(event.sender)
    if (diagnosticLabManager === undefined) throw new Error('desktop: diagnostic lab is unavailable')
    return diagnosticLabManager.catalog()
  })
  ipcMain.handle(DESKTOP_IPC.startupDiagnosticsList, async (event) => {
    assertMainRenderer(event.sender)
    if (activeMenuHome === undefined) return []
    return readStartupDiagnostics(activeMenuHome)
  })
  ipcMain.handle(DESKTOP_IPC.startupDiagnosticsRetry, async (event, incidentId: unknown) => {
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
      || incident.code === 'runtime.bundled-plugin-failed'
      || incident.code === 'runtime.bundled-plugin-marker-mismatch')
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
  ipcMain.handle(DESKTOP_IPC.diagnosticLabCurrent, (event) => {
    assertMainRenderer(event.sender)
    if (diagnosticLabManager === undefined) throw new Error('desktop: diagnostic lab is unavailable')
    return diagnosticLabManager.current()
  })
  ipcMain.handle(DESKTOP_IPC.diagnosticLabStart, (event, request: unknown) => {
    assertMainRenderer(event.sender)
    if (diagnosticLabManager === undefined) throw new Error('desktop: diagnostic lab is unavailable')
    if (request === null || typeof request !== 'object') throw new TypeError('desktop: invalid diagnostic lab request')
    return diagnosticLabManager.start(request as DiagnosticLabStartRequest)
  })
  ipcMain.handle(DESKTOP_IPC.diagnosticLabGet, (event, runId: unknown) => {
    assertMainRenderer(event.sender)
    if (diagnosticLabManager === undefined || typeof runId !== 'string') {
      throw new TypeError('desktop: invalid diagnostic lab run id')
    }
    return diagnosticLabManager.get(runId)
  })
  ipcMain.handle(DESKTOP_IPC.diagnosticLabCancel, (event, runId: unknown) => {
    assertMainRenderer(event.sender)
    if (diagnosticLabManager === undefined || typeof runId !== 'string') {
      throw new TypeError('desktop: invalid diagnostic lab run id')
    }
    return diagnosticLabManager.cancel(runId)
  })
  ipcMain.handle(DESKTOP_IPC.diagnosticLabRestoreAll, async (event, runId: unknown) => {
    assertMainRenderer(event.sender)
    if (diagnosticLabManager === undefined || typeof runId !== 'string') {
      throw new TypeError('desktop: invalid diagnostic lab run id')
    }
    return diagnosticLabManager.restoreAll(runId)
  })
  ipcMain.handle(DESKTOP_IPC.diagnosticLabExport, (event, runId: unknown) => {
    assertMainRenderer(event.sender)
    if (diagnosticLabManager === undefined || typeof runId !== 'string') {
      throw new TypeError('desktop: invalid diagnostic lab run id')
    }
    return diagnosticLabManager.exportReport(runId)
  })
  ipcMain.handle(DESKTOP_IPC.pluginSnapshotsList, (event): Promise<readonly PluginSnapshotSummary[]> => {
    assertMainRenderer(event.sender)
    if (pluginSnapshotManager === undefined) throw new Error('desktop: plugin snapshots are unavailable')
    return pluginSnapshotManager.list()
  })
  ipcMain.handle(DESKTOP_IPC.pluginSnapshotsCreate, (event, label: unknown) => {
    assertMainRenderer(event.sender)
    if (label !== undefined && typeof label !== 'string') throw new TypeError('desktop: invalid plugin snapshot label')
    if (pluginSnapshotManager === undefined) throw new Error('desktop: plugin snapshots are unavailable')
    return pluginSnapshotManager.create(label)
  })
  ipcMain.handle(DESKTOP_IPC.pluginSnapshotsRemove, (event, snapshotId: unknown) => {
    assertMainRenderer(event.sender)
    if (typeof snapshotId !== 'string') throw new TypeError('desktop: invalid plugin snapshot id')
    if (pluginSnapshotManager === undefined) throw new Error('desktop: plugin snapshots are unavailable')
    return pluginSnapshotManager.remove(snapshotId)
  })
  ipcMain.handle(DESKTOP_IPC.pluginSnapshotsRestore, (
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
  ipcMain.handle(DESKTOP_IPC.pluginSnapshotsRestoreGet, (event, operationId: unknown) => {
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
  ipcMain.on(DESKTOP_IPC.menuClientState, (event, state: unknown) => {
    if (event.sender !== mainSurface?.renderer || typeof state !== 'object' || state === null) return
    const { available, ready, locale } = state as { available?: unknown; ready?: unknown; locale?: unknown }
    if (typeof available !== 'boolean' || typeof ready !== 'boolean'
      || typeof locale !== 'string' || locale.length > 64) return
    menuClientAvailable = available
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
  ipcMain.on(DESKTOP_IPC.menuResult, (event, result: unknown) => {
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
      if (preparingFirstStart) return true
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
      prebuiltDeploymentAbort.abort()
      // File deployment settles before transaction disposal can release its lease.
      await prebuiltDeploymentTask?.catch(() => {})
      cancelBootableSnapshot()
      publishStartupProgress({ stage: 'waiting-background-tasks', progress: 12 })
      showLoading('restarting')
      const outcomes: PromiseSettledResult<unknown>[] = []
      outcomes.push(...await Promise.allSettled([
        releaseDownloader?.dispose(), downloadNetworkProxy?.close(), oneShotOperations.dispose(),
        workspaceRuntimeManager?.dispose(), profileMutation?.dispose(),
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

  if (activeNasRuntime !== undefined) {
    await appendDesktopStartupLog(`Connecting to selected NAS runtime ${activeNasRuntime.name} at ${activeNasRuntime.baseUrl}.`)
    try { await authority.connectSelected() } catch { /* recovery controls remain visible */ }
    app.on('activate', () => { lifecycle?.showWindow() })
    return
  }

  publishStartupProgress(app.isPackaged
    ? { stage: 'preparing-runtime', progress: 10 }
    : { stage: 'preparing-desktop', progress: 24 })
  const packagedRuntimeRoot = app.isPackaged
    ? packagedRuntimeArchiveRoot(process.platform, process.arch)
    : undefined
  const packagedRuntime = packagedRuntimeRoot !== undefined
    ? await ensurePackagedRuntime({
      expandedPath: join(process.resourcesPath, 'harness'),
      archivePath: join(process.resourcesPath, 'harness-runtime.tar'),
      checksumPath: join(process.resourcesPath, 'harness-runtime.tar.sha256'),
      destination: join(app.getPath('userData'), 'runtime', app.getVersion()),
      archiveRoot: packagedRuntimeRoot,
      onProgress: (phase) => {
        publishStartupProgress({
          stage: 'preparing-runtime',
          progress: phase === 'verifying-archive' ? 11 : 16,
          detail: phase === 'verifying-archive' ? 'runtime-archive-verification' : 'runtime-archive-extraction',
        })
      },
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
  const firstStartPreparation = new FirstStartPreparation(dshHome)
  const presetVersionGate = new BundledPresetVersionGate(dshHome)
  let firstStartPending = await firstStartPreparation.begin(
    !await lstat(join(dshHome, 'profiles/web/package.json')).then(stat => stat.isFile(), () => false) && !preserveCopiedPlugins,
  )
  preparingFirstStart = firstStartPending
  const showIncompletePreparation = (detail: string): void => {
    if (lifecycle?.isQuitting === true) return
    recoveryRestartRequired = true
    showLoading('failed', {
      message: shellMessages(app.getLocale()).bundledPreparationFailed(detail),
      diagnosticCode: 'desktop.bundled-preparation-incomplete',
      evidence: detail,
      logPath: harnessLogPath,
    })
  }
  const bundledDirectory = resolveBundledPluginResourcesDirectory(app.isPackaged, process.resourcesPath, DEFAULT_SOURCE_ROOT)
  const bundledManifestSource = await readFile(join(bundledDirectory, 'manifest.json'), 'utf8')
  const manifest = parseBundledPluginManifest(JSON.parse(bundledManifestSource) as unknown)
  let prebuiltDirectory: string | undefined
  if (app.isPackaged && firstStartPending) {
    const prebuiltRoot = packagedPrebuiltProfileArchiveRoot(process.platform, process.arch)
    const prebuiltStartedAt = Date.now()
    await appendDesktopStartupLog('Preparing the first-start Profile archive with single-pass verification and extraction.')
    try {
      prebuiltDirectory = await ensurePackagedPrebuiltProfile({
        archivePath: join(process.resourcesPath, 'prebuilt-profile.tar'),
        checksumPath: join(process.resourcesPath, 'prebuilt-profile.tar.sha256'),
        destination: join(app.getPath('userData'), 'prebuilt-profile', app.getVersion(), prebuiltRoot),
        archiveRoot: prebuiltRoot,
        onProgress: (phase) => {
          publishStartupProgress({
            stage: 'preparing-runtime',
            progress: phase === 'verifying-archive' ? 18 : 22,
            detail: phase === 'verifying-archive' ? 'prebuilt-profile-verification' : 'prebuilt-profile-extraction',
          })
        },
      })
      await appendDesktopStartupLog(`First-start Profile archive prepared in ${Date.now() - prebuiltStartedAt}ms.`)
    } catch (error) {
      showIncompletePreparation(error instanceof Error ? error.message : String(error))
      return
    }
  }
  const importedBuildPlan = firstStartPending ? await readImportedPluginRestorePlan(dshHome) : undefined
  const startupBuildRules = firstStartPending && !inspectProfileMutationLock(dshHome).active ? await readProfileBuildApprovals(dshHome) : {}
  for (const [name, allowed] of Object.entries(importedBuildPlan?.allowBuilds ?? {})) {
    startupBuildRules[name] = startupBuildRules[name] === false || !allowed ? false : true
  }
  let prebuilt: PrebuiltProfileManifest | undefined
  if (firstStartPending && prebuiltDirectory !== undefined) {
    try {
      const candidate = await readPrebuiltProfile(prebuiltDirectory)
      if (launchOptions.harnessBin === undefined) throw new Error('desktop: packaged Harness entry is unavailable')
      const core = JSON.parse(await readFile(join(dirname(dirname(launchOptions.harnessBin)), 'package.json'), 'utf8')) as { version: string }
      if (candidate?.identity.target === `${process.platform}-${process.arch}`
        && candidate.identity.nodeVersion === '24.21.0' && candidate.identity.pnpmVersion === DESKTOP_PNPM_VERSION
        && candidate.identity.runtimeVersion === core.version
        && candidate.identity.pluginManifestSha256 === createHash('sha256').update(bundledManifestSource).digest('hex')
        && !Object.values(startupBuildRules).includes(false)
        && (importedBuildPlan?.sourceIssues.length ?? 0) === 0) prebuilt = candidate
    } catch (error) {
      showIncompletePreparation(error instanceof Error ? error.message : String(error))
      return
    }
  }
  let runtimePendingApplied = false
  const desktopMutations = new DesktopProfileMutation({
    home: dshHome,
    ownerPid: process.pid,
    environment: harnessEnvironment,
    commands: {
      run: (environment, args, operation, timeoutMs, acceptedExitCodes = [0], allowDuringDisposal = false) => (
        runDesktopInvocation(
          resolveHarnessInvocation(environment, ['plugin', '--profile', 'web', ...args], launchOptions),
          operation,
          timeoutMs,
          acceptedExitCodes,
          allowDuringDisposal,
        )
      ),
    },
    harness: {
      available: () => supervisor !== undefined,
      stop: async () => { await supervisor?.stop() },
      resume: () => { supervisor?.resume() },
      suspendForRecovery: async () => {
        if (!recoveryHarnessSuspended && supervisor !== undefined) {
          cancelBootableSnapshot()
          await supervisor.stop()
          recoveryHarnessSuspended = true
          harnessOrigin = undefined
          harnessAuthenticationUrl = undefined
          desktopReturnControl?.clear()
          desktopWebAccess?.clear()
        } else if (supervisor === undefined) recoveryRestartRequired = true
      },
    },
    timeouts: {
      preparationMs: CANDIDATE_PREPARATION_TIMEOUT_MS,
      profileCheckMs: PROFILE_CHECK_TIMEOUT_MS,
      snapshotMs: SNAPSHOT_COMMAND_TIMEOUT_MS,
      installMs: BUNDLED_PLUGIN_INSTALL_TIMEOUT_MS,
    },
    isFirstStart: () => firstStartPending,
    canResumeFirstStart: async (candidateHome) => {
      if (!firstStartPending || prebuilt === undefined) return false
      const progressPath = join(candidateHome, 'prebuilt-deployment.json')
      try {
        if (!(await lstat(progressPath)).isFile()) return false
        const progress = JSON.parse(await readFile(progressPath, 'utf8')) as { fingerprint?: unknown }
        return progress.fingerprint === prebuilt.fingerprint
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return false
        throw error
      }
    },
    onFirstStartCommit: async () => {
      if (runtimePendingApplied) {
        await workspaceRuntimeManager?.commitPending(dshHome)
        runtimePendingApplied = false
        await appendDesktopStartupLog('Workspace runtime Profile changes committed after normal readiness.')
      }
      if (!firstStartPending) return
      await presetVersionGate.markAttempted(app.getVersion())
      await firstStartPreparation.complete()
      firstStartPending = false
      preparingFirstStart = false
      await appendDesktopStartupLog('First-start bundled plugin preparation committed after normal readiness.')
    },
    runSnapshot: (args, timeoutMs, allowDuringDisposal) => runSnapshotCommand(args, timeoutMs, allowDuringDisposal),
    cancelBootableSnapshot,
    restartBootableSnapshotWindow: restartBootableSnapshotStabilityWindow,
    onCandidatePreparation: (startedAt) => {
      publishStartupProgress({ stage: 'configuring-plugin', progress: startupProgress.progress,
        startedAt, deadlineAt: startedAt + CANDIDATE_PREPARATION_TIMEOUT_MS })
    },
    onActivation: () => { publishStartupProgress({ stage: 'starting-harness', progress: 88 }) },
    log: appendDesktopStartupLog,
    onRollback: (error) => {
      const detail = error instanceof Error ? error.message : String(error)
      void appendDesktopStartupLog(`Plugin activation failed; the previous Profile was restored: ${detail}`)
      if (firstStartPending) showIncompletePreparation(detail)
    },
    onRecoveryRequired: (error, operation) => {
      cancelBootableSnapshot()
      console.error('desktop: plugin transaction requires recovery', error)
      void appendDesktopStartupLog('Plugin transaction could not be settled; its recovery journal was retained.')
      if (operation !== undefined) void retainStartupWarning(
        'runtime.startup-rollback-failed', `${operation}:rollback`,
        ['diagnostics', 'open-log', 'snapshot-restore'],
      )
      if (supervisor !== undefined) void supervisor.stop().then(() => {
        showLoading('failed', {
          message: shellMessages(app.getLocale()).transactionRecoveryFailed,
          diagnosticCode: 'desktop.profile-transaction-rollback-failed',
          logPath: harnessLogPath,
        })
      })
    },
  })
  profileMutation = desktopMutations
  try { await desktopMutations.recoverBeforeStartup() } catch (error) {
    await appendDesktopStartupLog('Interrupted plugin transaction recovery failed; using diagnostic mode.')
    console.error('desktop: interrupted plugin transaction recovery failed', error)
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
  // Node flags precede the CLI entry; process ownership must resolve modules from the entry itself.
  const observerBin = observerLaunch.args[1]
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
      diagnosticCode: 'desktop.process-recovery-blocked',
      evidence: detail,
      logPath: harnessLogPath,
    })
    return
  }
  const profileManifestPath = join(dshHome, 'profiles', 'web', 'package.json')
  const profileInitialized = await lstat(profileManifestPath).then(stat => stat.isFile(), () => false)
  firstStartPending = await firstStartPreparation.begin(!profileInitialized && !preserveCopiedPlugins)
  preparingFirstStart = firstStartPending
  let profileMutationLock = inspectProfileMutationLock(dshHome)
  if (profileMutationLock.active && !desktopMutations.hasCandidate) {
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
    && !(desktopMutations.hasCandidate && profileMutationLock.pid === process.pid && profileMutationLock.workerPid === undefined)
  let startupProfileMutationAllowed = !profileMutationBlocked && !desktopMutations.recoveryRequired
  let profileNeedsRepair = prebuilt === undefined && !profileInitialized && startupProfileMutationAllowed
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
  } else if (prebuilt === undefined && profileInitialized && !desktopMutations.recoveryRequired) {
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
        ? await desktopMutations.applyAtStartup({ operation: 'profile-repair', run: () => runProfileRepair() })
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
          diagnosticCode: 'desktop.profile-initialize-failed',
          evidence: message,
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
    desktopLogSession.append('desktop-startup', 'warn', `Profile startup repair:\n${profileRepairDiagnostic.trim()}`)
  }
  publishStartupProgress({ stage: 'checking-profile', progress: 34 })
  // Descendant `dsh plugin add` processes (including the plugin market) can
  // restore an absent bundled version without downloading it again. The CLI
  // verifies the manifest and archive before using this directory.
  harnessEnvironment.DSH_DESKTOP_BUNDLED_PLUGINS_DIR = bundledDirectory
  const startupPluginCooldown = new BundledPluginStartupCooldown(dshHome)
  bundledPluginCooldown = startupPluginCooldown
  const withStartupPluginTransaction = async <T>(
    packageName: string,
    operation: () => Promise<T>,
  ): Promise<T> => {
    if (desktopMutations.recoveryRequired) {
      throw new Error('desktop: bundled plugin startup stopped after rollback failure')
    }
    return desktopMutations.applyAtStartup({ operation: `bundled-plugin:${packageName}`, run: () => operation() })
  }
  bundledPluginInstaller = new BundledPluginInstaller({
    manifest,
    resourcesDirectory: bundledDirectory,
    get dshHome() { return desktopMutations.mutationHome },
    sourceDshHome: dshHome,
    repairLegacyMarkers: !app.isPackaged,
    startupBudgetMs: 120_000,
    requireCompleteStartup: firstStartPending,
    isStartupCancelled: () => lifecycle?.isQuitting === true,
    shouldAttemptStartup: plugin => startupPluginCooldown.shouldAttempt(plugin.packageName, plugin.version),
    onStartupSuccess: plugin => startupPluginCooldown.clear(plugin.packageName),
    onStartupResult: async (plugin, result) => {
      await appendDesktopStartupLog(`Bundled plugin ${plugin.packageName}@${plugin.version}: ${result}.`)
      if (result === 'unresolved') {
        await retainStartupWarning(
          'runtime.bundled-plugin-marker-mismatch',
          'bundled-plugin-reconciliation',
          ['diagnostics', 'open-log', 'retry-plugin'],
          plugin.packageName,
        )
      }
    },
    onReconciled: (reconciliation) => {
      void appendDesktopStartupLog(
        `Bundled plugin reconciliation: ${reconciliation.packageName}; recorded=${reconciliation.recordedVersion ?? 'none'}; actual=${reconciliation.actualVersion ?? 'missing'}; target=${reconciliation.targetVersion}; source=${reconciliation.sourceKind ?? 'missing'}; ownership=${reconciliation.ownership}.`,
      ).catch((error: unknown) => {
        console.warn('desktop: could not persist bundled plugin reconciliation', error)
      })
      if (reconciliation.recordedVersion !== undefined
        && reconciliation.recordedVersion !== reconciliation.actualVersion) {
        void retainStartupWarning(
          'runtime.bundled-plugin-marker-mismatch',
          'bundled-plugin-reconciliation',
          ['diagnostics', 'open-log', 'retry-plugin'],
          reconciliation.packageName,
          {
            recordedVersion: reconciliation.recordedVersion,
            ...(reconciliation.actualVersion === undefined ? {} : { actualVersion: reconciliation.actualVersion }),
            targetVersion: reconciliation.targetVersion,
          },
        ).catch((error: unknown) => {
          console.warn('desktop: could not retain bundled plugin reconciliation warning', error)
        })
      }
    },
    onStartupDeferred: async (plugin, reason) => {
      await appendDesktopStartupLog(`Bundled plugin ${plugin.packageName}@${plugin.version} was not attempted (${reason}); it remains available for manual installation.`)
      await retainStartupWarning(
        'runtime.bundled-plugin-failed',
        `bundled-plugin-deferred:${reason}`,
        ['diagnostics', 'open-log', 'retry-plugin'],
        plugin.packageName,
      )
    },
    onManagedMutationStart: () => { cancelBootableSnapshot() },
    onManagedMutationSettled: (plugin) => {
      restartBootableSnapshotStabilityWindow(`bundled plugin ${plugin.packageName} settled`)
    },
    withStartupTransaction: (plugin, operation) => withStartupPluginTransaction(plugin.packageName, operation),
    withManagedTransaction: (plugin, operation) => desktopMutations.applyManaged({
      operation: `bundled-plugin:${plugin.packageName}`,
      expectedPackages: [plugin.packageName],
      run: () => operation(),
    }),
    prepare: async (plugin) => {
      await appendDesktopStartupLog(`Preparing bundled plugin ${plugin.packageName}@${plugin.version}.`)
      for (const packageName of plugin.approvedBuilds ?? []) {
        await runDesktopInvocation(resolveHarnessInvocation(harnessEnvironment, [
          'plugin', '--profile', plugin.profile, 'approve-build', packageName,
        ], launchOptions), `bundled-plugin-approve:${plugin.packageName}`, BUILD_APPROVAL_TIMEOUT_MS)
      }
    },
    install: async (archivePath, plugin) => {
      const startedAt = Date.now()
      publishStartupProgress({ ...startupProgress, startedAt, deadlineAt: startedAt + BUNDLED_PLUGIN_INSTALL_TIMEOUT_MS })
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
  const runtimePending = await workspaceRuntimeManager.pending(dshHome)
  const hasRuntimePending = Object.values(runtimePending).some(value => value !== undefined)
  const ptcWanted = runtimePending.ptc === 'enable'
    || (runtimePending.ptc !== 'remove' && await hasManagedWorkspacePtcBlock(dshHome))
  let ptcVersion: string | undefined
  let ptcNeedsInstall = false
  if (ptcWanted) {
    const harnessBin = resolveHarnessInvocation(harnessEnvironment, [], launchOptions).args[1]
    if (harnessBin === undefined) throw new Error('desktop: Harness entry is unavailable for optional PTC plugin')
    const manifest = JSON.parse(await readFile(join(dirname(dirname(harnessBin)), 'package.json'), 'utf8')) as { version?: unknown }
    if (typeof manifest.version !== 'string') throw new Error('desktop: Harness version is unavailable for optional PTC plugin')
    ptcVersion = manifest.version
    ptcNeedsInstall = !await isWorkspacePtcPluginInstalled(dshHome, ptcVersion)
  }
  const applyRuntimePending = (hasRuntimePending || ptcNeedsInstall) && startupProfileMutationAllowed && !preserveCopiedPlugins
  let presetUpgradeNeeded = false
  let presetVersionMarkerUnavailable = false
  if (!firstStartPending && (startupProfileMutationAllowed || preserveCopiedPlugins)) {
    try {
      if (await presetVersionGate.shouldAttempt(app.getVersion())) {
        await presetVersionGate.markAttempted(app.getVersion())
        presetUpgradeNeeded = !preserveCopiedPlugins && startupProfileMutationAllowed
      }
    } catch (error) {
      presetVersionMarkerUnavailable = true
      await retainStartupWarning(
        'runtime.bundled-preset-version-marker-unavailable',
        'bundled-preset-version-marker',
        ['diagnostics', 'open-log'],
      )
      console.warn('desktop: bundled preset version marker is unavailable; skipping automatic preparation', error)
    }
  }
  try {
    if (firstStartPending && (!startupProfileMutationAllowed || preserveCopiedPlugins)) {
      showIncompletePreparation('Profile verification or transaction recovery did not complete.')
      return
    }
    if (startupProfileMutationAllowed && !preserveCopiedPlugins) {
      // Even a retry with settled markers needs a readiness-verified commit before clearing the gate.
      if (firstStartPending || applyRuntimePending) await desktopMutations.prepareStartup()
      if (prebuilt !== undefined && prebuiltDirectory !== undefined) {
        const startedAt = Date.now()
        const candidate = desktopMutations.mutationHome
        const receipt = join(candidate, 'prebuilt-deployment.json')
        await writeFile(`${receipt}.tmp`, JSON.stringify({ fingerprint: prebuilt.fingerprint, stage: 'copying' }))
        await rename(`${receipt}.tmp`, receipt)
        let lastProgressAt = 0
        prebuiltDeploymentTask = deployPrebuiltProfile(prebuiltDirectory, candidate, prebuilt, prebuiltDeploymentAbort.signal,
          (completed, total) => {
            const now = Date.now()
            if (now - lastProgressAt < 100 && completed !== total) return
            lastProgressAt = now
            publishStartupProgress({ stage: 'configuring-plugin', progress: 36 + Math.floor(44 * completed / Math.max(1, total)), detail: `${completed}/${total}`, startedAt })
          })
        try { await prebuiltDeploymentTask } finally { prebuiltDeploymentTask = undefined }
        await mergeImportedAllowBuilds(join(candidate, 'profiles/web'), startupBuildRules)
        await appendDesktopStartupLog(`Prebuilt Profile deployment completed in ${Date.now() - startedAt}ms; fingerprint=${prebuilt.fingerprint}; no package installation invoked.`)
      } else if (firstStartPending) {
        await mergeImportedAllowBuilds(join(desktopMutations.mutationHome, 'profiles/web'), startupBuildRules)
        await seedBundledPluginsBatch(manifest.plugins.filter(entry => entry.installPolicy === 'startup'), bundledDirectory, desktopMutations.mutationHome,
          async (entry) => {
            for (const name of entry.approvedBuilds ?? []) {
              if (Object.values(startupBuildRules).includes(false)) continue
              await runDesktopInvocation(resolveHarnessInvocation(harnessEnvironment,
                ['plugin', '--profile', 'web', 'approve-build', name], launchOptions), 'bundled-batch-approve', BUILD_APPROVAL_TIMEOUT_MS)
            }
          },
          async (archives) => {
            await runDesktopInvocation(resolveHarnessInvocation(harnessEnvironment,
              ['plugin', '--profile', 'web', 'add', '--save-exact', ...archives], launchOptions), 'bundled-batch-install', BUNDLED_PLUGIN_INSTALL_TIMEOUT_MS)
          })
      } else if (presetUpgradeNeeded) {
        await appendDesktopStartupLog(`Preparing bundled presets once for desktop ${app.getVersion()} after an application upgrade.`)
        const seedResults = await bundledPluginInstaller.seedStartup((progress) => {
          const mapped = mapBundledPluginProgress(
            progress.entry.packageName,
            progress.index,
            progress.total,
            progress.stage,
            progress.progress,
          )
          publishStartupProgress({ ...mapped, detail: `${progress.entry.packageName} (${progress.index + 1}/${progress.total})` })
        })
        const count = (result: NonNullable<(typeof seedResults)[number]['result']>): number => (
          seedResults.filter(item => item.result === result).length
        )
        const pending = seedResults.filter(result => result.result === undefined).length
        await appendDesktopStartupLog(`Desktop ${app.getVersion()} bundled preset pass finished: verified=${count('verified')}; installed=${count('installed')}; upgraded=${count('upgraded')}; preserved-user-version=${count('preserved-user-version')}; removed=${count('removed')}; unresolved=${count('unresolved')}; failed-or-deferred=${pending}. Activation still requires normal readiness.`)
      } else {
        await appendDesktopStartupLog(presetVersionMarkerUnavailable
          ? 'Skipped bundled plugin provisioning: the desktop version marker is unavailable; inspect startup diagnostics.'
          : 'Skipped bundled plugin provisioning: this desktop version was already attempted for the Profile.')
      }
    } else {
      await appendDesktopStartupLog(
        preserveCopiedPlugins
          ? 'Preserved copied community plugins without startup seeding.'
          : 'Skipped bundled startup plugin mutations because Profile health was not proven safe for writes.',
      )
    }
  } catch (error) {
    if (lifecycle.isQuitting) return
    if (!firstStartPending) throw error
    await appendBundledPluginFailure(harnessLogPath, error)
    showIncompletePreparation(error instanceof Error ? error.message : String(error))
    return
  } finally {
    delete harnessEnvironment.DSH_PLUGIN_SNAPSHOT_BATCH
  }
  if (applyRuntimePending) {
    const launch = resolveHarnessInvocation(harnessEnvironment, [], launchOptions)
    const harnessBin = launch.args[1]
    if (harnessBin === undefined) throw new Error('desktop: Harness entry is unavailable for workspace-runtime activation')
    const nodePackages = app.isPackaged
      ? join(dirname(dirname(harnessBin)), 'node_modules')
      : join(DEFAULT_SOURCE_ROOT, 'node_modules')
    const pnpm = launchOptions.packageManagerBin ?? resolveDevelopmentLaunchOptions(DEFAULT_SOURCE_ROOT).packageManagerBin
    if (pnpm === undefined) throw new Error('desktop: pnpm entry is unavailable for workspace-runtime activation')
    if (ptcNeedsInstall && ptcVersion !== undefined) {
      await desktopMutations.applyAtStartup({
        operation: 'workspace-runtime-ptc-plugin-install',
        run: async (context) => {
          await ensureWorkspacePtcPlugin(context.home, ptcVersion, async (packageSpec) => {
            await context.write({ kind: 'add', packageSpecs: [packageSpec], exact: true,
              operation: 'workspace-runtime-ptc-plugin-install', timeoutMs: BUNDLED_PLUGIN_INSTALL_TIMEOUT_MS })
          })
          await appendDesktopStartupLog(`Optional PTC plugin ${PTC_PLUGIN_NAME}@${ptcVersion} installed after user opt-in.`)
        },
      })
    }
    for (const capability of WORKSPACE_RUNTIME_CAPABILITIES) {
      const action = runtimePending[capability]
      if (action === undefined) continue
      const reference = await workspaceRuntimeManager.reference(dshHome, capability)
      if (action === 'enable' && reference === undefined) throw new Error(`desktop: ${capability} workspace-runtime reference is missing`)
      const payloadRoot = reference?.payloadRoot ?? join(app.getPath('userData'), 'optional-runtimes', 'removed')
      const python = reference?.custom === true && reference.python !== undefined
        ? reference.python.executable
        : process.platform === 'win32'
          ? join(payloadRoot, 'python', 'python.exe')
          : join(payloadRoot, 'python', 'bin', 'python3')
      const paths: WorkspaceRuntimeProfilePaths = {
        runtimeRoot: payloadRoot,
        python,
        node: launch.command,
        pnpm,
        nodePackages,
        ...(reference?.custom === true && reference.python !== undefined ? { customPython: {
          executable: reference.python.executable,
          sitePackages: reference.python.sitePackages,
          distributions: reference.python.packages,
        } } : {}),
      }
      await desktopMutations.applyAtStartup({
        operation: `workspace-runtime-${capability}-${action}`,
        run: () => Promise.resolve(configureWorkspaceRuntimeCapability(
          desktopMutations.mutationHome,
          capability,
          action === 'enable',
          paths,
        )),
      })
    }
    runtimePendingApplied = hasRuntimePending
  }
  const officeNodeModules = await workspaceRuntimeManager.officeNodeModules(dshHome)
  if (officeNodeModules === undefined) delete harnessEnvironment.NODE_PATH
  else harnessEnvironment.NODE_PATH = [officeNodeModules, harnessEnvironment.NODE_PATH]
    .filter((value): value is string => typeof value === 'string' && value !== '')
    .join(delimiter)
  const installedProfileDependencies: Record<string, string> = {}
  try {
    const profileManifest = JSON.parse(
      await readFile(join(desktopMutations.mutationHome, 'profiles', 'web', 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, unknown> }
    for (const [packageName, declaredSpec] of Object.entries(profileManifest.dependencies ?? {})) {
      if (typeof declaredSpec === 'string') installedProfileDependencies[packageName] = declaredSpec
    }
  } catch (error) {
    console.warn('desktop: could not identify installed startup plugins for imported restore', error)
  }
  importedPluginRestoreManager = new ImportedPluginRestoreManager({
    get dshHome() { return desktopMutations.mutationHome },
    providedDependencies: installedProfileDependencies,
    inspectSource: packageSpec => inspectImportedPluginSource(packageSpec, harnessEnvironment, launchOptions),
    install: packageSpecs => runDesktopInvocation(resolveHarnessInvocation(harnessEnvironment, [
      'plugin', '--profile', 'web', 'add', ...packageSpecs,
    ], launchOptions), 'imported-plugin-install', IMPORTED_PLUGIN_INSTALL_TIMEOUT_MS),
    mergeAllowBuilds: (_profileDir, rules) => desktopMutations.applyAtStartup({
      operation: 'imported-plugin-allow-builds',
      run: () => mergeImportedAllowBuilds(join(desktopMutations.mutationHome, 'profiles', 'web'), rules),
    }),
    withMutation: (operation, expectedPackages) => desktopMutations.applyManaged({
      operation: 'imported-plugin-restore', expectedPackages, run: () => operation(),
    }),
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
  }
  try {
    if (desktopMutations.recoveryRequired) {
      await desktopMutations.abortStartup()
      if (firstStartPending) {
        showIncompletePreparation('Profile transaction recovery did not complete.')
        return
      }
    }
    else {
      await desktopMutations.finishStartup(firstStartPending
        ? manifest.plugins.filter(entry => entry.installPolicy === 'startup').map(entry => entry.packageName)
        : [])
    }
  } catch (error) {
    await appendDesktopStartupLog('Startup candidate could not be activated; preserved the prior Profile.')
    console.error('desktop: startup plugin candidate failed', error)
    if (firstStartPending) {
      showIncompletePreparation(error instanceof Error ? error.message : String(error))
      return
    }
  }
  publishStartupProgress({ stage: 'starting-harness', progress: 88 })
  await appendDesktopStartupLog('Starting Harness supervisor.')
  const launch = resolveHarnessLaunch(harnessEnvironment, launchOptions)
  desktopMutations.start()
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
    beforeRestart: signal => desktopMutations.beforeHarnessRestart(signal),
    onSpawn: (pid) => { observeProcess(pid, 'Harness') },
    logPath: harnessLogPath,
    environment: { ...harnessEnvironment },
    managedRuntime: processObserver,
    onOptionalStartupFailures: (failures) => {
      profileMutation?.observeHarness({ type: 'optional-startup-failures', failures })
    },
    ...(profileMutationBlocked || desktopMutations.recoveryRequired
      ? {
        initialDiagnosticMode: true,
        initialDiagnosticReason: profileMutationBlocked
          ? 'The active Profile is owned by another plugin mutation operation.'
          : 'A startup plugin mutation could not be rolled back safely.',
      }
      : {}),
    ...(process.platform === 'win32' ? { terminateProcessTree: terminateWindowsProcessTree } : {}),
    onReady: (url) => {
      profileMutation?.observeHarness({ type: 'server-ready' })
      recoveryHarnessSuspended = false
      recoveryRestartRequired = false
      latestRecoveryFailure = undefined
      latestRecoveryDiagnostic = undefined
      harnessOrigin = new URL(url).origin
      harnessAuthenticationUrl = url
      desktopReturnControl?.setHarnessOrigin(`${harnessOrigin}/`)
      desktopWebAccess?.setReady(url)
      reportedDesktopReadiness.clear()
      reportedClientBootFailureOrigin = undefined
      publishStartupProgress({ stage: 'ready', progress: 100 })
      const readyOrigin = harnessOrigin
      setTimeout(() => {
        if (harnessOrigin !== readyOrigin || mainSurface === undefined || mainSurface.window.isDestroyed()) return
        void loadAuthenticatedHarness(mainSurface, url).catch((error: unknown) => {
          console.error('desktop: could not load authenticated Harness page', error)
        })
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
      harnessAuthenticationUrl = undefined
      reportedDesktopReadiness.clear()
      reportedClientBootFailureOrigin = undefined
      desktopReturnControl?.clear()
      desktopWebAccess?.clear()
      publishStartupProgress({
        stage: 'starting-harness',
        progress: 92,
        detail: 'profile-diagnostics-ready',
        state: 'degraded',
      })
      void appendDesktopStartupLog(
        `Diagnostic mode is ready; the active Profile remains paused: ${failure.message}`,
      )
      const diagnosticSummary = profileMutationBlocked
        ? { diagnosticCode: 'desktop.profile-lock-busy' }
        : desktopMutations.recoveryRequired
          ? { diagnosticCode: 'desktop.profile-transaction-rollback-failed' }
          : readRecoveryFailureSummary(dshHome) ?? { diagnosticCode: 'desktop.harness-startup-failed' }
      showLoading('failed', {
        ...failure,
        ...diagnosticSummary,
        logPath: harnessLogPath,
      })
      showNotification('failed', notificationCopy.failed)
    },
    onState: (state) => {
      if (state === 'starting') profileMutation?.observeHarness({ type: 'starting' })
      if (state === 'restarting' || state === 'failed' || state === 'stopped') {
        cancelBootableSnapshot()
        harnessOrigin = undefined
        harnessAuthenticationUrl = undefined
        desktopReturnControl?.clear()
        desktopWebAccess?.clear()
      }
      if (state !== 'ready') {
        menuClientAvailable = false
        menuClientReady = false
      }
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
      profileMutation?.observeHarness({ type: 'failed', error: failure })
      const diagnosticSummary = profileMutationBlocked
        ? { diagnosticCode: 'desktop.profile-lock-busy' }
        : desktopMutations.recoveryRequired
          ? { diagnosticCode: 'desktop.profile-transaction-rollback-failed' }
          : readRecoveryFailureSummary(dshHome) ?? { diagnosticCode: 'desktop.harness-startup-failed' }
      const detailedFailure = {
        ...failure,
        ...diagnosticSummary,
        logPath: harnessLogPath,
      }
      if (pluginSnapshotManager === undefined) {
        showLoading('failed', detailedFailure)
        showNotification('failed', notificationCopy.failed)
        return
      }
      void pluginSnapshotManager.handleHarnessFailure(failure.message).then((handled) => {
        if (handled) return
        showLoading('failed', detailedFailure)
        showNotification('failed', notificationCopy.failed)
      }, (error: unknown) => {
        console.error('desktop: plugin snapshot rollback after startup failure failed', error)
        showLoading('failed', detailedFailure)
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
      mainSurface?.send(DESKTOP_IPC.pluginSnapshotsStatus, snapshot)
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
      mainSurface?.send(DESKTOP_IPC.diagnosticLabStatus, snapshot)
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
  app.on('will-quit', () => {
    desktopShortcuts?.dispose()
    stopReleaseChecks?.()
    desktopLogSession.close('application-quit')
  })
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

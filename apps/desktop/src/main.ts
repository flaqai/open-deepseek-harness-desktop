/** Electron application host for the existing DeepSeek Harness Web GUI. */

import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, shell, Tray, type MenuItemConstructorOptions } from 'electron'
import { appendBundledPluginFailure, seedBundledPlugin, type BundledPluginManifestEntry } from './bundled-plugin-seed.ts'
import { resolveHarnessInvocation, resolveHarnessLaunch, type DesktopLaunchOptions, type HarnessLaunch } from './launch.ts'
import { allowsHarnessPermission } from './permissions.ts'
import { ensurePackagedRuntime, packagedRuntimeArchiveRoot } from './packaged-runtime.ts'
import { HarnessSupervisor, type HarnessFailure, type HarnessState } from './supervisor.ts'
import { revealHarnessLog, type OpenLogResult } from './log-reveal.ts'
import { createNotificationThrottle, desktopNotificationDictionary } from './notifications.ts'
import {
  createDesktopPreferencesStore, DEFAULT_DESKTOP_PREFERENCES, parseDesktopPreferencesPatch,
  type DesktopPreferences, type DesktopPreferencesStore,
} from './preferences.ts'
import { DesktopReleaseChecker, isAllowedReleaseUrl, type DesktopReleaseStatus } from './release-checker.ts'
import { SourceUpdater } from './source-updater.ts'
import { createDesktopLifecycle, type DesktopLifecycle } from './window-lifecycle.ts'
import { usesCustomWindowFrame } from './window-frame.ts'

const APP_NAME = 'DeepSeek Harness'
const LOADING_PAGE = fileURLToPath(new URL('./loading.html', import.meta.url))
const WINDOW_ICON = fileURLToPath(new URL('./icon.png', import.meta.url))
const MACOS_TRAY_ICON = fileURLToPath(new URL('./tray-iconTemplate.png', import.meta.url))
const PRELOAD = fileURLToPath(new URL('./preload.cjs', import.meta.url))
const DEFAULT_SOURCE_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

let mainWindow: BrowserWindow | undefined
let supervisor: HarnessSupervisor | undefined
let harnessOrigin: string | undefined
let lifecycle: DesktopLifecycle | undefined
let preferencesStore: DesktopPreferencesStore | undefined
let preferences: DesktopPreferences = { ...DEFAULT_DESKTOP_PREFERENCES }
let tray: Tray | undefined
let quitReleased = false
let hiddenLaunch = false
let harnessLogPath = ''
let releaseChecker: DesktopReleaseChecker | undefined

interface DesktopCapabilities {
  platform: NodeJS.Platform
  packaged: boolean
  launchAtLoginAvailable: boolean
  sourceUpdateAvailable: boolean
}

function desktopCapabilities(): DesktopCapabilities {
  return {
    platform: process.platform,
    packaged: app.isPackaged,
    launchAtLoginAvailable: app.isPackaged && process.platform === 'darwin',
    sourceUpdateAvailable: !app.isPackaged,
  }
}

function desktopCopy(): {
  open: string
  openLog: string
  launchAtLogin: string
  notifications: string
  quit: string
  logErrorTitle: string
} {
  return app.getLocale().toLowerCase().startsWith('zh')
    ? {
      open: '打开窗口', openLog: '打开 Harness 日志', launchAtLogin: '开机自启',
      notifications: '系统通知', quit: '退出', logErrorTitle: '无法打开日志',
    }
    : {
      open: 'Open Window', openLog: 'Open Harness Log', launchAtLogin: 'Launch at Login',
      notifications: 'Notifications', quit: 'Quit', logErrorTitle: 'Could Not Open Log',
    }
}

function applyLaunchAtLogin(enabled: boolean): void {
  if (!desktopCapabilities().launchAtLoginAvailable) return
  app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: enabled })
}

function publishPreferences(): void {
  const window = mainWindow
  if (window !== undefined && !window.isDestroyed()) {
    window.webContents.send('dsh:desktop:preferences', preferences)
  }
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

function buildTrayMenu(): Menu {
  const copy = desktopCopy()
  const capabilities = desktopCapabilities()
  const template: MenuItemConstructorOptions[] = [
    { label: copy.open, click: () => { lifecycle?.showWindow() } },
    { label: copy.openLog, click: () => { void openHarnessLog() } },
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
    { label: copy.quit, click: () => { void lifecycle?.requestQuit() } },
  ]
  return Menu.buildFromTemplate(template)
}

function refreshTrayMenu(): void {
  tray?.setContextMenu(buildTrayMenu())
}

function createTray(): void {
  const image = nativeImage.createFromPath(process.platform === 'darwin' ? MACOS_TRAY_ICON : WINDOW_ICON)
  if (process.platform === 'darwin') {
    image.setTemplateImage(true)
  }
  tray = new Tray(image)
  tray.setToolTip(APP_NAME)
  refreshTrayMenu()
  tray.on('click', () => { lifecycle?.showWindow() })
  tray.on('right-click', refreshTrayMenu)
}

async function runHarnessInvocation(launch: HarnessLaunch, logPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(launch.command, launch.args, {
      env: { ...process.env, ...launch.environment },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const output: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => { output.push(chunk) })
    child.stderr.on('data', (chunk: Buffer) => { output.push(chunk) })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`desktop: bundled plugin install failed (${String(code)}, ${String(signal)}): ${Buffer.concat(output).toString('utf8').slice(-4000)}`))
    })
  }).catch(async (error: unknown) => {
    await appendBundledPluginFailure(logPath, error)
    throw error
  })
}

function showLoading(state: HarnessState, failure?: HarnessFailure & { logPath: string }): void {
  if (mainWindow === undefined || mainWindow.isDestroyed() || state === 'ready' || state === 'stopped') return
  void mainWindow.loadFile(LOADING_PAGE, {
    query: {
      state,
      ...(failure === undefined ? {} : { message: failure.message, logPath: failure.logPath }),
    },
  })
}

function configureNavigation(window: BrowserWindow): void {
  window.webContents.on('will-navigate', (event, target) => {
    if (harnessOrigin !== undefined && new URL(target).origin === harnessOrigin) return
    event.preventDefault()
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return { action: 'deny' }
    }
    if (parsed.protocol === 'https:') void shell.openExternal(parsed.href)
    return { action: 'deny' }
  })
  window.webContents.session.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
    return contents === window.webContents && allowsHarnessPermission(
      permission,
      details.requestingUrl ?? requestingOrigin,
      harnessOrigin,
      details.isMainFrame,
    )
  })
  window.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => {
    const requestingUrl = 'requestingUrl' in details ? details.requestingUrl : undefined
    const isMainFrame = 'isMainFrame' in details && details.isMainFrame
    callback(contents === window.webContents && allowsHarnessPermission(
      permission,
      requestingUrl,
      harnessOrigin,
      isMainFrame,
    ))
  })
}

function createWindow(): BrowserWindow {
  const customWindowFrame = usesCustomWindowFrame(process.platform)
  const window = new BrowserWindow({
    title: APP_NAME,
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#f4f2ed',
    icon: WINDOW_ICON,
    frame: !customWindowFrame,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: PRELOAD,
      additionalArguments: [app.isPackaged ? '--dsh-packaged' : '--dsh-source'],
    },
  })
  configureNavigation(window)
  if (customWindowFrame) {
    const sendMaximizedState = (): void => {
      window.webContents.send('dsh:window:maximized', window.isMaximized())
    }
    window.on('maximize', sendMaximizedState)
    window.on('unmaximize', sendMaximizedState)
  }
  window.once('ready-to-show', () => {
    if (!hiddenLaunch && lifecycle?.isQuitting !== true) window.show()
  })
  window.on('close', (event) => { lifecycle?.onWindowClose(event) })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })
  mainWindow = window
  if (harnessOrigin === undefined) showLoading('starting')
  else void window.loadURL(harnessOrigin)
  return window
}

async function startApplication(): Promise<void> {
  app.setName(APP_NAME)
  if (process.platform === 'win32') app.setAppUserModelId('ai.flaq.deepseek-harness')
  await app.whenReady()
  harnessLogPath = join(app.getPath('logs'), 'harness.log')
  preferencesStore = createDesktopPreferencesStore(
    join(app.getPath('userData'), 'desktop-preferences.json'),
    (error) => { console.error('desktop: could not read preferences; using defaults', error) },
  )
  preferences = preferencesStore.read()
  if (!desktopCapabilities().launchAtLoginAvailable) preferences.launchAtLoginEnabled = false
  applyLaunchAtLogin(preferences.launchAtLoginEnabled)
  hiddenLaunch = process.platform === 'darwin'
    && preferences.launchAtLoginEnabled
    && app.getLoginItemSettings().wasOpenedAtLogin
  const updater = new SourceUpdater({
    sourceRoot: process.env.DSH_DESKTOP_SOURCE_ROOT ?? DEFAULT_SOURCE_ROOT,
    nodeCommand: process.env.DSH_DESKTOP_NODE_BIN ?? 'node',
  })
  releaseChecker = app.isPackaged ? new DesktopReleaseChecker(app.getVersion()) : undefined
  releaseChecker?.subscribe((status) => {
    const window = mainWindow
    if (window !== undefined && !window.isDestroyed()) window.webContents.send('dsh:desktop:release-status', status)
  })
  ipcMain.handle('dsh:desktop:capabilities', () => desktopCapabilities())
  ipcMain.handle('dsh:desktop:preferences:get', () => preferences)
  ipcMain.handle('dsh:desktop:preferences:update', (_event, patch: unknown) => updatePreferences(patch))
  ipcMain.handle('dsh:desktop:log:open', () => openHarnessLog())
  ipcMain.handle('dsh:desktop:releases:get', (): DesktopReleaseStatus => (
    releaseChecker?.status ?? { phase: 'unsupported' }
  ))
  ipcMain.handle('dsh:desktop:releases:check', () => (
    releaseChecker?.check() ?? Promise.resolve({ phase: 'unsupported' } satisfies DesktopReleaseStatus)
  ))
  ipcMain.handle('dsh:desktop:releases:open', async (_event, releaseUrl: unknown) => {
    if (typeof releaseUrl !== 'string' || !isAllowedReleaseUrl(releaseUrl)) {
      throw new TypeError('desktop: invalid Release URL')
    }
    return { error: await shell.openExternal(releaseUrl).then(() => '') }
  })
  ipcMain.handle('dsh:source-update:check', () => updater.check())
  ipcMain.handle('dsh:source-update:upgrade', (_event, expectedCommit: unknown) => {
    if (typeof expectedCommit !== 'string' || !/^[0-9a-f]{40}$/u.test(expectedCommit)) {
      throw new TypeError('desktop: invalid expected update commit')
    }
    return updater.upgrade(expectedCommit)
  })
  ipcMain.handle('dsh:source-update:restart', () => {
    setTimeout(() => {
      app.relaunch()
      app.quit()
    }, 250)
    return { restarting: true as const }
  })
  ipcMain.handle('dsh:harness:retry', () => ({ started: supervisor?.retry() ?? false }))
  ipcMain.handle('dsh:harness:open-logs', () => openHarnessLog())
  ipcMain.on('dsh:window:minimize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window === mainWindow && usesCustomWindowFrame(process.platform)) window.minimize()
  })
  ipcMain.on('dsh:window:toggle-maximize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window !== mainWindow || !usesCustomWindowFrame(process.platform)) return
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })
  ipcMain.on('dsh:window:close', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window === mainWindow && usesCustomWindowFrame(process.platform)) window.close()
  })
  lifecycle = createDesktopLifecycle({
    getWindow: () => mainWindow,
    createWindow,
    readCloseBehavior: () => preferences.closeBehavior,
    disposeHost: async () => { await supervisor?.stop() },
    releaseQuit: () => {
      quitReleased = true
      tray?.destroy()
      tray = undefined
      app.quit()
    },
    reportError: (error) => { console.error('desktop: shutdown failed', error) },
  })
  createTray()
  createWindow()

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
  let launchOptions: DesktopLaunchOptions = {}
  if (app.isPackaged) {
    if (process.platform === 'win32') {
      const windowsRuntime = join(process.resourcesPath, 'runtime', 'win32-x64')
      launchOptions = {
        harnessBin: join(process.resourcesPath, 'harness', 'lib', 'bin.js'),
        nodeCommand: join(windowsRuntime, 'node.exe'),
        packageManagerBin: join(windowsRuntime, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'),
        runtimeBinPath: windowsRuntime,
      }
    } else if (packagedRuntime !== undefined && packageRuntimeBin !== undefined) {
      launchOptions = {
        harnessBin: join(packagedRuntime, 'lib', 'bin.js'),
        nodeCommand: join(packageRuntimeBin, 'node'),
        packageManagerBin: join(packageRuntimeBin, 'pnpm'),
        runtimeBinPath: packageRuntimeBin,
      }
    } else {
      throw new Error(`desktop: packaged runtime is unavailable for ${process.platform}-${process.arch}`)
    }

    const bundledDirectory = join(process.resourcesPath, 'bundled-plugins')
    const manifest = JSON.parse(await readFile(join(bundledDirectory, 'manifest.json'), 'utf8')) as {
      plugins: BundledPluginManifestEntry[]
    }
    const dshHome = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
    for (const entry of manifest.plugins) {
      try {
        await seedBundledPlugin({
          entry,
          resourcesDirectory: bundledDirectory,
          dshHome,
          install: async (archivePath, plugin) => {
            await runHarnessInvocation(resolveHarnessInvocation(process.env, [
              'plugin', '--profile', plugin.profile, 'add', '--save-exact', archivePath,
            ], launchOptions), harnessLogPath)
          },
        })
      } catch (error) {
        console.error(error)
      }
    }
  }
  const launch = resolveHarnessLaunch(process.env, launchOptions)
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
    logPath: harnessLogPath,
    environment: { ...process.env },
    onReady: (url) => {
      harnessOrigin = new URL(url).origin
      if (mainWindow !== undefined && !mainWindow.isDestroyed()) void mainWindow.loadURL(url)
      if (recovering) {
        recovering = false
        showNotification('recovered', notificationCopy.recovered)
      }
    },
    onState: (state) => {
      if (state === 'restarting' || state === 'failed') harnessOrigin = undefined
      if (state !== 'failed') showLoading(state)
      if (state === 'restarting' && !recovering) {
        recovering = true
        showNotification('restart', notificationCopy.restart)
      }
    },
    onFailure: (failure) => {
      showLoading('failed', { ...failure, logPath: harnessLogPath })
      showNotification('failed', notificationCopy.failed)
    },
  })
  supervisor.start()

  if (releaseChecker !== undefined) {
    setTimeout(() => { void releaseChecker?.check() }, 10_000)
  }

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
  void startApplication().catch((error: unknown) => {
    console.error(error)
    if (lifecycle === undefined) {
      quitReleased = true
      app.quit()
    } else {
      void lifecycle.requestQuit()
    }
  })
}

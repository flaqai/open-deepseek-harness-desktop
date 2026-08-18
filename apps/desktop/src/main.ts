/** Electron application host for the existing DeepSeek Harness Web GUI. */

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { resolveHarnessLaunch } from './launch.ts'
import { allowsHarnessPermission } from './permissions.ts'
import { ensurePackagedRuntime } from './packaged-runtime.ts'
import { HarnessSupervisor, type HarnessState } from './supervisor.ts'
import { SourceUpdater } from './source-updater.ts'
import { usesCustomWindowFrame } from './window-frame.ts'

const APP_NAME = 'DeepSeek Harness'
const LOADING_PAGE = fileURLToPath(new URL('./loading.html', import.meta.url))
const WINDOW_ICON = fileURLToPath(new URL('./icon.png', import.meta.url))
const PRELOAD = fileURLToPath(new URL('./preload.js', import.meta.url))
const DEFAULT_SOURCE_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

let mainWindow: BrowserWindow | undefined
let supervisor: HarnessSupervisor | undefined
let harnessOrigin: string | undefined
let quitting = false

function showLoading(state: HarnessState): void {
  if (mainWindow === undefined || mainWindow.isDestroyed() || state === 'ready' || state === 'stopped') return
  void mainWindow.loadFile(LOADING_PAGE, { query: { state } })
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
    window.show()
  })
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
  const updater = new SourceUpdater({
    sourceRoot: process.env.DSH_DESKTOP_SOURCE_ROOT ?? DEFAULT_SOURCE_ROOT,
    nodeCommand: process.env.DSH_DESKTOP_NODE_BIN ?? 'node',
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
  createWindow()

  const packagedRuntime = app.isPackaged && process.platform === 'darwin'
    ? await ensurePackagedRuntime({
      archivePath: join(process.resourcesPath, 'harness-runtime.tar.gz'),
      destination: join(app.getPath('userData'), 'runtime', app.getVersion()),
      archiveRoot: 'desktop-runtime-darwin-arm64',
    })
    : undefined
  const packageRuntimeBin = packagedRuntime === undefined
    ? undefined
    : join(packagedRuntime, 'package-runtime', 'bin')
  const launch = resolveHarnessLaunch(process.env, app.isPackaged
    ? {
      harnessBin: join(packagedRuntime ?? process.resourcesPath, packagedRuntime === undefined ? 'harness-runtime/lib/bin.js' : 'lib/bin.js'),
      nodeCommand: packageRuntimeBin === undefined ? process.execPath : join(packageRuntimeBin, 'node'),
      electronNodeMode: packageRuntimeBin === undefined,
      ...(packageRuntimeBin === undefined
        ? {}
        : {
          packageManagerBin: join(packageRuntimeBin, 'pnpm'),
          runtimeBinPath: packageRuntimeBin,
        }),
      ...(packagedRuntime === undefined
        ? { dependenciesPath: join(process.resourcesPath, 'harness-runtime', 'runtime-dependencies') }
        : {}),
    }
    : {})
  supervisor = new HarnessSupervisor({
    launch,
    logPath: join(app.getPath('logs'), 'harness.log'),
    environment: { ...process.env },
    onReady: (url) => {
      harnessOrigin = new URL(url).origin
      if (mainWindow !== undefined && !mainWindow.isDestroyed()) void mainWindow.loadURL(url)
    },
    onState: (state) => {
      if (state === 'restarting') harnessOrigin = undefined
      showLoading(state)
    },
  })
  supervisor.start()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow === undefined) createWindow()
    if (mainWindow?.isMinimized() === true) mainWindow.restore()
    mainWindow?.show()
    mainWindow?.focus()
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('before-quit', (event) => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    const shutdown = supervisor?.stop()
    if (shutdown === undefined) app.quit()
    else void shutdown.finally(() => {
      app.quit()
    })
  })
  void startApplication().catch((error: unknown) => {
    console.error(error)
    app.quit()
  })
}

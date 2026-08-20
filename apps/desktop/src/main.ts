/** Electron application host for the existing DeepSeek Harness Web GUI. */

import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { appendBundledPluginFailure, seedBundledPlugin, type BundledPluginManifestEntry } from './bundled-plugin-seed.ts'
import { resolveHarnessInvocation, resolveHarnessLaunch, type DesktopLaunchOptions, type HarnessLaunch } from './launch.ts'
import { allowsHarnessPermission } from './permissions.ts'
import { ensurePackagedRuntime, packagedRuntimeArchiveRoot } from './packaged-runtime.ts'
import { HarnessSupervisor, type HarnessFailure, type HarnessState } from './supervisor.ts'
import { SourceUpdater } from './source-updater.ts'
import { usesCustomWindowFrame } from './window-frame.ts'

const APP_NAME = 'DeepSeek Harness'
const LOADING_PAGE = fileURLToPath(new URL('./loading.html', import.meta.url))
const WINDOW_ICON = fileURLToPath(new URL('./icon.png', import.meta.url))
const PRELOAD = fileURLToPath(new URL('./preload.cjs', import.meta.url))
const DEFAULT_SOURCE_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

let mainWindow: BrowserWindow | undefined
let supervisor: HarnessSupervisor | undefined
let harnessOrigin: string | undefined
let quitting = false

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
  const harnessLogPath = join(app.getPath('logs'), 'harness.log')
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
  ipcMain.handle('dsh:harness:retry', () => ({ started: supervisor?.retry() ?? false }))
  ipcMain.handle('dsh:harness:open-logs', async () => ({ error: await shell.openPath(dirname(harnessLogPath)) }))
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
  supervisor = new HarnessSupervisor({
    launch,
    logPath: harnessLogPath,
    environment: { ...process.env },
    onReady: (url) => {
      harnessOrigin = new URL(url).origin
      if (mainWindow !== undefined && !mainWindow.isDestroyed()) void mainWindow.loadURL(url)
    },
    onState: (state) => {
      if (state === 'restarting' || state === 'failed') harnessOrigin = undefined
      if (state !== 'failed') showLoading(state)
    },
    onFailure: (failure) => {
      showLoading('failed', { ...failure, logPath: harnessLogPath })
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

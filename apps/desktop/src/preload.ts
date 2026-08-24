/** Narrow update bridge plus desktop-owned Windows and Linux title-bar chrome. */

import { contextBridge, ipcRenderer } from 'electron'
import type { OpenLogResult } from './log-reveal.ts'
import type { DesktopPreferences, DesktopPreferencesPatch } from './preferences.ts'
import type { DesktopReleaseStatus } from './release-checker.ts'
import type { SourceUpdateResult, SourceUpdateStatus } from './source-updater.ts'
import type {
  BundledPluginDeferredStartResult,
  BundledPluginInstallSnapshot,
  BundledPluginStartResult,
} from './bundled-plugin-installer.ts'
import { CUSTOM_WINDOW_TITLE_BAR_HEIGHT, usesCustomWindowFrame } from './window-frame.ts'

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
}

/** Narrow desktop-shell preference and diagnostics bridge. */
export interface DesktopShellBridge {
  getCapabilities(): Promise<DesktopCapabilities>
  getPreferences(): Promise<DesktopPreferences>
  updatePreferences(patch: DesktopPreferencesPatch): Promise<DesktopPreferences>
  onPreferences(callback: (preferences: DesktopPreferences) => void): () => void
  openLog(): Promise<OpenLogResult>
  restart(): Promise<{ restarting: true }>
}

/** Release discovery bridge; it never downloads or installs application files. */
export interface DesktopReleasesBridge {
  getStatus(): Promise<DesktopReleaseStatus>
  check(): Promise<DesktopReleaseStatus>
  onStatus(callback: (status: DesktopReleaseStatus) => void): () => void
  openDownload(releaseUrl: string): Promise<{ error: string }>
}

/** Exact allowlisted bundled-plugin operations; no arbitrary package path is exposed. */
export interface DesktopBundledPluginsBridge {
  startInstall(request: { profile: string; packageSpec: string }): Promise<BundledPluginStartResult>
  startDeferred(request: { profile: string; packageSpec: string }): Promise<BundledPluginDeferredStartResult>
  getInstall(installId: string): Promise<BundledPluginInstallSnapshot>
}

/** Fixed source-mode fixture operation; no renderer-supplied path is accepted. */
export interface DesktopDiagnosticFixturesBridge {
  install(): Promise<{ installed: true; diagnostic: string }>
}

const shellBridge: DesktopShellBridge = {
  getCapabilities: () => ipcRenderer.invoke('dsh:desktop:capabilities') as Promise<DesktopCapabilities>,
  getPreferences: () => ipcRenderer.invoke('dsh:desktop:preferences:get') as Promise<DesktopPreferences>,
  updatePreferences: patch => ipcRenderer.invoke('dsh:desktop:preferences:update', patch) as Promise<DesktopPreferences>,
  onPreferences(callback) {
    const listener = (_event: Electron.IpcRendererEvent, next: DesktopPreferences): void => { callback(next) }
    ipcRenderer.on('dsh:desktop:preferences', listener)
    return () => { ipcRenderer.removeListener('dsh:desktop:preferences', listener) }
  },
  openLog: () => ipcRenderer.invoke('dsh:desktop:log:open') as Promise<OpenLogResult>,
  restart: () => ipcRenderer.invoke('dsh:desktop:restart') as Promise<{ restarting: true }>,
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
}

const bundledPluginsBridge: DesktopBundledPluginsBridge = {
  startInstall: request => ipcRenderer.invoke('dsh:desktop:bundled-plugins:start', request) as Promise<BundledPluginStartResult>,
  startDeferred: request => ipcRenderer.invoke('dsh:desktop:bundled-plugins:start-deferred', request) as Promise<BundledPluginDeferredStartResult>,
  getInstall: installId => ipcRenderer.invoke('dsh:desktop:bundled-plugins:get', installId) as Promise<BundledPluginInstallSnapshot>,
}

const diagnosticFixturesBridge: DesktopDiagnosticFixturesBridge = {
  install: () => ipcRenderer.invoke('dsh:desktop:diagnostic-fixture:install') as Promise<{ installed: true; diagnostic: string }>,
}

const sourceMode = process.argv.includes('--dsh-source')
contextBridge.exposeInMainWorld('deepSeekHarnessDesktop', Object.freeze({
  shell: Object.freeze(shellBridge),
  releases: Object.freeze(releasesBridge),
  bundledPlugins: Object.freeze(bundledPluginsBridge),
  ...(sourceMode ? {
    updater: Object.freeze(bridge),
    diagnosticFixtures: Object.freeze(diagnosticFixturesBridge),
  } : {}),
}))

function installLoadingPage(): void {
  if (!location.pathname.endsWith('/loading.html')) return
  const query = new URLSearchParams(location.search)
  const chinese = navigator.language.toLowerCase().startsWith('zh')
  const copy = chinese
    ? {
      title: 'DeepSeek Harness 启动失败',
      description: '内置 Harness 连续三次未能完成启动。你可以重试或打开日志目录查看详情。',
      retry: '重新启动',
      logs: '打开日志目录',
      logLabel: '日志：',
      slow: '启动时间较长，你可以打开 Harness 日志查看当前进度。',
    }
    : {
      title: 'DeepSeek Harness could not start',
      description: 'The embedded Harness failed to become ready after three attempts. Retry or open the log folder for details.',
      retry: 'Retry',
      logs: 'Open log folder',
      logLabel: 'Log: ',
      slow: 'Startup is taking longer than expected. Open the Harness log to inspect its progress.',
    }
  const title = document.querySelector<HTMLElement>('#title')
  const description = document.querySelector<HTMLElement>('#description')
  const progress = document.querySelector<HTMLElement>('#progress')
  const failure = document.querySelector<HTMLElement>('#failure')
  const message = document.querySelector<HTMLElement>('#failure-message')
  const logPath = document.querySelector<HTMLElement>('#log-path')
  const retry = document.querySelector<HTMLButtonElement>('#retry')
  const openLogs = document.querySelector<HTMLButtonElement>('#open-logs')
  const slow = document.querySelector<HTMLElement>('#slow')
  const slowMessage = document.querySelector<HTMLElement>('#slow-message')
  const openSlowLog = document.querySelector<HTMLButtonElement>('#open-slow-log')
  if (
    title === null || description === null || progress === null || failure === null
    || message === null || logPath === null || retry === null || openLogs === null
    || slow === null || slowMessage === null || openSlowLog === null
  ) return
  const openLog = (): void => { void ipcRenderer.invoke('dsh:desktop:log:open') }
  openLogs.textContent = copy.logs
  openSlowLog.textContent = copy.logs
  openLogs.addEventListener('click', openLog)
  openSlowLog.addEventListener('click', openLog)
  if (query.get('state') !== 'failed') {
    setTimeout(() => {
      slowMessage.textContent = copy.slow
      slow.hidden = false
    }, 15_000)
    return
  }
  title.textContent = copy.title
  description.textContent = copy.description
  message.textContent = query.get('message') ?? copy.description
  logPath.textContent = `${copy.logLabel}${query.get('logPath') ?? ''}`
  retry.textContent = copy.retry
  progress.hidden = true
  failure.hidden = false
  retry.addEventListener('click', () => {
    retry.disabled = true
    void ipcRenderer.invoke('dsh:harness:retry').finally(() => { retry.disabled = false })
  })
}

const TITLE_BAR_STYLE = `
  html.dsh-desktop-custom-frame {
    box-sizing: border-box;
    height: 100%;
    overflow: hidden;
    padding-top: ${CUSTOM_WINDOW_TITLE_BAR_HEIGHT}px;
  }
  html.dsh-desktop-custom-frame body {
    box-sizing: border-box;
    height: 100% !important;
    min-height: 100% !important;
  }
  #dsh-desktop-titlebar {
    -webkit-app-region: drag;
    align-items: center;
    background: color-mix(in srgb, var(--dsw-alias-bg-base, #fff) 94%, transparent);
    border-bottom: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 10%));
    color: var(--dsw-alias-label-primary, #171719);
    display: flex;
    font-family: var(--dsw-font-family, "Segoe UI", sans-serif);
    height: ${CUSTOM_WINDOW_TITLE_BAR_HEIGHT}px;
    inset: 0 0 auto;
    position: fixed;
    user-select: none;
    z-index: 2147483647;
  }
  #dsh-desktop-titlebar-title {
    flex: 1;
    font-size: 12px;
    font-weight: 500;
    line-height: ${CUSTOM_WINDOW_TITLE_BAR_HEIGHT}px;
    min-width: 0;
    overflow: hidden;
    padding: 0 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  #dsh-desktop-window-controls {
    -webkit-app-region: no-drag;
    align-self: stretch;
    display: flex;
  }
  .dsh-desktop-window-control {
    appearance: none;
    background: transparent;
    border: 0;
    color: inherit;
    height: ${CUSTOM_WINDOW_TITLE_BAR_HEIGHT}px;
    margin: 0;
    outline: none;
    padding: 0;
    position: relative;
    width: 46px;
  }
  .dsh-desktop-window-control:hover { background: var(--dsw-alias-bg-mask-2, rgb(0 0 0 / 8%)); }
  .dsh-desktop-window-control:focus-visible { box-shadow: inset 0 0 0 2px #4176e6; }
  .dsh-desktop-window-control[data-action="close"]:hover { background: #c42b1c; color: #fff; }
  .dsh-desktop-window-control::before,
  .dsh-desktop-window-control::after {
    box-sizing: border-box;
    content: "";
    left: 50%;
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%);
  }
  .dsh-desktop-window-control[data-action="minimize"]::before { border-top: 1px solid currentColor; width: 10px; }
  .dsh-desktop-window-control[data-action="maximize"]::before { border: 1px solid currentColor; height: 10px; width: 10px; }
  .dsh-desktop-window-control[data-action="maximize"][data-maximized="true"]::before {
    height: 8px;
    margin: 1px 0 0 -1px;
    width: 8px;
  }
  .dsh-desktop-window-control[data-action="maximize"][data-maximized="true"]::after {
    border: 1px solid currentColor;
    height: 8px;
    margin: -2px 0 0 2px;
    width: 8px;
  }
  .dsh-desktop-window-control[data-action="close"]::before,
  .dsh-desktop-window-control[data-action="close"]::after { border-top: 1px solid currentColor; width: 12px; }
  .dsh-desktop-window-control[data-action="close"]::before { transform: translate(-50%, -50%) rotate(45deg); }
  .dsh-desktop-window-control[data-action="close"]::after { transform: translate(-50%, -50%) rotate(-45deg); }
  @media (prefers-color-scheme: dark) {
    #dsh-desktop-titlebar { background: color-mix(in srgb, var(--dsw-alias-bg-base, #202024) 94%, transparent); color: var(--dsw-alias-label-primary, #f4f4f5); }
  }
`

function installCustomTitleBar(): void {
  const root = document.documentElement
  root.classList.add('dsh-desktop-custom-frame')

  const style = document.createElement('style')
  style.id = 'dsh-desktop-titlebar-style'
  style.textContent = TITLE_BAR_STYLE
  document.head.append(style)

  const titleBar = document.createElement('header')
  titleBar.id = 'dsh-desktop-titlebar'
  titleBar.setAttribute('role', 'banner')

  const title = document.createElement('div')
  title.id = 'dsh-desktop-titlebar-title'
  const syncTitle = (): void => {
    title.textContent = document.title || 'DeepSeek Harness'
  }
  syncTitle()
  const documentTitle = document.querySelector('title')
  if (documentTitle !== null) new MutationObserver(syncTitle).observe(documentTitle, { childList: true })
  titleBar.append(title)

  const controls = document.createElement('div')
  controls.id = 'dsh-desktop-window-controls'
  const chinese = navigator.language.toLowerCase().startsWith('zh')
  const labels = chinese
    ? { minimize: '最小化', maximize: '最大化', restore: '还原', close: '关闭' }
    : { minimize: 'Minimize', maximize: 'Maximize', restore: 'Restore', close: 'Close' }

  const minimize = document.createElement('button')
  minimize.className = 'dsh-desktop-window-control'
  minimize.dataset.action = 'minimize'
  minimize.type = 'button'
  minimize.ariaLabel = labels.minimize
  minimize.addEventListener('click', () => {
    ipcRenderer.send('dsh:window:minimize')
  })

  const maximize = document.createElement('button')
  maximize.className = 'dsh-desktop-window-control'
  maximize.dataset.action = 'maximize'
  maximize.dataset.maximized = 'false'
  maximize.type = 'button'
  maximize.ariaLabel = labels.maximize
  maximize.addEventListener('click', () => {
    ipcRenderer.send('dsh:window:toggle-maximize')
  })
  ipcRenderer.on('dsh:window:maximized', (_event, maximized: boolean) => {
    maximize.dataset.maximized = String(maximized)
    maximize.ariaLabel = maximized ? labels.restore : labels.maximize
  })

  const close = document.createElement('button')
  close.className = 'dsh-desktop-window-control'
  close.dataset.action = 'close'
  close.type = 'button'
  close.ariaLabel = labels.close
  close.addEventListener('click', () => {
    ipcRenderer.send('dsh:window:close')
  })

  controls.append(minimize, maximize, close)
  titleBar.append(controls)
  document.body.prepend(titleBar)
}

window.addEventListener('DOMContentLoaded', () => {
  installLoadingPage()
  if (usesCustomWindowFrame(process.platform)) installCustomTitleBar()
}, { once: true })

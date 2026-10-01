/** Narrow floating chat window; the main Desktop window remains the process owner. */

import { BrowserWindow, Menu, screen } from 'electron'
import type { OrbSettings } from './orb-settings.ts'
import { DESKTOP_IPC } from './desktop-ipc-protocol.ts'
import { isTrustedOrbPage } from './orb-navigation.ts'

/** BrowserWindow operations needed by the host without exposing arbitrary navigation. */
export interface OrbWindowController {
  readonly webContentsId: number | undefined
  readonly visible: boolean
  show(): Promise<void>
  hide(): void
  /** Temporarily exclude this window from native capture without changing saved visibility. */
  excludeFromCapture(): () => void
  expand(): Promise<void>
  sendSelectionText(text: string): Promise<void>
  collapse(): Promise<void>
  update(settings: OrbSettings): void
  dispose(): void
}

/** Fixed content and callbacks for the floating window. */
export interface OrbWindowOptions {
  readonly preload: string
  readonly shellPage: string
  readonly getHarnessOrigin: () => string | undefined
  readonly getSettings: () => OrbSettings
  readonly getLocale: () => string
  readonly openMain: () => void
  readonly openSettings: () => void
  readonly hide: () => void
  readonly quit: () => void
}

const BALL_SIZE = 84
const PANEL_WIDTH = 380
const PANEL_HEIGHT = 570

/** Compute a work-area-contained dock position for both window sizes.
 * @param bounds - Current display's work area.
 * @param anchor - Preferred edge.
 * @param expanded - Whether chat is expanded.
 * @returns Window bounds.
 */
export function orbDockBounds(
  bounds: Electron.Rectangle, anchor: OrbSettings['anchor'], expanded: boolean,
): Electron.Rectangle {
  const width = expanded ? Math.min(PANEL_WIDTH, bounds.width) : Math.min(BALL_SIZE, bounds.width)
  const height = expanded ? Math.min(PANEL_HEIGHT, bounds.height) : Math.min(BALL_SIZE, bounds.height)
  return {
    x: anchor === 'left' ? bounds.x : bounds.x + bounds.width - width,
    y: bounds.y + Math.max(0, Math.round((bounds.height - height) / 2)),
    width, height,
  }
}

/** Create the one desktop-owned floating window controller.
 * @param options - Fixed local page, authenticated origin, and host callbacks.
 * @returns Contained window controls.
 */
export function createOrbWindowController(options: OrbWindowOptions): OrbWindowController {
  let window: BrowserWindow | undefined
  let expanded = false
  let disposed = false
  let captureExclusions = 0

  const live = (): BrowserWindow | undefined => window !== undefined && !window.isDestroyed() ? window : undefined
  // Fixed metadata only: never include page URLs, console text, chat, or error messages.
  const record = (event: string, target = live(), detail: Record<string, string | number | boolean> = {}): void => {
    if (target === undefined || target.isDestroyed()) {
      console.info('[desktop:orb-window]', JSON.stringify({ event, windowAlive: false, ...detail }))
      return
    }
    const bounds = target.getBounds()
    const display = screen.getDisplayNearestPoint({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 })
    console.info('[desktop:orb-window]', JSON.stringify({
      event, windowAlive: true, visible: target.isVisible(), minimized: target.isMinimized(),
      opacity: target.getOpacity(), alwaysOnTop: target.isAlwaysOnTop(),
      allWorkspaces: target.isVisibleOnAllWorkspaces(), contentProtection: target.isContentProtected(),
      bounds, workArea: display.workArea, expanded, captureExclusions, ...detail,
    }))
  }
  const dock = (target: BrowserWindow): void => {
    const current = target.getBounds()
    const display = screen.getDisplayNearestPoint({ x: current.x + current.width / 2, y: current.y + current.height / 2 })
    target.setBounds(orbDockBounds(display.workArea, options.getSettings().anchor, expanded))
    record('dock', target)
  }
  const create = (): BrowserWindow => {
    const settings = options.getSettings()
    const display = screen.getPrimaryDisplay()
    const target = new BrowserWindow({
      ...orbDockBounds(display.workArea, settings.anchor, false),
      show: false,
      title: 'DeepSeek Orb',
      frame: false,
      transparent: process.platform !== 'linux',
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: process.platform !== 'linux',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: options.preload,
      },
    })
    // Remote desktop viewers need to capture this window; owned Computer Use captures hide it temporarily.
    target.setContentProtection(false)
    target.on('show', () => { record('show', target) })
    target.on('hide', () => { record('hide', target) })
    target.on('minimize', () => { record('minimize', target) })
    target.on('restore', () => { record('restore', target) })
    target.on('move', () => { record('move', target) })
    target.webContents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
      record('load-failed', target, { code, mainFrame })
    })
    target.webContents.on('preload-error', () => { record('preload-failed', target) })
    target.webContents.on('render-process-gone', (_event, details) => {
      record('renderer-gone', target, { reason: details.reason, exitCode: details.exitCode })
    })
    target.webContents.on('unresponsive', () => { record('renderer-unresponsive', target) })
    target.webContents.on('responsive', () => { record('renderer-responsive', target) })
    target.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    target.webContents.on('will-navigate', (event, url) => {
      if (isTrustedOrbPage(url, options.shellPage, options.getHarnessOrigin())) return
      event.preventDefault()
    })
    target.webContents.on('context-menu', () => {
      const chinese = /^zh\b/iu.test(options.getLocale())
      Menu.buildFromTemplate([
        { label: chinese ? '打开主窗口' : 'Open main window', click: options.openMain },
        { label: chinese ? '悬浮球设置' : 'Floating ball settings', click: options.openSettings },
        { type: 'separator' },
        { label: chinese ? '隐藏悬浮球' : 'Hide floating ball', click: options.hide },
        { label: chinese ? '退出' : 'Quit', click: options.quit },
      ]).popup({ window: target })
    })
    target.on('closed', () => {
      record('closed')
      if (window === target) window = undefined
    })
    window = target
    record('created', target)
    return target
  }

  const inspectShell = async (target: BrowserWindow): Promise<void> => {
    // Probe only our fixed local shell, never the chat document. Codes: missing/layout/style/ready.
    try {
      const result: unknown = await target.webContents.executeJavaScript(`(() => {
        const ball = document.getElementById('orb-expand');
        if (!ball) return 0;
        const rect = ball.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return 1;
        const style = getComputedStyle(ball);
        if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0
          || style.backgroundImage === 'none') return 2;
        return 3;
      })()`)
      record('shell-paint-probe', target, { code: typeof result === 'number' && [0, 1, 2, 3].includes(result) ? result : -1 })
    } catch (_error) {
      record('shell-paint-probe-failed', target)
    }
  }
  const loadShell = async (target: BrowserWindow): Promise<void> => {
    record('shell-load-start', target)
    await target.loadFile(options.shellPage)
    record('shell-load-complete', target)
    void inspectShell(target)
  }
  const controller: OrbWindowController = {
    get webContentsId() { return live()?.webContents.id },
    get visible() { return live()?.isVisible() ?? false },
    async show() {
      if (disposed) throw new Error('desktop: floating window is disposed')
      const target = live() ?? create()
      record('show-request', target)
      if (target.webContents.getURL() === '') {
        try { await loadShell(target) }
        catch (error) {
          target.destroy()
          if (window === target) window = undefined
          throw error
        }
      }
      if (captureExclusions === 0) target.show()
      record('show-result', target)
    },
    hide() { record('hide-request'); live()?.hide() },
    excludeFromCapture() {
      const target = live()
      const wasVisible = target?.isVisible() === true
      captureExclusions++
      target?.hide()
      record('capture-exclude', target)
      let restored = false
      return () => {
        if (restored) return
        restored = true
        captureExclusions--
        if (captureExclusions === 0 && wasVisible && target === live()
          && options.getSettings().visible) target.showInactive()
        record('capture-restore', target)
      }
    },
    async expand() {
      const target = live()
      const origin = options.getHarnessOrigin()
      if (target === undefined || origin === undefined) throw new Error('desktop: local Harness is not ready for floating chat')
      if (expanded && target.webContents.getURL() === `${origin}/?surface=orb`) {
        if (captureExclusions === 0) target.show()
        return
      }
      expanded = true
      dock(target)
      try { await target.loadURL(`${origin}/?surface=orb`) }
      catch (error) {
        expanded = false
        dock(target)
        await loadShell(target)
        throw error
      }
    },
    async sendSelectionText(text) {
      if (text.length === 0 || text.length > 8192) throw new Error('desktop: invalid floating selection length')
      await controller.expand()
      const target = live()
      const origin = options.getHarnessOrigin()
      if (target === undefined || !expanded || origin === undefined
        || target.webContents.getURL() !== `${origin}/?surface=orb`) {
        throw new Error('desktop: floating chat is unavailable for the copied selection')
      }
      target.webContents.send(DESKTOP_IPC.orbSelectionText, text)
    },
    async collapse() {
      const target = live()
      if (target === undefined) return
      expanded = false
      dock(target)
      await loadShell(target)
    },
    update(settings) {
      const target = live()
      if (target === undefined) return
      if (settings.visible && captureExclusions === 0) target.show()
      else target.hide()
      dock(target)
      target.webContents.send(DESKTOP_IPC.orbChanged, settings)
      record('settings-applied', target, { requestedVisible: settings.visible })
    },
    dispose() {
      disposed = true
      const target = live()
      window = undefined
      target?.destroy()
    },
  }
  return controller
}

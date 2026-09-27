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
  expand(): Promise<void>
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

  const live = (): BrowserWindow | undefined => window !== undefined && !window.isDestroyed() ? window : undefined
  const dock = (target: BrowserWindow): void => {
    const current = target.getBounds()
    const display = screen.getDisplayNearestPoint({ x: current.x + current.width / 2, y: current.y + current.height / 2 })
    target.setBounds(orbDockBounds(display.workArea, options.getSettings().anchor, expanded))
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
    target.setContentProtection(true)
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
    target.on('closed', () => { if (window === target) window = undefined })
    window = target
    return target
  }

  const loadShell = async (target: BrowserWindow): Promise<void> => {
    await target.loadFile(options.shellPage)
  }
  const controller: OrbWindowController = {
    get webContentsId() { return live()?.webContents.id },
    get visible() { return live()?.isVisible() ?? false },
    async show() {
      if (disposed) throw new Error('desktop: floating window is disposed')
      const target = live() ?? create()
      if (target.webContents.getURL() === '') {
        try { await loadShell(target) }
        catch (error) {
          target.destroy()
          if (window === target) window = undefined
          throw error
        }
      }
      target.show()
    },
    hide() { live()?.hide() },
    async expand() {
      const target = live()
      const origin = options.getHarnessOrigin()
      if (target === undefined || origin === undefined) throw new Error('desktop: local Harness is not ready for floating chat')
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
      if (settings.visible) target.show()
      else target.hide()
      dock(target)
      target.webContents.send(DESKTOP_IPC.orbChanged, settings)
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

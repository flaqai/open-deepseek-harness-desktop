/** Native window composition for the desktop title bar and Harness renderer. */

import {
  BrowserWindow,
  WebContentsView,
  type BrowserWindowConstructorOptions,
  type WebContents,
  type WebPreferences,
} from 'electron'
import { harnessContentBounds, usesCustomWindowFrame } from './window-frame.ts'
import { DESKTOP_IPC } from './desktop-ipc-protocol.ts'

type LoadFileOptions = Parameters<WebContents['loadFile']>[1]

/** Inputs required to create the main desktop window and its trusted renderers. */
export interface DesktopWindowSurfaceOptions {
  readonly platform: NodeJS.Platform
  readonly window: Omit<BrowserWindowConstructorOptions, 'frame' | 'webPreferences'>
  readonly rendererPreferences: WebPreferences
  readonly titlebarPreferences: WebPreferences
  readonly titlebarPage: string
  readonly onSplitFailure: (error: unknown) => void
}

/** The native window plus the renderer that owns Harness application capabilities. */
export interface DesktopWindowSurface {
  readonly window: BrowserWindow
  readonly renderer: WebContents
  readonly titlebarRenderer?: WebContents
  readonly split: boolean
  initialize(): Promise<void>
  loadURL(url: string): Promise<void>
  loadFile(path: string, options?: LoadFileOptions): Promise<void>
  send(channel: string, ...args: unknown[]): void
  sendTitlebar(channel: string, ...args: unknown[]): void
  setBackgroundColor(color: string): void
  layout(): void
  dispose(): void
}

function createNativeSurface(options: DesktopWindowSurfaceOptions): DesktopWindowSurface {
  const macOS = options.platform === 'darwin'
  const window = new BrowserWindow({
    ...options.window,
    frame: true,
    ...(macOS ? {
      // Match upstream's inset traffic lights and translucent system sidebar.
      titleBarStyle: 'hiddenInset' as const,
      trafficLightPosition: { x: 16, y: 18 },
      vibrancy: 'sidebar' as const,
      visualEffectState: 'active' as const,
      backgroundColor: '#00000000',
    } : {}),
    webPreferences: options.rendererPreferences,
  })
  const renderer = window.webContents
  if (macOS) {
    const sendFullscreen = (): void => {
      if (!window.isDestroyed() && !renderer.isDestroyed()) {
        renderer.send(DESKTOP_IPC.windowFullscreen, window.isFullScreen())
      }
    }
    window.on('enter-full-screen', sendFullscreen)
    window.on('leave-full-screen', sendFullscreen)
    renderer.on('did-finish-load', sendFullscreen)
  }
  return {
    window,
    renderer,
    split: false,
    initialize: async () => {},
    loadURL: async (url) => { await renderer.loadURL(url) },
    loadFile: async (path, loadOptions) => { await renderer.loadFile(path, loadOptions) },
    send: (channel, ...args) => {
      if (!renderer.isDestroyed()) renderer.send(channel, ...args)
    },
    sendTitlebar: () => {},
    // An opaque theme update would mask the native macOS sidebar material.
    setBackgroundColor: (color) => { if (!macOS) window.setBackgroundColor(color) },
    layout: () => {},
    dispose: () => {},
  }
}

function createSplitSurface(options: DesktopWindowSurfaceOptions): DesktopWindowSurface {
  const window = new BrowserWindow({
    ...options.window,
    frame: false,
    webPreferences: options.titlebarPreferences,
  })
  let contentView: WebContentsView
  try {
    contentView = new WebContentsView({ webPreferences: options.rendererPreferences })
  } catch (error) {
    window.destroy()
    throw error
  }
  const renderer = contentView.webContents
  if (typeof options.window.backgroundColor === 'string') {
    contentView.setBackgroundColor(options.window.backgroundColor)
  }
  let disposed = false
  const layout = (): void => {
    if (disposed || window.isDestroyed() || renderer.isDestroyed()) return
    const size = window.getContentSize()
    contentView.setBounds(harnessContentBounds(size[0] ?? 0, size[1] ?? 0))
  }
  window.contentView.addChildView(contentView)
  window.on('resize', layout)
  layout()
  return {
    window,
    renderer,
    titlebarRenderer: window.webContents,
    split: true,
    initialize: async () => { await window.loadFile(options.titlebarPage) },
    loadURL: async (url) => { await renderer.loadURL(url) },
    loadFile: async (path, loadOptions) => { await renderer.loadFile(path, loadOptions) },
    send: (channel, ...args) => {
      if (!renderer.isDestroyed()) renderer.send(channel, ...args)
    },
    sendTitlebar: (channel, ...args) => {
      if (!window.webContents.isDestroyed()) window.webContents.send(channel, ...args)
    },
    setBackgroundColor: (color) => {
      window.setBackgroundColor(color)
      contentView.setBackgroundColor(color)
    },
    layout,
    dispose: () => {
      if (disposed) return
      disposed = true
      window.removeListener('resize', layout)
      if (!window.isDestroyed()) window.contentView.removeChildView(contentView)
      if (!renderer.isDestroyed()) renderer.close({ waitForBeforeUnload: false })
    },
  }
}

/**
 * Create the main renderer surface for one platform.
 * @param options - Native window, renderer, and fallback configuration.
 * @returns A split custom-frame surface on Windows/Linux or a native surface elsewhere.
 */
export function createDesktopWindowSurface(options: DesktopWindowSurfaceOptions): DesktopWindowSurface {
  if (!usesCustomWindowFrame(options.platform)) return createNativeSurface(options)
  try {
    return createSplitSurface(options)
  } catch (error) {
    options.onSplitFailure(error)
    return createNativeSurface(options)
  }
}

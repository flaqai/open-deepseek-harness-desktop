import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DESKTOP_IPC } from '../src/desktop-ipc-protocol.ts'

interface MockRenderer {
  readonly close: ReturnType<typeof vi.fn>
  readonly loadFile: ReturnType<typeof vi.fn>
  readonly loadURL: ReturnType<typeof vi.fn>
  readonly send: ReturnType<typeof vi.fn>
  emit(event: string): void
}

interface MockView {
  readonly options: unknown
  readonly setBounds: ReturnType<typeof vi.fn>
  readonly webContents: MockRenderer
}

interface MockWindow {
  readonly contentView: {
    readonly addChildView: ReturnType<typeof vi.fn>
    readonly removeChildView: ReturnType<typeof vi.fn>
  }
  readonly destroy: ReturnType<typeof vi.fn>
  readonly options: {
    readonly frame?: boolean
    readonly webPreferences?: unknown
    readonly titleBarStyle?: string
    readonly trafficLightPosition?: { readonly x: number; readonly y: number }
    readonly vibrancy?: string
    readonly visualEffectState?: string
    readonly backgroundColor?: string
  }
  readonly setBackgroundColor: ReturnType<typeof vi.fn>
  readonly webContents: MockRenderer
  emit(event: string): void
  setContentSize(width: number, height: number): void
  setFullScreen(fullscreen: boolean): void
}

const electron = vi.hoisted(() => ({
  failViewCreation: false,
  views: [] as unknown[],
  windows: [] as unknown[],
}))

vi.mock('electron', () => {
  class MockWebContents {
    destroyed = false
    close = vi.fn(() => { this.destroyed = true })
    isDestroyed = vi.fn(() => this.destroyed)
    loadFile = vi.fn<(path: string) => Promise<void>>(async () => {})
    loadURL = vi.fn(async () => {})
    send = vi.fn()
    private readonly listeners = new Map<string, Set<() => void>>()
    on(event: string, listener: () => void): void {
      const current = this.listeners.get(event)
      this.listeners.set(event, current === undefined ? new Set([listener]) : current.add(listener))
    }
    emit(event: string): void { this.listeners.get(event)?.forEach((listener) => { listener() }) }
  }

  class BrowserWindow {
    readonly options: { readonly frame?: boolean; readonly webPreferences?: unknown }
    readonly webContents = new MockWebContents()
    readonly contentView = { addChildView: vi.fn(), removeChildView: vi.fn() }
    readonly destroy = vi.fn(() => { this.destroyed = true })
    readonly setBackgroundColor = vi.fn()
    private readonly listeners = new Map<string, Set<() => void>>()
    private contentSize: [number, number] = [1440, 920]
    private destroyed = false
    private fullscreen = false

    constructor(options: { readonly frame?: boolean; readonly webPreferences?: unknown }) {
      this.options = options
      electron.windows.push(this)
    }

    getContentSize(): [number, number] { return this.contentSize }
    isDestroyed(): boolean { return this.destroyed }
    isFullScreen(): boolean { return this.fullscreen }
    loadFile(path: string): Promise<void> { return this.webContents.loadFile(path) }
    on(event: string, listener: () => void): void {
      const listeners = this.listeners.get(event) ?? new Set()
      listeners.add(listener)
      this.listeners.set(event, listeners)
    }
    removeListener(event: string, listener: () => void): void { this.listeners.get(event)?.delete(listener) }
    emit(event: string): void { this.listeners.get(event)?.forEach((listener) => { listener() }) }
    setContentSize(width: number, height: number): void { this.contentSize = [width, height] }
    setFullScreen(fullscreen: boolean): void { this.fullscreen = fullscreen }
  }

  class WebContentsView {
    readonly options: unknown
    readonly setBackgroundColor = vi.fn()
    readonly setBounds = vi.fn()
    readonly webContents = new MockWebContents()

    constructor(options: unknown) {
      if (electron.failViewCreation) throw new Error('view unavailable')
      this.options = options
      electron.views.push(this)
    }
  }

  return { BrowserWindow, WebContentsView }
})

import { createDesktopWindowSurface } from '../src/desktop-window-surface.ts'

function options(platform: NodeJS.Platform, onSplitFailure = vi.fn()) {
  return {
    platform,
    window: { width: 1440, height: 920, backgroundColor: '#fff' },
    rendererPreferences: { preload: '/content.cjs' },
    titlebarPreferences: { preload: '/titlebar.cjs' },
    titlebarPage: '/titlebar.html',
    onSplitFailure,
  }
}

describe('DesktopWindowSurface', () => {
  beforeEach(() => {
    electron.failViewCreation = false
    electron.views.length = 0
    electron.windows.length = 0
  })

  it('uses the upstream macOS inset frame and retains vibrancy through theme changes', async () => {
    const surface = createDesktopWindowSurface(options('darwin'))
    const window = electron.windows[0] as MockWindow

    expect(surface.split).toBe(false)
    expect(window.options.frame).toBe(true)
    expect(window.options).toMatchObject({
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 18 },
      vibrancy: 'sidebar',
      visualEffectState: 'active',
      backgroundColor: '#00000000',
    })
    expect(surface.renderer).toBe(window.webContents)
    surface.setBackgroundColor('#fff')
    expect(window.setBackgroundColor).not.toHaveBeenCalled()
    await surface.loadURL('http://127.0.0.1:1/')
    expect(window.webContents.loadURL).toHaveBeenCalledWith('http://127.0.0.1:1/')
    window.webContents.emit('did-finish-load')
    expect(window.webContents.send).toHaveBeenLastCalledWith(DESKTOP_IPC.windowFullscreen, false)
    window.setFullScreen(true)
    window.emit('enter-full-screen')
    expect(window.webContents.send).toHaveBeenLastCalledWith(DESKTOP_IPC.windowFullscreen, true)
    window.setFullScreen(false)
    window.emit('leave-full-screen')
    expect(window.webContents.send).toHaveBeenLastCalledWith(DESKTOP_IPC.windowFullscreen, false)
  })

  it('loads Harness below the Windows title bar and relays to the correct renderer', async () => {
    const surface = createDesktopWindowSurface(options('win32'))
    const window = electron.windows[0] as MockWindow
    const view = electron.views[0] as MockView

    expect(surface.split).toBe(true)
    expect(window.options.frame).toBe(false)
    expect(window.options.titleBarStyle).toBeUndefined()
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 36, width: 1440, height: 884 })
    await surface.initialize()
    await surface.loadFile('/loading.html')
    await surface.loadURL('http://127.0.0.1:2/')
    surface.send('content-message', 1)
    surface.sendTitlebar('titlebar-message', 2)
    expect(window.webContents.loadFile).toHaveBeenCalledWith('/titlebar.html')
    expect(view.webContents.loadFile).toHaveBeenCalledWith('/loading.html', undefined)
    expect(view.webContents.loadURL).toHaveBeenCalledWith('http://127.0.0.1:2/')
    expect(view.webContents.send).toHaveBeenCalledWith('content-message', 1)
    expect(window.webContents.send).toHaveBeenCalledWith('titlebar-message', 2)

    window.setContentSize(1000, 700)
    window.emit('resize')
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 36, width: 1000, height: 664 })

    surface.dispose()
    expect(window.contentView.removeChildView).toHaveBeenCalledWith(view)
    expect(view.webContents.close).toHaveBeenCalledWith({ waitForBeforeUnload: false })
  })

  it('recreates a native-frame window when the content view cannot be created', () => {
    const onSplitFailure = vi.fn()
    electron.failViewCreation = true
    const surface = createDesktopWindowSurface(options('linux', onSplitFailure))
    const failedWindow = electron.windows[0] as MockWindow
    const fallbackWindow = electron.windows[1] as MockWindow

    expect(failedWindow.destroy).toHaveBeenCalledOnce()
    expect(onSplitFailure).toHaveBeenCalledOnce()
    expect(surface.split).toBe(false)
    expect(fallbackWindow.options.frame).toBe(true)
  })
})

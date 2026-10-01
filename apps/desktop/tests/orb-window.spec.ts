import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_ORB_SETTINGS } from '../src/orb-settings.ts'

const state = vi.hoisted(() => ({
  paintCode: 3,
  windows: [] as Array<{
    visible: boolean
    showCalls: number
    inactiveCalls: number
    destroyed: boolean
    contentProtected: boolean
    events: Map<string, (...args: never[]) => void>
  }>,
}))

vi.mock('electron', () => {
  class MockBrowserWindow {
    visible = false
    showCalls = 0
    inactiveCalls = 0
    destroyed = false
    contentProtected = false
    events = new Map<string, (...args: never[]) => void>()
    webContents = {
      id: 17,
      getURL: () => this.url,
      setWindowOpenHandler: () => {},
      on: (event: string, listener: (...args: never[]) => void) => { this.events.set(event, listener) },
      send: () => {},
      executeJavaScript: async () => state.paintCode,
    }
    private url = ''
    private bounds = { x: 0, y: 0, width: 84, height: 84 }

    constructor() { state.windows.push(this) }
    isDestroyed() { return this.destroyed }
    isVisible() { return this.visible }
    isMinimized() { return false }
    getOpacity() { return 1 }
    isAlwaysOnTop() { return true }
    isVisibleOnAllWorkspaces() { return false }
    getBounds() { return this.bounds }
    setBounds(bounds: typeof this.bounds) { this.bounds = bounds }
    setContentProtection(value: boolean) { this.contentProtected = value }
    isContentProtected() { return this.contentProtected }
    on() {}
    async loadFile() { this.url = 'file:///orb-shell.html' }
    async loadURL(url: string) { this.url = url }
    show() { this.visible = true; this.showCalls++ }
    showInactive() { this.visible = true; this.inactiveCalls++ }
    hide() { this.visible = false }
    destroy() { this.destroyed = true; this.visible = false }
  }
  return {
    BrowserWindow: MockBrowserWindow,
    Menu: { buildFromTemplate: () => ({ popup: () => {} }) },
    screen: {
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1200, height: 800 } }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1200, height: 800 } }),
    },
  }
})

import { createOrbWindowController } from '../src/orb-window.ts'

describe('floating window capture exclusion', () => {
  it('hides during capture and restores without activating the target app', async () => {
    const logging = vi.spyOn(console, 'info').mockImplementation(() => {})
    state.windows.length = 0
    let settings = { ...DEFAULT_ORB_SETTINGS, visible: true }
    const controller = createOrbWindowController({
      preload: '/preload.js', shellPage: '/orb-shell.html',
      getHarnessOrigin: () => 'http://127.0.0.1:1234',
      getSettings: () => settings,
      getLocale: () => 'en',
      openMain: () => {}, openSettings: () => {}, hide: () => {}, quit: () => {},
    })
    await controller.show()
    const window = state.windows[0]!
    expect(window.contentProtected).toBe(false)
    const initialShowCalls = window.showCalls
    const restore = controller.excludeFromCapture()
    expect(window.visible).toBe(false)
    controller.update(settings)
    expect(window.visible).toBe(false)
    restore()
    restore()
    expect(window.visible).toBe(true)
    expect(window.inactiveCalls).toBe(1)
    expect(window.showCalls).toBe(initialShowCalls)
    const records: unknown[] = []
    for (const call of logging.mock.calls) {
      const record: unknown = JSON.parse(String(call[1]))
      records.push(record)
    }
    expect(records).toContainEqual(expect.objectContaining({ event: 'created', visible: false }))
    expect(records).toContainEqual(expect.objectContaining({ event: 'shell-paint-probe', code: 3 }))
    expect(records).toContainEqual(expect.objectContaining({
      event: 'show-result', visible: true, opacity: 1, allWorkspaces: false,
      contentProtection: false, captureExclusions: 0,
    }))
    expect(records).toContainEqual(expect.objectContaining({ event: 'capture-exclude', visible: false, captureExclusions: 1 }))
    expect(records).toContainEqual(expect.objectContaining({ event: 'capture-restore', visible: true, captureExclusions: 0 }))
    window.events.get('preload-error')?.()
    window.events.get('unresponsive')?.()
    expect(logging.mock.calls.some(call => String(call[1]).includes('preload-failed'))).toBe(true)
    expect(logging.mock.calls.some(call => String(call[1]).includes('renderer-unresponsive'))).toBe(true)
    expect(JSON.stringify(logging.mock.calls)).not.toContain('127.0.0.1')
    expect(JSON.stringify(logging.mock.calls)).not.toContain('/preload.js')

    const restoreAgain = controller.excludeFromCapture()
    settings = { ...settings, visible: false }
    restoreAgain()
    expect(window.visible).toBe(false)
    controller.dispose()
    logging.mockRestore()
  })

  it.each([0, 1, 2, 3])('records shell paint code %s without preventing window display', async (code) => {
    const logging = vi.spyOn(console, 'info').mockImplementation(() => {})
    state.paintCode = code
    const controller = createOrbWindowController({
      preload: '/preload.js', shellPage: '/orb-shell.html',
      getHarnessOrigin: () => undefined, getSettings: () => DEFAULT_ORB_SETTINGS,
      getLocale: () => 'en', openMain: () => {}, openSettings: () => {}, hide: () => {}, quit: () => {},
    })
    await controller.show()
    expect(controller.visible).toBe(true)
    expect(logging).toHaveBeenCalledWith('[desktop:orb-window]', expect.stringContaining('"event":"shell-paint-probe"'))
    expect(logging).toHaveBeenCalledWith('[desktop:orb-window]', expect.stringContaining(`"code":${code}`))
    controller.dispose()
    state.paintCode = 3
    logging.mockRestore()
  })
})

import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_ORB_SETTINGS } from '../src/orb-settings.ts'

const state = vi.hoisted(() => ({
  windows: [] as Array<{
    visible: boolean
    showCalls: number
    inactiveCalls: number
    destroyed: boolean
  }>,
}))

vi.mock('electron', () => {
  class MockBrowserWindow {
    visible = false
    showCalls = 0
    inactiveCalls = 0
    destroyed = false
    webContents = {
      id: 17,
      getURL: () => this.url,
      setWindowOpenHandler: () => {},
      on: () => {},
      send: () => {},
    }
    private url = ''
    private bounds = { x: 0, y: 0, width: 84, height: 84 }

    constructor() { state.windows.push(this) }
    isDestroyed() { return this.destroyed }
    isVisible() { return this.visible }
    getBounds() { return this.bounds }
    setBounds(bounds: typeof this.bounds) { this.bounds = bounds }
    setContentProtection() {}
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

    const restoreAgain = controller.excludeFromCapture()
    settings = { ...settings, visible: false }
    restoreAgain()
    expect(window.visible).toBe(false)
    controller.dispose()
  })
})

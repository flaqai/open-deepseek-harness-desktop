import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const load = vi.hoisted(() => ({ path: '', shown: false, destroyed: false, maximized: false }))

vi.mock('electron', () => ({
  app: { getAppPath: () => join(process.cwd(), 'lib') },
  BrowserWindow: class {
    webContents = {
      mainFrame: {},
      setWindowOpenHandler: () => undefined,
      on: () => undefined,
    }
    once() { return this }
    async loadFile(path: string) {
      load.path = path
      await access(path)
    }
    isDestroyed() { return load.destroyed }
    show() { load.shown = true }
    maximize() { load.maximized = true }
    destroy() { load.destroyed = true }
  },
  ipcMain: { handle: () => undefined, removeHandler: () => undefined },
}))

import { resolveDesktopLocale } from '../src/locale.ts'
import { openWelcomeWindow, welcomeWindowOptions } from '../src/welcome-window.ts'

describe('native desktop welcome file', () => {
  it('uses the workspace window bounds instead of the upstream fixed-size dialog', () => {
    const options = welcomeWindowOptions('darwin', resolveDesktopLocale('en'), { x: 80, y: 40, width: 1100, height: 760 })
    expect(options).toMatchObject({ x: 80, y: 40, width: 1100, height: 760, minWidth: 960, minHeight: 640, resizable: true })
  })

  it('loads the packaged renderer beside lib even when Electron appPath is lib', async () => {
    load.shown = false
    load.destroyed = false
    load.maximized = false
    let recordedBeforeShow = false
    await openWelcomeWindow(resolveDesktopLocale('en'), {
      takeNotice: async () => undefined,
      startSignIn: async () => { throw new Error('unused') },
      cancelSignIn: async () => { throw new Error('unused') },
      copySignInLink: async () => undefined,
      saveApiKey: async () => ({ ok: false }),
      skip: async () => undefined,
    }, { x: 0, y: 0, width: 1440, height: 920 }, async () => { recordedBeforeShow = !load.shown }, true)
    expect(load.path).toBe(join(process.cwd(), 'apps', 'desktop', 'renderer', 'welcome.html'))
    expect(recordedBeforeShow).toBe(true)
    expect(load.shown).toBe(true)
    expect(load.maximized).toBe(true)
  })

  it('does not show an unrecorded welcome when durable acknowledgement fails', async () => {
    load.shown = false
    load.destroyed = false
    await expect(openWelcomeWindow(resolveDesktopLocale('en'), {
      takeNotice: async () => undefined,
      startSignIn: async () => { throw new Error('unused') },
      cancelSignIn: async () => { throw new Error('unused') },
      copySignInLink: async () => undefined,
      saveApiKey: async () => ({ ok: false }),
      skip: async () => undefined,
    }, { x: 0, y: 0, width: 1440, height: 920 }, async () => { throw new Error('disk unavailable') }))
      .rejects.toThrow('disk unavailable')
    expect(load.shown).toBe(false)
    expect(load.destroyed).toBe(true)
  })
})

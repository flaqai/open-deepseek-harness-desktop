/** Native welcome window and its presentation-only renderer. */

import { fileURLToPath } from 'node:url'
import { BrowserWindow, ipcMain, type BrowserWindowConstructorOptions, type IpcMainInvokeEvent, type Rectangle } from 'electron'
import type { DesktopLocale } from './locale.ts'
import { WELCOME_IPC, type WelcomeOperations } from './welcome-api.ts'

/**
 * Resolve the welcome window's native material and workspace-matched bounds.
 * @param platform - operating system hosting Electron.
 * @param locale - shell-owned localized copy.
 * @param bounds - current workspace window bounds in display coordinates.
 * @returns sandboxed window options with a locale-only preload.
 */
export function welcomeWindowOptions(platform: NodeJS.Platform, locale: DesktopLocale, bounds: Rectangle): BrowserWindowConstructorOptions {
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 960,
    minHeight: 640,
    resizable: true,
    maximizable: true,
    fullscreenable: false,
    show: false,
    title: locale.messages.welcomeTitle,
    backgroundColor: platform === 'darwin' || platform === 'win32' ? '#00000000' : '#FFFFFF',
    ...(platform === 'darwin' ? {
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 21, y: 21 },
      vibrancy: 'menu',
      visualEffectState: 'active',
    } as const : {}),
    ...(platform === 'win32' ? {
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#00000000', symbolColor: '#0F1115', height: 42 },
      backgroundMaterial: 'acrylic',
    } as const : {}),
    webPreferences: {
      preload: fileURLToPath(new URL('./preload-welcome.cjs', import.meta.url)),
      additionalArguments: [`--dsh-welcome-locale=${locale.id}`],
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  }
}

let disposeActiveHandlers: (() => void) | undefined

/**
 * Open the process's sole welcome window with desktop-owned operations.
 * Replaces IPC ownership immediately; the caller closes the previous native window.
 * @param locale - shell-owned localized copy.
 * @param operations - credential write and this-launch-only skip actions.
 * @param bounds - current workspace window bounds.
 * @param recordPresentation - durable acknowledgement after the renderer loads and before it becomes visible.
 * @param maximized - whether the workspace window is currently maximized.
 * @returns the visible window; a failed load destroys it before rejecting.
 */
export async function openWelcomeWindow(
  locale: DesktopLocale,
  operations: WelcomeOperations,
  bounds: Rectangle,
  recordPresentation: () => Promise<void>,
  maximized = false,
): Promise<BrowserWindow> {
  const window = new BrowserWindow(welcomeWindowOptions(process.platform, locale, bounds))
  disposeActiveHandlers?.()
  let active = true
  const disposeHandlers = (): void => {
    if (!active) return
    active = false
    for (const channel of [
      WELCOME_IPC.takeNotice, WELCOME_IPC.saveApiKey, WELCOME_IPC.skip, WELCOME_IPC.start, WELCOME_IPC.cancel, WELCOME_IPC.copyLink,
    ]) {
      ipcMain.removeHandler(channel)
    }
    disposeActiveHandlers = undefined
  }
  disposeActiveHandlers = disposeHandlers
  const assertSender = (event: IpcMainInvokeEvent): void => {
    if (!active || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('desktop welcome: rejected action from an unowned frame')
    }
  }
  ipcMain.handle(WELCOME_IPC.takeNotice, async (event) => { assertSender(event); return operations.takeNotice() })
  ipcMain.handle(WELCOME_IPC.saveApiKey, async (event, value: unknown) => {
    assertSender(event)
    if (typeof value !== 'string' || !/^[\x21-\x7e]+$/.test(value)) return { ok: false }
    return operations.saveApiKey(value)
  })
  ipcMain.handle(WELCOME_IPC.skip, async (event) => {
    assertSender(event)
    await operations.skip()
  })
  ipcMain.handle(WELCOME_IPC.start, async (event) => { assertSender(event); return operations.startSignIn() })
  ipcMain.handle(WELCOME_IPC.cancel, async (event, id: unknown) => {
    assertSender(event)
    if (typeof id !== 'string') throw new Error('desktop welcome: invalid attempt')
    return operations.cancelSignIn(id)
  })
  ipcMain.handle(WELCOME_IPC.copyLink, async (event, id: unknown) => {
    assertSender(event)
    if (typeof id !== 'string') throw new Error('desktop welcome: invalid attempt')
    return operations.copySignInLink(id)
  })
  window.once('closed', disposeHandlers)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => { event.preventDefault() })
  try {
    await window.loadFile(fileURLToPath(new URL('../renderer/welcome.html', import.meta.url)))
    await recordPresentation()
  } catch (error) {
    disposeHandlers()
    if (!window.isDestroyed()) window.destroy()
    throw error
  }
  if (active && !window.isDestroyed()) {
    if (maximized) window.maximize()
    window.show()
  }
  return window
}

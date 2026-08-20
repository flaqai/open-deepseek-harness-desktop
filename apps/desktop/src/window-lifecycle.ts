/** Window and process teardown coordination for the desktop shell. */

import type { BrowserWindow, Event } from 'electron'
import type { CloseBehavior } from './preferences.ts'

/** Dependencies owned outside the lifecycle controller. */
export interface DesktopLifecycleOptions {
  getWindow(): BrowserWindow | undefined
  createWindow(): BrowserWindow
  readCloseBehavior(): CloseBehavior
  disposeHost(): Promise<void>
  releaseQuit(): void
  reportError(error: unknown): void
}

/** Serialized desktop lifecycle actions. */
export interface DesktopLifecycle {
  readonly isQuitting: boolean
  onWindowClose(event: Event): void
  showWindow(): void
  requestQuit(): Promise<void>
}

/** Create one controller for every route that can hide or quit the app. */
export function createDesktopLifecycle(options: DesktopLifecycleOptions): DesktopLifecycle {
  let quitting = false
  let quitOperation: Promise<void> | undefined

  const showWindow = (): void => {
    const window = options.getWindow() ?? options.createWindow()
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }

  const requestQuit = (): Promise<void> => {
    if (quitOperation !== undefined) return quitOperation
    quitting = true
    quitOperation = options.disposeHost()
      .catch((error: unknown) => { options.reportError(error) })
      .then(() => { options.releaseQuit() })
    return quitOperation
  }

  return {
    get isQuitting() { return quitting },
    onWindowClose(event) {
      if (quitting) return
      event.preventDefault()
      if (options.readCloseBehavior() === 'tray') {
        options.getWindow()?.hide()
      } else {
        void requestQuit()
      }
    },
    showWindow,
    requestQuit,
  }
}

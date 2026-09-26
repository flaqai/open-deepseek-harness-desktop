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
  /** Return false when an active mutation cannot safely be interrupted. */
  canQuit?(): boolean
  /** Ordinary quit only: confirm work interruption after the synchronous mutation guard. */
  confirmQuit?(): Promise<boolean>
  /** Invalidate an ordinary confirmation when a quick restart takes over. */
  cancelQuitConfirmation?(): void
  /** False only when the host positively knows tray creation failed. */
  canHideToTray?(): boolean
  onTrayUnavailable?(): void
}

/** Serialized desktop lifecycle actions. */
export interface DesktopLifecycle {
  readonly isQuitting: boolean
  onWindowClose(event: Event): void
  showWindow(): void
  /** System session termination skips an interactive dialog but retains normal cleanup. */
  requestQuit(options?: { readonly skipConfirmation?: boolean }): Promise<void>
  requestRestart(relaunch: () => void): Promise<void>
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

  const beginQuit = (relaunch?: () => void): Promise<void> => {
    quitting = true
    quitOperation = Promise.resolve().then(() => options.disposeHost())
      .then(() => {
        relaunch?.()
        options.releaseQuit()
      })
      .catch((error: unknown) => {
        quitting = false
        quitOperation = undefined
        options.reportError(error)
        showWindow()
      })
    return quitOperation
  }

  const requestQuit = (request?: { readonly skipConfirmation?: boolean }): Promise<void> => {
    if (request?.skipConfirmation === true) {
      if (quitting) return quitOperation ?? Promise.resolve()
      if (options.canQuit?.() === false) return Promise.resolve()
      if (quitOperation !== undefined) options.cancelQuitConfirmation?.()
      quitOperation = undefined
      return beginQuit()
    }
    if (quitOperation !== undefined) return quitOperation
    if (options.canQuit?.() === false) return Promise.resolve()
    if (options.confirmQuit === undefined) return beginQuit()
    const operation: Promise<void> = Promise.resolve().then(() => quitOperation === operation ? options.confirmQuit?.() : false)
      .then(async (approved) => {
        if (quitOperation !== operation || approved !== true) return
        if (options.canQuit?.() === false) return
        await beginQuit()
      })
      .catch((error: unknown) => {
        if (quitOperation !== operation) return
        options.reportError(error)
        showWindow()
      })
      .finally(() => { if (quitOperation === operation) quitOperation = undefined })
    quitOperation = operation
    return operation
  }

  return {
    get isQuitting() { return quitting },
    onWindowClose(event) {
      if (quitting) return
      event.preventDefault()
      if (options.readCloseBehavior() === 'tray') {
        if (options.canHideToTray?.() === false) options.onTrayUnavailable?.()
        else options.getWindow()?.hide()
      } else {
        void requestQuit()
      }
    },
    showWindow,
    requestQuit,
    requestRestart(relaunch) {
      if (quitting) return quitOperation ?? Promise.resolve()
      if (options.canQuit?.() === false) return Promise.resolve()
      if (quitOperation !== undefined) {
        options.cancelQuitConfirmation?.()
        quitOperation = undefined
      }
      return beginQuit(relaunch)
    },
  }
}

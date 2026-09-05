/** Local-browser handoff owned by the Electron main process. */

const LOCAL_WEB_HOST = '127.0.0.1'
const TOKEN = /^[A-Za-z0-9_-]+$/u

/** Renderer-visible browser handoff state; it never includes the authenticated URL. */
export type DesktopWebStatus =
  | { readonly phase: 'starting' | 'ready' | 'opening' }
  | { readonly phase: 'error'; readonly message: string }

/** Result of one successful system-browser handoff. */
export interface DesktopWebOpenResult {
  readonly opened: true
  readonly hidden: boolean
}

/** Native operations supplied by the Electron application host. */
export interface DesktopWebAccessOptions {
  openExternal(url: string): Promise<void>
  canHideWindow(): boolean
  hideWindow(): void
  showWindow(): void
  publish(status: DesktopWebStatus): void
}

/** Validate and normalize the process-owned launch URL. */
export function parseDesktopWebUrl(raw: string): string {
  const url = new URL(raw)
  const tokens = url.searchParams.getAll('token')
  if (url.protocol !== 'http:' || url.hostname !== LOCAL_WEB_HOST || url.port === ''
    || url.username !== '' || url.password !== '' || url.pathname !== '/' || url.hash !== ''
    || [...url.searchParams.keys()].some(key => key !== 'token')
    || tokens.length !== 1 || !TOKEN.test(tokens[0] ?? '')) {
    throw new TypeError('desktop: invalid local Web launch URL')
  }
  const port = Number(url.port)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError('desktop: invalid local Web launch port')
  }
  return url.href
}

/** Own the current Harness generation and serialize browser handoffs. */
export class DesktopWebAccess {
  #url: string | undefined
  #status: DesktopWebStatus = { phase: 'starting' }
  #generation = 0
  #opening: { readonly generation: number; readonly promise: Promise<DesktopWebOpenResult> } | undefined
  #automaticAttempted = false

  constructor(readonly options: DesktopWebAccessOptions) {}

  /** Read the URL-free handoff state. @returns Current state. */
  status(): DesktopWebStatus { return this.#status }

  /** Whether a handoff can start for the current generation. @returns Availability. */
  canOpen(): boolean { return this.#url !== undefined && this.#opening?.generation !== this.#generation }

  /** Replace the active Harness generation.
   * @param rawUrl - Authenticated loopback URL emitted by the ready Harness.
   */
  setReady(rawUrl: string): void {
    const url = parseDesktopWebUrl(rawUrl)
    if (url !== this.#url) {
      this.#generation += 1
      this.#automaticAttempted = false
    }
    this.#url = url
    this.#setStatus({ phase: 'ready' })
  }

  /** Invalidate the current Harness generation. */
  clear(): void {
    this.#url = undefined
    this.#generation += 1
    this.#automaticAttempted = false
    this.#setStatus({ phase: 'starting' })
  }

  /** Open the current generation in the system browser.
   * @returns Whether the desktop window was hidden after handoff.
   */
  open(): Promise<DesktopWebOpenResult> {
    if (this.#opening?.generation === this.#generation) return this.#opening.promise
    const url = this.#url
    if (url === undefined) return Promise.reject(new Error('desktop: local Web interface is not ready'))
    const generation = this.#generation
    this.#setStatus({ phase: 'opening' })
    const operation = this.options.openExternal(url).then(() => {
      if (generation !== this.#generation || url !== this.#url) return { opened: true as const, hidden: false }
      const hidden = this.options.canHideWindow()
      if (hidden) this.options.hideWindow()
      this.#setStatus({ phase: 'ready' })
      return { opened: true as const, hidden }
    }, (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      if (generation === this.#generation) this.#setStatus({ phase: 'error', message: message.slice(0, 1000) })
      throw error
    }).finally(() => {
      if (this.#opening?.promise === operation) this.#opening = undefined
    })
    this.#opening = { generation, promise: operation }
    return operation
  }

  /** Open at most once for the current Harness generation.
   * @param enabled - Whether the persisted automatic-open preference is active.
   */
  openAutomatically(enabled: boolean): void {
    if (!enabled || this.#automaticAttempted || this.#url === undefined) return
    this.#automaticAttempted = true
    void this.open().catch(() => { this.options.showWindow() })
  }

  #setStatus(status: DesktopWebStatus): void {
    this.#status = status
    this.options.publish(status)
  }
}

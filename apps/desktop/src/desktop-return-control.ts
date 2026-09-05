/** Loopback-only control that lets an authenticated browser view reveal Electron. */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

const LOOPBACK_HOST = '127.0.0.1'
const RETURN_PATH = '/show'
const TOKEN = /^[A-Za-z0-9_-]+$/u

/** Native action owned by the Electron window lifecycle. */
export interface DesktopReturnControlOptions {
  showWindow(): void
}

/** Validate a ready Harness origin used by browser CORS checks.
 * @param raw - Origin derived from the current Harness ready URL.
 * @returns Normalized loopback origin.
 */
export function parseHarnessOrigin(raw: string): string {
  const url = new URL(raw)
  if (url.protocol !== 'http:' || url.hostname !== LOOPBACK_HOST || url.port === ''
    || url.username !== '' || url.password !== '' || url.pathname !== '/'
    || url.search !== '' || url.hash !== '') {
    throw new TypeError('desktop: invalid Harness origin for return control')
  }
  const port = Number(url.port)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError('desktop: invalid Harness return-control port')
  }
  return url.origin
}

function deny(response: ServerResponse, statusCode = 403): void {
  response.writeHead(statusCode, {
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'",
  })
  response.end()
}

function equalToken(left: string, right: string): boolean {
  if (!TOKEN.test(left) || !TOKEN.test(right)) return false
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.byteLength === b.byteLength && timingSafeEqual(a, b)
}

/** Own a random, generation-scoped browser-to-desktop reveal endpoint. */
export class DesktopReturnControl {
  #server: Server | undefined
  #port: number | undefined
  #origin: string | undefined
  #token: string | undefined

  constructor(readonly options: DesktopReturnControlOptions) {}

  /** Bind the private control endpoint to IPv4 loopback. */
  async start(): Promise<void> {
    if (this.#server !== undefined) return
    const server = createServer((request, response) => { this.#handle(request, response) })
    server.requestTimeout = 5_000
    server.headersTimeout = 5_000
    server.keepAliveTimeout = 1_000
    server.maxHeadersCount = 32
    await new Promise<void>((resolve, reject) => {
      const fail = (error: Error): void => { server.off('listening', ready); reject(error) }
      const ready = (): void => { server.off('error', fail); resolve() }
      server.once('error', fail)
      server.once('listening', ready)
      server.listen(0, LOOPBACK_HOST)
    })
    const address = server.address()
    if (address === null || typeof address === 'string') {
      await new Promise<void>(resolve => server.close(() => { resolve() }))
      throw new Error('desktop: return control did not bind a TCP port')
    }
    server.unref()
    this.#server = server
    this.#port = address.port
  }

  /** Rotate the capability for one ready Harness generation.
   * @param rawOrigin - Exact origin of the current Harness.
   */
  setHarnessOrigin(rawOrigin: string): void {
    const origin = parseHarnessOrigin(rawOrigin)
    if (origin === this.#origin && this.#token !== undefined) return
    this.#origin = origin
    this.#token = randomBytes(32).toString('base64url')
  }

  /** Invalidate the browser return capability without closing the listener. */
  clear(): void {
    this.#origin = undefined
    this.#token = undefined
  }

  /** Return the current browser-only reveal URL.
   * @returns Loopback endpoint carrying the scoped token, or undefined before readiness.
   */
  returnUrl(): string | undefined {
    return this.#port === undefined || this.#token === undefined
      ? undefined
      : `http://${LOOPBACK_HOST}:${this.#port}${RETURN_PATH}?token=${this.#token}`
  }

  /** Close the loopback listener and invalidate its capability. */
  async close(): Promise<void> {
    this.clear()
    const server = this.#server
    this.#server = undefined
    this.#port = undefined
    if (server === undefined) return
    await new Promise<void>((resolve, reject) => {
      server.close((error) => { if (error === undefined) resolve(); else reject(error) })
    })
  }

  #handle(request: IncomingMessage, response: ServerResponse): void {
    const origin = this.#origin
    const token = this.#token
    if (origin === undefined || token === undefined || request.method !== 'POST'
      || request.headers.origin !== origin
      || (request.headers['content-length'] !== undefined && request.headers['content-length'] !== '0')
      || request.headers['transfer-encoding'] !== undefined
      || request.socket.remoteAddress !== LOOPBACK_HOST) {
      deny(response)
      return
    }
    let url: URL
    try {
      url = new URL(request.url ?? '', `http://${LOOPBACK_HOST}`)
    } catch {
      deny(response, 400)
      return
    }
    const tokens = url.searchParams.getAll('token')
    if (url.pathname !== RETURN_PATH || url.hash !== ''
      || [...url.searchParams.keys()].some(key => key !== 'token')
      || tokens.length !== 1 || !equalToken(tokens[0] ?? '', token)) {
      deny(response)
      return
    }
    try {
      this.options.showWindow()
    } catch (error) {
      console.error('desktop: browser return could not reveal the window', error)
      deny(response, 500)
      return
    }
    response.writeHead(204, {
      'access-control-allow-origin': origin,
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'",
      vary: 'Origin',
    })
    response.end()
  }
}

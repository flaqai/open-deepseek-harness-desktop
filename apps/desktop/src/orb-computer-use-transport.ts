/** Private loopback transport from the local Host to Desktop-owned native input. */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import type { OrbComputerUseAction, OrbComputerUseBackend, OrbComputerUseObservation } from './orb-computer-use-backend.ts'

const ROUTE = '/orb-computer-use/v1'
const SECRET_HEADER = 'x-dsh-desktop-orb-secret'
const MAX_REQUEST_BYTES = 128 * 1024
const MAX_IMAGE_BYTES = 32 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 20_000

/** Backend factory runs lazily after the current Host generation authenticates. */
export interface OrbComputerUseTransportOptions {
  readonly secret: () => string | undefined
  readonly openBackend: () => Promise<OrbComputerUseBackend>
  readonly onObservation?: (observation: OrbComputerUseObservation) => void
}

/** Stable loopback endpoint with synchronous generation revocation. */
export interface OrbComputerUseTransport {
  readonly origin: string
  invalidateGeneration(): void
  close(): Promise<void>
}

function authorized(request: IncomingMessage, secret: string, authority: string): boolean {
  const received = request.headers[SECRET_HEADER]
  return request.socket.remoteAddress === '127.0.0.1'
    && request.headers.host === authority
    && request.headers.origin === undefined
    && typeof received === 'string'
    && received.length === secret.length
    && timingSafeEqual(Buffer.from(received), Buffer.from(secret))
}

async function readJson(request: IncomingMessage, signal: AbortSignal): Promise<unknown> {
  if (request.headers['content-type'] !== 'application/json') throw new Error('invalid content type')
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    signal.throwIfAborted()
    if (!Buffer.isBuffer(chunk)) throw new Error('invalid request body')
    bytes += chunk.byteLength
    if (bytes > MAX_REQUEST_BYTES) throw new Error('request body too large')
    chunks.push(chunk)
  }
  signal.throwIfAborted()
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new Error('invalid JSON request body') }
}

function action(value: unknown): { frameId: number; action: OrbComputerUseAction } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid action')
  const input = value as Record<string, unknown>
  if (input.operation !== 'act' || Object.keys(input).length !== 3
    || !Number.isSafeInteger(input.frameId) || (input.frameId as number) < 1) {
    throw new Error('invalid action')
  }
  const raw = input.action
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('invalid action')
  const fields = raw as Record<string, unknown>
  const position = fields.position
  if (!Array.isArray(position) || position.length !== 2 || !position.every(item => Number.isInteger(item) && item >= 0 && item <= 1000)) {
    throw new Error('invalid action position')
  }
  if (fields.kind === 'click' && (fields.button === 'left' || fields.button === 'right')
    && (fields.count === 1 || fields.count === 2) && Object.keys(fields).length === 4) {
    return { frameId: input.frameId as number, action: { kind: 'click', position: [position[0], position[1]], button: fields.button, count: fields.count } }
  }
  if (fields.kind === 'type' && typeof fields.text === 'string' && fields.text.length > 0
    && fields.text.length <= 32_768 && typeof fields.replace === 'boolean' && typeof fields.submit === 'boolean'
    && Object.keys(fields).length === 5) {
    return { frameId: input.frameId as number, action: { kind: 'type', position: [position[0], position[1]], text: fields.text, replace: fields.replace, submit: fields.submit } }
  }
  throw new Error('invalid action')
}

function observation(value: OrbComputerUseObservation): object {
  if (value.frame.data.byteLength > MAX_IMAGE_BYTES) throw new Error('screenshot too large')
  return {
    frameId: value.frameId,
    frame: {
      data: Buffer.from(value.frame.data).toString('base64'),
      mediaType: value.frame.mediaType,
      bounds: value.frame.bounds,
      windowId: value.frame.windowId,
      appName: value.frame.appName,
      ...(value.frame.windowTitle === undefined ? {} : { windowTitle: value.frame.windowTitle }),
    },
  }
}

function send(response: ServerResponse, status: number, body: object): void {
  if (response.destroyed || response.writableEnded) return
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Connection': 'close' })
  response.end(JSON.stringify(body))
}

/** Start one loopback-only endpoint; each Host generation gets a fresh native backend.
 * @param options - Current Host secret getter and Desktop-owned native backend factory.
 * @returns The private origin, synchronous generation revocation, and awaited disposer.
 */
export async function startOrbComputerUseTransport(options: OrbComputerUseTransportOptions): Promise<OrbComputerUseTransport> {
  const pending = new Set<Promise<void>>()
  const requests = new Set<AbortController>()
  let backendReady: Promise<OrbComputerUseBackend> | undefined
  let retiring: Promise<void> = Promise.resolve()
  let generation = 0
  let currentSecret = options.secret()
  let authority = ''
  let closed = false
  let closing: Promise<void> | undefined
  const invalidateGeneration = (): void => {
    generation++
    currentSecret = options.secret()
    for (const controller of requests) controller.abort()
    const previous = backendReady
    backendReady = undefined
    if (previous !== undefined) {
      retiring = retiring.then(async () => {
        const backend = await previous.catch(() => undefined)
        await backend?.close()
      })
    }
  }
  const getBackend = (requestedGeneration: number): Promise<OrbComputerUseBackend> => {
    if (requestedGeneration !== generation || closed) throw new Error('orb transport: Host generation changed')
    backendReady ??= retiring.then(async () => {
      if (requestedGeneration !== generation || closed) throw new Error('orb transport: Host generation changed')
      return options.openBackend()
    })
    return backendReady
  }
  const server = createServer((request, response) => {
    const operation = (async () => {
      if (options.secret() !== currentSecret) invalidateGeneration()
      const secret = currentSecret
      if (closed || request.url !== ROUTE || request.method !== 'POST'
        || secret === undefined || !/^[A-Za-z0-9_-]{43}$/u.test(secret)
        || !authorized(request, secret, authority)) {
        send(response, 403, { error: 'forbidden' })
        return
      }
      const requestedGeneration = generation
      const controller = new AbortController()
      requests.add(controller)
      const onClose = (): void => { controller.abort() }
      response.once('close', onClose)
      const timer = setTimeout(() => { controller.abort(new Error('orb transport: request timed out')) }, REQUEST_TIMEOUT_MS)
      try {
        const value = await readJson(request, controller.signal)
        if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid request')
        const input = value as Record<string, unknown>
        const command = input.operation === 'observe' && Object.keys(input).length === 1 ? undefined : action(value)
        const backend = await getBackend(requestedGeneration)
        controller.signal.throwIfAborted()
        let result: OrbComputerUseObservation
        if (command === undefined) {
          result = await backend.observe(controller.signal)
        } else {
          result = await backend.act(command.frameId, command.action, controller.signal)
        }
        controller.signal.throwIfAborted()
        const payload = observation(result)
        try { options.onObservation?.(result) }
        catch (error) { console.warn('orb transport: observation listener failed', error) }
        send(response, 200, payload)
      } catch (error) {
        if (controller.signal.aborted) send(response, 504, { error: 'timeout or cancelled' })
        else send(response, 400, { error: error instanceof Error ? error.message : 'invalid request' })
      } finally {
        clearTimeout(timer)
        response.off('close', onClose)
        requests.delete(controller)
      }
    })()
    pending.add(operation)
    void operation.finally(() => { pending.delete(operation) })
  })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
    })
    const address = server.address() as AddressInfo | null
    if (address === null || address.address !== '127.0.0.1') throw new Error('orb transport: loopback bind failed')
    authority = `127.0.0.1:${String(address.port)}`
  } catch (error) {
    server.closeAllConnections()
    if (server.listening) await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    throw error
  }
  return {
    origin: `http://${authority}`,
    invalidateGeneration,
    close() {
      if (closing !== undefined) return closing
      closed = true
      invalidateGeneration()
      closing = (async () => {
        server.closeAllConnections()
        await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
        await Promise.allSettled(pending)
        await retiring
      })()
      return closing
    },
  }
}

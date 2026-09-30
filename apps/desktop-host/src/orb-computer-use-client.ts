/** Host-only HTTP client for Desktop-owned foreground Computer Use. */

const ROUTE = '/orb-computer-use/v1'
const TIMEOUT_MS = 20_000
const MAX_IMAGE_BYTES = 32 * 1024 * 1024
const MAX_RESPONSE_BYTES = 44 * 1024 * 1024

/** Native action forwarded by the authorized Host provider. */
export type DesktopOrbAction =
  | { readonly kind: 'click'; readonly position: readonly [number, number]; readonly button: 'left' | 'right'; readonly count: 1 | 2 }
  | { readonly kind: 'type'; readonly position: readonly [number, number]; readonly text: string; readonly replace: boolean; readonly submit: boolean }

/** Screenshot returned to the provider before attachment persistence. */
export interface DesktopOrbObservation {
  readonly frameId: number
  readonly frame: {
    readonly data: Uint8Array
    readonly mediaType: 'image/png' | 'image/jpeg'
    readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
    readonly windowId: string
    readonly appName: string
    readonly windowTitle?: string
  }
}

/** Provider-compatible backend; close aborts and waits for in-flight HTTP requests. */
export interface DesktopOrbHttpBackend {
  observe(signal?: AbortSignal): Promise<DesktopOrbObservation>
  act(frameId: number, action: DesktopOrbAction, signal?: AbortSignal): Promise<DesktopOrbObservation>
  close(): Promise<void>
}

/** Launch-only endpoint and generation authority consumed by the Host process. */
export interface DesktopOrbEndpoint {
  readonly origin: string
  readonly secret: string
}

/** Parse and remove transport authority before plugins or child processes inherit the environment.
 * @param environment - The Host process environment.
 * @returns A validated Desktop endpoint, or undefined outside the local Desktop generation.
 */
export function consumeDesktopOrbEndpoint(environment: NodeJS.ProcessEnv): DesktopOrbEndpoint | undefined {
  const origin = environment.DSH_DESKTOP_ORB_NATIVE_ORIGIN
  const secret = environment.DSH_DESKTOP_ORB_NATIVE_SECRET
  delete environment.DSH_DESKTOP_ORB_NATIVE_ORIGIN
  delete environment.DSH_DESKTOP_ORB_NATIVE_SECRET
  if (origin === undefined && secret === undefined) return undefined
  if (origin === undefined || secret === undefined) throw new Error('orb native client: incomplete Desktop endpoint')
  return validateEndpoint({ origin, secret })
}

function validateEndpoint(endpoint: DesktopOrbEndpoint): DesktopOrbEndpoint {
  let url: URL
  try { url = new URL(endpoint.origin) }
  catch { throw new Error('orb native client: invalid Desktop endpoint') }
  const port = Number(url.port)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username !== '' || url.password !== ''
    || url.pathname !== '/' || url.search !== '' || url.hash !== ''
    || !Number.isInteger(port) || port < 1 || port > 65_535
    || endpoint.origin !== url.origin || !/^[A-Za-z0-9_-]{43}$/u.test(endpoint.secret)) {
    throw new Error('orb native client: invalid Desktop endpoint')
  }
  return endpoint
}

function parsedObservation(value: unknown): DesktopOrbObservation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('orb native client: malformed observation')
  const result = value as Record<string, unknown>
  const raw = result.frame
  if (!Number.isSafeInteger(result.frameId) || (result.frameId as number) < 1
    || typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('orb native client: malformed observation')
  const frame = raw as Record<string, unknown>
  const bounds = frame.bounds
  if (typeof frame.data !== 'string' || frame.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4
    || !/^[A-Za-z0-9+/]+={0,2}$/u.test(frame.data)
    || (frame.mediaType !== 'image/png' && frame.mediaType !== 'image/jpeg')
    || typeof frame.windowId !== 'string' || frame.windowId.length < 1 || frame.windowId.length > 256
    || typeof frame.appName !== 'string' || frame.appName.length < 1 || frame.appName.length > 256
    || (frame.windowTitle !== undefined && (typeof frame.windowTitle !== 'string' || frame.windowTitle.length > 1024))
    || typeof bounds !== 'object' || bounds === null || Array.isArray(bounds)) {
    throw new Error('orb native client: malformed observation')
  }
  const rectangle = bounds as Record<string, unknown>
  if (!Number.isFinite(rectangle.x) || !Number.isFinite(rectangle.y)
    || !Number.isInteger(rectangle.width) || !Number.isInteger(rectangle.height)
    || (rectangle.width as number) < 2 || (rectangle.height as number) < 2
    || (rectangle.width as number) > 16_384 || (rectangle.height as number) > 16_384) {
    throw new Error('orb native client: malformed observation')
  }
  const data = Buffer.from(frame.data, 'base64')
  if (data.byteLength < 1 || data.byteLength > MAX_IMAGE_BYTES || data.toString('base64') !== frame.data) {
    throw new Error('orb native client: malformed screenshot')
  }
  return {
    frameId: result.frameId as number,
    frame: {
      data, mediaType: frame.mediaType, windowId: frame.windowId, appName: frame.appName,
      bounds: { x: rectangle.x as number, y: rectangle.y as number, width: rectangle.width as number, height: rectangle.height as number },
      ...(frame.windowTitle === undefined ? {} : { windowTitle: frame.windowTitle }),
    },
  }
}

async function boundedResponse(response: Response, signal: AbortSignal): Promise<unknown> {
  if (response.body === null) throw new Error('orb native client: empty response')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      signal.throwIfAborted()
      const next = await reader.read()
      if (next.done) break
      bytes += next.value.byteLength
      if (bytes > MAX_RESPONSE_BYTES) throw new Error('orb native client: response too large')
      chunks.push(next.value)
    }
  } finally { await reader.cancel().catch(() => {}) }
  signal.throwIfAborted()
  const body = Buffer.concat(chunks, bytes).toString('utf8')
  try { return JSON.parse(body) }
  catch { throw new Error('orb native client: malformed response') }
}

/** Open a backend only after the Host provider reserves its sole Computer Use slot.
 * @param endpoint - Desktop main's generation-scoped loopback endpoint.
 * @param acquireExclusive - Provider reservation callback.
 * @param fetcher - HTTP implementation, injectable for tests.
 * @returns A backend that aborts and settles requests during disposal.
 */
export async function createDesktopOrbHttpBackend(
  endpoint: DesktopOrbEndpoint,
  acquireExclusive: () => Promise<() => Promise<void>>,
  fetcher: typeof fetch = fetch,
): Promise<DesktopOrbHttpBackend> {
  validateEndpoint(endpoint)
  const release = await acquireExclusive()
  const lifetime = new AbortController()
  const pending = new Set<Promise<unknown>>()
  let closing: Promise<void> | undefined
  const request = (body: object, signal?: AbortSignal): Promise<DesktopOrbObservation> => {
    if (closing !== undefined) return Promise.reject(new Error('orb native client: backend is closed'))
    const active = AbortSignal.any([lifetime.signal, AbortSignal.timeout(TIMEOUT_MS), ...(signal === undefined ? [] : [signal])])
    const operation = (async () => {
      active.throwIfAborted()
      const response = await fetcher(`${endpoint.origin}${ROUTE}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-dsh-desktop-orb-secret': endpoint.secret },
        body: JSON.stringify(body), cache: 'no-store', redirect: 'error', signal: active,
      })
      if (!response.ok) throw new Error(`orb native client: Desktop returned HTTP ${String(response.status)}`)
      const length = Number(response.headers.get('content-length'))
      if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) throw new Error('orb native client: response too large')
      return parsedObservation(await boundedResponse(response, active))
    })()
    pending.add(operation)
    void operation.finally(() => { pending.delete(operation) }).catch(() => {})
    return operation
  }
  return {
    observe: signal => request({ operation: 'observe' }, signal),
    act: (frameId, action, signal) => request({ operation: 'act', frameId, action }, signal),
    close() {
      if (closing !== undefined) return closing
      lifetime.abort()
      closing = (async () => { await Promise.allSettled(pending); await release() })()
      return closing
    },
  }
}

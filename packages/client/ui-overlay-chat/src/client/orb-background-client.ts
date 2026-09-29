/** Authenticated same-origin background-task calls for the local Desktop Orb. */

const ROUTE = '/api/desktop.orb-background'
const SESSION_PATTERN = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const TIMEOUT_MS = 15_000

/** Worker facts confirmed by the local Host's durable ownership records. */
export interface OrbBackgroundWorker {
  readonly sessionId: string
  readonly running: boolean
}

/** Renderer-facing operations; no caller identity is accepted from the page. */
export interface OrbBackgroundClient {
  list(): Promise<readonly OrbBackgroundWorker[] | undefined>
  submit(task: string): Promise<string>
  stop(workerSessionId: string): Promise<void>
}

function requireWorker(value: unknown): OrbBackgroundWorker {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('orb background: malformed worker')
  const worker = value as Record<string, unknown>
  if (typeof worker.sessionId !== 'string' || !SESSION_PATTERN.test(worker.sessionId)
    || typeof worker.running !== 'boolean') throw new Error('orb background: malformed worker')
  return { sessionId: worker.sessionId, running: worker.running }
}

/** Create a client that relies on ordinary Connection cookies and same-origin checks.
 * @param fetcher - Browser fetch implementation.
 * @returns Bounded background-task requests for the floating renderer.
 */
export function createOrbBackgroundClient(fetcher: typeof fetch): OrbBackgroundClient {
  const call = async (method: 'GET' | 'POST', body?: object): Promise<Response> => fetcher(ROUTE, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
    credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  return {
    async list() {
      const response = await call('GET')
      if (response.status === 403 || response.status === 404) return undefined
      if (!response.ok) throw new Error('orb background: list unavailable')
      const body: unknown = await response.json()
      if (typeof body !== 'object' || body === null || Array.isArray(body)
        || !('workers' in body) || !Array.isArray(body.workers)) {
        throw new Error('orb background: malformed worker list')
      }
      return body.workers.map(requireWorker)
    },
    async submit(task) {
      const response = await call('POST', { operation: 'submit', task })
      if (!response.ok) throw new Error('orb background: submission unavailable')
      const body: unknown = await response.json()
      if (typeof body !== 'object' || body === null || Array.isArray(body)
        || !('sessionId' in body) || typeof body.sessionId !== 'string' || !SESSION_PATTERN.test(body.sessionId)) {
        throw new Error('orb background: malformed submission receipt')
      }
      return body.sessionId
    },
    async stop(workerSessionId) {
      if (!SESSION_PATTERN.test(workerSessionId)) throw new Error('orb background: invalid worker identity')
      const response = await call('POST', { operation: 'stop', workerSessionId })
      if (!response.ok) throw new Error('orb background: stop unavailable')
    },
  }
}

/** Ensure the Host-owned floating-chat Session without leaking Desktop authority to a renderer. */

import { createHash } from 'node:crypto'

const ROUTE = '/api/desktop.orb-caller'
const TIMEOUT_MS = 5000

export interface OrbCallerCookieStore {
  get(filter: { readonly url: string }): Promise<readonly { readonly name: string; readonly value: string }[]>
}

/** Use only the current ready loopback Host generation and its private secret. */
export async function ensureLocalOrbCaller(
  origin: string,
  secret: string,
  cookies: OrbCallerCookieStore,
  fetcher: (url: string, init: RequestInit) => Promise<Response>,
): Promise<string> {
  const url = new URL(origin)
  const port = Number(url.port)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1'
    || url.username !== '' || url.password !== '' || url.pathname !== '/'
    || url.search !== '' || url.hash !== '' || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError('orb caller: expected the ready local Harness origin')
  }
  if (!/^[A-Za-z0-9_-]{43}$/u.test(secret)) throw new TypeError('orb caller: invalid generation authority')
  const name = `dsh-auth-${createHash('sha256').update(url.host).digest('base64url')}`
  const cookie = (await cookies.get({ url: url.href })).find(entry => entry.name === name)
  if (cookie === undefined || cookie.value === '') throw new Error('orb caller: authenticated Harness session is unavailable')
  const response = await fetcher(`${url.origin}${ROUTE}`, {
    method: 'POST',
    headers: { Cookie: `${name}=${cookie.value}`, 'x-dsh-desktop-orb-secret': secret },
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`orb caller: Host returned HTTP ${String(response.status)}`)
  const body: unknown = await response.json()
  if (typeof body !== 'object' || body === null || Array.isArray(body)
    || !('sessionId' in body) || typeof body.sessionId !== 'string'
    || !/^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(body.sessionId)) {
    throw new Error('orb caller: Host returned an invalid Session identity')
  }
  return body.sessionId
}

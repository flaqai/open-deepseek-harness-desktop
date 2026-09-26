/** Read the local Web Host's task facts before an ordinary Desktop quit. */

import { createHash } from 'node:crypto'
import type { DesktopQuitInspection } from './quit-confirmation.ts'

const ROUTE = '/api/desktop.quit-inspection'
const INSPECTION_TIMEOUT_MS = 1800

/** Only the current loopback Harness cookie may authenticate this request. */
export interface QuitInspectionCookieStore {
  get(filter: { readonly url: string }): Promise<readonly { readonly name: string; readonly value: string }[]>
}

/** Minimal fetch seam for the local Host request. */
export type QuitInspectionFetch = (url: string, init: RequestInit) => Promise<Response>

/**
 * Query the authenticated, Desktop-only Host route without visiting NAS or
 * exposing the browser session cookie to any other authority.
 * @param origin - The ready local Harness origin, never a user-provided URL.
 * @param cookies - Session of the renderer that completed the token exchange.
 * @param fetcher - Network fetch used only for this validated loopback origin.
 */
export async function inspectLocalHarnessQuit(
  origin: string,
  cookies: QuitInspectionCookieStore,
  fetcher: QuitInspectionFetch,
): Promise<DesktopQuitInspection> {
  const url = new URL(origin)
  const port = Number(url.port)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1'
    || url.username !== '' || url.password !== '' || url.pathname !== '/'
    || url.search !== '' || url.hash !== '' || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError('desktop quit: expected the ready loopback Harness origin')
  }
  const name = `dsh-auth-${createHash('sha256').update(url.host).digest('base64url')}`
  const cookie = (await cookies.get({ url: url.href })).find(entry => entry.name === name)
  if (cookie === undefined || cookie.value === '') {
    throw new Error('desktop quit: authenticated Harness session is unavailable')
  }
  const response = await fetcher(`${url.origin}${ROUTE}`, {
    method: 'GET',
    headers: { Cookie: `${name}=${cookie.value}` },
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(INSPECTION_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`desktop quit: Host inspection returned HTTP ${String(response.status)}`)
  const body: unknown = await response.json()
  if (typeof body !== 'object' || body === null || Array.isArray(body)
    || !('activeTasks' in body) || typeof body.activeTasks !== 'boolean'
    || !('scheduledTasks' in body) || typeof body.scheduledTasks !== 'boolean') {
    throw new Error('desktop quit: Host inspection returned malformed task facts')
  }
  return { activeTasks: body.activeTasks, scheduledTasks: body.scheduledTasks }
}

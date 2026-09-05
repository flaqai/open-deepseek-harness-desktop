/** Browser-only handoff back to the Electron window that opened this page. */

const FRAGMENT_KEY = 'dsh-desktop-return'
const STORAGE_KEY = 'dsh.desktop-return.v1'
const TOKEN = /^[A-Za-z0-9_-]+$/u

/** Minimal browser history dependency used by the handoff capture. */
export interface DesktopReturnHistory {
  readonly state: unknown
  replaceState(data: unknown, unused: string, url?: string | URL | null): void
}

/** Validate the Electron-owned reveal endpoint.
 * @param raw - Candidate callback URL from the browser fragment or session storage.
 * @returns Normalized callback URL.
 */
export function parseDesktopReturnUrl(raw: string): string {
  const url = new URL(raw)
  const tokens = url.searchParams.getAll('token')
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port === ''
    || url.username !== '' || url.password !== '' || url.pathname !== '/show' || url.hash !== ''
    || [...url.searchParams.keys()].some(key => key !== 'token')
    || tokens.length !== 1 || !TOKEN.test(tokens[0] ?? '')) {
    throw new TypeError('desktop shell: invalid browser return URL')
  }
  const port = Number(url.port)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError('desktop shell: invalid browser return port')
  }
  return url.href
}

/** Capture a generation-scoped return target and remove it from the visible URL.
 * @param location - Current browser location.
 * @param storage - Per-tab session storage.
 * @param history - Browser history used to scrub the fragment.
 * @returns Validated return target, or undefined for an independent Web session.
 */
export function captureDesktopReturnTarget(
  location: Pick<Location, 'hash' | 'pathname' | 'search'> = window.location,
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = window.sessionStorage,
  history: DesktopReturnHistory = window.history,
): string | undefined {
  const prefix = `#${FRAGMENT_KEY}=`
  if (location.hash.startsWith(prefix)) {
    try {
      const target = parseDesktopReturnUrl(decodeURIComponent(location.hash.slice(prefix.length)))
      storage.setItem(STORAGE_KEY, target)
      history.replaceState(history.state, '', `${location.pathname}${location.search}`)
      return target
    } catch {
      storage.removeItem(STORAGE_KEY)
      history.replaceState(history.state, '', `${location.pathname}${location.search}`)
      return undefined
    }
  }
  const saved = storage.getItem(STORAGE_KEY)
  if (saved === null) return undefined
  try {
    return parseDesktopReturnUrl(saved)
  } catch {
    storage.removeItem(STORAGE_KEY)
    return undefined
  }
}

/** Request that the owning desktop client reveal its window.
 * @param target - Validated Electron-owned callback URL.
 * @param request - Browser fetch implementation.
 */
export async function requestDesktopReturn(
  target: string,
  request: typeof fetch = window.fetch.bind(window),
): Promise<void> {
  const response = await request(parseDesktopReturnUrl(target), {
    method: 'POST',
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
}

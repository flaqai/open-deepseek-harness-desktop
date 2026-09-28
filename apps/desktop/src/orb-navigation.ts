/** Exact document admission for the dedicated floating renderer. */

import { pathToFileURL } from 'node:url'

/** Admit only the packaged shell or the currently authenticated Harness chat route.
 * @param documentUrl - Electron navigation or IPC frame URL.
 * @param shellPage - Fixed local shell path.
 * @param harnessOrigin - Current local or paired NAS Harness origin, when ready.
 * @returns Whether the top-level document is owned by the floating surface.
 */
export function isTrustedOrbPage(
  documentUrl: string, shellPage: string, harnessOrigin: string | undefined,
): boolean {
  if (documentUrl === pathToFileURL(shellPage).href) return true
  if (harnessOrigin === undefined) return false
  try {
    const page = new URL(documentUrl)
    return page.origin === harnessOrigin && page.pathname === '/'
      && page.searchParams.size === 1 && page.searchParams.get('surface') === 'orb'
      && page.hash === ''
  } catch { return false }
}

/** A NAS chat may open only after its selected HTTPS origin finished connecting.
 * The same origin is subject to Desktop's exact-origin bearer and certificate rules.
 * @param runtime - The NAS fixed for this Desktop process.
 * @param harnessOrigin - Current authenticated Harness origin.
 * @param connected - Whether the NAS main document loaded after health validation.
 * @returns Whether the floating chat may use this remote origin.
 */
export function nasOrbChatReady(
  runtime: { readonly baseUrl: string } | undefined,
  harnessOrigin: string | undefined,
  connected: boolean,
): boolean {
  if (runtime === undefined || harnessOrigin === undefined || !connected) return false
  try {
    const origin = new URL(harnessOrigin)
    return origin.protocol === 'https:' && origin.origin === runtime.baseUrl
  } catch { return false }
}

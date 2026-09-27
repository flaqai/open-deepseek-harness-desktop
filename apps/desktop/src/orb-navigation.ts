/** Exact document admission for the dedicated floating renderer. */

import { pathToFileURL } from 'node:url'

/** Admit only the packaged shell or the local authenticated chat route.
 * @param documentUrl - Electron navigation or IPC frame URL.
 * @param shellPage - Fixed local shell path.
 * @param harnessOrigin - Current local Harness origin, when ready.
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

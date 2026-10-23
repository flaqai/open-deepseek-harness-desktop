/** Main-document anchor navigation through the authenticated Desktop bridge. */
import { parseExternalBrowserUrl } from './sidebar-iframe-security.ts'

/**
 * Route unhandled HTTP(S) anchor activations without depending on referrer headers.
 * Page-owned handlers run first; embedded documents, downloads and non-HTTP(S)
 * destinations retain their existing behavior. The main process still validates
 * the sender frame and excludes the active Harness listener.
 * @param document - The preload's document; nested documents install no listeners.
 * @param open - Main-frame IPC operation for one validated external destination.
 * @param failed - Receives a rejected system-browser operation without retrying it.
 * @returns Removes the document-lifetime listeners.
 */
export function installExternalAnchorNavigation(
  document: Document,
  open: (url: string) => Promise<void>,
  failed: (error: unknown) => void,
): () => void {
  const view = document.defaultView
  if (view === null || view !== view.top) return () => {}
  const activate = (event: MouseEvent): void => {
    if (event.defaultPrevented || (event.type === 'click' ? event.button !== 0 : event.button !== 1)) return
    const anchor = event.composedPath().find((node): node is HTMLAnchorElement => node instanceof view.HTMLAnchorElement)
    if (anchor === undefined || anchor.hasAttribute('download') || !anchor.hasAttribute('href')) return
    let target: string
    try { target = parseExternalBrowserUrl(anchor.href, document.location.origin) }
    catch { return /* Internal links and unsafe protocols are not external navigation. */ }
    event.preventDefault()
    void open(target).catch(failed)
  }
  view.addEventListener('click', activate)
  view.addEventListener('auxclick', activate)
  return () => {
    view.removeEventListener('click', activate)
    view.removeEventListener('auxclick', activate)
  }
}

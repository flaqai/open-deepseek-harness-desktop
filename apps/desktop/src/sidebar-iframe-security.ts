/** Main-process guardrails for untrusted documents embedded in the Harness renderer. */

const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Match the active Harness listener, including loopback aliases for its port. */
export function isHarnessAddress(value: string, harnessOrigin: string | undefined): boolean {
  if (harnessOrigin === undefined) return false
  try {
    const target = new URL(value)
    const harness = new URL(harnessOrigin)
    return target.port === harness.port && target.protocol === harness.protocol
      && (target.hostname === harness.hostname
        || (LOOPBACK_NAMES.has(target.hostname) && LOOPBACK_NAMES.has(harness.hostname)))
  } catch {
    return false
  }
}

/** Only a top-level Harness document may open an external URL through the explicit bridge. */
export function parseExternalBrowserUrl(value: unknown, harnessOrigin: string | undefined): string {
  if (typeof value !== 'string' || value.length > 16 * 1024) throw new Error('desktop: invalid external URL')
  let url: URL
  try { url = new URL(value) } catch { throw new Error('desktop: invalid external URL') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username !== '' || url.password !== ''
    || isHarnessAddress(url.href, harnessOrigin)) throw new Error('desktop: external URL is not allowed')
  return url.href
}

/** Preserve ordinary HTTPS links from the Harness document, never embedded-origin popups. */
export function trustedRendererPopupUrl(
  value: string,
  referrer: string,
  harnessOrigin: string | undefined,
  hasPostBody: boolean,
): string | undefined {
  if (harnessOrigin === undefined || hasPostBody) return undefined
  try {
    if (new URL(referrer).origin !== harnessOrigin) return undefined
    const target = parseExternalBrowserUrl(value, harnessOrigin)
    return new URL(target).protocol === 'https:' ? target : undefined
  } catch {
    return undefined
  }
}

/** Prevent nested documents from loading authenticated Harness pages or addressing the top-level app. */
export function blockEmbeddedNavigation(
  value: string,
  harnessOrigin: string | undefined,
  isMainFrame: boolean,
  initiatedBySubframe: boolean,
): boolean {
  return isMainFrame ? initiatedBySubframe : isHarnessAddress(value, harnessOrigin)
}

/** Cover programmatic iframe loads and subresource requests, which navigation events can miss. */
export function blockEmbeddedRequest(
  value: string,
  harnessOrigin: string | undefined,
  resourceType: string,
  hasParentFrame: boolean,
): boolean {
  return (resourceType === 'subFrame' || hasParentFrame) && isHarnessAddress(value, harnessOrigin)
}

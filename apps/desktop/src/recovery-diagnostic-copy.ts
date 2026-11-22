/** Native diagnostic copying for the local recovery main frame only. */

interface RecoveryCopyRequest {
  readonly sender: unknown
  readonly frame: unknown
  readonly url: string
}

interface RecoveryCopyOwner {
  readonly sender: unknown
  readonly mainFrame: unknown
  readonly loadingUrl: string
  readonly local: boolean
}

/**
 * Copy a main-process diagnostic after validating the local recovery frame.
 * @param request - IPC sender and current frame URL, never renderer-supplied text.
 * @param owner - Current main renderer and its packaged loading-page URL.
 * @param diagnostic - Main-process failure text and optional private home to redact.
 * @param writeText - Native clipboard operation; its failure reaches the caller.
 * @returns Nothing after the bounded redacted diagnostic is written.
 */
export async function copyRecoveryDiagnostic(
  request: RecoveryCopyRequest,
  owner: RecoveryCopyOwner,
  diagnostic: () => { readonly text: string; readonly home?: string },
  writeText: (text: string) => void | Promise<void>,
): Promise<void> {
  const actual = new URL(request.url)
  const expected = new URL(owner.loadingUrl)
  actual.search = ''
  actual.hash = ''
  expected.search = ''
  expected.hash = ''
  if (!owner.local || owner.sender === undefined || owner.mainFrame === undefined
    || request.sender !== owner.sender || request.frame === undefined || request.frame === null
    || request.frame !== owner.mainFrame || actual.protocol !== 'file:' || actual.href !== expected.href) {
    throw new Error('desktop: diagnostic copy requires the local recovery main frame')
  }
  const payload = diagnostic()
  const bounded = payload.text.slice(0, 32_768)
  let text = payload.home === undefined || payload.home === '' ? bounded : bounded.replaceAll(payload.home, '<dsh-home>')
  text = text.replace(/\bBearer\s+[a-z0-9._~+/=-]+/giu, 'Bearer <redacted>')
  text = text.replace(/\b(api[ _-]?key|token|password|secret|authorization|cookie)(\s*[:=]\s*)([^\s,;]+)/giu, '$1$2<redacted>')
  if (text.trim() === '') throw new Error('desktop: no recovery diagnostic is available')
  await writeText(text.slice(0, 8_192))
}

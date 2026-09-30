/** Restricted community feedback payloads and fixed-destination delivery. */

/** Enable only after the Worker, sender domain and destination mailbox are verified. */
export const COMMUNITY_FEEDBACK_ENDPOINT: string | null = null
export const COMMUNITY_FEEDBACK_EMAIL = 'odsh_hecoococ@163.com'

export interface CommunityFeedbackInput {
  kind: 'bug' | 'idea' | 'other'
  title: string
  body: string
  replyEmail?: string
  requestId?: string
}

/** Reject fields beyond the small, user-authored feedback vocabulary. */
export function parseCommunityFeedbackInput(value: unknown, requireRequestId: boolean): CommunityFeedbackInput {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid feedback')
  const entry = value as Record<string, unknown>
  const allowed = new Set(['kind', 'title', 'body', 'replyEmail', 'requestId'])
  if (Object.keys(entry).some(key => !allowed.has(key))) throw new TypeError('Invalid feedback fields')
  if (entry.kind !== 'bug' && entry.kind !== 'idea' && entry.kind !== 'other') throw new TypeError('Invalid feedback type')
  if (typeof entry.title !== 'string' || (requireRequestId && entry.title.trim().length < 3) || entry.title.length > 120) throw new TypeError('Invalid feedback title')
  if (typeof entry.body !== 'string' || (requireRequestId && entry.body.trim().length < 10) || entry.body.length > 4_000) throw new TypeError('Invalid feedback body')
  if (entry.replyEmail !== undefined && (typeof entry.replyEmail !== 'string' || entry.replyEmail.length > 254
    || (requireRequestId && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(entry.replyEmail)))) throw new TypeError('Invalid reply email')
  if (requireRequestId && (typeof entry.requestId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(entry.requestId))) {
    throw new TypeError('Invalid feedback request ID')
  }
  return {
    kind: entry.kind,
    title: entry.title.trim(),
    body: entry.body.trim(),
    ...(entry.replyEmail === undefined ? {} : { replyEmail: entry.replyEmail }),
    ...(entry.requestId === undefined ? {} : { requestId: entry.requestId as string }),
  }
}

/** Compose only a fixed-recipient mail action; never accept a URL from the renderer. */
export function communityFeedbackMailto(input: CommunityFeedbackInput, version: string, platform: string): string {
  const subject = `[ODSH ${input.kind}] ${input.title.replace(/[\r\n]/gu, ' ') || 'Community feedback'}`
  const body = `${input.body}\n\nDesktop: ${version}\nOS: ${platform}${input.replyEmail ? `\nReply to: ${input.replyEmail}` : ''}`
  return `mailto:${COMMUNITY_FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

/** Deliver one bounded request; only an acknowledged, durable response counts as received. */
export async function submitCommunityFeedback(
  input: CommunityFeedbackInput,
  version: string,
  platform: string,
  endpoint: string | null,
  fetcher: typeof fetch,
): Promise<{ status: 'received' | 'unavailable' | 'rate-limited' | 'failed'; id?: string }> {
  if (endpoint === null) return { status: 'unavailable' }
  const url = new URL(endpoint)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/v1/feedback') {
    throw new TypeError('Invalid community feedback endpoint')
  }
  try {
    const response = await fetcher(url, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...input, desktopVersion: version, platform }),
      signal: AbortSignal.timeout(15_000),
    })
    if (response.status === 429) return { status: 'rate-limited' }
    if (response.status !== 202) return { status: 'failed' }
    const value: unknown = await response.json()
    if (value === null || typeof value !== 'object' || !('id' in value)
      || typeof value.id !== 'string' || !/^[0-9a-f-]{36}$/iu.test(value.id)) return { status: 'failed' }
    return { status: 'received', id: value.id }
  } catch {
    return { status: 'failed' }
  }
}

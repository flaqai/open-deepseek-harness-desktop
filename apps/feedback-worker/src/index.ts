/** Anonymous, bounded community feedback ingress with daily operator digests. */

export interface FeedbackEnvironment {
  DB: {
    prepare(query: string): {
      bind(...values: unknown[]): {
        first<T>(): Promise<T | null>
        // eslint-disable-next-line typescript/no-unnecessary-type-parameters -- Matches the typed D1 query API.
        all<T>(): Promise<{ results: T[] }>
        run(): Promise<unknown>
      }
    }
  }
  RATE_LIMIT: { limit(input: { key: string }): Promise<{ success: boolean }> }
  EMAIL: { send(message: { from: string; to: string; subject: string; text: string }): Promise<{ messageId: string }> }
  MAIL_FROM: string
  FEEDBACK_TO_EMAIL: string
  ADMIN_TOKEN: string
}

interface FeedbackRecord {
  id: number
  public_id: string
  request_id: string
  kind: string
  title: string
  body: string
  reply_email: string | null
  desktop_version: string
  platform: string
  created_at: string
}

type SavedFeedback = Pick<FeedbackRecord, 'public_id' | 'kind' | 'title' | 'body' | 'reply_email' | 'desktop_version' | 'platform'>

function receipt(saved: SavedFeedback, input: ReturnType<typeof parseFeedback>): Response {
  if (saved.kind !== input.kind || saved.title !== input.title || saved.body !== input.body
    || saved.reply_email !== input.replyEmail || saved.desktop_version !== input.desktopVersion || saved.platform !== input.platform) {
    return json(409, { error: 'request-id-reused' })
  }
  return json(202, { id: saved.public_id })
}

const MAX_BYTES = 20_480
const MAX_DAILY = 10_000
const RETENTION_DAYS = 90

function json(status: number, value: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), { status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } })
}

async function boundedBody(request: Request): Promise<string> {
  if (Number(request.headers.get('content-length')) > MAX_BYTES) throw new Error('too-large')
  if (request.body === null) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const item = await reader.read()
    if (item.done) break
    total += item.value.byteLength
    if (total > MAX_BYTES) { await reader.cancel(); throw new Error('too-large') }
    chunks.push(item.value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

/** Admit only the documented fields; unknown metadata and credentials never enter storage. */
export function parseFeedback(value: unknown): {
  kind: 'bug' | 'idea' | 'other'
  title: string
  body: string
  replyEmail: string | null
  requestId: string
  desktopVersion: string
  platform: 'darwin' | 'win32' | 'linux'
} {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid feedback')
  const input = value as Record<string, unknown>
  const keys = new Set(['kind', 'title', 'body', 'replyEmail', 'requestId', 'desktopVersion', 'platform'])
  if (Object.keys(input).some(key => !keys.has(key))) throw new TypeError('Unknown feedback field')
  if (input.kind !== 'bug' && input.kind !== 'idea' && input.kind !== 'other') throw new TypeError('Invalid type')
  if (typeof input.title !== 'string' || input.title.trim().length < 3 || input.title.length > 120) throw new TypeError('Invalid title')
  if (typeof input.body !== 'string' || input.body.trim().length < 10 || input.body.length > 4_000) throw new TypeError('Invalid body')
  if (input.replyEmail !== undefined && (typeof input.replyEmail !== 'string' || input.replyEmail.length > 254
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(input.replyEmail))) throw new TypeError('Invalid email')
  if (typeof input.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(input.requestId)) throw new TypeError('Invalid request ID')
  if (typeof input.desktopVersion !== 'string' || !/^[0-9A-Za-z.-]{1,64}$/u.test(input.desktopVersion)) throw new TypeError('Invalid version')
  if (input.platform !== 'darwin' && input.platform !== 'win32' && input.platform !== 'linux') throw new TypeError('Invalid platform')
  return { kind: input.kind, title: input.title.trim(), body: input.body.trim(),
    replyEmail: typeof input.replyEmail === 'string' ? input.replyEmail : null,
    requestId: input.requestId, desktopVersion: input.desktopVersion, platform: input.platform }
}

async function receive(request: Request, env: FeedbackEnvironment): Promise<Response> {
  if (request.headers.get('content-type')?.split(';', 1)[0] !== 'application/json') return json(415, { error: 'content-type' })
  let input: ReturnType<typeof parseFeedback>
  try { input = parseFeedback(JSON.parse(await boundedBody(request))) }
  catch (error) { return json(error instanceof Error && error.message === 'too-large' ? 413 : 400, { error: 'invalid-feedback' }) }
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
  try {
    const rate = await env.RATE_LIMIT.limit({ key: ip })
    if (!rate.success) return json(429, { error: 'rate-limited' }, { 'retry-after': '60' })
    const duplicate = await env.DB.prepare('SELECT public_id, kind, title, body, reply_email, desktop_version, platform FROM feedback WHERE request_id = ?').bind(input.requestId)
      .first<SavedFeedback>()
    if (duplicate !== null) return receipt(duplicate, input)
    const day = new Date().toISOString().slice(0, 10)
    // eslint-disable-next-line no-restricted-properties -- Cloudflare Workers always provide this secure-context API.
    const id = crypto.randomUUID()
    await env.DB.prepare(`INSERT OR IGNORE INTO feedback
      (public_id, request_id, kind, title, body, reply_email, desktop_version, platform, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE (SELECT COUNT(*) FROM feedback WHERE created_at >= ?) < ?`)
      .bind(id, input.requestId, input.kind, input.title, input.body, input.replyEmail,
        input.desktopVersion, input.platform, new Date().toISOString(), `${day}T00:00:00.000Z`, MAX_DAILY).run()
    const saved = await env.DB.prepare('SELECT public_id, kind, title, body, reply_email, desktop_version, platform FROM feedback WHERE request_id = ?').bind(input.requestId)
      .first<SavedFeedback>()
    if (saved === null) return json(429, { error: 'daily-limit' }, { 'retry-after': '3600' })
    return receipt(saved, input)
  } catch {
    return json(503, { error: 'storage-unavailable' })
  }
}

function tokenMatches(provided: string, expected: string): boolean {
  if (typeof expected !== 'string' || provided.length !== expected.length || expected.length < 32) return false
  let diff = 0
  for (let index = 0; index < expected.length; index += 1) diff |= provided.charCodeAt(index) ^ expected.charCodeAt(index)
  return diff === 0
}

async function exportFeedback(request: Request, env: FeedbackEnvironment): Promise<Response> {
  const token = request.headers.get('authorization')?.replace(/^Bearer /u, '') ?? ''
  if (!tokenMatches(token, env.ADMIN_TOKEN)) return json(401, { error: 'unauthorized' })
  const cursor = Number(new URL(request.url).searchParams.get('cursor') ?? '0')
  if (!Number.isSafeInteger(cursor) || cursor < 0) return json(400, { error: 'invalid-cursor' })
  const rows = await env.DB.prepare(`SELECT id, public_id, request_id, kind, title, body, reply_email,
      desktop_version, platform, created_at FROM feedback WHERE id > ? ORDER BY id ASC LIMIT 100`)
    .bind(cursor).all<FeedbackRecord>()
  return json(200, { items: rows.results, nextCursor: rows.results.at(-1)?.id ?? null })
}

/** HTTP entry; no CORS response is emitted because the Desktop host sends requests. */
export async function handleFeedbackRequest(request: Request, env: FeedbackEnvironment): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname === '/v1/feedback' && request.method === 'POST') return receive(request, env)
  if (url.pathname === '/v1/admin/feedback' && request.method === 'GET') return exportFeedback(request, env)
  return json(404, { error: 'not-found' })
}

/** Send a bounded daily digest, then mark the covered records; failed sends remain pending. */
export async function runDailyDigest(env: FeedbackEnvironment, now = new Date()): Promise<void> {
  const expiry = new Date(now.getTime() - RETENTION_DAYS * 86_400_000).toISOString()
  await env.DB.prepare('DELETE FROM feedback WHERE created_at < ?').bind(expiry).run()
  const cutoff = now.toISOString()
  const boundary = await env.DB.prepare('SELECT MAX(id) AS id FROM feedback WHERE notified_at IS NULL AND created_at <= ?')
    .bind(cutoff).first<{ id: number | null }>()
  const maxId = boundary?.id ?? 0
  const count = await env.DB.prepare('SELECT kind, COUNT(*) AS count FROM feedback WHERE notified_at IS NULL AND created_at <= ? AND id <= ? GROUP BY kind')
    .bind(cutoff, maxId).all<{ kind: string; count: number }>()
  const total = count.results.reduce((sum, row) => sum + row.count, 0)
  if (total > 0) {
    const preview = await env.DB.prepare(`SELECT id, public_id, request_id, kind, title, body, reply_email,
      desktop_version, platform, created_at FROM feedback WHERE notified_at IS NULL AND created_at <= ? AND id <= ? ORDER BY id ASC LIMIT 50`)
      .bind(cutoff, maxId).all<FeedbackRecord>()
    const summary = count.results.map(row => `${row.kind}: ${row.count}`).join(', ')
    const sample = preview.results.map(row => `${row.public_id} [${row.kind}] ${row.title}`).join('\n')
    await env.EMAIL.send({ from: env.MAIL_FROM, to: env.FEEDBACK_TO_EMAIL,
      subject: `ODSH feedback digest: ${total} received`,
      text: `${summary}\n\nFirst ${preview.results.length} submissions:\n${sample}\n\nExport the full queue with the protected admin endpoint.`,
    })
    await env.DB.prepare('UPDATE feedback SET notified_at = ? WHERE notified_at IS NULL AND created_at <= ? AND id <= ?')
      .bind(cutoff, cutoff, maxId).run()
  }
}

export default {
  fetch: handleFeedbackRequest,
  scheduled: (_controller: unknown, env: FeedbackEnvironment) => runDailyDigest(env),
}

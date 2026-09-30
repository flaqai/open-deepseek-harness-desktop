import { readFileSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleFeedbackRequest, parseFeedback, runDailyDigest, type FeedbackEnvironment } from '../src/index.ts'

const requestId = '123e4567-e89b-42d3-a456-426614174000'
const input = { kind: 'bug', title: 'Update check failed', body: 'The update button did not return any result.',
  requestId, desktopVersion: '0.2.0-rc.2.1', platform: 'darwin' }

function fixture() {
  const database = new DatabaseSync(':memory:')
  database.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'))
  databases.push(database)
  let limited = false
  let failStore = false
  const db: FeedbackEnvironment['DB'] = {
    prepare(query) {
      return { bind(...values: unknown[]) {
        return {
          async first<T>() {
            if (failStore) throw new Error('storage offline')
            return (database.prepare(query).get(...values as SQLInputValue[]) ?? null) as T | null
          },
          // eslint-disable-next-line typescript/no-unnecessary-type-parameters -- Implements the typed D1 query adapter.
          async all<T>() {
            return { results: database.prepare(query).all(...values as SQLInputValue[]) as T[] }
          },
          async run() {
            if (failStore) throw new Error('storage offline')
            return database.prepare(query).run(...values as SQLInputValue[])
          },
        }
      } }
    },
  }
  const send = vi.fn().mockResolvedValue({ messageId: 'test-message' })
  const env: FeedbackEnvironment = { DB: db, RATE_LIMIT: { limit: async () => ({ success: !limited }) },
    EMAIL: { send }, MAIL_FROM: 'feedback@example.test', FEEDBACK_TO_EMAIL: 'odsh_hecoococ@163.com',
    ADMIN_TOKEN: 'a'.repeat(40) }
  return { env, database, get rows() { return database.prepare('SELECT * FROM feedback ORDER BY id').all() },
    send, setLimited(value: boolean) { limited = value }, setFailStore(value: boolean) { failStore = value } }
}

const databases: DatabaseSync[] = []
afterEach(() => { for (const database of databases.splice(0)) database.close() })

const post = (body: unknown) => new Request('https://feedback.example.test/v1/feedback', {
  method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.1' },
  body: JSON.stringify(body),
})

describe('community feedback worker', () => {
  it('rejects unrecognized fields, malformed metadata and oversized content', () => {
    expect(() => parseFeedback({ ...input, token: 'secret' })).toThrow()
    expect(() => parseFeedback({ ...input, platform: 'unknown' })).toThrow()
    expect(() => parseFeedback({ ...input, title: 'x'.repeat(121) })).toThrow()
  })

  it('acknowledges only saved feedback and deduplicates retry IDs', async () => {
    const f = fixture()
    const accepted = await handleFeedbackRequest(post(input), f.env)
    expect(accepted.status).toBe(202)
    const first = await accepted.json() as { id: string }
    expect(f.rows).toHaveLength(1)
    const duplicate = await handleFeedbackRequest(post(input), f.env)
    expect(await duplicate.json()).toEqual(first)
    expect(f.rows).toHaveLength(1)
    expect((await handleFeedbackRequest(post({ ...input, body: 'A different report with the same request ID.' }), f.env)).status).toBe(409)
    f.setFailStore(true)
    const failed = await handleFeedbackRequest(post({ ...input, requestId: '223e4567-e89b-42d3-a456-426614174000' }), f.env)
    expect(failed.status).toBe(503)
  })

  it('rejects rate-limited and invalid requests without storage', async () => {
    const f = fixture()
    f.setLimited(true)
    expect((await handleFeedbackRequest(post(input), f.env)).status).toBe(429)
    expect((await handleFeedbackRequest(post({ ...input, apiKey: 'secret' }), f.env)).status).toBe(400)
    expect((await handleFeedbackRequest(post({ ...input, body: 'x'.repeat(25_000) }), f.env)).status).toBe(413)
    expect(f.rows).toHaveLength(0)
  })

  it('protects export, sends one digest and retains pending records after mail failure', async () => {
    const f = fixture()
    await handleFeedbackRequest(post(input), f.env)
    const adminUrl = 'https://feedback.example.test/v1/admin/feedback'
    expect((await handleFeedbackRequest(new Request(adminUrl), f.env)).status).toBe(401)
    const exported = await handleFeedbackRequest(new Request(adminUrl, {
      headers: { authorization: `Bearer ${f.env.ADMIN_TOKEN}` },
    }), f.env)
    expect((await exported.json() as { items: unknown[] }).items).toHaveLength(1)
    f.send.mockRejectedValueOnce(new Error('delivery failed'))
    await expect(runDailyDigest(f.env)).rejects.toThrow('delivery failed')
    expect(f.rows[0]?.notified_at).toBeNull()
    await runDailyDigest(f.env)
    expect(f.rows[0]?.notified_at).not.toBeNull()
    expect(f.send).toHaveBeenCalledTimes(2)
    await runDailyDigest(f.env)
    expect(f.send).toHaveBeenCalledTimes(2)
  })

  it('enforces the daily storage limit atomically across simultaneous requests', async () => {
    const f = fixture()
    const seed = f.database.prepare(`INSERT INTO feedback
      (public_id, request_id, kind, title, body, desktop_version, platform, created_at)
      VALUES (?, ?, 'bug', 'seed', 'seed record', '0.2.0', 'darwin', ?)`)
    const created = new Date().toISOString()
    f.database.exec('BEGIN')
    for (let index = 0; index < 9_999; index += 1) seed.run(`public-${index}`, `request-${index}`, created)
    f.database.exec('COMMIT')
    const results = await Promise.all([input, { ...input, requestId: '223e4567-e89b-42d3-a456-426614174000' }]
      .map(value => handleFeedbackRequest(post(value), f.env)))
    expect(results.map(result => result.status).sort()).toEqual([202, 429])
    expect(f.rows).toHaveLength(10_000)
  })

  it('keeps arrivals during delivery pending and removes expired reports even when email fails', async () => {
    const f = fixture()
    await handleFeedbackRequest(post(input), f.env)
    f.send.mockImplementationOnce(async () => {
      await handleFeedbackRequest(post({ ...input, requestId: '223e4567-e89b-42d3-a456-426614174000' }), f.env)
      return { messageId: 'digest-1' }
    })
    await runDailyDigest(f.env)
    expect(f.rows[0]?.notified_at).not.toBeNull()
    expect(f.rows[1]?.notified_at).toBeNull()
    f.database.prepare('UPDATE feedback SET created_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', 1)
    f.send.mockRejectedValueOnce(new Error('mail unavailable'))
    await expect(runDailyDigest(f.env)).rejects.toThrow('mail unavailable')
    expect(f.rows).toHaveLength(1)
    expect(f.rows[0]?.notified_at).toBeNull()
  })
})

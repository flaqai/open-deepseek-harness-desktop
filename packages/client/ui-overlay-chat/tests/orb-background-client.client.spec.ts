import { describe, expect, it, vi } from 'vitest'
import { createOrbBackgroundClient } from '../src/client/orb-background-client.ts'

const SESSION = 'session-00000000-0000-4000-8000-000000000001'

describe('Orb background HTTP client', () => {
  it('uses the authenticated same-origin route without sending caller identity', async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => init.method === 'GET'
      ? Response.json({ workers: [{ sessionId: SESSION, running: true }] })
      : Response.json({ sessionId: SESSION }))
    const client = createOrbBackgroundClient(fetcher as typeof fetch)
    expect((await client.list())?.[0]?.sessionId).toBe(SESSION)
    expect(await client.submit('prepare')).toBe(SESSION)
    expect(fetcher).toHaveBeenCalledWith('/api/desktop.orb-background', expect.objectContaining({
      credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    }))
    const submit = fetcher.mock.calls.find(([, init]) => init.method === 'POST')
    const body = submit?.[1].body
    expect(typeof body).toBe('string')
    expect(JSON.parse(body as string)).toEqual({ operation: 'submit', task: 'prepare' })
  })

  it('treats a missing local route as unavailable and rejects malformed workers', async () => {
    const missing = createOrbBackgroundClient(async () => new Response(null, { status: 404 }))
    expect(await missing.list()).toBeUndefined()
    const malformed = createOrbBackgroundClient(async () => Response.json({ workers: [{ sessionId: '../other', running: true }] }))
    await expect(malformed.list()).rejects.toThrow('malformed worker')
  })
})

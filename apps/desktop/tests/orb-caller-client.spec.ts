import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { ensureLocalOrbCaller } from '../src/orb-caller-client.ts'

const ORIGIN = 'http://127.0.0.1:51234/'
const SECRET = 'A'.repeat(43)
const ID = 'session-11111111-2222-4333-8444-555555555555'
const cookieName = `dsh-auth-${createHash('sha256').update('127.0.0.1:51234').digest('base64url')}`

const cookies = { get: vi.fn(async () => [{ name: cookieName, value: 'private-cookie' }]) }

describe('Desktop Orb caller client', () => {
  it('sends the secret and browser cookie only to the exact current loopback Host', async () => {
    const fetcher = vi.fn(async () => Response.json({ sessionId: ID }))
    expect(await ensureLocalOrbCaller(ORIGIN, SECRET, cookies, fetcher)).toBe(ID)
    expect(fetcher).toHaveBeenCalledWith(`${ORIGIN.slice(0, -1)}/api/desktop.orb-caller`, expect.objectContaining({
      method: 'POST',
      redirect: 'error',
      headers: { Cookie: `${cookieName}=private-cookie`, 'x-dsh-desktop-orb-secret': SECRET },
    }))
  })

  it.each([
    'https://127.0.0.1:51234/',
    'http://localhost:51234/',
    'http://127.0.0.1:51234/path',
    'http://user@127.0.0.1:51234/',
    'http://192.168.1.2:51234/',
  ])('rejects a non-exact local authority before reading credentials: %s', async (origin) => {
    const credentialReader = { get: vi.fn(async () => []) }
    const fetcher = vi.fn()
    await expect(ensureLocalOrbCaller(origin, SECRET, credentialReader, fetcher)).rejects.toThrow('ready local Harness origin')
    expect(credentialReader.get).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects missing cookie, malformed authority, and malformed Host responses', async () => {
    const fetcher = vi.fn(async () => Response.json({ sessionId: ID }))
    await expect(ensureLocalOrbCaller(ORIGIN, 'short', cookies, fetcher)).rejects.toThrow('invalid generation authority')
    await expect(ensureLocalOrbCaller(ORIGIN, SECRET, { get: async () => [] }, fetcher))
      .rejects.toThrow('authenticated Harness session is unavailable')
    expect(fetcher).not.toHaveBeenCalled()
    await expect(ensureLocalOrbCaller(ORIGIN, SECRET, cookies, async () => Response.json({ sessionId: '../other' })))
      .rejects.toThrow('invalid Session identity')
    await expect(ensureLocalOrbCaller(ORIGIN, SECRET, cookies, async () => new Response('', { status: 403 })))
      .rejects.toThrow('HTTP 403')
  })
})

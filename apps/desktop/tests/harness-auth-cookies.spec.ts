import { describe, expect, it, vi } from 'vitest'
import { authenticateHarnessWelcome, clearStaleHarnessAuthCookies } from '../src/harness-auth-cookies.ts'

describe('Harness authentication cookie cleanup', () => {
  it('removes only stale Harness authentication cookies before a fresh token exchange', async () => {
    const stale = `dsh-auth-${'a'.repeat(43)}`
    const current = `dsh-auth-${'B'.repeat(42)}_`
    const remove = vi.fn(async () => undefined)
    const count = await clearStaleHarnessAuthCookies({
      get: vi.fn(async () => [
        { name: stale }, { name: current }, { name: 'unrelated-session' }, { name: 'dsh-auth-short' },
      ]),
      remove,
    }, 'http://127.0.0.1:43123/?token=fresh-token')

    expect(count).toBe(2)
    expect(remove.mock.calls).toEqual([
      ['http://127.0.0.1:43123/', stale],
      ['http://127.0.0.1:43123/', current],
    ])
  })

  it.each([
    'https://127.0.0.1:43123/?token=value',
    'http://localhost:43123/?token=value',
    'http://127.0.0.1/?token=value',
    'http://user@127.0.0.1:43123/?token=value',
  ])('rejects a non-Harness cookie origin: %s', async (url) => {
    await expect(clearStaleHarnessAuthCookies({
      get: vi.fn(async () => []), remove: vi.fn(async () => undefined),
    }, url)).rejects.toThrow('invalid Harness authentication URL')
  })
})

describe('native welcome authentication', () => {
  const url = 'http://127.0.0.1:43123/?token=current'
  const cookie = `dsh-auth-${'x'.repeat(43)}=signed-cookie`

  it('exchanges only the current token without a browser cookie jar or redirect', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {
      status: 303, headers: { location: './', 'set-cookie': `${cookie}; HttpOnly; Path=/` },
    }))
    await expect(authenticateHarnessWelcome(url, send)).resolves.toBe(cookie)
    expect(send).toHaveBeenCalledExactlyOnceWith(url, { redirect: 'manual', credentials: 'omit' })
  })

  it.each([
    { status: 500, location: './', cookies: [cookie] },
    { status: 303, location: 'https://example.com/', cookies: [cookie] },
    { status: 303, location: './', cookies: ['unrelated=value'] },
    { status: 303, location: './', cookies: [cookie.slice(0, cookie.indexOf('='))] },
    { status: 303, location: './', cookies: [cookie, cookie] },
  ])('rejects an invalid exchange: %j', async ({ status, location, cookies }) => {
    const headers = new Headers({ location })
    for (const value of cookies) headers.append('set-cookie', value)
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status, headers }))
    await expect(authenticateHarnessWelcome(url, send)).rejects.toThrow('desktop welcome:')
  })

  it('rejects a remote origin before sending the startup token', async () => {
    const send = vi.fn<typeof fetch>()
    await expect(authenticateHarnessWelcome('https://example.com/?token=current', send)).rejects.toThrow('invalid Harness')
    expect(send).not.toHaveBeenCalled()
  })
})

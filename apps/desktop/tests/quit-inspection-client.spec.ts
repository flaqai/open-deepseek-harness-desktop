import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { inspectLocalHarnessQuit } from '../src/quit-inspection-client.ts'

const ORIGIN = 'http://127.0.0.1:43123'
const COOKIE_NAME = `dsh-auth-${createHash('sha256').update('127.0.0.1:43123').digest('base64url')}`

describe('local desktop quit inspection', () => {
  it('uses only the current authority cookie and accepts exact task booleans', async () => {
    const fetcher = vi.fn(async () => Response.json({ activeTasks: true, scheduledTasks: false }))
    const result = await inspectLocalHarnessQuit(ORIGIN, {
      get: vi.fn(async () => [
        { name: 'unrelated', value: 'secret' },
        { name: COOKIE_NAME, value: 'signed-session' },
      ]),
    }, fetcher)

    expect(result).toEqual({ activeTasks: true, scheduledTasks: false })
    expect(fetcher).toHaveBeenCalledWith(`${ORIGIN}/api/desktop.quit-inspection`, expect.objectContaining({
      method: 'GET', headers: { Cookie: `${COOKIE_NAME}=signed-session` }, redirect: 'error',
    }))
  })

  it.each([
    'http://localhost:43123',
    'https://127.0.0.1:43123',
    'http://192.168.1.2:43123',
    'http://127.0.0.1:43123/other',
    'http://127.0.0.1:43123/?token=secret',
  ])('refuses non-local or non-origin destinations: %s', async (origin) => {
    const get = vi.fn(async () => [])
    const fetcher = vi.fn()
    await expect(inspectLocalHarnessQuit(origin, { get }, fetcher)).rejects.toThrow('loopback Harness origin')
    expect(get).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('treats missing authentication, HTTP failures, and malformed facts as unknown', async () => {
    const missing = { get: vi.fn(async () => []) }
    const fetcher = vi.fn(async () => Response.json({ activeTasks: false, scheduledTasks: false }))
    await expect(inspectLocalHarnessQuit(ORIGIN, missing, fetcher)).rejects.toThrow('session is unavailable')
    expect(fetcher).not.toHaveBeenCalled()

    const cookies = { get: vi.fn(async () => [{ name: COOKIE_NAME, value: 'signed-session' }]) }
    await expect(inspectLocalHarnessQuit(ORIGIN, cookies, async () => new Response('', { status: 503 })))
      .rejects.toThrow('HTTP 503')
    await expect(inspectLocalHarnessQuit(ORIGIN, cookies, async () => Response.json({ activeTasks: 'false', scheduledTasks: false })))
      .rejects.toThrow('malformed task facts')
  })
})

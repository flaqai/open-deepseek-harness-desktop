import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  consumeDesktopOrbSecret, createDesktopOrbCaller, installDesktopOrbCallerRoute,
  type OrbCallerSessionDriver,
} from '../src/desktop-orb-caller.ts'

const SECRET = 'A'.repeat(43)
const homes: string[] = []

afterEach(async () => {
  await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true })))
})

async function home(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'dsh-orb-caller-test-'))
  homes.push(path)
  return path
}

function sessionDriver(): OrbCallerSessionDriver & { create: ReturnType<typeof vi.fn> } {
  const headers = new Map<string, { cwd: string; agentPreset: string }>()
  const create = vi.fn(async (input: { sessionId: SessionId; cwd: string; agentPreset: 'standard' }) => {
    const existing = headers.get(input.sessionId)
    if (existing !== undefined && (existing.cwd !== input.cwd || existing.agentPreset !== input.agentPreset)) {
      throw new Error('Session conflict')
    }
    headers.set(input.sessionId, { cwd: input.cwd, agentPreset: input.agentPreset })
  })
  return {
    create,
    inspect: async (id) => {
      const meta = headers.get(id)
      if (meta === undefined) throw new Error('Session not found')
      return { meta }
    },
  }
}

describe('Desktop Orb caller ownership', () => {
  it('scrubs the launch secret even when a Web/NAS route must not be mounted', () => {
    const env = { DSH_DESKTOP_ORB_OWNER_SECRET: SECRET }
    expect(consumeDesktopOrbSecret(env)).toBe(SECRET)
    expect(env).not.toHaveProperty('DSH_DESKTOP_ORB_OWNER_SECRET')
    const malformed = { DSH_DESKTOP_ORB_OWNER_SECRET: 'short' }
    expect(consumeDesktopOrbSecret(malformed)).toBeUndefined()
    expect(malformed).not.toHaveProperty('DSH_DESKTOP_ORB_OWNER_SECRET')
  })

  it('persists one owned standard Session, adopts it after Host restart, and isolates homes', async () => {
    const firstHome = await home()
    const secondHome = await home()
    const sessions = sessionDriver()
    const first = createDesktopOrbCaller(firstHome, sessions)
    const [id, concurrent] = await Promise.all([first.ensure(), first.ensure()])
    expect(concurrent).toBe(id)
    expect(sessions.create).toHaveBeenCalledTimes(1)
    expect(await first.ownsCaller(id)).toBe(true)
    expect(await first.ownsCaller(SessionId('session-other'))).toBe(false)
    const record = JSON.parse(await readFile(join(firstHome, '.desktop-orb', 'caller-session-v1.json'), 'utf8')) as { sessionId: string }
    expect(record.sessionId).toBe(id)

    const restarted = createDesktopOrbCaller(firstHome, sessions)
    expect(await restarted.ensure()).toBe(id)
    expect(await restarted.ownsCaller(id)).toBe(true)
    const other = createDesktopOrbCaller(secondHome, sessions)
    const otherId = await other.ensure()
    expect(otherId).not.toBe(id)
    expect(await other.ownsCaller(id)).toBe(false)
  })

  it('does not replace malformed or conflicting ownership records', async () => {
    const path = await home()
    const sessions = sessionDriver()
    const owner = createDesktopOrbCaller(path, sessions)
    const id = await owner.ensure()
    await writeFile(join(path, '.desktop-orb', 'caller-session-v1.json'), '{"version":1,"sessionId":"../wrong"}\n')
    await expect(owner.ensure()).rejects.toThrow('malformed owner record')
    await expect(owner.ownsCaller(id)).rejects.toThrow('malformed owner record')
  })

  it('requires the private generation secret even after ordinary Connection authentication', async () => {
    const path = await home()
    const ctx = new Context()
    const sessions = sessionDriver()
    let route: { fetch(request: Request): Promise<Response> } | undefined
    const register = vi.fn((input: unknown) => {
      route = input as { fetch(request: Request): Promise<Response> }
      return () => {}
    })
    ctx.provide('connection', { fetch: { register } } as never)
    ctx.provide('sessionController', sessions as never)
    try {
      const mounted = ctx.plugin(pluginCtx => installDesktopOrbCallerRoute(pluginCtx, path, SECRET))
      await mounted.await()
      expect(register).toHaveBeenCalledWith(expect.objectContaining({
        path: '/api/desktop.orb-caller', methods: ['POST'], requestBody: 'buffered',
      }))
      const request = (secret?: string) => new Request('http://127.0.0.1:1234/api/desktop.orb-caller', {
        method: 'POST', ...(secret === undefined ? {} : { headers: { 'x-dsh-desktop-orb-secret': secret } }),
      })
      expect((await route!.fetch(request())).status).toBe(403)
      expect((await route!.fetch(request('B'.repeat(43)))).status).toBe(403)
      expect(sessions.create).not.toHaveBeenCalled()
      const response = await route!.fetch(request(SECRET))
      expect(response.status).toBe(200)
      expect((await response.json() as { sessionId: string }).sessionId).toMatch(/^session-/u)
    } finally { await ctx.fiber.dispose() }
  })
})

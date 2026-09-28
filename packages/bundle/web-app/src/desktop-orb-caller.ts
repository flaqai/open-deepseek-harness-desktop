/** Desktop-only, Host-owned identity for the floating chat's ordinary Session. */

import { randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-client-connection'

/** Launch-only environment key for the Desktop generation authority. */
export const DESKTOP_ORB_SECRET_ENV = 'DSH_DESKTOP_ORB_OWNER_SECRET'
/** Exact local Host route owned by the Desktop caller bridge. */
export const DESKTOP_ORB_CALLER_ROUTE = '/api/desktop.orb-caller'
const SECRET_HEADER = 'x-dsh-desktop-orb-secret'
const SESSION_PATTERN = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u

/** A generation secret is not a browser capability; only Desktop main may send it.
 * @param value - Untrusted environment value.
 * @returns Whether it has the shape of a 32-byte base64url secret.
 */
export function validOrbSecret(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(value)
}

function matchesSecret(actual: string | null, expected: string): boolean {
  if (actual === null || actual.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
}

/** Minimal Session Controller methods used by Host identity ownership. */
export interface OrbCallerSessionDriver {
  /** Create or adopt the fixed caller Session and its standard preset. */
  create(input: { readonly sessionId: SessionId; readonly cwd: string; readonly agentPreset: 'standard' }): Promise<unknown>
  /** Inspect the resulting durable Session header without changing its Agent. */
  inspect(sessionId: SessionId): Promise<{ readonly meta: { readonly cwd?: string; readonly agentPreset?: string } }>
}

/** Host-side durable owner; no renderer-supplied Session ID is accepted.
 * @param home - Canonical active Harness data directory.
 * @param sessions - Host Session operations, never a browser proxy.
 * @returns Owner operations for this Host and data directory.
 */
export function createDesktopOrbCaller(home: string, sessions: OrbCallerSessionDriver): {
  ensure(): Promise<SessionId>
  ownsCaller(sessionId: SessionId): Promise<boolean>
} {
  if (!isAbsolute(home) || resolve(home) !== home) throw new Error('orb caller: expected a canonical absolute DSH_HOME')
  const directory = join(home, '.desktop-orb')
  const workspace = join(home, 'orb-workspace')
  const file = join(directory, 'caller-session-v1.json')
  let pending: Promise<SessionId> | undefined

  const readIdentity = async (): Promise<SessionId | undefined> => {
    let content: string
    try { content = await readFile(file, 'utf8') }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
      throw error
    }
    const value: unknown = JSON.parse(content)
    if (typeof value !== 'object' || value === null || Array.isArray(value)
      || !('version' in value) || value.version !== 1
      || !('sessionId' in value) || typeof value.sessionId !== 'string'
      || !SESSION_PATTERN.test(value.sessionId)) {
      throw new Error('orb caller: malformed owner record; no Session was claimed')
    }
    return SessionId(value.sessionId)
  }

  const ensure = (): Promise<SessionId> => {
    if (pending !== undefined) return pending
    const operation = (async () => {
      const previous = await readIdentity()
      const sessionId = previous ?? SessionId(`session-${randomUUID()}`)
      await mkdir(workspace, { recursive: true, mode: 0o700 })
      await sessions.create({ sessionId, cwd: workspace, agentPreset: 'standard' })
      const inspected = await sessions.inspect(sessionId)
      if (inspected.meta.cwd !== workspace || inspected.meta.agentPreset !== 'standard') {
        throw new Error('orb caller: Session identity does not match its owned workspace and preset')
      }
      if (previous === undefined) {
        await mkdir(directory, { recursive: true, mode: 0o700 })
        const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
        try {
          await writeFile(temporary, `${JSON.stringify({ version: 1, sessionId })}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
          await rename(temporary, file)
        } finally {
          // An interrupted replace can leave only this exact temporary file.
          await rm(temporary, { force: true })
        }
      }
      return sessionId
    })()
    pending = operation
    void operation.finally(() => { if (pending === operation) pending = undefined }).catch(() => {})
    return operation
  }

  return {
    ensure,
    async ownsCaller(sessionId) {
      const recorded = await readIdentity()
      if (recorded !== sessionId) return false
      try {
        const inspected = await sessions.inspect(sessionId)
        return inspected.meta.cwd === workspace && inspected.meta.agentPreset === 'standard'
      } catch { return false }
    },
  }
}

/** Mount one exact private route after the shared Connection's ordinary cookie and origin checks.
 * @param ctx - Web Host plugin context.
 * @param home - Active local Harness data directory.
 * @param secret - Desktop generation authority unavailable to renderers.
 */
export function installDesktopOrbCallerRoute(ctx: Context, home: string, secret: string): void {
  if (!validOrbSecret(secret)) throw new Error('orb caller: invalid Desktop generation secret')
  ctx.inject(['connection', 'sessionController'], (inner) => {
    const owner = createDesktopOrbCaller(home, inner.sessionController)
    inner.effect(() => inner.connection.fetch.register({
      path: DESKTOP_ORB_CALLER_ROUTE,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        if (!matchesSecret(request.headers.get(SECRET_HEADER), secret)) {
          return Response.json({ error: 'forbidden' }, { status: 403, headers: { 'Cache-Control': 'no-store' } })
        }
        try {
          const sessionId = await owner.ensure()
          return Response.json({ sessionId }, { headers: { 'Cache-Control': 'no-store' } })
        } catch (error) {
          inner.logger.warn('orb caller: could not ensure owned Session', error)
          return Response.json({ error: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
        }
      },
    }), 'web-app: Desktop Orb caller')
  })
}

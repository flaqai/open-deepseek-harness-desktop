/** NAS devices retain independent identities and cannot bypass role restrictions through exact Fetch routes. */

import { createHash } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import { afterEach, expect, it, vi } from 'vitest'
import { BrowserAuth } from '../src/browser-auth.ts'
import { NasAccess } from '../src/nas-access.ts'
import { HostConnectionService } from '../src/rpc-host.ts'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function setup() {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  const ctx = new Context()
  contexts.push(ctx)
  const records = new MemoryCredentials(ctx)
  const devices = ['admin', 'user', 'readonly'].map(role => ({
    id: role, role, name: role,
    createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1000).toISOString(),
    tokenHash: createHash('sha256').update(`token-${role}`).digest('hex'),
  }))
  await records.modifyRecord(credentialKey('client-connection', 'nas-devices'), () => Promise.resolve({
    kind: 'grant', payload: { version: 2, instanceId: 'instance', devices },
  }))
  const access = await NasAccess.create(records, { enabled: true, name: 'NAS', version: 'test', protocolVersion: 1,
    trustedHosts: [], deviceLifetimeDays: 90 })
  const auth = await BrowserAuth.create(ctx, records, 30, access)
  const connection = new HostConnectionService(ctx, [], auth)
  const admit = (role: string) => {
    const result = connection.admit({ headers: new Headers({ host: 'localhost', authorization: `Bearer token-${role}` }) })
    if ('rejection' in result) throw new Error(`unexpected rejection ${result.rejection}`)
    return result.peer
  }
  return { ctx, connection, access, auth, admit }
}

it('creates independent device Peers and never treats a non-admin bearer as the shared owner cookie', async () => {
  const { admit, auth } = await setup()
  const user = admit('user')
  expect(user.principal).toEqual({ kind: 'nas', deviceId: 'user' })
  expect(admit('readonly').principal).toEqual({ kind: 'nas', deviceId: 'readonly' })
  expect(admit('admin').principal).toEqual({ kind: 'owner' })
  expect(admit('user')).toBe(user)
  expect(admit('admin').id).not.toBe(user.id)
  expect(auth.isAuthenticated({ headers: new Headers({ host: 'localhost', authorization: 'Bearer token-user' }) })).toBe(false)
})

it('permits preview reads and user uploads while denying readonly uploads, unknown routes and remote native operations', async () => {
  const { connection, admit } = await setup()
  for (const path of ['/api/file', '/api/session/uploadFileBinary', '/api/third-party', '/api/session.export', '/api/present.open']) {
    connection.fetch.register({ path, methods: ['GET', 'POST'], requestBody: 'buffered',
      fetch: async () => new Response('allowed') })
  }
  const handler = connection.createSharedFetchHandler('/api')
  const call = (path: string, role: string, method = 'GET') => handler.fetch(new Request(`http://localhost${path}`, { method }), admit(role))
  expect((await call('/api/file', 'readonly')).status).toBe(200)
  expect((await call('/api/session/uploadFileBinary', 'user', 'POST')).status).toBe(200)
  expect((await call('/api/session/uploadFileBinary', 'readonly', 'POST')).status).toBe(403)
  expect((await call('/api/third-party', 'user')).status).toBe(403)
  expect((await call('/api/session.export', 'user')).status).toBe(403)
  expect((await call('/api/session.export', 'admin')).status).toBe(200)
  expect((await call('/api/present.open', 'admin')).status).toBe(403)
})

it('aborts active device scopes at expiry and refuses a new request with the expired credential', async () => {
  vi.useFakeTimers()
  const { connection, admit } = await setup()
  const peer = admit('user')
  await vi.advanceTimersByTimeAsync(1001)
  expect(peer.signal.aborted).toBe(true)
  expect(connection.admit({ headers: new Headers({ host: 'localhost', authorization: 'Bearer token-user' }) }))
    .toEqual({ rejection: 401 })
})

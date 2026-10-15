/** Raw third-party HTTP and upgrade handlers must not bypass NAS device roles. */
import { Context } from '@deepseek-ai/cordis'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { createHash } from 'node:crypto'
import { connect } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebServer from '../../../host/webserver/src/index.ts'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import { NasAccess } from '../src/nas-access.ts'
import { nasRouteGuard } from '../src/nas-route-policy.ts'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  vi.restoreAllMocks()
})

async function setup(guarded = true, requireRequestGuard = guarded) {
  const ctx = new Context()
  contexts.push(ctx)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
  const records = new MemoryCredentials(ctx)
  const devices = ['admin', 'backup', 'user', 'readonly'].map(role => ({
    id: role, role: role === 'backup' ? 'admin' : role, name: role,
    createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
    tokenHash: createHash('sha256').update(`token-${role}`).digest('hex'),
  }))
  await records.modifyRecord(credentialKey('client-connection', 'nas-devices'), () => Promise.resolve({
    kind: 'grant', payload: { version: 2, instanceId: 'route-fixture', devices },
  }))
  const access = await NasAccess.create(records, {
    enabled: true, name: 'Route fixture', version: 'test', protocolVersion: 1,
    trustedHosts: ['harness.local'], deviceLifetimeDays: 90,
  })
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0, requireRequestGuard })
  const server = ctx.webServer
  const disposeGuard = guarded ? server.registerRequestGuard(nasRouteGuard(access, ['harness.local'])) : () => {}
  for (const route of access.routes) server.register(route)
  const origin = server.getOrigin()
  const request = (path: string, role?: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    if (!headers.has('host')) headers.set('host', 'harness.local')
    if (role !== undefined) headers.set('authorization', `Bearer token-${role}`)
    return fetch(`${origin}${path}`, { ...init, headers })
  }
  return { server, access, request, disposeGuard }
}

async function upgrade(port: number, role?: string, path = '/third-party/socket'): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1')
    let response = ''
    socket.setTimeout(3000, () => { socket.destroy(new Error('upgrade response timed out')) })
    socket.once('error', reject)
    socket.on('data', (chunk: Buffer) => { response += chunk.toString('utf8') })
    socket.once('end', () => {
      const status = /^HTTP\/1\.1 (\d+)/u.exec(response)?.[1]
      if (status === undefined) reject(new Error(`missing HTTP status: ${response}`))
      else resolve(Number(status))
    })
    socket.once('connect', () => {
      socket.write([
        `GET ${path} HTTP/1.1`, 'Host: harness.local', 'Connection: Upgrade', 'Upgrade: fixture',
        ...(role === undefined ? [] : [`Authorization: Bearer token-${role}`]), '', '',
      ].join('\r\n'))
    })
  })
}

describe('NAS raw route admission on the real WebServer', () => {
  it('fails closed before the required NAS guard registers and again after its disposal', async () => {
    const { server, access, request } = await setup(false, true)
    const effect = vi.fn()
    server.registerFallback((_req, res) => { effect(); res.end('frontend') })
    server.register({ kind: 'exact', path: '/third-party/action', handler: (_req, res) => { effect(); res.end() } })
    server.registerUpgrade({ path: '/third-party/socket', handler: (_req, socket) => {
      effect()
      socket.end('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: fixture\r\n\r\n')
    } })
    const port = server.port
    if (port === undefined) throw new Error('listener did not bind')
    const assertClosed = async () => {
      expect((await request('/', 'admin')).status).toBe(403)
      expect((await request('/nas/health')).status).toBe(403)
      expect((await request('/third-party/action', 'admin')).status).toBe(403)
      expect(await upgrade(port, 'admin')).toBe(403)
    }
    await assertClosed()
    expect(effect).not.toHaveBeenCalled()
    const remove = server.registerRequestGuard(nasRouteGuard(access, ['harness.local']))
    expect((await request('/')).status).toBe(200)
    expect((await request('/third-party/action', 'admin')).status).toBe(200)
    expect(await upgrade(port, 'admin')).toBe(101)
    expect(effect).toHaveBeenCalledTimes(3)
    remove()
    await assertClosed()
    expect(effect).toHaveBeenCalledTimes(3)
  })

  it('delegates only the exact Gateway mux upgrade to a live lower-layer identity admission boundary', async () => {
    const { server, access } = await setup()
    const admissions = vi.fn()
    const accepted = vi.fn()
    // This is the guard contract, not a Gateway/RBAC implementation: Gateway's
    // real wire admission and per-resource decisions are tested in its own suites.
    server.registerUpgrade({ path: '/api/remote.mux', handler: (req, socket) => {
      admissions()
      if (!access.isAuthenticated(req)) {
        socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
        return
      }
      accepted()
      socket.end('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: fixture\r\n\r\n')
    } })
    const port = server.port
    if (port === undefined) throw new Error('listener did not bind')
    expect(await upgrade(port, undefined, '/api/remote.mux')).toBe(401)
    for (const role of ['admin', 'user', 'readonly']) expect(await upgrade(port, role, '/api/remote.mux')).toBe(101)
    expect(admissions).toHaveBeenCalledTimes(4)
    expect(accepted).toHaveBeenCalledTimes(3)
    server.registerUpgrade({ path: '/api/remote.mux/other', handler: (_req, socket) => {
      accepted()
      socket.end('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: fixture\r\n\r\n')
    } })
    expect(await upgrade(port, 'user', '/api/remote.mux/other')).toBe(403)
    expect(accepted).toHaveBeenCalledTimes(3)
    const expired = Date.now() + 120_000
    vi.spyOn(Date, 'now').mockReturnValue(expired)
    expect(await upgrade(port, 'user', '/api/remote.mux')).toBe(401)
    expect(admissions).toHaveBeenCalledTimes(5)
    expect(accepted).toHaveBeenCalledTimes(3)
  })

  it('blocks unknown exact and prefix handlers before side effects for restricted or unpaired callers', async () => {
    const { server, request } = await setup()
    const effect = vi.fn()
    for (const kind of ['exact', 'prefix'] as const) server.register({ kind, path: `/third-party/${kind}`, handler: (_req, res) => {
      effect()
      res.end('third-party effect')
    } })
    for (const role of ['user', 'readonly', undefined]) {
      for (const path of ['/third-party/exact', '/third-party/prefix/child']) {
        for (const method of ['GET', 'POST']) expect((await request(path, role, { method })).status).toBe(403)
      }
    }
    expect(effect).not.toHaveBeenCalled()
    expect((await request('/third-party/exact', 'admin', { method: 'POST' })).status).toBe(200)
    expect((await request('/third-party/prefix/child', 'admin')).status).toBe(200)
    expect(effect).toHaveBeenCalledTimes(2)
    expect((await request('/third-party/exact', 'admin', { headers: { origin: 'http://untrusted.invalid' } })).status).toBe(403)
    expect(effect).toHaveBeenCalledTimes(2)
  })

  it('rejects raw upgrades before their handlers and admits only a live administrator', async () => {
    const { server } = await setup()
    const effect = vi.fn()
    server.registerUpgrade({ path: '/third-party/socket', handler: (_req, socket) => {
      effect()
      socket.end('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: fixture\r\n\r\n')
    } })
    const port = server.port
    if (port === undefined) throw new Error('listener did not bind')
    for (const role of ['user', 'readonly', undefined]) expect(await upgrade(port, role)).toBe(403)
    expect(effect).not.toHaveBeenCalled()
    expect(await upgrade(port, 'admin')).toBe(101)
    expect(effect).toHaveBeenCalledTimes(1)
    server.registerUpgrade({ path: '/api', handler: (_req, socket) => {
      effect()
      socket.end('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: fixture\r\n\r\n')
    } })
    expect(await upgrade(port, 'user', '/api')).toBe(403)
    expect(await upgrade(port, undefined, '/api')).toBe(403)
    expect(effect).toHaveBeenCalledTimes(1)
    expect(await upgrade(port, 'admin', '/api')).toBe(101)
    expect(effect).toHaveBeenCalledTimes(2)
  })

  it('allows frontend reads but delegates classified API routes without treating them as authenticated', async () => {
    const { server, access, request } = await setup()
    const frontend = vi.fn()
    server.registerFallback((_req, res) => { frontend(); res.end('frontend') })
    for (const path of ['/plugins', '/plugins/events']) server.register({ kind: 'exact', path, handler: (_req, res) => {
      frontend()
      res.end('frontend asset')
    } })
    const delegated = vi.fn()
    server.register({ kind: 'prefix', path: '/api', handler: (req, res) => {
      delegated()
      res.writeHead(access.isAuthenticated(req) ? 200 : 401)
      res.end()
    } })
    for (const path of ['/', '/assets/client.js', '/plugins', '/plugins/events']) {
      for (const method of ['GET', 'HEAD']) expect((await request(path, undefined, { method })).status).toBe(200)
    }
    expect(frontend).toHaveBeenCalledTimes(8)
    expect((await request('/not-a-registered-route', 'user', { method: 'POST' })).status).toBe(403)
    expect(frontend).toHaveBeenCalledTimes(8)
    expect((await request('/api/resource')).status).toBe(401)
    expect((await request('/api/resource', 'readonly')).status).toBe(200)
    expect(delegated).toHaveBeenCalledTimes(2)
    expect((await request('/nas/health')).status).toBe(200)
  })

  it('rechecks token revocation and expiry for every raw request', async () => {
    const { server, request } = await setup()
    const effect = vi.fn()
    server.register({ kind: 'exact', path: '/third-party/action', handler: (_req, res) => { effect(); res.end() } })
    expect((await request('/third-party/action', 'admin')).status).toBe(200)
    expect((await request('/nas/devices', 'backup', {
      method: 'POST', body: JSON.stringify({ revokeDeviceId: 'admin' }),
    })).status).toBe(200)
    expect((await request('/third-party/action', 'admin')).status).toBe(403)
    expect((await request('/third-party/action', 'backup')).status).toBe(200)
    const expired = Date.now() + 120_000
    vi.spyOn(Date, 'now').mockReturnValue(expired)
    expect((await request('/third-party/action', 'backup')).status).toBe(403)
    expect(effect).toHaveBeenCalledTimes(2)
  })

  it('leaves ordinary non-NAS WebServer routes unchanged and disposes only its own guard', async () => {
    const { server, request } = await setup(false)
    const effect = vi.fn()
    server.register({ kind: 'exact', path: '/third-party/action', handler: (_req, res) => { effect(); res.end() } })
    expect((await request('/third-party/action', undefined, { method: 'POST' })).status).toBe(200)
    const remove = server.registerRequestGuard(() => false)
    expect((await request('/third-party/action')).status).toBe(403)
    remove()
    expect((await request('/third-party/action')).status).toBe(200)
    expect(effect).toHaveBeenCalledTimes(2)
  })
})

/** NAS pairing and per-device bearer authorization over real HTTP routes. */

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { createHash } from 'node:crypto'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import { NasAccess, createNasAdministratorRecovery } from '../src/nas-access.ts'

const close: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const dispose of close.splice(0)) await dispose()
  vi.restoreAllMocks()
})

async function serve(access: NasAccess): Promise<string> {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://harness.local').pathname
    const route = access.routes.find(candidate => candidate.path === path)
    if (route === undefined) { response.writeHead(404); response.end(); return }
    void route.handler(request, response)
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  close.push(() => new Promise<void>((resolve, reject) => {
    server.close((error) => { if (error === undefined) resolve(); else reject(error) })
  }))
  const { port } = server.address() as AddressInfo
  return `http://127.0.0.1:${String(port)}`
}

describe('NasAccess', () => {
  it('pairs once, authenticates a device, revokes it, and preserves server identity', async () => {
    const records = new MemoryCredentials(new Context())
    const config = {
      enabled: true, name: 'Studio NAS', version: '0.1.6-alpha.1', protocolVersion: 1,
      trustedHosts: ['harness.local'], deviceLifetimeDays: 90, pairingCode: '12345678',
    }
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const access = await NasAccess.create(records, config)
    const origin = await serve(access)
    const request = (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers)
      headers.set('host', 'harness.local')
      return fetch(`${origin}${path}`, { ...init, headers })
    }

    const initial = await request('/nas/health').then(response => response.json()) as { instanceId: string }
    const pairingResponse = await request('/nas/pair', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: '12345678', deviceName: 'Laptop' }),
    })
    expect(pairingResponse.status).toBe(200)
    const paired = await pairingResponse.json() as { deviceId: string; token: string }
    expect(paired.token).toHaveLength(43)
    expect(log).toHaveBeenCalled()
    expect((await request('/nas/devices')).status).toBe(401)

    const auth = { authorization: `Bearer ${paired.token}` }
    const listed = await request('/nas/devices', { headers: auth })
    expect(await listed.json()).toMatchObject({ devices: [{ id: paired.deviceId, name: 'Laptop' }] })
    expect((await request('/nas/pair', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: '12345678', deviceName: 'Replay' }),
    })).status).toBe(401)

    const protectedAdmin = await request('/nas/devices', {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ revokeDeviceId: paired.deviceId }),
    })
    expect(protectedAdmin.status).toBe(409)
    const recovery = await createNasAdministratorRecovery(records)
    const second = await request('/nas/pair', { method: 'POST',
      body: JSON.stringify({ code: recovery.code, deviceName: 'Recovery administrator' }) }).then(response => response.json()) as { token: string }
    const revoked = await request('/nas/devices', {
      method: 'POST', headers: { authorization: `Bearer ${second.token}` },
      body: JSON.stringify({ revokeDeviceId: paired.deviceId }),
    })
    expect(revoked.status).toBe(200)
    expect((await request('/nas/devices', { headers: auth })).status).toBe(401)

    const reloaded = await NasAccess.create(records, config)
    const reloadedOrigin = await serve(reloaded)
    const next = await fetch(`${reloadedOrigin}/nas/health`, { headers: { host: 'harness.local' } })
      .then(response => response.json()) as { instanceId: string }
    expect(next.instanceId).toBe(initial.instanceId)
  })

  it('rate limits repeated invalid pairing codes', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const access = await NasAccess.create(new MemoryCredentials(new Context()), {
      enabled: true, name: 'Studio NAS', version: '0.1.6-alpha.1', protocolVersion: 1,
      trustedHosts: ['harness.local'], deviceLifetimeDays: 90, pairingCode: '12345678',
    })
    const origin = await serve(access)
    const attempt = () => fetch(`${origin}/nas/pair`, {
      method: 'POST',
      headers: { host: 'harness.local', 'content-type': 'application/json' },
      body: JSON.stringify({ code: '00000000', deviceName: 'Unknown device' }),
    })

    for (let index = 0; index < 10; index += 1) expect((await attempt()).status).toBe(401)
    expect((await attempt()).status).toBe(429)
    const health = await fetch(`${origin}/nas/health`, { headers: { host: 'harness.local' } })
      .then(async (response): Promise<unknown> => response.json())
    expect(health).toMatchObject({ pairingAvailable: false })
  })

  it('binds invitations to server roles, denies user management, invalidates peers, and prevents last-admin demotion', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const records = new MemoryCredentials(new Context())
    const access = await NasAccess.create(records, {
      enabled: true, name: 'NAS', version: 'test', protocolVersion: 1,
      trustedHosts: ['harness.local'], deviceLifetimeDays: 90, pairingCode: '12345678',
    })
    const origin = await serve(access)
    const request = (path: string, token?: string, body?: object) => fetch(`${origin}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { host: 'harness.local', ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const admin = await request('/nas/pair', undefined, { code: '12345678', deviceName: 'Admin' })
      .then(response => response.json()) as { token: string; deviceId: string; role: string }
    expect(admin.role).toBe('admin')
    const invitation = await request('/nas/invitations', admin.token, {})
      .then(response => response.json()) as { code: string; role: string }
    expect(invitation.role).toBe('user')
    const user = await request('/nas/pair', undefined, { code: invitation.code, deviceName: 'User', role: 'admin' })
      .then(response => response.json()) as { token: string; deviceId: string; role: string }
    expect(user.role).toBe('user')
    expect((await request('/nas/devices', user.token)).status).toBe(403)
    expect((await request('/nas/invitations', user.token, { role: 'admin' })).status).toBe(403)
    expect((await request('/nas/device-role', admin.token, { deviceId: admin.deviceId, role: 'readonly' })).status).toBe(409)
    const changed = vi.fn(async () => {})
    const dispose = access.onChanged(changed)
    expect((await request('/nas/device-role', admin.token, { deviceId: user.deviceId, role: 'readonly' })).status).toBe(200)
    expect(changed).toHaveBeenCalledWith(user.deviceId)
    expect(await request('/nas/me', user.token).then(response => response.json())).toMatchObject({ role: 'readonly' })
    expect((await request('/nas/devices', admin.token, { revokeDeviceId: user.deviceId })).status).toBe(200)
    expect((await request('/nas/me', user.token)).status).toBe(401)
    dispose()
  })

  it('backs up v1 credentials and migrates device roles without changing tokens or identities', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const records = new MemoryCredentials(new Context())
    const key = credentialKey('client-connection', 'nas-devices')
    const legacy = { kind: 'grant' as const, payload: { version: 1, instanceId: 'stable-instance', devices: [{
      id: 'legacy-device', name: 'Legacy', tokenHash: createHash('sha256').update('legacy-token').digest('hex'),
      createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    }] } }
    await records.modifyRecord(key, () => Promise.resolve(legacy))
    const config = { enabled: true, name: 'NAS', version: 'test', protocolVersion: 1,
      trustedHosts: ['harness.local'], deviceLifetimeDays: 90 }
    const first = await NasAccess.create(records, config)
    expect(first.device('legacy-device')).toMatchObject({ role: 'admin' })
    expect(first.isAuthenticated({ headers: new Headers({ authorization: 'Bearer legacy-token' }) })).toBe(true)
    const backup = credentialKey('client-connection', 'nas-devices-before-roles')
    expect(await records.readRecord(backup)).toEqual(legacy)
    const second = await NasAccess.create(records, config)
    expect(second.listDevices()).toEqual(first.listDevices())
    expect(await records.readRecord(backup)).toEqual(legacy)
    expect(await records.readRecord(key)).toMatchObject({ payload: { version: 2 } })
  })
})

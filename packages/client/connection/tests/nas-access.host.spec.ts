/** NAS pairing and per-device bearer authorization over real HTTP routes. */

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import { NasAccess } from '../src/nas-access.ts'

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

    const revoked = await request('/nas/devices', {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ revokeDeviceId: paired.deviceId }),
    })
    expect(await revoked.json()).toEqual({ devices: [] })
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
})

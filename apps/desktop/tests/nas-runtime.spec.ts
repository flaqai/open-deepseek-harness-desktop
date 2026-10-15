import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  NasRuntimeClient, NasRuntimeStore, certificateFingerprint, normalizeNasBaseUrl,
  parseNasDiscoveryPacket,
  type NasFetchResponse,
} from '../src/nas-runtime.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'dsh-nas-runtime-'))
  roots.push(value)
  return value
}

const codec = {
  available: true,
  seal: (value: string) => Buffer.from(value).toString('base64'),
  open: (value: string) => Buffer.from(value, 'base64').toString('utf8'),
}

describe('NAS runtime directory', () => {
  it('accepts only dedicated HTTPS origins', () => {
    expect(normalizeNasBaseUrl('https://nas.example.com/')).toBe('https://nas.example.com')
    expect(() => normalizeNasBaseUrl('http://nas.local')).toThrow(/HTTPS/)
    expect(() => normalizeNasBaseUrl('https://nas.example.com/harness')).toThrow(/dedicated HTTPS origin/)
    expect(() => normalizeNasBaseUrl('https://user@nas.example.com')).toThrow(/credentials/)
  })

  it('stores metadata separately from sealed device credentials', () => {
    const directory = root()
    const store = new NasRuntimeStore(join(directory, 'runtimes.json'), join(directory, 'secrets.json'), codec)
    const status = store.savePairing('https://nas.example.com', {
      schema: 'open-deepseek-harness/nas-pairing/v1', deviceId: 'device-1', token: 'x'.repeat(48),
      expiresAt: '2027-01-01T00:00:00.000Z',
      health: {
        schema: 'open-deepseek-harness/nas-health/v1', instanceId: 'nas-1', name: 'Home NAS', version: '0.1.6',
        protocolVersion: 1, platform: 'linux', architecture: 'arm64', pairingAvailable: false,
      },
    }, 'AA'.repeat(32))
    expect(status.selection).toEqual({ kind: 'local' })
    expect(store.credential('nas-1')).toEqual({ deviceId: 'device-1', token: 'x'.repeat(48) })
    expect(readFileSync(join(directory, 'runtimes.json'), 'utf8')).not.toContain('xxxxxxxx')
    expect(readFileSync(join(directory, 'secrets.json'), 'utf8')).not.toContain('xxxxxxxx')
    expect(store.select({ kind: 'local' }).selection).toEqual({ kind: 'local' })
    expect(store.remove('nas-1').servers).toEqual([])
  })

  it('refuses durable pairing when secure storage is unavailable', () => {
    const directory = root()
    const store = new NasRuntimeStore(join(directory, 'runtimes.json'), join(directory, 'secrets.json'), {
      available: false, seal: value => value, open: value => value,
    })
    expect(() => store.savePairing('https://nas.example.com', {
      schema: 'open-deepseek-harness/nas-pairing/v1', deviceId: 'device-1', token: 'x'.repeat(48),
      expiresAt: '2027-01-01T00:00:00.000Z',
      health: {
        schema: 'open-deepseek-harness/nas-health/v1', instanceId: 'nas-1', name: 'NAS', version: '0.1.6',
        protocolVersion: 1, platform: 'linux', architecture: 'x64', pairingAvailable: false,
      },
    })).toThrow(/secure storage/)
  })
})

describe('NAS network client', () => {
  it('reads only the current identity and sends server-bound invitation roles', async () => {
    const device = { id: 'a'.repeat(32), name: 'User', createdAt: '2026-10-15T00:00:00Z', expiresAt: '2027-10-15T00:00:00Z', role: 'user' }
    const fetch = vi.fn(async (url: string): Promise<NasFetchResponse> => ({ ok: true, status: 200,
      json: async () => url.endsWith('/nas/me') ? device : { code: '12345678', role: 'readonly', expiresAt: '2027-10-15T00:00:00Z' },
    }))
    const client = new NasRuntimeClient(fetch)
    expect(await client.me('https://nas.example', 'secret')).toEqual(device)
    expect(await client.invite('https://nas.example', 'secret', 'readonly')).toMatchObject({ role: 'readonly' })
    expect(fetch).toHaveBeenNthCalledWith(2, 'https://nas.example/nas/invitations', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ role: 'readonly' }),
      headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
    }))
  })

  it('does not interpret a forbidden or malformed management response as administrator access', async () => {
    const denied = new NasRuntimeClient(async () => ({ ok: false, status: 403, json: async () => ({}) }))
    await expect(denied.me('https://nas.example', 'secret')).rejects.toThrow(/403/)
    const malformed = new NasRuntimeClient(async () => ({ ok: true, status: 200, json: async () => ({ role: 'owner' }) }))
    await expect(malformed.me('https://nas.example', 'secret')).rejects.toThrow(/invalid device list/)
    await expect(malformed.invite('https://nas.example', 'secret', 'user')).rejects.toThrow(/invalid invitation/)
  })

  it('performs a fixed-path pairing request and validates the protocol', async () => {
    const fetch = vi.fn(async (_url: string, _init: unknown): Promise<NasFetchResponse> => ({
      ok: true, status: 200, json: async () => ({
        schema: 'open-deepseek-harness/nas-pairing/v1', deviceId: 'device-1', token: 't'.repeat(48),
        expiresAt: '2027-01-01T00:00:00.000Z',
        health: {
          schema: 'open-deepseek-harness/nas-health/v1', instanceId: 'nas-1', name: 'NAS', version: '0.1.6',
          protocolVersion: 1, platform: 'linux', architecture: 'x64', pairingAvailable: false,
        },
      }),
    }))
    const result = await new NasRuntimeClient(fetch).pair({
      baseUrl: 'https://nas.example.com', code: '1234 5678', deviceName: 'Mac mini',
    })
    expect(result.deviceId).toBe('device-1')
    expect(fetch).toHaveBeenCalledWith('https://nas.example.com/nas/pair', expect.objectContaining({ method: 'POST' }))
  })

  it('rejects incompatible health documents', async () => {
    const fetch = vi.fn(async (): Promise<NasFetchResponse> => ({
      ok: true, status: 200, json: async () => ({
        schema: 'open-deepseek-harness/nas-health/v1', instanceId: 'nas-1', name: 'NAS', version: '0.1.6',
        protocolVersion: 2, platform: 'linux', architecture: 'x64', pairingAvailable: true,
      }),
    }))
    await expect(new NasRuntimeClient(fetch).health('https://nas.example.com')).rejects.toThrow(/incompatible/)
  })

  it('lists and revokes devices through the fixed authenticated endpoint', async () => {
    const device = {
      id: 'a'.repeat(32), name: 'Office PC',
      createdAt: '2026-09-17T00:00:00.000Z', expiresAt: '2026-12-16T00:00:00.000Z',
    }
    const fetch = vi.fn(async (_url: string, _init: unknown): Promise<NasFetchResponse> => ({
      ok: true, status: 200, json: async () => ({ devices: [device] }),
    }))
    const client = new NasRuntimeClient(fetch)
    expect(await client.devices('https://nas.example.com', 'secret')).toEqual([device])
    expect(await client.revokeDevice('https://nas.example.com', 'secret', device.id)).toEqual([device])
    expect(fetch).toHaveBeenNthCalledWith(1, 'https://nas.example.com/nas/devices', expect.objectContaining({
      method: 'GET', headers: { authorization: 'Bearer secret' },
    }))
    expect(fetch).toHaveBeenNthCalledWith(2, 'https://nas.example.com/nas/devices', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ revokeDeviceId: device.id }),
    }))
  })
})

it('formats certificate fingerprints for confirmation', () => {
  expect(certificateFingerprint(new Uint8Array([1, 2, 3]))).toMatch(/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/u)
})

it('treats mDNS discovery as an untrusted HTTPS address suggestion', () => {
  const txt = (value: string): Buffer => {
    const bytes = Buffer.from(value)
    return Buffer.concat([Buffer.from([bytes.length]), bytes])
  }
  expect(parseNasDiscoveryPacket(Buffer.concat([
    Buffer.alloc(20), txt('dsh-protocol=1'), txt('url=https://harness.local'), txt('name=Home NAS'),
  ]))).toEqual({ baseUrl: 'https://harness.local', name: 'Home NAS' })
  expect(parseNasDiscoveryPacket(Buffer.concat([
    Buffer.alloc(20), txt('dsh-protocol=1'), txt('url=http://harness.local'),
  ]))).toBeUndefined()
})

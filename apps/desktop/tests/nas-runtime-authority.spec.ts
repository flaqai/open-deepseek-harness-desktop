import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DesktopNasRuntimeAuthority,
  type NasRuntimeConnectionAdapter,
  type NasRuntimeNetworkAdapter,
} from '../src/nas-runtime-authority.ts'
import {
  NasRuntimeStore, type NasHealth, type NasPairingResponse, type NasRuntimeRecord,
} from '../src/nas-runtime.ts'

const roots: string[] = []
afterEach(() => { for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true }) })

const codec = {
  available: true,
  seal: (value: string) => Buffer.from(value).toString('base64'),
  open: (value: string) => Buffer.from(value, 'base64').toString('utf8'),
}

function health(id = 'nas-1'): NasHealth {
  return {
    schema: 'open-deepseek-harness/nas-health/v1', instanceId: id, name: 'Home NAS', version: '0.1.6',
    protocolVersion: 1, platform: 'linux', architecture: 'arm64', pairingAvailable: false,
  }
}

function pairing(id = 'nas-1', deviceId = 'a'.repeat(32)): NasPairingResponse {
  return {
    schema: 'open-deepseek-harness/nas-pairing/v1', deviceId, token: 't'.repeat(48),
    expiresAt: '2027-01-01T00:00:00.000Z', health: health(id),
  }
}

function store(): NasRuntimeStore {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-nas-authority-'))
  roots.push(directory)
  return new NasRuntimeStore(join(directory, 'runtimes.json'), join(directory, 'secrets.json'), codec)
}

function network(overrides: Partial<NasRuntimeNetworkAdapter> = {}): NasRuntimeNetworkAdapter {
  return {
    discover: vi.fn(() => Promise.resolve([])),
    inspectCertificate: vi.fn(() => Promise.resolve('AA'.repeat(32))),
    health: vi.fn(() => Promise.resolve(health())),
    pair: vi.fn(() => Promise.resolve(pairing())),
    devices: vi.fn(() => Promise.resolve([])),
    me: vi.fn(async () => ({ id: 'a'.repeat(32), name: 'Current', role: 'admin' as const, createdAt: '2026-10-15T00:00:00Z', expiresAt: '2027-10-15T00:00:00Z' })),
    invite: vi.fn(async (_baseUrl: string, _token: string, role: import('../src/nas-runtime.ts').NasRole) => ({
      code: '12345678', role, expiresAt: '2027-10-15T00:00:00Z',
    })),
    setDeviceRole: vi.fn(async () => []),
    revokeDevice: vi.fn(() => Promise.resolve([])),
    ...overrides,
  }
}

function connection(overrides: Partial<NasRuntimeConnectionAdapter> = {}): NasRuntimeConnectionAdapter {
  return {
    capture: vi.fn(() => ({ isCurrent: () => true, load: vi.fn(() => Promise.resolve()) })),
    begin: vi.fn(),
    ready: vi.fn(),
    fail: vi.fn(() => Promise.resolve()),
    ...overrides,
  }
}

function authority(options: {
  store?: NasRuntimeStore
  network?: NasRuntimeNetworkAdapter
  connection?: NasRuntimeConnectionAdapter
  stop?: () => Promise<void>
  restart?: (delayMs: number) => void
  publish?: (status: ReturnType<NasRuntimeStore['status']>) => void
} = {}): DesktopNasRuntimeAuthority {
  return new DesktopNasRuntimeAuthority({
    store: options.store ?? store(),
    network: options.network ?? network(),
    connection: options.connection ?? connection(),
    lifecycle: {
      stopActiveProfileServices: options.stop ?? vi.fn(() => Promise.resolve()),
      restartAfter: options.restart ?? vi.fn(),
    },
    publishStatus: options.publish ?? vi.fn(),
    now: () => Date.parse('2026-09-18T00:00:00.000Z'),
  })
}

describe('Desktop NAS runtime authority', () => {
  it('requires a confirmed certificate pin before pairing and owns its publication', async () => {
    const runtimeStore = store()
    const runtimeNetwork = network()
    const publish = vi.fn()
    const runtime = authority({ store: runtimeStore, network: runtimeNetwork, publish })
    const request = {
      baseUrl: 'https://nas.example.com', code: '12345678', deviceName: 'Mac mini',
      certificateFingerprint: 'AA'.repeat(32),
    }

    await expect(runtime.execute({ kind: 'pair', request })).rejects.toThrow(/inspect and confirm/)
    await expect(runtime.execute({
      kind: 'inspect-certificate', baseUrl: 'https://nas.example.com',
    })).resolves.toEqual({ fingerprint: 'AA'.repeat(32) })
    expect(runtime.acceptsCertificate('https://nas.example.com/nas/pair', 'AA'.repeat(32))).toBe(true)
    await expect(runtime.execute({ kind: 'pair', request })).resolves.toMatchObject({
      servers: [expect.objectContaining({ id: 'nas-1', baseUrl: 'https://nas.example.com' })],
    })
    expect(publish).toHaveBeenCalledOnce()
  })

  it('adds credentials only to the exact persistently selected NAS origin', async () => {
    const runtimeStore = store()
    runtimeStore.savePairing('https://nas.example.com', pairing(), 'AA'.repeat(32))
    runtimeStore.select({ kind: 'nas', serverId: 'nas-1' })
    const runtime = authority({ store: runtimeStore })

    expect(runtime.authorizeRequestHeaders('https://nas.example.com/chat', { accept: 'json' })).toEqual({
      accept: 'json', Authorization: `Bearer ${'t'.repeat(48)}`,
    })
    expect(runtime.authorizeRequestHeaders('https://other.example.com/chat', { accept: 'json' })).toEqual({ accept: 'json' })
    expect(runtime.authorizeRequestHeaders('not a url', { accept: 'json' })).toEqual({ accept: 'json' })
  })

  it('owns the complete connection order and rejects a changed NAS identity', async () => {
    const runtimeStore = store()
    runtimeStore.savePairing('https://nas.example.com', pairing(), 'AA'.repeat(32))
    runtimeStore.select({ kind: 'nas', serverId: 'nas-1' })
    const order: string[] = []
    const target = {
      isCurrent: vi.fn(() => { order.push('current'); return true }),
      load: vi.fn(() => { order.push('load'); return Promise.resolve() }),
    }
    const fail = vi.fn((_runtime: NasRuntimeRecord, _error: Error) => {
      order.push('fail')
      return Promise.resolve()
    })
    const runtimeConnection = connection({
      capture: vi.fn(() => target),
      begin: vi.fn(() => { order.push('begin') }),
      ready: vi.fn(() => { order.push('ready') }),
      fail,
    })
    const runtimeNetwork = network({
      health: vi.fn(() => { order.push('health'); return Promise.resolve(health()) }),
    })
    const runtime = authority({ store: runtimeStore, connection: runtimeConnection, network: runtimeNetwork })

    await runtime.connectSelected()
    expect(order).toEqual(['begin', 'health', 'current', 'ready', 'load'])

    const changedIdentity = authority({
      store: runtimeStore,
      connection: runtimeConnection,
      network: network({ health: vi.fn(() => Promise.resolve(health('different-nas'))) }),
    })
    await expect(changedIdentity.connectSelected()).rejects.toThrow(/identity changed/)
    expect(fail).toHaveBeenCalledOnce()
    expect(fail.mock.calls[0]?.[0].id).toBe('nas-1')
    expect(fail.mock.calls[0]?.[1].message).toMatch(/identity changed/)
  })

  it('keeps a runtime selection fixed until restart and preserves lifecycle ordering', async () => {
    const runtimeStore = store()
    runtimeStore.savePairing('https://nas.example.com', pairing(), 'AA'.repeat(32))
    const order: string[] = []
    const runtime = authority({
      store: runtimeStore,
      publish: () => { order.push('publish') },
      stop: () => { order.push('stop'); return Promise.resolve() },
      restart: (delay) => { order.push(`restart:${String(delay)}`) },
    })
    expect(runtime.bootRuntime).toEqual({ kind: 'local' })

    await expect(runtime.execute({
      kind: 'select', selection: { kind: 'nas', serverId: 'nas-1' },
    })).resolves.toEqual({ restarting: true })
    expect(order).toEqual(['publish', 'stop', 'restart:250'])
    expect(runtime.bootRuntime).toEqual({ kind: 'local' })
    expect(runtime.status().selection).toEqual({ kind: 'nas', serverId: 'nas-1' })
  })

  it('removes local credentials and restarts only when this paired device revokes itself', async () => {
    const runtimeStore = store()
    const ownDeviceId = 'a'.repeat(32)
    runtimeStore.savePairing('https://nas.example.com', pairing('nas-1', ownDeviceId), 'AA'.repeat(32))
    runtimeStore.select({ kind: 'nas', serverId: 'nas-1' })
    const restart = vi.fn()
    const runtime = authority({ store: runtimeStore, restart })

    await runtime.execute({ kind: 'revoke-device', serverId: 'nas-1', deviceId: 'b'.repeat(32) })
    expect(runtime.status().servers).toHaveLength(1)
    expect(restart).not.toHaveBeenCalled()

    await runtime.execute({ kind: 'revoke-device', serverId: 'nas-1', deviceId: ownDeviceId })
    expect(runtime.status().servers).toEqual([])
    expect(restart).toHaveBeenCalledWith(250)
  })
})

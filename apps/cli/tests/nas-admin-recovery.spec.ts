import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { JSON_SCHEMA, load } from 'js-yaml'
import { Context } from '@deepseek-ai/cordis'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { NasAccess } from '@deepseek-ai/dsh-client-connection'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { onTestFinished, vi } from 'vitest'
import { issueNasAdministratorRecovery } from '../src/nas-admin-recovery.ts'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function temporaryHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-nas-recovery-'))
  roots.push(home)
  return home
}

describe('server-local NAS administrator recovery', () => {
  it('serializes invitation consumption and last-administrator changes with the real local provider', async () => {
    const home = await temporaryHome()
    const file = join(home, '.credentials.yaml')
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    onTestFinished(() => { vi.restoreAllMocks() })
    await ctx.plugin(LocalCredentialProvider, { path: file, watch: false })
    const access = await NasAccess.create(ctx.credentials, {
      enabled: true, name: 'Concurrent NAS', version: 'test', protocolVersion: 1,
      trustedHosts: ['harness.local'], deviceLifetimeDays: 90, pairingCode: '12345678',
    })
    const server = createServer((request, response) => {
      const path = new URL(request.url ?? '/', 'http://harness.local').pathname
      const route = access.routes.find(candidate => candidate.path === path)
      if (route === undefined) { response.writeHead(404); response.end(); return }
      void route.handler(request, response)
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    onTestFinished(() => new Promise<void>((resolve, reject) => {
      server.close((error) => { if (error === undefined) resolve(); else reject(error) })
    }))
    const origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
    const request = (path: string, token?: string, body?: object) => fetch(`${origin}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { host: 'harness.local', ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const bootstrap = await request('/nas/pair', undefined, { code: '12345678', deviceName: 'Admin one' })
    expect(bootstrap.status).toBe(200)
    const admin = await bootstrap.json() as { token: string; deviceId: string }
    const invitation = await request('/nas/invitations', admin.token, { role: 'admin' })
      .then(response => response.json()) as { code: string }
    const attempts = await Promise.all([1, 2].map(index => request('/nas/pair', undefined, {
      code: invitation.code, deviceName: `Admin candidate ${String(index)}`,
    })))
    expect(attempts.map(response => response.status).sort()).toEqual([200, 401])
    const second = await attempts.find(response => response.status === 200)!.json() as { token: string; deviceId: string }
    const demotions = await Promise.all([
      request('/nas/device-role', admin.token, { deviceId: admin.deviceId, role: 'readonly' }),
      request('/nas/device-role', second.token, { deviceId: second.deviceId, role: 'readonly' }),
    ])
    expect(demotions.filter(response => response.status === 200)).toHaveLength(1)
    expect(demotions.some(response => response.status === 409 || response.status === 403)).toBe(true)
    expect(access.listDevices().filter(device => device.role === 'admin')).toHaveLength(1)
    const persisted = await readFile(file, 'utf8')
    expect(persisted).not.toContain(admin.token)
    expect(persisted).not.toContain(second.token)
    const reloaded = await NasAccess.create(ctx.credentials, {
      enabled: true, name: 'Concurrent NAS', version: 'test', protocolVersion: 1,
      trustedHosts: ['harness.local'], deviceLifetimeDays: 90, pairingCode: '12345678',
    })
    expect(reloaded.listDevices().filter(device => device.role === 'admin')).toHaveLength(1)
  })

  it('persists only the code hash and expiry while preserving unrelated credentials', async () => {
    const home = await temporaryHome()
    const file = join(home, '.credentials.yaml')
    await writeFile(file, 'version: 1\nrefs:\n  DSH_TEST_UNRELATED: keep-existing-value\n', { mode: 0o600 })
    const issued = await issueNasAdministratorRecovery({ home })
    expect(issued.credentialsFile).toBe(file)
    expect(issued.code).toMatch(/^[0-9]{8}$/u)
    expect(Date.parse(issued.expiresAt)).toBeGreaterThan(Date.now())
    const text = await readFile(file, 'utf8')
    expect(text).not.toContain(issued.code)
    expect(load(text, { schema: JSON_SCHEMA })).toMatchObject({
      refs: { DSH_TEST_UNRELATED: 'keep-existing-value' },
      records: {
        'client-connection/nas-administrator-recovery': {
          kind: 'grant', payload: {
            tokenHash: createHash('sha256').update(issued.code).digest('hex'),
            expiresAt: issued.expiresAt,
          },
        },
      },
    })
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600)
  })

  it('uses only the explicit custom credentials document and replaces the prior recovery grant', async () => {
    const home = await temporaryHome()
    const custom = join(home, 'server-private.yaml')
    await writeFile(custom, 'version: 1\nrecords:\n  client-connection/nas-administrator-recovery:\n    kind: grant\n    payload:\n      tokenHash: previous-recovery-hash\n      expiresAt: "2000-01-01T00:00:00.000Z"\n', { mode: 0o600 })
    const second = await issueNasAdministratorRecovery({ home, credentialsFile: custom })
    const text = await readFile(custom, 'utf8')
    expect(text).not.toContain('previous-recovery-hash')
    expect(text).toContain(createHash('sha256').update(second.code).digest('hex'))
    await expect(stat(join(home, '.credentials.yaml'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects an invalid document without overwriting it', async () => {
    const home = await temporaryHome()
    const file = join(home, '.credentials.yaml')
    const original = 'version: 999\nrefs: {}\n'
    await writeFile(file, original, { mode: 0o600 })
    await expect(issueNasAdministratorRecovery({ home })).rejects.toThrow()
    expect(await readFile(file, 'utf8')).toBe(original)
  })
})

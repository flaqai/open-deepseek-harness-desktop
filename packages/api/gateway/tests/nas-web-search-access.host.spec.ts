/** NAS Search/Fetch settings use real Remote controllers over observable in-memory stores. */

import { createHash } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import RemoteAccessService from '@deepseek-ai/dsh-api-remote-access'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'
import { HostConnectionService, type PeerScope } from '@deepseek-ai/dsh-client-connection'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { afterEach, expect, it, vi } from 'vitest'
import SettingsController from '../../settings-controller/src/index.ts'
import { credentialKey, credentialRef } from '../../../credentials/credentials/src/index.ts'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import { BrowserAuth } from '../../../client/connection/src/browser-auth.ts'
import { NasAccess } from '../../../client/connection/src/nas-access.ts'
import { installNasPolicy } from '../../../client/connection/src/nas-policy.ts'
import type { SettingsDescriptor, SettingsNamespace } from '../../../settings/settings/src/index.ts'

const namespaces = ['web', 'web-search-deepseek', 'web-deepseek-api'] as const
const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.restoreAllMocks()
})

class UnclassifiedSearchFixture extends TypertRemoteService {
  constructor(ctx: Context, private readonly called: () => void) { super(ctx, 'futureSearch') }

  @Remote
  configure(): void { this.called() }
}

async function setup() {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(RemoteAccessService)
  await ctx.plugin(TypertGatewayService)
  await ctx.plugin(SessionStore)
  ctx.provide('sessionPersistence', { list: async () => [] })
  ctx.provide('workspaceRegistry', { list: () => [] })
  const credentials = new MemoryCredentials(ctx, { DEEPSEEK_API_KEY: 'fixture-original' })
  const devices = ['admin', 'user', 'readonly'].map(role => ({
    id: role, name: role, role,
    tokenHash: createHash('sha256').update(`fixture-${role}-token`).digest('hex'),
    createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }))
  await credentials.modifyRecord(credentialKey('client-connection', 'nas-devices'), async () => ({
    kind: 'grant', payload: { version: 2, instanceId: 'fixture-nas', devices },
  }))
  const access = await NasAccess.create(credentials, {
    enabled: true, name: 'NAS', version: 'test', protocolVersion: 1, trustedHosts: [], deviceLifetimeDays: 90,
  })
  await installNasPolicy(ctx, access)
  const auth = await BrowserAuth.create(ctx, credentials, 30, access)
  new HostConnectionService(ctx, [], auth)
  const stored = new Map<string, Record<string, boolean>>(namespaces.map(ns => [ns, { enabled: false }]))
  const describe = vi.fn((): SettingsDescriptor[] => [...stored].map(([ns, value]) => ({
    ns: ns as SettingsNamespace, value: { ...value }, autoGenerate: true, schema: {}, revision: 0, applies: 'live',
  })))
  const update = vi.fn(async (ns: string, patch: Record<string, boolean>) => {
    stored.set(ns, { ...stored.get(ns), ...patch })
  })
  const replace = vi.fn(async (ns: string, section: Record<string, boolean>) => { stored.set(ns, { ...section }) })
  const mutate = vi.fn(async (ns: string, ops: { op: string; path: string[]; value?: boolean }[]) => {
    const section = { ...stored.get(ns) }
    for (const op of ops) {
      const key = op.path[0]
      if (key === undefined) throw new Error('fixture requires a field path')
      if (op.op === 'unset') Reflect.deleteProperty(section, key)
      else if (op.value !== undefined) section[key] = op.value
    }
    stored.set(ns, section)
  })
  ctx.provide('settings', { writable: true, describe, update, replace, mutate })
  await ctx.plugin(SettingsController)
  const unknownCalled = vi.fn()
  await ctx.plugin({ apply(owner) { new UnclassifiedSearchFixture(owner, unknownCalled) } })
  const set = vi.spyOn(credentials, 'set')
  const unset = vi.spyOn(credentials, 'unset')
  const peerFor = (role: 'admin' | 'user' | 'readonly'): PeerScope => {
    const admission = ctx.connection.admit({ headers: new Headers({ host: 'localhost', authorization: `Bearer fixture-${role}-token` }) })
    if ('rejection' in admission) throw new Error(`fixture device was rejected: ${String(admission.rejection)}`)
    expect(admission.peer.principal).toEqual(role === 'admin' ? { kind: 'owner' } : { kind: 'nas', deviceId: role })
    return admission.peer
  }
  const shared = ctx.connection.createSharedFetchHandler('/api')
  const http = async (peer: PeerScope, namespace: string, method: string, args: object): Promise<unknown> => {
    const endpoint = `${namespace}/${method}`
    const response = await shared.fetch(new Request(`http://localhost/api/${endpoint}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'nas-search', method: endpoint, payload: { args } }),
    }), peer)
    return response.json()
  }
  return { ctx, credentials, stored, describe, update, replace, mutate, set, unset, unknownCalled, peerFor, http }
}

it.each(['user', 'readonly'] as const)('denies %s direct and HTTP settings or credential writes before storage', async (role) => {
  const fixture = await setup()
  const { ctx, peerFor, http } = fixture
  const peer = peerFor(role)
  const writes = namespaces.flatMap(ns => [
    { namespace: 'settings', method: 'update', args: { ns, patch: { enabled: true } } },
    { namespace: 'settings', method: 'replace', args: { ns, section: { enabled: true } } },
    { namespace: 'settings', method: 'mutate', args: { ns, ops: [{ op: 'set', path: ['enabled'], value: true }] } },
  ])
  for (const request of [
    ...writes,
    { namespace: 'credentials', method: 'set', args: { ref: 'DEEPSEEK_API_KEY', value: 'fixture-replacement' } },
    { namespace: 'credentials', method: 'unset', args: { ref: 'DEEPSEEK_API_KEY' } },
    { namespace: 'futureSearch', method: 'configure', args: {} },
  ]) {
    await expect(ctx.typertGateway.invoke({ peer, ...request }))
      .rejects.toMatchObject({ code: 'remote-access/denied', details: { reason: 'nas-role-forbidden' } })
    expect(await http(peer, request.namespace, request.method, request.args)).toMatchObject({
      result: { ok: false, error: { code: 'remote-access/denied', details: { reason: 'nas-role-forbidden' } } },
    })
  }
  for (const spy of [
    fixture.describe, fixture.update, fixture.replace, fixture.mutate, fixture.set, fixture.unset, fixture.unknownCalled,
  ]) {
    expect(spy).not.toHaveBeenCalled()
  }
  expect([...fixture.stored.values()]).toEqual(namespaces.map(() => ({ enabled: false })))
  expect(await fixture.credentials.resolve(credentialRef('DEEPSEEK_API_KEY'))).toEqual({ value: 'fixture-original', source: 'memory' })
})

it('admits an authenticated administrator as owner and commits real controller writes through both carriers', async () => {
  const { ctx, credentials, stored, peerFor, http, update, replace, mutate, set, unset } = await setup()
  const peer = peerFor('admin')
  for (const ns of namespaces) {
    await expect(ctx.typertGateway.invoke({ peer, namespace: 'settings', method: 'update', args: { ns, patch: { enabled: true } } }))
      .resolves.toMatchObject({ ns, value: { enabled: true } })
    expect(stored.get(ns)).toEqual({ enabled: true })
    expect(await http(peer, 'settings', 'replace', { ns, section: { enabled: false } }))
      .toMatchObject({ result: { ok: true, value: { ns, value: { enabled: false } } } })
    expect(stored.get(ns)).toEqual({ enabled: false })
    expect(await http(peer, 'settings', 'mutate', { ns, ops: [{ op: 'set', path: ['enabled'], value: true }] }))
      .toMatchObject({ result: { ok: true, value: { ns, value: { enabled: true } } } })
    expect(stored.get(ns)).toEqual({ enabled: true })
  }
  await ctx.typertGateway.invoke({ peer, namespace: 'credentials', method: 'set', args: { ref: 'DEEPSEEK_API_KEY', value: 'fixture-new' } })
  expect(await credentials.resolve(credentialRef('DEEPSEEK_API_KEY'))).toEqual({ value: 'fixture-new', source: 'memory' })
  expect(await http(peer, 'credentials', 'unset', { ref: 'DEEPSEEK_API_KEY' })).toMatchObject({ result: { ok: true } })
  expect(await credentials.resolve(credentialRef('DEEPSEEK_API_KEY'))).toBeUndefined()
  expect(await http(peer, 'credentials', 'set', { ref: 'DEEPSEEK_API_KEY', value: 'fixture-http' }))
    .toMatchObject({ result: { ok: true } })
  expect(await credentials.resolve(credentialRef('DEEPSEEK_API_KEY'))).toEqual({ value: 'fixture-http', source: 'memory' })
  await ctx.typertGateway.invoke({ peer, namespace: 'credentials', method: 'unset', args: { ref: 'DEEPSEEK_API_KEY' } })
  expect(await credentials.resolve(credentialRef('DEEPSEEK_API_KEY'))).toBeUndefined()
  expect(update).toHaveBeenCalledTimes(3)
  expect(replace).toHaveBeenCalledTimes(3)
  expect(mutate).toHaveBeenCalledTimes(3)
  expect(set).toHaveBeenCalledTimes(2)
  expect(unset).toHaveBeenCalledTimes(2)
})

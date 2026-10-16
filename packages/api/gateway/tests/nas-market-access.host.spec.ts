/** NAS market access remains administrator-only across direct calls, HTTP and event streams. */

import { Context } from '@deepseek-ai/cordis'
import { apply as applyConnection, inject as connectionInject } from '@deepseek-ai/dsh-client-connection'
import RemoteAccessService from '@deepseek-ai/dsh-api-remote-access'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import { afterEach, expect, it, vi } from 'vitest'
import { NasAccess } from '../../../client/connection/src/nas-access.ts'
import { installNasPolicy } from '../../../client/connection/src/nas-policy.ts'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'

class MarketFixture extends TypertRemoteService {
  constructor(ctx: Context, private readonly called: () => void) { super(ctx, 'pluginMarket') }

  @Remote
  listIndexes(): string[] { this.called(); return [] }

  @Remote
  search(): string[] { this.called(); return [] }

  @Remote
  setIndexes(): void { this.called() }
}

class InstallFixture extends TypertRemoteService {
  constructor(ctx: Context, private readonly called: () => void) { super(ctx, 'pluginManager') }

  @Remote
  install(): void { this.called() }
}

class HistoryFixture extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, 'session') }

  @Remote({ resources: { session: () => SessionId('shared') } })
  page(): string { return 'shared history' }
}

const roots: Context[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.restoreAllMocks()
})

async function setup() {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(RemoteAccessService)
  await ctx.plugin(TypertGatewayService)
  await ctx.plugin(SessionStore)
  ctx.sessions.create(SessionId('shared'))
  ctx.provide('sessionPersistence', { list: async () => [] })
  ctx.provide('workspaceRegistry', { list: () => [] })
  const access = await NasAccess.create(new MemoryCredentials(ctx), {
    enabled: true, name: 'NAS', version: 'test', protocolVersion: 1, trustedHosts: [], deviceLifetimeDays: 90,
  })
  vi.spyOn(access, 'device').mockImplementation(id => ({
    id, role: id === 'user' ? 'user' : 'readonly', name: id,
    createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }))
  await installNasPolicy(ctx, access)
  await ctx.plugin({ inject: [...connectionInject], apply: applyConnection })
  const marketCalled = vi.fn()
  const installCalled = vi.fn()
  await ctx.plugin({ apply(owner) { new MarketFixture(owner, marketCalled) } })
  await ctx.plugin({ apply(owner) { new InstallFixture(owner, installCalled) } })
  await ctx.plugin(HistoryFixture)
  return { ctx, marketCalled, installCalled }
}

it('denies new index operations and installation before dispatch while preserving shared history', async () => {
  const { ctx, marketCalled, installCalled } = await setup()
  const shared = ctx.connection.createSharedFetchHandler('/api')
  for (const role of ['user', 'readonly'] as const) {
    const peer = ctx.connection.createPeer({ principal: { kind: 'nas', deviceId: role }, interactions: role === 'readonly' ? 'none' : 'answer' })
    for (const [namespace, method] of [['pluginMarket', 'listIndexes'], ['pluginMarket', 'search'], ['pluginMarket', 'setIndexes'], ['pluginManager', 'install']] as const) {
      await expect(ctx.typertGateway.invoke({ peer, namespace, method, args: {} }))
        .rejects.toMatchObject({ code: 'remote-access/denied', details: { reason: 'nas-role-forbidden' } })
      const endpoint = `${namespace}/${method}`
      const response = await shared.fetch(new Request(`http://localhost/api/${endpoint}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'nas-market', method: endpoint, payload: { args: {} } }),
      }), peer)
      expect(await response.json()).toMatchObject({ result: { ok: false, error: { code: 'remote-access/denied' } } })
    }
    await expect(ctx.typertGateway.invoke({ peer, namespace: 'session', method: 'page', args: {} })).resolves.toBe('shared history')
  }
  expect(marketCalled).not.toHaveBeenCalled()
  expect(installCalled).not.toHaveBeenCalled()
  await expect(ctx.typertGateway.invoke({ peer: ctx.connection.browserPeer, namespace: 'pluginMarket', method: 'listIndexes', args: {} })).resolves.toEqual([])
  await expect(ctx.typertGateway.invoke({ peer: ctx.connection.browserPeer, namespace: 'pluginMarket', method: 'setIndexes', args: {} })).resolves.toBeUndefined()
  await expect(ctx.typertGateway.invoke({ peer: ctx.connection.browserPeer, namespace: 'pluginManager', method: 'install', args: {} })).resolves.toBeUndefined()
})

it('filters market events from a NAS user without losing allowed shared-history events', async () => {
  const { ctx } = await setup()
  const deliveries = [
    { event: 'plugin-market/changed', args: [] },
    { event: 'api-session/added', args: [] },
  ]
  const ready = Promise.withResolvers<undefined>()
  ctx.effect(() => ctx.typertGateway.registerRemoteEvents(async function* (signal) {
    await ready.promise
    yield* deliveries
    await new Promise<void>((resolve) => {
      if (signal.aborted) resolve()
      else signal.addEventListener('abort', () => { resolve() }, { once: true })
    })
  }, { home: '/fixture' }))
  const abort = new AbortController()
  const user = ctx.connection.createPeer({ principal: { kind: 'nas', deviceId: 'user' } })
  const open = async (peer: typeof user) => (await ctx.typertGateway.wireStream.open(
    '$events', { args: {} }, (async function* () {})(), peer, abort.signal,
  ))[Symbol.asyncIterator]()
  const restricted = await open(user)
  const admin = await open(ctx.connection.browserPeer)
  try {
    await restricted.next()
    await admin.next()
    ready.resolve(undefined)
    await expect(restricted.next()).resolves.toMatchObject({ value: { type: 'emit', event: 'api-session/added' } })
    await expect(admin.next()).resolves.toMatchObject({ value: { type: 'emit', event: 'plugin-market/changed' } })
  } finally {
    ready.resolve(undefined)
    abort.abort()
    await restricted.return?.()
    await admin.return?.()
  }
})

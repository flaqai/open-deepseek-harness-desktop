/** Shared resources are granted independently; device roles never authorize unknown operations. */

import { Context } from '@deepseek-ai/cordis'
import RemoteAccessService, { type RemoteAccessAction, type RemoteAccessResource } from '@deepseek-ai/dsh-api-remote-access'
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import { afterEach, expect, it, vi } from 'vitest'
import { NasAccess } from '../src/nas-access.ts'
import { installNasPolicy } from '../src/nas-policy.ts'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  vi.restoreAllMocks()
})

it('explicitly grants workspace and session reads, denies readonly writes and dangerous or unclassified operations', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(RemoteAccessService)
  const session = ctx.sessions.create(SessionId('shared-session'))
  const workspaceId = WorkspaceId('shared-workspace')
  ctx.provide('sessionPersistence', { list: async () => [] })
  ctx.provide('workspaceRegistry', { list: () => [{ id: workspaceId, sessionIds: [session.id] }] })
  const access = await NasAccess.create(new MemoryCredentials(ctx), {
    enabled: true, name: 'NAS', version: 'test', protocolVersion: 1, trustedHosts: [], deviceLifetimeDays: 90,
  })
  const device = vi.spyOn(access, 'device').mockReturnValue({ id: 'device', role: 'readonly', name: 'Device',
    createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1000).toISOString() })
  await installNasPolicy(ctx, access)
  const decide = (action: RemoteAccessAction, resources: readonly RemoteAccessResource[] = [{ kind: 'global' }]) =>
    ctx.remoteAccess.decide({ principal: { kind: 'nas', deviceId: 'device' }, action, resources }).kind
  expect(decide('session/page', [{ kind: 'session', id: session.id }])).toBe('allow')
  expect(decide('workspace/follow', [{ kind: 'workspace', id: workspaceId }])).toBe('allow')
  expect(decide('session/page', [{ kind: 'session', id: SessionId('unlisted-session') }])).toBe('deny')
  expect(decide('session/prompt', [{ kind: 'session', id: session.id }])).toBe('deny')
  expect(decide('session/create')).toBe('deny')
  device.mockReturnValue({ id: 'device', role: 'user', name: 'Device',
    createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1000).toISOString() })
  expect(decide('session/create')).toBe('allow')
  expect(decide('session/prompt', [{ kind: 'session', id: session.id }])).toBe('allow')
  expect(decide('event:user-questions/request')).toBe('allow')
  for (const action of ['settings/set', 'pluginManager/install', 'credentials/read', 'thirdParty/unknown',
    'event:tools/approval', 'session/delete', 'session/cancel'] as const) expect(decide(action)).toBe('deny')
  device.mockReturnValue(undefined)
  expect(decide('session/prompt', [{ kind: 'session', id: session.id }])).toBe('deny')
})

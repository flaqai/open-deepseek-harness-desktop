/** NAS file reads use canonical shared roots across RPC and exact image routes. */

import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import RemoteAccessService from '@deepseek-ai/dsh-api-remote-access'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'
import WorkspaceFiles from '@deepseek-ai/dsh-api-workspace-files'
import { Peer, type ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { NasAccess } from '@deepseek-ai/dsh-client-connection/src/nas-access.ts'
import { installNasPolicy } from '@deepseek-ai/dsh-client-connection/src/nas-policy.ts'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import { SessionMediaReferences } from '../src/media-references.ts'
import { testSessionPersistence } from './test-remote.ts'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0)) await dispose()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

it('denies external files, escaping directory links and home control files without changing local owner reads', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-nas-file-access-')))
  const workspace = join(root, 'shared')
  const outside = join(root, 'outside')
  await mkdir(workspace)
  await mkdir(outside)
  await writeFile(join(workspace, 'allowed.md'), 'shared document')
  await writeFile(join(outside, 'secret.md'), 'external data')
  await writeFile(join(workspace, '.credentials.yaml'), 'private token')
  await symlink(outside, join(workspace, 'escape'), 'dir')
  const home = join(workspace, 'managed-home')
  await mkdir(home)
  await writeFile(join(home, 'settings.yml'), 'server control configuration')
  vi.stubEnv('DSH_HOME', home)
  const ctx = new Context()
  cleanup.push(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(SessionStore)
  await ctx.plugin(RemoteAccessService)
  await ctx.plugin(LocalFileSystem, { cwd: workspace })
  ctx.provide('sandboxPolicy', { workspaceRoot: workspace } as never)
  const sessionId = SessionId('shared-file-session')
  ctx.sessions.create(sessionId, { meta: { cwd: workspace } })
  ctx.provide('sessionPersistence', testSessionPersistence(ctx, { list: async () => [] }))
  ctx.provide('workspaceRegistry', { list: () => [{ id: WorkspaceId('shared'), path: workspace, sessionIds: [sessionId] }] } as never)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  const access = await NasAccess.create(new MemoryCredentials(ctx), {
    enabled: true, name: 'NAS', version: 'test', protocolVersion: 1, trustedHosts: [], deviceLifetimeDays: 90,
  })
  vi.spyOn(access, 'device').mockReturnValue({ id: 'reader', role: 'readonly', name: 'Reader',
    createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 100_000).toISOString() })
  await installNasPolicy(ctx, access)
  await ctx.plugin(WorkspaceFiles, { maxBytes: 1024, maxFileBytes: 1024, maxLines: 100, maxEntries: 100 })
  await ctx.plugin(TypertGatewayService)
  const reader = new Peer(ctx, { principal: { kind: 'nas', deviceId: 'reader' } })
  const owner = new Peer(ctx, { principal: { kind: 'owner' } })
  const read = (path: string, peer = reader) => ctx.typertGateway.invoke({ peer, namespace: 'workspaceFiles', method: 'readBytes',
    args: { workspaceFileScopeId: sessionId, path, options: {} } })
  await expect(read('allowed.md')).resolves.toHaveProperty('data')
  for (const path of [join(outside, 'secret.md'), 'escape/secret.md', '.credentials.yaml', join(home, 'settings.yml')]) {
    await expect(read(path)).rejects.toMatchObject({ code: 'workspace-file/outside-workspace' })
  }
  await expect(read(join(outside, 'secret.md'), owner)).resolves.toHaveProperty('data')

  let route: ConnectionFetchRoute | undefined
  ctx.provide('connection', { fetch: { register: (value: ConnectionFetchRoute) => { route = value; return () => {} } } } as never)
  ctx.provide('attachments', { imageLimits: { maxImageBytes: 1024 } } as never)
  await ctx.plugin(SessionMediaReferences)
  const preview = (path: string, peer = reader) => {
    if (route === undefined) throw new Error('media route did not mount')
    return route.fetch(new Request(`http://localhost/api/file?path=${encodeURIComponent(path)}`), peer)
  }
  expect((await preview(join(workspace, 'allowed.md'))).status).toBe(200)
  for (const path of [join(outside, 'secret.md'), join(workspace, 'escape', 'secret.md'), join(workspace, '.credentials.yaml')]) {
    expect((await preview(path)).status).toBe(403)
  }
  expect((await preview(join(outside, 'secret.md'), owner)).status).toBe(200)
})

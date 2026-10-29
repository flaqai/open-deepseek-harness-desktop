import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { boot, initProfile, readProfilePatches } from '@deepseek-ai/dsh-app-boot'
import * as appBoot from '@deepseek-ai/dsh-app-boot'
import { expect, it, onTestFinished, vi } from 'vitest'
import Hmr from '@deepseek-ai/dsh-hmr'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import { listManagedServers, upsertServer, setServerEnabled, removeServer } from '../src/patch-writer.ts'
import { McpSettingsController } from '../src/index.ts'

async function fixture(text = '[]\n') {
  const home = await mkdtemp(join(tmpdir(), 'mcp-settings-'))
  const dir = join(home, 'profiles', 'web')
  initProfile(dir, [])
  const patchPath = join(dir, 'cordis.patch.yml')
  await writeFile(patchPath, text)
  const ctx = new Context()
  ctx.provide('profileContext', { name: 'web', dir, patchPath, installAnchor: join(home, 'package.json'), cwd: home, home, startedBundles: [], overlays: [], telemetryDisabledEnv: undefined })
  onTestFinished(async () => { await ctx.fiber.dispose(); await rm(home, { recursive: true, force: true }) })
  return { ctx, patchPath }
}

it('persists without trying to reload a Loader when HMR is absent', async () => {
  const { ctx, patchPath } = await fixture()
  expect(await upsertServer(ctx, 'sample', { serverName: 'sample', transport: 'stdio', command: 'node' })).toBe('restart-required')
  expect((await listManagedServers(ctx)).get('mcp-sample')).toBe('sample')
  await setServerEnabled(ctx, 'sample', false)
  expect(await readFile(patchPath, 'utf8')).toContain('disabled: true')
  await removeServer(ctx, 'sample')
  expect((await listManagedServers(ctx)).size).toBe(0)
})

it('retains unknown options and comments when editing an imported server', async () => {
  const { ctx, patchPath } = await fixture('# user configuration\n- insert:\n    - id: mcp-sample\n      name: "@deepseek-ai/dsh-mcp-client"\n      config:\n        serverName: sample\n        transport: stdio\n        command: node\n        futureOption: keep-me\n- id: unrelated\n  config:\n    conditional: !!js process.platform\n')
  await upsertServer(ctx, 'sample', { serverName: 'sample', transport: 'stdio', command: 'updated' })
  const text = await readFile(patchPath, 'utf8')
  expect(text).toContain('# user configuration')
  expect(text).toContain('futureOption: keep-me')
  expect(text).toContain('!!js process.platform')
  expect(text).toContain('command: updated')
})

it('refuses an entry id collision without changing another plugin', async () => {
  const source = '- insert:\n    - id: mcp-sample\n      name: other-plugin\n      config: {}\n'
  const { ctx, patchPath } = await fixture(source)
  await expect(upsertServer(ctx, 'sample', { serverName: 'sample', transport: 'stdio', command: 'node' })).rejects.toThrow('another plugin')
  expect(await readFile(patchPath, 'utf8')).toBe(source)
})

it('rejects unsafe Remote targets and transports before accessing or changing the Loader', async () => {
  const { ctx, patchPath } = await fixture()
  const controller = new McpSettingsController(ctx)
  const before = await readFile(patchPath, 'utf8')
  await expect(controller.upsert({ serverName: '../other', transport: 'stdio', command: 'node' })).rejects.toThrow()
  await expect(controller.upsert({ serverName: 'sample', transport: 'stdio', command: '' })).rejects.toThrow()
  await expect(controller.upsert({ serverName: 'sample', transport: 'streamable-http', url: 'file:///etc/passwd' })).rejects.toThrow()
  await expect(controller.setEnabled('../other', true)).rejects.toThrow()
  await expect(controller.deleteServer('absent')).rejects.toThrow()
  expect(await readFile(patchPath, 'utf8')).toBe(before)
})

it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])('refuses invalid MCP tool timeout %s without changing the Profile', async (toolCallTimeoutMs) => {
  const { ctx, patchPath } = await fixture()
  const controller = new McpSettingsController(ctx)
  const before = await readFile(patchPath, 'utf8')
  await expect(controller.upsert({ serverName: 'sample', transport: 'stdio', command: 'node', toolCallTimeoutMs })).rejects.toThrow('positive safe integer')
  expect(await readFile(patchPath, 'utf8')).toBe(before)
})

it('loads the saved MCP configuration and rolls back readProfilePatches and activation failures', async () => {
  const { ctx, patchPath } = await fixture()
  await upsertServer(ctx, 'sample', { serverName: 'sample', transport: 'stdio', command: 'node', args: ['--version'] })
  const rootPath = join(ctx.profileContext.dir, 'cordis.yml')
  await writeFile(rootPath, '[]\n')
  const profile = ctx.profileContext
  const external = join(profile.dir, 'node_modules', '@deepseek-ai', 'dsh-mcp-client')
  await mkdir(external, { recursive: true })
  await writeFile(join(external, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-mcp-client', type: 'module', exports: './index.js' }))
  await writeFile(join(external, 'index.js'), 'export function apply(ctx, config) { if (config.command === "broken") throw new Error("connection failed") }\n')
  const loaded = await boot('mcp-settings-test', rootPath, readProfilePatches('dsh', profile), (owner) => {
    owner.provide('profileContext', profile)
    owner.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => {} } })
  })
  onTestFinished(() => loaded.fiber.dispose())
  const entry = [...loaded.loader.entries()].find(entry => entry.options.id === 'mcp-sample')
  expect(entry?.options.config).toMatchObject({ serverName: 'sample', command: 'node', args: ['--version'] })
  expect(entry?.disabled).not.toBe(true)
  expect(entry?.fiber?.state).toBe(2)
  expect(await readFile(patchPath, 'utf8')).toContain('mcp-sample')
  await loaded.plugin(Timer)
  await loaded.plugin(Hmr, { root: [], ignored: [], debounce: 0 })
  const before = await readFile(patchPath, 'utf8')
  const reading = vi.spyOn(appBoot, 'readProfilePatches').mockImplementationOnce(() => { throw new Error('cannot read candidate patches') })
  try {
    await expect(upsertServer(loaded, 'sample', { serverName: 'sample', transport: 'stdio', command: 'changed' })).rejects.toThrow('cannot read candidate patches')
    expect(await readFile(patchPath, 'utf8')).toBe(before)
  } finally { reading.mockRestore() }
  await expect(upsertServer(loaded, 'sample', { serverName: 'sample', transport: 'stdio', command: 'broken' })).rejects.toThrow()
  expect(await readFile(patchPath, 'utf8')).toBe(before)
  const restored = [...loaded.loader.entries()].find(entry => entry.options.id === 'mcp-sample')
  expect(restored?.options.config).toMatchObject({ command: 'node' })
})

it('projects expression-backed MCP credentials as read-only without exposing or persisting evaluated values', async () => {
  const source = '- insert:\n    - id: mcp-dynamic\n      name: "@deepseek-ai/dsh-mcp-client"\n      config:\n        serverName: dynamic\n        transport: stdio\n        command: node\n        env: !!js ({KEY:"secret-from-expression"})\n        headers: !!js ({Authorization:"secret-from-expression"})\n    - id: mcp-static\n      name: "@deepseek-ai/dsh-mcp-client"\n      config:\n        serverName: static\n        transport: stdio\n        command: node\n'
  const { ctx, patchPath } = await fixture(source)
  const profile = ctx.profileContext
  const rootPath = join(profile.dir, 'cordis.yml')
  await writeFile(rootPath, '[]\n')
  const external = join(profile.dir, 'node_modules', '@deepseek-ai', 'dsh-mcp-client')
  await mkdir(external, { recursive: true })
  await writeFile(join(external, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-mcp-client', type: 'module', exports: './index.js' }))
  await writeFile(join(external, 'index.js'), 'export function apply() {}\n')
  const loaded = await boot('mcp-settings-dynamic', rootPath, readProfilePatches('dsh', profile), (owner) => { owner.provide('profileContext', profile) })
  onTestFinished(() => loaded.fiber.dispose())
  const controller = new McpSettingsController(loaded)
  const rows = await controller.list()
  expect(rows.find(row => row.serverName === 'dynamic')).toMatchObject({ editable: false })
  const dynamic = rows.find(row => row.serverName === 'dynamic')
  expect(dynamic?.config.env).toBeUndefined()
  expect(dynamic?.config.headers).toBeUndefined()
  expect(JSON.stringify(rows)).not.toContain('secret-from-expression')
  expect(rows.find(row => row.serverName === 'static')).toMatchObject({ editable: true })
  await expect(controller.setEnabled('dynamic', false)).rejects.toThrow('read-only')
  await expect(controller.deleteServer('dynamic')).rejects.toThrow('read-only')
  await expect(controller.upsert({ serverName: 'dynamic', transport: 'stdio', command: 'node' })).rejects.toThrow('read-only')
  expect(await readFile(patchPath, 'utf8')).toBe(source)
})

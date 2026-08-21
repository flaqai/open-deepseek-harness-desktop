import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessHandle,
  SubprocessSpawnSpec,
  SubprocessTerminalHandle,
  SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import PluginInventoryGateway from '../src/index.ts'

const contexts: Context[] = []
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), 'dsh-plugin-inventory-'))
  temporaryDirectories.push(path)
  return path
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, undefined, 2)}\n`)
}

const activePlugin: Plugin.Function = () => {}
const pendingPlugin: Plugin.Object = {
  inject: ['neverReady'],
  apply() {},
}

class StubSubprocessRuntime extends SubprocessRuntime {
  readonly spawns: SubprocessSpawnSpec[] = []
  exitCode = 0
  stdout = ''
  stderr = ''

  async resolveExecutable(command: string): Promise<string> {
    return command
  }

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.spawns.push(spec)
    const output = (text: string) => ({
      readFrom: () => ({ text, nextOffset: Buffer.byteLength(text), lossy: false }),
    })
    return {
      pid: 42,
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected: { stdout: output(this.stdout), stderr: output(this.stderr) },
      done: Promise.resolve({ exitCode: this.exitCode, signal: null }),
      terminate: () => {},
      waitForExit: () => Promise.resolve(true),
    }
  }

  async spawnTerminal(_spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    throw new Error('not used')
  }
}

async function harness(): Promise<{
  ctx: Context
  inventory: PluginInventoryGateway
  subprocess: StubSubprocessRuntime
}> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  await ctx.plugin(StubSubprocessRuntime)
  ctx.loader.builtins.active = activePlugin
  ctx.loader.builtins.pending = pendingPlugin
  await ctx.plugin(PluginInventoryGateway)
  const inventory = ctx.get('pluginInventory') as PluginInventoryGateway
  return { ctx, inventory, subprocess: ctx.subprocess as StubSubprocessRuntime }
}

describe('PluginInventoryGateway', () => {
  it('publishes one direct list method under the pluginInventory namespace', async () => {
    const { inventory } = await harness()
    expect(inventory.typertRemote).toMatchObject({
      serviceKey: 'pluginInventory',
      namespace: 'pluginInventory',
    })
    expect(remoteMethods(inventory)).toEqual([
      { method: 'list', invocation: { kind: 'direct' } },
      { method: 'externalTools', invocation: { kind: 'direct' } },
      { method: 'setExternalTool', invocation: { kind: 'direct' } },
      { method: 'dismissDependencyHealth', invocation: { kind: 'direct' } },
      { method: 'uninstallQuarantine', invocation: { kind: 'direct' } },
      { method: 'startQuarantineRetry', invocation: { kind: 'direct' } },
      { method: 'startInstall', invocation: { kind: 'direct' } },
      { method: 'startUninstall', invocation: { kind: 'direct' } },
      { method: 'startDependencyDoctor', invocation: { kind: 'direct' } },
      { method: 'getDependencyDoctor', invocation: { kind: 'direct' } },
      { method: 'getInstall', invocation: { kind: 'direct' } },
    ])
  })

  it('projects disconnected Host tools and rejects unsupported or unavailable toggles', async () => {
    const { inventory } = await harness()
    await expect(inventory.externalTools()).resolves.toEqual({
      scope: 'complete-presets',
      codex: false,
      claudeCode: false,
    })
    await expect(inventory.setExternalTool({ tool: 'codex', enabled: true }))
      .rejects.toThrow(/agent preset roster is unavailable/)
    await expect(inventory.setExternalTool({ tool: 'hermes' as 'codex', enabled: true }))
      .rejects.toThrow(/unsupported external tool/)
  })

  it('runs the core doctor in read-only and repair modes with structured phases', async () => {
    const { inventory, subprocess } = await harness()
    subprocess.stdout = JSON.stringify({
      schema: 'dsh/profile-dependency-repair/v1',
      profile: 'web',
      status: 'failed',
      conflicts: [{
        profile: 'web',
        rootPackage: 'dsh-computer-use',
        dependencyChain: ['dsh-computer-use', '@deepseek-ai/dsh-tools'],
        dependency: '@deepseek-ai/dsh-tools',
        declaredRange: '^0.1.0-rc.6',
        declaredIn: 'dependencies',
        hostVersion: '0.1.0-rc.7',
        hostPath: '/host/dsh-tools',
        resolvedPath: '/profile/dsh-tools',
        compatible: true,
      }],
      orphanedBundles: [],
      quarantined: [],
    })
    subprocess.exitCode = 2

    const inspected = inventory.startDependencyDoctor({ profile: 'web', repair: false })
    await expect.poll(() => inventory.getDependencyDoctor(inspected.doctorId).phase).toBe('issues')
    expect(inventory.getDependencyDoctor(inspected.doctorId).report?.conflicts[0]).not.toHaveProperty('hostPath')
    expect(subprocess.spawns[0]?.argv.slice(-4)).toEqual(['plugin', '--profile', 'web', 'doctor'])

    subprocess.stdout = JSON.stringify({
      schema: 'dsh/profile-dependency-repair/v1',
      profile: 'web',
      status: 'repaired',
      conflicts: [],
      quarantined: [],
    })
    subprocess.exitCode = 10
    const repaired = inventory.startDependencyDoctor({ profile: 'web', repair: true })
    await expect.poll(() => inventory.getDependencyDoctor(repaired.doctorId).phase).toBe('repaired')
    expect(subprocess.spawns[1]?.argv.slice(-5)).toEqual(['plugin', '--profile', 'web', 'doctor', '--repair'])
  })

  it('starts an exact package uninstall and rejects versioned or path-like targets', async () => {
    const { inventory, subprocess } = await harness()
    const started = inventory.startUninstall({ profile: 'web', packageName: 'dshmarket' })
    expect(started).toMatchObject({
      packageSpec: 'dshmarket',
      command: 'dsh plugin --profile web remove dshmarket',
      phase: 'running',
    })
    expect(subprocess.spawns[0]?.argv.slice(-5)).toEqual([
      'plugin', '--profile', 'web', 'remove', 'dshmarket',
    ])
    await expect.poll(() => inventory.getInstall(started.installId).phase).toBe('succeeded')
    expect(() => inventory.startUninstall({ profile: 'web', packageName: 'dshmarket@1.12.1' }))
      .toThrow(/invalid registry package name/)
    expect(() => inventory.startUninstall({ profile: 'web', packageName: '../dshmarket' }))
      .toThrow(/invalid registry package name/)
  })

  it('projects current non-group Loader entries without a second cache', async () => {
    const { ctx, inventory } = await harness()
    const activeId = await ctx.loader.create({ name: 'cordis:active' })
    const pendingId = await ctx.loader.create({ name: 'cordis:pending' })
    const disabledId = await ctx.loader.create({
      name: 'cordis:not-installed',
      disabled: true,
    })
    await ctx.loader.create({ name: 'cordis:active', group: true })

    const snapshot = inventory.list()
    expect(snapshot.entries).toHaveLength(3)
    expect(snapshot.entries).toEqual(expect.arrayContaining([
      {
        entryId: activeId,
        moduleName: 'cordis:active',
        enabled: true,
        fiberPhase: 'active',
      },
      {
        entryId: pendingId,
        moduleName: 'cordis:pending',
        enabled: true,
        fiberPhase: 'pending',
      },
      {
        entryId: disabledId,
        moduleName: 'cordis:not-installed',
        enabled: false,
        fiberPhase: null,
      },
    ]))

    await ctx.loader.update(activeId, { disabled: true })
    expect(inventory.list().entries.find(entry => entry.entryId === activeId)).toEqual({
      entryId: activeId,
      moduleName: 'cordis:active',
      enabled: false,
      fiberPhase: null,
    })

    await ctx.loader.remove(pendingId)
    expect(inventory.list().entries.some(entry => entry.entryId === pendingId)).toBe(false)
  })

  it('starts a structured CLI install, deduplicates it while running, and publishes completion', async () => {
    const { inventory, subprocess } = await harness()
    const deferred = Promise.withResolvers<{ exitCode: number | null; signal: null }>()
    const baseSpawn = subprocess.spawn.bind(subprocess)
    subprocess.spawn = spec => ({ ...baseSpawn(spec), done: deferred.promise })

    const request = { profile: 'web', packageSpec: '@fixture/dsh-plugin@1.2.3' }
    const started = inventory.startInstall(request)
    expect(started).toMatchObject({
      profile: 'web',
      packageSpec: '@fixture/dsh-plugin@1.2.3',
      command: 'dsh plugin --profile web add @fixture/dsh-plugin@1.2.3',
      phase: 'running',
    })
    expect(inventory.startInstall(request).installId).toBe(started.installId)
    expect(subprocess.spawns).toHaveLength(1)
    expect(subprocess.spawns[0]?.argv.slice(-5)).toEqual([
      'plugin', '--profile', 'web', 'add', '@fixture/dsh-plugin@1.2.3',
    ])
    expect(subprocess.spawns[0]?.stdio.stdin).toBe('ignore')

    deferred.resolve({ exitCode: 0, signal: null })
    await expect.poll(() => inventory.getInstall(started.installId).phase).toBe('succeeded')
    expect(inventory.getInstall(started.installId).exitCode).toBe(0)
  })

  it('rejects non-registry command text and retains bounded failure diagnostics', async () => {
    const { inventory, subprocess } = await harness()
    expect(() => inventory.startInstall({ profile: 'web', packageSpec: 'git+https://example.test/plugin.git' }))
      .toThrow(/invalid registry package spec/)
    expect(() => inventory.startInstall({ profile: '../other', packageSpec: 'safe-plugin' }))
      .toThrow(/invalid profile/)

    subprocess.exitCode = 1
    subprocess.stderr = 'pnpm install failed'
    const started = inventory.startInstall({ profile: 'web', packageSpec: 'safe-plugin' })
    await expect.poll(() => inventory.getInstall(started.installId).phase).toBe('failed')
    expect(inventory.getInstall(started.installId)).toMatchObject({
      exitCode: 1,
      diagnostic: 'pnpm install failed',
    })
    expect(() => inventory.getInstall('not-real' as typeof started.installId)).toThrow(/unknown install/)
  })

  it('projects an automatic convergence outcome as a distinct successful install phase', async () => {
    const { inventory, subprocess } = await harness()
    subprocess.stderr = `dsh: profile dependency health ${JSON.stringify({
      schema: 'dsh/profile-dependency-repair/v1',
      profile: 'web',
      status: 'repaired',
      conflicts: [],
      quarantined: [],
    })}`
    const started = inventory.startInstall({ profile: 'web', packageSpec: 'safe-plugin' })
    await expect.poll(() => inventory.getInstall(started.installId).phase).toBe('repaired')
    expect(inventory.getInstall(started.installId).diagnostic).toContain('profile dependency health')
  })

  it('retries a quarantine through the core doctor command and clears the successful record', async () => {
    const home = temporaryDirectory()
    vi.stubEnv('DSH_HOME', home)
    const quarantineId = '00000000-0000-4000-8000-000000000001'
    const quarantinePath = join(home, 'quarantine', 'profile-plugins.json')
    writeJson(quarantinePath, {
      schema: 1,
      plugins: [{
        quarantineId,
        profile: 'web',
        packageName: 'fixture-plugin',
        packageSpec: 'github:fixture/plugin',
        installedVersion: '1.2.3',
        bundleIndex: 1,
        quarantinedAt: '2026-08-19T01:02:03.000Z',
        reason: 'incompatible-host-dependency',
        conflicts: [],
      }],
    })
    const { inventory, subprocess } = await harness()
    subprocess.stderr = JSON.stringify({
      schema: 'dsh/profile-dependency-repair/v1',
      profile: 'web',
      status: 'healthy',
      conflicts: [],
      quarantined: [],
    })

    const started = inventory.startQuarantineRetry({ quarantineId })
    expect(started).toMatchObject({
      packageSpec: 'github:fixture/plugin',
      command: `dsh plugin --profile web doctor --retry ${quarantineId}`,
      phase: 'running',
    })
    expect(subprocess.spawns[0]?.argv.slice(-6)).toEqual([
      'plugin', '--profile', 'web', 'doctor', '--retry', quarantineId,
    ])
    await expect.poll(() => inventory.getInstall(started.installId).phase).toBe('succeeded')
    expect((JSON.parse(readFileSync(quarantinePath, 'utf8')) as { plugins: unknown[] }).plugins).toEqual([])
  })

  it('uninstalls an inactive quarantined plugin and removes its record', async () => {
    const home = temporaryDirectory()
    vi.stubEnv('DSH_HOME', home)
    const quarantineId = '00000000-0000-4000-8000-000000000001'
    const profileDir = join(home, 'profiles', 'web')
    const pluginDir = join(profileDir, 'node_modules', 'fixture-plugin')
    const quarantinePath = join(home, 'quarantine', 'profile-plugins.json')
    writeJson(join(profileDir, 'package.json'), {
      name: 'dsh-profile-web',
      dependencies: {},
      dsh: { profile: { bundles: [] } },
    })
    writeJson(join(pluginDir, 'package.json'), { name: 'fixture-plugin', version: '1.2.3' })
    writeJson(quarantinePath, {
      schema: 1,
      plugins: [{
        quarantineId,
        profile: 'web',
        packageName: 'fixture-plugin',
        packageSpec: '^1.2.0',
        installedVersion: '1.2.3',
        bundleIndex: 1,
        quarantinedAt: '2026-08-19T01:02:03.000Z',
        reason: 'convergence-failed',
        conflicts: [],
      }],
    })
    const { inventory } = await harness()

    expect(inventory.uninstallQuarantine({ quarantineId })).toBe(true)
    expect(() => readFileSync(join(pluginDir, 'package.json'), 'utf8')).toThrow()
    expect((JSON.parse(readFileSync(quarantinePath, 'utf8')) as { plugins: unknown[] }).plugins).toEqual([])
  })
})

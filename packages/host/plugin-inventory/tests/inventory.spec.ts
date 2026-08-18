import { afterEach, describe, expect, it } from 'vitest'
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

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

const activePlugin: Plugin.Function = () => {}
const pendingPlugin: Plugin.Object = {
  inject: ['neverReady'],
  apply() {},
}

class StubSubprocessRuntime extends SubprocessRuntime {
  readonly spawns: SubprocessSpawnSpec[] = []
  exitCode = 0
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
      collected: { stdout: output(''), stderr: output(this.stderr) },
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
      { method: 'startInstall', invocation: { kind: 'direct' } },
      { method: 'startUninstall', invocation: { kind: 'direct' } },
      { method: 'getInstall', invocation: { kind: 'direct' } },
    ])
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
})

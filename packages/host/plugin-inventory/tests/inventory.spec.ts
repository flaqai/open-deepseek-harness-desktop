import { appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, FiberState, type Plugin } from '@deepseek-ai/cordis'
import { PluginPackages, readPluginMeta, type RuntimeResolution } from '@deepseek-ai/dsh-app-boot'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessHandle,
  SubprocessSpawnSpec,
  SubprocessTerminalEnvironment,
  SubprocessTerminalHandle,
  SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import type { AgentPresetRegistry } from '@deepseek-ai/dsh-agent-preset-registry'
import PluginInventoryGateway, { readPluginInventory } from '../src/index.ts'
import type { PluginDiagnosticExport } from '../src/types.ts'

const contexts: Context[] = []
const temporaryDirectories: string[] = []
const roots: string[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true })
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
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

  async terminalEnvironment(): Promise<SubprocessTerminalEnvironment> {
    return { platform: 'posix', defaultShell: '/bin/sh' }
  }

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.spawns.push(spec)
    const output = (text: string) => ({
      readFrom: () => ({ text, nextOffset: Buffer.byteLength(text), lossy: false }),
    })
    return {
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      control: undefined,
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

async function harness(baseUrl?: string): Promise<{
  ctx: Context
  inventory: PluginInventoryGateway
  subprocess: StubSubprocessRuntime
}> {
  if (process.env.DSH_HOME === undefined) vi.stubEnv('DSH_HOME', temporaryDirectory())
  const ctx = new Context()
  contexts.push(ctx)
  if (baseUrl !== undefined) ctx.baseUrl = baseUrl
  await ctx.plugin(Loader)
  await ctx.plugin(StubSubprocessRuntime)
  ctx.loader.builtins.active = activePlugin
  ctx.loader.builtins.pending = pendingPlugin
  await ctx.plugin(PluginInventoryGateway)
  const inventory = ctx.get('pluginInventory') as PluginInventoryGateway
  return { ctx, inventory, subprocess: ctx.subprocess as StubSubprocessRuntime }
}

function metadataFixture(mode: 'native' | 'runtime') {
  const root = mkdtempSync(join(tmpdir(), 'dsh-inventory-meta-'))
  roots.push(root)
  const profilesDir = join(root, 'profiles')
  const profileDir = join(profilesDir, 'test')
  const baseDir = mode === 'runtime' ? profileDir : root
  mkdirSync(baseDir, { recursive: true })
  const baseUrl = pathToFileURL(join(baseDir, 'entry.mjs')).href
  const dir = mode === 'runtime'
    ? join(root, 'installation', 'node_modules', 'local-plugin')
    : join(root, 'node_modules', 'local-plugin')
  const resolution: RuntimeResolution = {
    profilesDir, profileDir, localPackageNames: [], linkedRoots: [],
    entries: [{ name: 'local-plugin', packageDir: dir, version: undefined,
      declarer: join(dir, 'package.json'), scope: 'installation' }],
  }
  const expectUnlinked = () => {
    expect(lstatSync(dir).isDirectory()).toBe(true)
    for (const path of [
      join(profileDir, 'node_modules'), join(profilesDir, 'node_modules'),
      join(root, 'node_modules'), join(profileDir, '.dsh-module-fallback'),
    ]) expect(lstatSync(path, { throwIfNoEntry: false }), path).toBeUndefined()
  }
  return { dir, baseUrl, resolution, expectUnlinked }
}

describe('PluginInventoryGateway', () => {
  it('reports active bundle Session API risks without starting a mutation process', async () => {
    const home = temporaryDirectory()
    vi.stubEnv('DSH_HOME', home)
    const profile = join(home, 'profiles', 'web')
    const root = join(profile, 'node_modules', 'fixture-plugin')
    writeJson(join(profile, 'package.json'), { name: 'fixture', dependencies: { 'fixture-plugin': '1.0.0' },
      dsh: { profile: { bundles: ['fixture-plugin'] } } })
    writeJson(join(root, 'package.json'), { name: 'fixture-plugin', version: '1.0.0',
      peerDependencies: { '@deepseek-ai/dsh-session': '*' } })
    writeFileSync(join(root, 'index.js'), 'for (const event of session.events) {}')
    const { inventory, subprocess } = await harness()
    expect((await inventory.list()).dependencyHealth.issues).toEqual([
      expect.objectContaining({ code: 'profile.session-api-incompatible', severity: 'warning',
        attribution: { rootPackage: 'fixture-plugin' } }),
    ])
    expect(subprocess.spawns).toEqual([])
  })

  it.each(['native', 'runtime'] as const)('reads local metadata while the package entry remains disabled with %s resolution', async (mode) => {
    const { dir, baseUrl, resolution, expectUnlinked } = metadataFixture(mode)
    mkdirSync(join(dir, 'locale'), { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'local-plugin', exports: { './feature': './index.js', './feature/locale/*.json': './locale/*.json' },
    }))
    writeFileSync(join(dir, 'index.js'), 'throw new Error("metadata must not execute the plugin")\n')
    writeFileSync(join(dir, 'locale', 'en.json'), '{"meta":{"title":"Local plugin","description":"Local description"}}')
    if (mode === 'runtime') {
      expectUnlinked()
      expect(readPluginMeta('local-plugin/feature', baseUrl)).toBeUndefined()
    }
    const { ctx, inventory } = await harness(baseUrl)
    await ctx.plugin(PluginPackages, mode === 'runtime' ? { resolution } : {})
    await ctx.loader.create({ name: 'local-plugin/feature', disabled: true })
    expect((await inventory.list()).entries).toMatchObject([{
      enabled: false, fiberPhase: null, meta: { title: { en: 'Local plugin' }, description: { en: 'Local description' } },
    }])
    if (mode === 'runtime') {
      expectUnlinked()
      await ctx.fiber.dispose()
      expect(readPluginMeta('local-plugin/feature', baseUrl)).toBeUndefined()
      expectUnlinked()
    }
  })

  it.each(['native', 'runtime'] as const)('resolves preset row metadata from the profile base without loading the plugins with %s resolution', async (mode) => {
    const { dir, baseUrl, resolution, expectUnlinked } = metadataFixture(mode)
    mkdirSync(join(dir, 'locale'), { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'local-plugin', exports: { './feature': './index.js', './feature/locale/*.json': './locale/*.json' },
    }))
    writeFileSync(join(dir, 'index.js'), 'throw new Error("metadata must not execute the plugin")\n')
    writeFileSync(join(dir, 'locale', 'en.json'), '{"meta":{"title":"Preset plugin","description":"Preset description"}}')
    writeFileSync(join(dir, 'locale', 'zh.json'), '{"meta":{"title":"预设插件"}}')
    if (mode === 'runtime') {
      expectUnlinked()
      expect(readPluginMeta('local-plugin/feature', baseUrl)).toBeUndefined()
    }
    const { ctx, inventory } = await harness(baseUrl)
    await ctx.plugin(PluginPackages, mode === 'runtime' ? { resolution } : {})
    ctx.provide('agentPresets', {
      compositionInventory: async () => [{
        id: 'local', isDefault: true,
        rows: [
          { entryId: 'feature', moduleName: 'local-plugin/feature', enabled: false },
          { entryId: null, moduleName: 'local-plugin/private', enabled: false },
        ],
      }],
    } as Partial<AgentPresetRegistry> as never)

    expect(await inventory.list()).toMatchObject({
      entries: [],
      agentPresets: [{
        id: 'local', isDefault: true,
        rows: [
          {
            entryId: 'feature', moduleName: 'local-plugin/feature', enabled: false, fiberPhase: null,
            meta: { title: { en: 'Preset plugin', zh: '预设插件' }, description: { en: 'Preset description' } },
          },
          { entryId: null, moduleName: 'local-plugin/private', enabled: false, fiberPhase: null },
        ],
      }],
    })
    if (mode === 'runtime') {
      expectUnlinked()
      await ctx.fiber.dispose()
      expect(readPluginMeta('local-plugin/feature', baseUrl)).toBeUndefined()
      expectUnlinked()
    }
  })

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
      { method: 'recoverClientLoadFailure', invocation: { kind: 'direct' } },
      { method: 'uninstallQuarantine', invocation: { kind: 'direct' } },
      { method: 'startQuarantineRetry', invocation: { kind: 'direct' } },
      { method: 'startHostVersionOverride', invocation: { kind: 'direct' } },
      { method: 'approveQuarantineBuild', invocation: { kind: 'direct' } },
      { method: 'approveDiagnosticBuild', invocation: { kind: 'direct' } },
      { method: 'exportDiagnostics', invocation: { kind: 'direct' } },
      { method: 'startInstall', invocation: { kind: 'direct' } },
      { method: 'startUninstall', invocation: { kind: 'direct' } },
      { method: 'startDependencyDoctor', invocation: { kind: 'direct' } },
      { method: 'getDependencyDoctor', invocation: { kind: 'direct' } },
      { method: 'getInstall', invocation: { kind: 'direct' } },
      { method: 'getInstallOutput', invocation: { kind: 'direct' } },
      { method: 'pauseInstall', invocation: { kind: 'direct' } },
      { method: 'cancelInstall', invocation: { kind: 'direct' } },
    ])
  })

  it('reports profile management when the plugin manager is composed', async () => {
    const { ctx, inventory } = await harness()
    ctx.provide('pluginManager', {} as never)

    await expect(readPluginInventory(ctx)).resolves.toMatchObject({ managementAvailable: true })
    await expect(inventory.list()).resolves.toMatchObject({ managementAvailable: true })
  })

  it('runs the guarded client Loader quarantine and restarts only after durable success', async () => {
    vi.useFakeTimers()
    try {
      const { ctx, inventory, subprocess } = await harness()
      const exit = vi.fn()
      ctx.provide('appExit', exit)
      subprocess.stdout = JSON.stringify({
        schema: 'dsh/profile-dependency-repair/v1',
        diagnosticSchema: 'dsh/profile-diagnostic/v2',
        profile: 'web',
        status: 'quarantined',
        conflicts: [],
        quarantined: [{
          quarantineId: 'fixture-quarantine',
          profile: 'web',
          packageName: 'dsh-font',
          packageSpec: '1.1.0',
          bundleIndex: 0,
          quarantinedAt: '2026-08-28T00:00:00.000Z',
          reason: 'client-module-unavailable',
          conflicts: [],
        }],
      })
      subprocess.exitCode = 11

      await expect(inventory.recoverClientLoadFailure({
        packageName: 'dsh-font',
        entryId: '71626ed6',
        requestedModule: '@deepseek-ai/dsh-client-runtime/client',
        code: 'client-module-unavailable',
      })).resolves.toEqual({
        packageName: 'dsh-font',
        status: 'quarantined',
        restartScheduled: true,
      })
      expect(subprocess.spawns[0]?.argv.slice(-8)).toEqual([
        'plugin', '--profile', 'web', 'doctor', '--quarantine-client-module',
        'dsh-font', '71626ed6', '@deepseek-ai/dsh-client-runtime/client',
      ])
      expect(exit).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(150)
      expect(exit).toHaveBeenCalledWith(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects arbitrary browser requests before spawning the product CLI', async () => {
    const { inventory, subprocess } = await harness()
    await expect(inventory.recoverClientLoadFailure({
      packageName: '../dsh-font',
      entryId: '71626ed6',
      requestedModule: '@deepseek-ai/dsh-client-runtime/client',
      code: 'client-module-unavailable',
    })).rejects.toThrow(/invalid client Loader recovery request/)
    expect(subprocess.spawns).toHaveLength(0)
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

  it('projects declared Host compatibility without exposing package paths', async () => {
    const home = temporaryDirectory()
    vi.stubEnv('DSH_HOME', home)
    writeJson(join(home, 'quarantine', 'profile-plugins.json'), {
      schema: 1,
      plugins: [{
        quarantineId: '00000000-0000-4000-8000-000000000016',
        profile: 'web',
        packageName: '@fixture/compatibility-plugin',
        packageSpec: '1.0.0',
        installedVersion: '1.0.0',
        bundleIndex: 1,
        quarantinedAt: '2026-09-07T12:00:00.000Z',
        reason: 'incompatible-host-version',
        hostCompatibility: {
          profile: 'web',
          packageName: '@fixture/compatibility-plugin',
          installedVersion: '1.0.0',
          hostVersion: '0.1.2-rc.1',
          supportedHostVersions: ['0.1.2-alpha.5'],
          recommendedHostVersion: '0.1.2-alpha.5',
          previewTag: 'next',
        },
        conflicts: [],
      }],
    })
    const { inventory } = await harness()

    await expect(inventory.list()).resolves.toMatchObject({
      dependencyHealth: {
        quarantined: [{
          packageName: '@fixture/compatibility-plugin',
          reason: 'incompatible-host-version',
          hostCompatibility: {
            hostVersion: '0.1.2-rc.1',
            supportedHostVersions: ['0.1.2-alpha.5'],
            recommendedHostVersion: '0.1.2-alpha.5',
            previewTag: 'next',
          },
        }],
      },
    })
  })

  it('does not project obsolete quarantine actions for a restored active plugin', async () => {
    const home = temporaryDirectory()
    vi.stubEnv('DSH_HOME', home)
    const profileDir = join(home, 'profiles', 'web')
    writeJson(join(profileDir, 'package.json'), {
      name: 'dsh-profile-web',
      dependencies: { 'fixture-plugin': '1.2.3' },
      dsh: { profile: { bundles: ['fixture-plugin'] } },
    })
    writeJson(join(profileDir, 'node_modules', 'fixture-plugin', 'package.json'), {
      name: 'fixture-plugin',
      version: '1.2.3',
    })
    const quarantinePath = join(home, 'quarantine', 'profile-plugins.json')
    writeJson(quarantinePath, {
      schema: 1,
      plugins: [{
        quarantineId: '00000000-0000-4000-8000-000000000017',
        profile: 'web',
        packageName: 'fixture-plugin',
        packageSpec: 'fixture-plugin',
        installedVersion: '1.2.3',
        bundleIndex: 0,
        quarantinedAt: '2026-09-08T12:00:00.000Z',
        reason: 'orphaned-bundle',
        conflicts: [],
      }],
    })
    const { ctx, inventory } = await harness()
    ctx.loader.builtins['fixture-plugin'] = activePlugin
    const activeId = await ctx.loader.create({ name: 'cordis:fixture-plugin' })
    const activeEntry = [...ctx.loader.entries()].find(entry => entry.id === activeId)
    if (activeEntry === undefined) throw new Error('fixture Loader entry was not created')
    Object.defineProperty(activeEntry.options, 'name', { value: 'fixture-plugin' })

    await expect(inventory.list()).resolves.toMatchObject({
      dependencyHealth: { quarantined: [] },
    })
    expect((JSON.parse(readFileSync(quarantinePath, 'utf8')) as { plugins: unknown[] }).plugins).toEqual([])
    expect(readFileSync(join(profileDir, 'node_modules', 'fixture-plugin', 'package.json'), 'utf8'))
      .toContain('fixture-plugin')
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

    const snapshot = await inventory.list()
    // No agent-preset roster is composed, so the snapshot carries no presets.
    expect(snapshot.agentPresets).toBeUndefined()
    expect(snapshot.entries).toHaveLength(3)
    expect(snapshot.dependencyHealth.issues).toEqual([
      expect.objectContaining({
        code: 'loader.unresolved-injection',
        attribution: { entryId: pendingId, moduleName: 'cordis:pending' },
      }),
    ])
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
    expect((await inventory.list()).entries.find(entry => entry.entryId === activeId)).toEqual({
      entryId: activeId,
      moduleName: 'cordis:active',
      enabled: false,
      fiberPhase: null,
    })

    ctx.loader.remove(pendingId)
    expect((await inventory.list()).entries.some(entry => entry.entryId === pendingId)).toBe(false)
  })

  it('carries each composed preset with root-fiber states mapped to phases', async () => {
    const { ctx, inventory } = await harness()
    ctx.provide('agentPresets', {
      compositionInventory: async () => [
        {
          id: 'standard',
          name: '标准模式',
          isDefault: true,
          rows: [
            { entryId: 'alpha', moduleName: 'pkg-alpha', enabled: true, fiberState: FiberState.ACTIVE },
            { entryId: null, moduleName: 'pkg-file', enabled: 'conditional', condition: 'x' },
          ],
        },
        { id: 'damaged', isDefault: false, broken: 'the composition file is missing', rows: [] },
      ],
    } as Partial<AgentPresetRegistry> as never)

    const snapshot = await inventory.list()
    expect(snapshot.agentPresets).toEqual([
      {
        id: 'standard',
        name: '标准模式',
        isDefault: true,
        rows: [
          { entryId: 'alpha', moduleName: 'pkg-alpha', enabled: true, fiberPhase: 'active' },
          { entryId: null, moduleName: 'pkg-file', enabled: 'conditional', condition: 'x', fiberPhase: null },
        ],
      },
      { id: 'damaged', isDefault: false, broken: 'the composition file is missing', rows: [] },
    ])
  })

  it('exports a redacted current diagnostic bundle with runtime and Loader facts', async () => {
    const { ctx, inventory } = await harness()
    await ctx.loader.create({ name: 'cordis:pending' })
    const exported = JSON.parse(await inventory.exportDiagnostics()) as PluginDiagnosticExport
    expect(exported).toMatchObject({
      schema: 'dsh/profile-diagnostic-export/v1',
      diagnosticSchema: 'dsh/profile-diagnostic/v2',
      rulesVersion: 2,
      profile: 'web',
      runtime: {
        platform: process.platform,
        architecture: process.arch,
        node: process.version,
      },
    })
    expect(exported).not.toHaveProperty('home')
    expect(exported.rules.some(rule => (
      rule.code === 'pnpm.build-script-blocked' && rule.actions.includes('approve-build')
    ))).toBe(true)
    expect(exported.rules.some(rule => (
      rule.code === 'profile.unknown' && rule.actions.length === 1 && rule.actions[0] === 'export'
    ))).toBe(true)
    expect(JSON.stringify(exported)).not.toContain(process.env.HOME ?? '/Users')
  })

  it('approves only the exact retained build key and retries the retained package once', async () => {
    const home = temporaryDirectory()
    vi.stubEnv('DSH_HOME', home)
    const diagnosticId = '00000000-0000-4000-8000-000000000002'
    writeJson(join(home, 'profile-health', 'web.diagnostics.json'), {
      schema: 'dsh/profile-diagnostic/v2',
      profile: 'web',
      generatedAt: '2026-08-25T00:00:00.000Z',
      issues: [{
        diagnosticId,
        code: 'pnpm.build-script-blocked',
        nativeCode: 'ERR_PNPM_IGNORED_BUILDS',
        source: 'pnpm',
        phase: 'install',
        severity: 'security',
        attribution: { rootPackage: 'fixture-plugin@1.2.3' },
        buildApprovalKey: 'node-pty',
        actions: ['approve-build', 'isolate', 'export'],
        evidence: ['ERR_PNPM_IGNORED_BUILDS: Ignored build scripts: node-pty'],
      }],
    })
    const { inventory, subprocess } = await harness()

    const started = inventory.approveDiagnosticBuild({ diagnosticId })
    await expect.poll(() => inventory.getInstall(started.installId).phase).toBe('succeeded')
    expect(subprocess.spawns.map(spawn => spawn.argv.slice(-5))).toEqual([
      ['plugin', '--profile', 'web', 'approve-build-key', 'node-pty'],
      ['plugin', '--profile', 'web', 'add', 'fixture-plugin@1.2.3'],
    ])
    expect(() => inventory.approveDiagnosticBuild({
      diagnosticId: '00000000-0000-4000-8000-000000000003',
    })).toThrow(/no approvable build operation/)
  })

  it('starts a structured CLI install, deduplicates it while running, and publishes completion', async () => {
    vi.stubEnv('DSH_HOME', '/desktop data/development/dsh-home')
    vi.stubEnv('DSH_PNPM_BIN', '/desktop runtime/pnpm.mjs')
    vi.stubEnv('DSH_DESKTOP_BUNDLED_PLUGINS_DIR', '/desktop resources/bundled-plugins')
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
    expect(subprocess.spawns[0]?.env).toEqual({
      DSH_HOME: '/desktop data/development/dsh-home',
      DSH_PNPM_BIN: '/desktop runtime/pnpm.mjs',
      DSH_DESKTOP_BUNDLED_PLUGINS_DIR: '/desktop resources/bundled-plugins',
    })

    deferred.resolve({ exitCode: 0, signal: null })
    await expect.poll(() => inventory.getInstall(started.installId).phase).toBe('succeeded')
    expect(inventory.getInstall(started.installId).exitCode).toBe(0)
  })

  it('installs and composes a reviewed Browser Use provider as one guarded recipe', async () => {
    const { inventory, subprocess } = await harness()
    const packageSpec = '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp@0.2.0-rc.2'
    const started = inventory.startInstall({
      profile: 'web',
      packageSpec,
      experimentalCapability: 'browser-use-playwright-visible',
    })
    await expect.poll(() => inventory.getInstall(started.installId).phase).toBe('succeeded')
    expect(subprocess.spawns.map(spawn => spawn.argv.slice(-2))).toEqual([
      ['add', '@deepseek-ai/dsh-browser-use@0.2.0-rc.2'],
      ['add', packageSpec],
      ['configure-experimental-capability', 'browser-use-playwright-visible'],
    ])
    expect(() => inventory.startInstall({
      profile: 'web',
      packageSpec,
      experimentalCapability: 'computer-use-native',
    })).toThrow(/invalid experimental capability/)
  })

  it('publishes sanitized incremental pnpm progress and removes its private sidecar', async () => {
    const home = temporaryDirectory()
    vi.stubEnv('DSH_HOME', home)
    const { inventory, subprocess } = await harness()
    const deferred = Promise.withResolvers<{ exitCode: number | null; signal: null }>()
    const baseSpawn = subprocess.spawn.bind(subprocess)
    let progressFile: string | undefined
    subprocess.spawn = (spec) => {
      progressFile = spec.env?.DSH_DESKTOP_INSTALL_PROGRESS_FILE
      if (progressFile !== undefined) {
        appendFileSync(progressFile, [
          JSON.stringify({ name: 'pnpm:progress', status: 'resolved' }),
          JSON.stringify({ name: 'pnpm:progress', status: 'resolved' }),
          JSON.stringify({ name: 'pnpm:stage', stage: 'resolution_done' }),
          JSON.stringify({ name: 'pnpm:progress', status: 'found_in_store' }),
          JSON.stringify({ name: 'pnpm:request-retry', message: 'Authorization: Bearer private-token' }),
        ].join('\n') + '\n')
      }
      return { ...baseSpawn(spec), done: deferred.promise }
    }

    const started = inventory.startInstall({ profile: 'web', packageSpec: 'safe-plugin' })
    expect(progressFile).toMatch(/\.desktop-install-progress[/\\][0-9a-f-]{36}\.ndjson$/u)
    expect(inventory.getInstall(started.installId).installProgress).toEqual({
      stage: 'downloading', percent: 50, completed: 1, total: 2,
    })
    const first = inventory.getInstallOutput({ installId: started.installId, offset: 0 })
    expect(first.text).toContain('Downloading dependencies')
    expect(first.text).not.toContain('private-token')
    expect(first.settled).toBe(false)
    expect(inventory.getInstallOutput({ installId: started.installId, offset: first.nextOffset }).text).toBe('')
    expect(() => inventory.getInstallOutput({
      installId: 'not-real' as typeof started.installId,
      offset: 0,
    })).toThrow(/unknown install/u)

    deferred.resolve({ exitCode: 0, signal: null })
    await expect.poll(() => inventory.getInstall(started.installId).phase).toBe('succeeded')
    expect(inventory.getInstall(started.installId).installProgress).toEqual({ stage: 'verifying', percent: 100 })
    expect(inventory.getInstallOutput({ installId: started.installId, offset: first.nextOffset }).settled).toBe(true)
    expect(progressFile).toBeDefined()
    expect(existsSync(progressFile!)).toBe(false)
  })

  it('pauses and stops installs only after their managed process ranges exit', async () => {
    const { inventory, subprocess } = await harness()
    const outcomes: Array<ReturnType<typeof Promise.withResolvers<{ exitCode: number | null; signal: 'SIGTERM' }>>> = []
    const terminated: boolean[] = []
    const rangeExited: boolean[] = []
    const baseSpawn = subprocess.spawn.bind(subprocess)
    subprocess.spawn = (spec) => {
      const base = baseSpawn(spec)
      const outcome = Promise.withResolvers<{ exitCode: number | null; signal: 'SIGTERM' }>()
      const index = outcomes.push(outcome) - 1
      terminated[index] = false
      rangeExited[index] = false
      return {
        ...base,
        done: outcome.promise,
        terminate: () => {
          terminated[index] = true
          outcome.resolve({ exitCode: null, signal: 'SIGTERM' })
        },
        waitForExit: async () => {
          expect(terminated[index]).toBe(true)
          rangeExited[index] = true
          return true
        },
      }
    }

    const paused = inventory.startInstall({ profile: 'web', packageSpec: 'pause-plugin' })
    await expect(inventory.pauseInstall(paused.installId)).resolves.toMatchObject({ phase: 'paused' })
    expect(rangeExited[0]).toBe(true)
    const resumed = inventory.startInstall({ profile: 'web', packageSpec: 'pause-plugin' })
    expect(resumed.installId).not.toBe(paused.installId)
    await inventory.cancelInstall(resumed.installId)

    const stopped = inventory.startInstall({ profile: 'web', packageSpec: 'stop-plugin' })
    await expect(inventory.cancelInstall(stopped.installId)).resolves.toMatchObject({ phase: 'cancelled' })
    expect(rangeExited.at(-1)).toBe(true)
    expect(inventory.getInstallOutput({ installId: stopped.installId, offset: 0 }).text).toContain('stopped by user')
  })

  it('removes an active install sidecar when the Host service is disposed', async () => {
    const home = temporaryDirectory()
    vi.stubEnv('DSH_HOME', home)
    const { ctx, inventory, subprocess } = await harness()
    const deferred = Promise.withResolvers<{ exitCode: number | null; signal: null }>()
    const baseSpawn = subprocess.spawn.bind(subprocess)
    let progressFile: string | undefined
    subprocess.spawn = (spec) => {
      progressFile = spec.env?.DSH_DESKTOP_INSTALL_PROGRESS_FILE
      return { ...baseSpawn(spec), done: deferred.promise }
    }

    inventory.startInstall({ profile: 'web', packageSpec: 'safe-plugin' })
    expect(progressFile).toBeDefined()
    expect(existsSync(progressFile!)).toBe(true)
    await ctx.fiber.dispose()
    expect(existsSync(progressFile!)).toBe(false)
    deferred.resolve({ exitCode: 1, signal: null })
  })

  it('forwards the selected Profile home to doctor subprocesses after DSH environment scrubbing', async () => {
    vi.stubEnv('DSH_HOME', String.raw`C:\Users\测试 用户\AppData\Roaming\open-deepseek-harness-desktop\dsh-home`)
    vi.stubEnv('DSH_PNPM_BIN', String.raw`D:\DeepSeek Harness\resources\runtime\pnpm.mjs`)
    const { inventory, subprocess } = await harness()
    subprocess.stdout = JSON.stringify({
      schema: 'dsh/profile-dependency-repair/v1',
      profile: 'web',
      status: 'healthy',
      conflicts: [],
      quarantined: [],
    })

    const started = inventory.startDependencyDoctor({ profile: 'web', repair: false })
    await expect.poll(() => inventory.getDependencyDoctor(started.doctorId).phase).toBe('healthy')
    expect(subprocess.spawns[0]?.env).toEqual({
      DSH_HOME: String.raw`C:\Users\测试 用户\AppData\Roaming\open-deepseek-harness-desktop\dsh-home`,
      DSH_PNPM_BIN: String.raw`D:\DeepSeek Harness\resources\runtime\pnpm.mjs`,
    })
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

  it('records an exact Host-version override before retrying only that quarantine reason', async () => {
    const home = temporaryDirectory()
    vi.stubEnv('DSH_HOME', home)
    const quarantineId = '00000000-0000-4000-8000-000000000021'
    const quarantinePath = join(home, 'quarantine', 'profile-plugins.json')
    writeJson(quarantinePath, {
      schema: 1,
      plugins: [{
        quarantineId,
        profile: 'web',
        packageName: 'fixture-plugin',
        packageSpec: '^1.2.0',
        installedVersion: '1.2.3',
        bundleIndex: 1,
        quarantinedAt: '2026-09-17T01:02:03.000Z',
        reason: 'incompatible-host-version',
        hostCompatibility: {
          profile: 'web',
          packageName: 'fixture-plugin',
          installedVersion: '1.2.3',
          hostVersion: '0.1.6-rc.1',
          supportedHostVersions: ['0.1.5-rc.2'],
          recommendedHostVersion: '0.1.5-rc.2',
        },
        conflicts: [],
      }],
    })
    const { inventory, subprocess } = await harness()

    const started = inventory.startHostVersionOverride({ quarantineId })

    expect(started.phase).toBe('running')
    expect(subprocess.spawns[0]?.argv.slice(-6)).toEqual([
      'plugin', '--profile', 'web', 'doctor', '--retry', quarantineId,
    ])
    const approvalFile = JSON.parse(
      readFileSync(join(home, 'quarantine', 'host-version-overrides.json'), 'utf8'),
    ) as { schema: unknown; approvals: Array<{ acknowledgedAt?: unknown }> }
    const acknowledgedAt = approvalFile.approvals[0]?.acknowledgedAt
    expect(typeof acknowledgedAt).toBe('string')
    expect(approvalFile).toEqual({
      schema: 1,
      approvals: [{
        profile: 'web',
        packageName: 'fixture-plugin',
        pluginVersion: '1.2.3',
        hostVersion: '0.1.6-rc.1',
        supportedHostVersions: ['0.1.5-rc.2'],
        recommendedHostVersion: '0.1.5-rc.2',
        acknowledgedAt,
      }],
    })

    writeJson(quarantinePath, {
      schema: 1,
      plugins: [{
        quarantineId: '00000000-0000-4000-8000-000000000022',
        profile: 'web',
        packageName: 'broken-plugin',
        packageSpec: '1.0.0',
        bundleIndex: 0,
        quarantinedAt: '2026-09-17T01:02:03.000Z',
        reason: 'loader-lifecycle-failed',
        conflicts: [],
      }],
    })
    expect(() => inventory.startHostVersionOverride({
      quarantineId: '00000000-0000-4000-8000-000000000022',
    })).toThrow(/only a Host version declaration can be overridden/)
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

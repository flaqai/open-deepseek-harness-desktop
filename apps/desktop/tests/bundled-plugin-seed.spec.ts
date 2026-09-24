import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  appendBundledPluginFailure,
  assertBundledPluginManifestEntry,
  bundledPluginFailureDiagnostic,
  bundledPluginSeedIsSettled,
  seedBundledPlugin,
  seedBundledPluginsBatch,
  type BundledPluginManifestEntry,
} from '../src/bundled-plugin-seed.ts'

const roots: string[] = []

function profileManifest(
  dependencies: Record<string, string>,
  bundles: string[] = Object.keys(dependencies),
) {
  return { dependencies, dsh: { profile: { bundles } } }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(): Promise<{
  root: string
  dshHome: string
  resourcesDirectory: string
  entry: BundledPluginManifestEntry
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bundled-plugin-'))
  roots.push(root)
  const dshHome = join(root, 'home')
  const resourcesDirectory = join(root, 'resources')
  await mkdir(resourcesDirectory, { recursive: true })
  const bytes = Buffer.from('fixture plugin archive')
  await writeFile(join(resourcesDirectory, 'dshmarket.tgz'), bytes)
  return {
    root,
    dshHome,
    resourcesDirectory,
    entry: {
      seedId: 'dshmarket',
      packageName: 'dshmarket',
      version: '1.12.1',
      profile: 'web',
      installPolicy: 'startup',
      registrySpec: 'dshmarket@1.19.0',
      archive: 'dshmarket.tgz',
      integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    },
  }
}

async function materializeBundledPlugin(
  dshHome: string,
  entry: BundledPluginManifestEntry,
): Promise<void> {
  const profile = join(dshHome, 'profiles', entry.profile)
  const installed = join(profile, 'node_modules', ...entry.packageName.split('/'))
  await mkdir(installed, { recursive: true })
  await writeFile(join(installed, 'package.json'), JSON.stringify({
    name: entry.packageName,
    version: entry.version,
  }))
  let dependencies: Record<string, string> = {}
  let bundles: string[] = []
  try {
    const current = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { profile?: { bundles?: string[] } }
    }
    dependencies = current.dependencies ?? {}
    bundles = current.dsh?.profile?.bundles ?? []
  } catch {
    // The install fixture creates a new Profile manifest when none exists.
  }
  await writeFile(join(profile, 'package.json'), JSON.stringify({
    dependencies: {
      ...dependencies,
      [entry.packageName]: `file:${join(dshHome, 'bundled-plugins', entry.archive)}`,
    },
    dsh: { profile: { bundles: [...new Set([...bundles, entry.packageName])] } },
  }))
}

function successfulInstall(options: Awaited<ReturnType<typeof fixture>>) {
  return vi.fn(async (_archivePath: string, entry: BundledPluginManifestEntry) => {
    await materializeBundledPlugin(options.dshHome, entry)
  })
}

describe('bundled plugin seed', () => {
  it('installs all local archives in one call and marks the complete batch only afterward', async () => {
    const f = await fixture()
    const second = { ...f.entry, seedId: 'second', packageName: 'second' }
    const entries = [f.entry, second]
    const install = vi.fn(async (archives: readonly string[]) => {
      expect(archives).toHaveLength(2)
      const profile = join(f.dshHome, 'profiles/web')
      for (const entry of entries) {
        await mkdir(join(profile, 'node_modules', entry.packageName), { recursive: true })
        await writeFile(join(profile, 'node_modules', entry.packageName, 'package.json'),
          JSON.stringify({ name: entry.packageName, version: entry.version }))
      }
      await writeFile(join(profile, 'package.json'), JSON.stringify({
        dependencies: { dshmarket: f.entry.version, second: second.version },
        dsh: { profile: { bundles: ['dshmarket', 'second'] } },
      }))
    })
    await seedBundledPluginsBatch(entries, f.resourcesDirectory, f.dshHome, async () => {}, install)
    expect(install).toHaveBeenCalledTimes(1)
    for (const entry of entries) {
      expect(JSON.parse(await readFile(join(f.dshHome, 'bundled-plugins', `${entry.seedId}.seeded.json`), 'utf8')))
        .toMatchObject({ schema: 4, installedVersion: entry.version, ownership: 'desktop-archive' })
    }
  })
  it('uses one batch installation and writes no success marker for an incomplete graph', async () => {
    const f = await fixture()
    const install = vi.fn(async () => {})
    await expect(seedBundledPluginsBatch([f.entry], f.resourcesDirectory, f.dshHome, async () => {}, install))
      .rejects.toThrow('did not materialize')
    expect(install).toHaveBeenCalledTimes(1)
    await expect(readFile(join(f.dshHome, 'bundled-plugins/dshmarket.seeded.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('creates the log directory before persisting an early install failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-bundled-plugin-log-'))
    roots.push(root)
    const logPath = join(root, 'missing', 'logs', 'harness.log')
    await appendBundledPluginFailure(logPath, new Error('pnpm failed'))
    await expect(readFile(logPath, 'utf8')).resolves.toMatch(
      /^\[[^\]]+\] \[bundled-plugin\] \[error\] Error: pnpm failed/mu,
    )
  })

  it('retains the actionable cause chain behind startup wrappers', () => {
    const command = new Error('runner could not start target')
    const preparation = new Error('candidate preparation failed', { cause: command })
    expect(bundledPluginFailureDiagnostic(preparation)).toContain('candidate preparation failed')
    expect(bundledPluginFailureDiagnostic(preparation)).toContain('Caused by: Error: runner could not start target')
  })

  it('renders non-Error rejection details without default object coercion', () => {
    expect(bundledPluginFailureDiagnostic({ code: 'EPLUGIN', plugin: 'fixture' }))
      .toBe('{"code":"EPLUGIN","plugin":"fixture"}')
    const circular: { self?: unknown } = {}
    circular.self = circular
    expect(bundledPluginFailureDiagnostic(circular)).toBe('unserializable failure object')
  })

  it('ships the pinned preset archives with matching integrity', async () => {
    const manifest = JSON.parse(await readFile(new URL('../bundled-plugins/manifest.json', import.meta.url), 'utf8')) as {
      schema: number
      plugins: BundledPluginManifestEntry[]
    }
    expect(manifest.schema).toBe(2)
    expect(manifest.plugins.map(entry => entry.packageName)).not.toContain('dsh-skill-picker')
    expect(manifest.plugins.map(entry => [entry.packageName, entry.installPolicy])).toEqual([
      ['dshmarket', 'startup'],
      ['@xmanrui/dsh-im', 'startup'],
      ['dsh-better-sidebar', 'startup'],
      ['dsh-pocket', 'startup'],
      ['@ychris12138/dsh-usage-stats', 'startup'],
      ['dsh-smooth-stream', 'startup'],
      ['dsh-mermaid', 'startup'],
      ['dsh-whale-widget', 'startup'],
      ['dsh-font', 'diagnostic'],
      ['@dsh-diagnostic-lab/scoped-loader-mismatch', 'diagnostic'],
      ['@dsh-diagnostic-lab/loader-dependency-unavailable', 'diagnostic'],
      ['@dsh-diagnostic-lab/loader-export-unavailable', 'diagnostic'],
      ['@dsh-diagnostic-lab/legacy-session-api', 'diagnostic'],
      ['@dsh-diagnostic-lab/immutable-agent-input-mutation', 'diagnostic'],
    ])
    for (const entry of manifest.plugins.filter(candidate => (
      candidate.installPolicy !== 'diagnostic' && !candidate.registrySpec?.startsWith('github:')
    ))) {
      expect(entry.registrySpec).toBe(`${entry.packageName}@${entry.version}`)
    }
    const diagnosticEntry = manifest.plugins.find(entry => entry.packageName === 'dsh-font')
    expect(diagnosticEntry).toMatchObject({ version: '1.1.0', installPolicy: 'diagnostic' })
    expect(diagnosticEntry?.registrySpec).toBeUndefined()
    expect(manifest.plugins.find(entry => entry.packageName === '@dsh-diagnostic-lab/scoped-loader-mismatch'))
      .toMatchObject({ version: '1.0.0', installPolicy: 'diagnostic' })
    expect(manifest.plugins.find(entry => entry.packageName === '@dsh-diagnostic-lab/loader-dependency-unavailable'))
      .toMatchObject({ version: '1.0.0', installPolicy: 'diagnostic' })
    expect(manifest.plugins.find(entry => entry.packageName === '@dsh-diagnostic-lab/loader-export-unavailable'))
      .toMatchObject({ version: '1.0.0', installPolicy: 'diagnostic' })
    expect(manifest.plugins.find(entry => entry.packageName === '@dsh-diagnostic-lab/legacy-session-api'))
      .toMatchObject({ version: '1.0.0', installPolicy: 'diagnostic' })
    expect(manifest.plugins.find(entry => entry.packageName === '@dsh-diagnostic-lab/immutable-agent-input-mutation'))
      .toMatchObject({ version: '1.0.0', installPolicy: 'diagnostic' })
    expect(manifest.plugins.find(entry => entry.packageName === '@ychris12138/dsh-usage-stats'))
      .toMatchObject({ version: '0.3.3', installPolicy: 'startup' })
    expect(manifest.plugins.find(entry => entry.packageName === 'dsh-smooth-stream'))
      .toMatchObject({ version: '0.6.1', installPolicy: 'startup' })
    expect(manifest.plugins.find(entry => entry.packageName === 'dsh-mermaid'))
      .toMatchObject({ version: '0.4.1', installPolicy: 'startup' })
    expect(manifest.plugins.find(entry => entry.packageName === 'dsh-whale-widget'))
      .toMatchObject({ version: '0.3.11', installPolicy: 'startup' })
    expect(new Set(manifest.plugins.map(entry => entry.seedId)).size).toBe(manifest.plugins.length)
    expect(manifest.plugins.find(entry => entry.packageName === 'dsh-better-sidebar')?.approvedBuilds)
      .toEqual(['node-pty'])
    expect(Object.fromEntries(manifest.plugins.flatMap(entry => (
      entry.managedUpgradeFrom === undefined ? [] : [[entry.packageName, entry.managedUpgradeFrom]]
    )))).toEqual({
      '@xmanrui/dsh-im': ['3.0.6'],
      'dsh-better-sidebar': ['0.16.1'],
      'dsh-pocket': ['1.14.5'],
    })
    expect(manifest.plugins.map(entry => entry.packageName)).not.toContain('@deepseek-ai/dsh-subagent-codex')
    expect(manifest.plugins.map(entry => entry.packageName)).not.toContain('@deepseek-ai/dsh-subagent-claude-code')
    for (const entry of manifest.plugins) {
      const bytes = await readFile(new URL(`../bundled-plugins/${entry.archive}`, import.meta.url))
      expect(`sha512-${createHash('sha512').update(bytes).digest('base64')}`).toBe(entry.integrity)
    }
  })

  it('upgrades every verified historical preset and settles on the second startup', async () => {
    const manifest = JSON.parse(await readFile(new URL('../bundled-plugins/manifest.json', import.meta.url), 'utf8')) as {
      plugins: BundledPluginManifestEntry[]
    }
    const resourcesDirectory = fileURLToPath(new URL('../bundled-plugins/', import.meta.url))
    const historical = manifest.plugins.filter(entry => entry.managedUpgradeFrom !== undefined)
    expect(historical).toHaveLength(3)

    for (const entry of historical) {
      const root = await mkdtemp(join(tmpdir(), 'dsh-historical-preset-'))
      roots.push(root)
      const dshHome = join(root, '配置 with spaces')
      const profile = join(dshHome, 'profiles', entry.profile)
      const state = join(dshHome, 'bundled-plugins')
      const previousVersion = entry.managedUpgradeFrom?.[0]
      if (previousVersion === undefined) throw new Error(`missing historical version for ${entry.packageName}`)
      await mkdir(join(profile, 'node_modules', ...entry.packageName.split('/')), { recursive: true })
      await mkdir(state, { recursive: true })
      await writeFile(join(profile, 'package.json'), JSON.stringify({
        ...profileManifest({ [entry.packageName]: previousVersion }),
      }))
      await writeFile(
        join(profile, 'node_modules', ...entry.packageName.split('/'), 'package.json'),
        JSON.stringify({ name: entry.packageName, version: previousVersion }),
      )
      await writeFile(join(state, `${entry.seedId}.seeded.json`), JSON.stringify({
        schema: 3,
        packageName: entry.packageName,
        version: entry.version,
        ownership: 'external',
      }))
      const install = vi.fn(async () => materializeBundledPlugin(dshHome, entry))
      const prepare = vi.fn(async (candidate: BundledPluginManifestEntry) => {
        if ((candidate.approvedBuilds ?? []).length === 0) return
        await writeFile(
          join(profile, 'pnpm-workspace.yaml'),
          `allowBuilds:\n${candidate.approvedBuilds?.map(name => `  ${name}: true`).join('\n')}\n`,
        )
      })

      await expect(seedBundledPlugin({
        entry,
        resourcesDirectory,
        dshHome,
        install,
        prepare,
      })).resolves.toBe('upgraded')
      expect(install).toHaveBeenCalledOnce()
      expect(JSON.parse(await readFile(join(state, `${entry.seedId}.seeded.json`), 'utf8')))
        .toMatchObject({
          schema: 4,
          handledBundledVersion: entry.version,
          installedVersion: entry.version,
          state: 'installed',
          ownership: 'desktop-archive',
        })
      await expect(bundledPluginSeedIsSettled(dshHome, entry)).resolves.toBe(true)
    }
  })

  it('rejects malformed or duplicate lifecycle build approvals', async () => {
    const options = await fixture()
    expect(() => {
      assertBundledPluginManifestEntry({
        ...options.entry,
        approvedBuilds: ['node-pty', 'node-pty'],
      })
    }).toThrow('invalid bundled plugin manifest entry')
    expect(() => {
      assertBundledPluginManifestEntry({
        ...options.entry,
        approvedBuilds: ['node-pty@1.1.0'],
      })
    }).toThrow('invalid bundled plugin manifest entry')
  })

  it('installs once and preserves the marker as an uninstall tombstone', async () => {
    const options = await fixture()
    const install = successfulInstall(options)
    await expect(seedBundledPlugin({ ...options, install })).resolves.toBe('installed')
    expect(install).toHaveBeenCalledOnce()
    await expect(seedBundledPlugin({ ...options, install })).resolves.toBe('verified')
    expect(install).toHaveBeenCalledOnce()
    expect(JSON.parse(await readFile(join(options.dshHome, 'bundled-plugins', 'dshmarket.seeded.json'), 'utf8')))
      .toMatchObject({
        schema: 4,
        packageName: 'dshmarket',
        handledBundledVersion: '1.12.1',
        installedVersion: '1.12.1',
        state: 'installed',
        ownership: 'desktop-archive',
      })
  })

  it('adopts an existing dependency without replacing its version', async () => {
    const options = await fixture()
    const profile = join(options.dshHome, 'profiles', 'web')
    await mkdir(profile, { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify(profileManifest({ dshmarket: '9.9.9' })))
    await mkdir(join(profile, 'node_modules/dshmarket'), { recursive: true })
    await writeFile(join(profile, 'node_modules/dshmarket/package.json'), JSON.stringify({ name: 'dshmarket', version: '9.9.9' }))
    const install = vi.fn(async () => {})
    const prepare = vi.fn(async () => {})
    await expect(seedBundledPlugin({ ...options, install, prepare })).resolves.toBe('preserved-user-version')
    expect(install).not.toHaveBeenCalled()
    expect(prepare).toHaveBeenCalledOnce()
    expect(JSON.parse(await readFile(join(options.dshHome, 'bundled-plugins', 'dshmarket.seeded.json'), 'utf8')))
      .toMatchObject({ schema: 4, installedVersion: '9.9.9', ownership: 'user' })
  })

  it('adopts an aliased dependency from the same GitHub repository without duplicating it', async () => {
    const options = await fixture()
    const profile = join(options.dshHome, 'profiles', 'web')
    await mkdir(profile, { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify({
      dependencies: {
        'custom-market-name': 'git+https://github.com/example/dshmarket.git#older-commit',
      },
      dsh: { profile: { bundles: ['custom-market-name'] } },
    }))
    await mkdir(join(profile, 'node_modules/custom-market-name'), { recursive: true })
    await writeFile(join(profile, 'node_modules/custom-market-name/package.json'), JSON.stringify({
      name: 'dshmarket', version: '1.0.0',
    }))
    const entry = {
      ...options.entry,
      registrySpec: 'github:example/dshmarket#newer-commit',
    }
    const install = vi.fn(async () => {})
    const prepare = vi.fn(async () => {})
    await expect(seedBundledPlugin({ ...options, entry, install, prepare })).resolves.toBe('preserved-user-version')
    expect(install).not.toHaveBeenCalled()
    expect(prepare).toHaveBeenCalledWith(entry)
  })

  it('merges reviewed build approvals when an existing marker still has its dependency', async () => {
    const options = await fixture()
    const profile = join(options.dshHome, 'profiles', 'web')
    const state = join(options.dshHome, 'bundled-plugins')
    await mkdir(profile, { recursive: true })
    await mkdir(state, { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify(profileManifest({ dshmarket: '1.0.0' })))
    await mkdir(join(profile, 'node_modules/dshmarket'), { recursive: true })
    await writeFile(join(profile, 'node_modules/dshmarket/package.json'), JSON.stringify({ name: 'dshmarket', version: '1.0.0' }))
    await writeFile(join(state, 'dshmarket.seeded.json'), JSON.stringify({ schema: 2 }))
    const prepare = vi.fn(async () => {})
    await expect(seedBundledPlugin({ ...options, install: vi.fn(), prepare })).resolves.toBe('preserved-user-version')
    expect(prepare).toHaveBeenCalledWith(options.entry)
  })

  it('uses the settled fast path only after reviewed build approvals have durable policy entries', async () => {
    const options = await fixture()
    const entry = { ...options.entry, approvedBuilds: ['node-pty'] }
    const profile = join(options.dshHome, 'profiles', 'web')
    const state = join(options.dshHome, 'bundled-plugins')
    await mkdir(profile, { recursive: true })
    await mkdir(state, { recursive: true })
    await mkdir(join(profile, 'node_modules/dshmarket'), { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify(profileManifest({ dshmarket: entry.version })))
    await writeFile(join(profile, 'node_modules/dshmarket/package.json'), JSON.stringify({ name: 'dshmarket', version: entry.version }))
    await writeFile(join(state, 'dshmarket.seeded.json'), JSON.stringify({
      schema: 4,
      handledBundledVersion: entry.version,
      installedVersion: entry.version,
      state: 'installed',
      ownership: 'desktop-registry',
    }))

    await expect(bundledPluginSeedIsSettled(options.dshHome, entry)).resolves.toBe(false)
    await writeFile(join(profile, 'pnpm-workspace.yaml'), 'allowBuilds:\n  node-pty: true\n')
    await expect(bundledPluginSeedIsSettled(options.dshHome, options.entry)).resolves.toBe(true)
  })

  it('upgrades a stale desktop-owned archive when the bundled version changes', async () => {
    const options = await fixture()
    const profile = join(options.dshHome, 'profiles', 'web')
    const state = join(options.dshHome, 'bundled-plugins')
    await mkdir(profile, { recursive: true })
    await mkdir(state, { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify(profileManifest({
      dshmarket: `file:${join(state, 'dshmarket-1.0.0.tgz')}`,
    })))
    await writeFile(join(state, 'dshmarket.seeded.json'), JSON.stringify({
      schema: 2, packageName: 'dshmarket', version: '1.0.0',
    }))
    const installed = join(profile, 'node_modules', 'dshmarket')
    await mkdir(installed, { recursive: true })
    await writeFile(join(installed, 'package.json'), JSON.stringify({ name: 'dshmarket', version: '1.0.0' }))
    const install = successfulInstall(options)

    await expect(seedBundledPlugin({ ...options, install })).resolves.toBe('upgraded')
    expect(install).toHaveBeenCalledWith(join(state, options.entry.archive), options.entry)
    expect(JSON.parse(await readFile(join(state, 'dshmarket.seeded.json'), 'utf8')))
      .toMatchObject({ schema: 4, installedVersion: '1.12.1', ownership: 'desktop-archive' })
    await expect(bundledPluginSeedIsSettled(options.dshHome, options.entry)).resolves.toBe(true)
  })

  it('upgrades an older registry-resolved preset left by an earlier desktop release', async () => {
    const options = await fixture()
    const profile = join(options.dshHome, 'profiles', 'web')
    const state = join(options.dshHome, 'bundled-plugins')
    const installed = join(profile, 'node_modules', 'dshmarket')
    await mkdir(installed, { recursive: true })
    await mkdir(state, { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify(profileManifest({ dshmarket: '1.0.0' })))
    await writeFile(join(installed, 'package.json'), JSON.stringify({
      name: 'dshmarket', version: '1.0.0',
    }))
    await writeFile(join(state, 'dshmarket.seeded.json'), JSON.stringify({
      schema: 2, packageName: 'dshmarket', version: '1.0.0',
    }))
    const install = successfulInstall(options)
    const entry = { ...options.entry, managedUpgradeFrom: ['1.0.0'] }

    await expect(seedBundledPlugin({ ...options, entry, install })).resolves.toBe('upgraded')
    expect(install).toHaveBeenCalledWith(join(state, options.entry.archive), entry)
    expect(JSON.parse(await readFile(join(state, 'dshmarket.seeded.json'), 'utf8')))
      .toMatchObject({ schema: 4, installedVersion: '1.12.1', ownership: 'desktop-archive' })
  })

  it('repairs a schema-2 marker that claimed the packaged version before the dependency advanced', async () => {
    const options = await fixture()
    const profile = join(options.dshHome, 'profiles', 'web')
    const state = join(options.dshHome, 'bundled-plugins')
    const installed = join(profile, 'node_modules', 'dshmarket')
    await mkdir(installed, { recursive: true })
    await mkdir(state, { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify(profileManifest({ dshmarket: '1.0.0' })))
    await writeFile(join(installed, 'package.json'), JSON.stringify({
      name: 'dshmarket', version: '1.0.0',
    }))
    await writeFile(join(state, 'dshmarket.seeded.json'), JSON.stringify({
      schema: 2, packageName: 'dshmarket', version: options.entry.version,
    }))
    const install = successfulInstall(options)
    const entry = { ...options.entry, managedUpgradeFrom: ['1.0.0'] }

    await expect(bundledPluginSeedIsSettled(options.dshHome, options.entry)).resolves.toBe(false)
    await expect(seedBundledPlugin({ ...options, entry, install })).resolves.toBe('upgraded')
    expect(install).toHaveBeenCalledOnce()
    expect(JSON.parse(await readFile(join(state, 'dshmarket.seeded.json'), 'utf8')))
      .toMatchObject({ schema: 4, installedVersion: '1.12.1', ownership: 'desktop-archive' })
  })

  it('explicitly restores the packaged archive over an older registry dependency', async () => {
    const options = await fixture()
    const profile = join(options.dshHome, 'profiles/web')
    const installed = join(profile, 'node_modules/dshmarket')
    await mkdir(installed, { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify(profileManifest({ dshmarket: '1.0.0' })))
    await writeFile(join(installed, 'package.json'), JSON.stringify({
      name: 'dshmarket', version: '1.0.0',
    }))
    const install = successfulInstall(options)

    await expect(seedBundledPlugin({
      ...options,
      install,
      restoreBundledVersion: true,
    })).resolves.toBe('upgraded')
    expect(install).toHaveBeenCalledOnce()
    expect(JSON.parse(await readFile(
      join(options.dshHome, 'bundled-plugins/dshmarket.seeded.json'),
      'utf8',
    ))).toMatchObject({
      schema: 4,
      handledBundledVersion: options.entry.version,
      installedVersion: options.entry.version,
      ownership: 'desktop-archive',
    })
  })

  it('retains desktop archive ownership after the active Profile is copied into a candidate home', async () => {
    const options = await fixture()
    const activeHome = join(options.root, 'active home')
    const candidateHome = join(options.root, '候选 配置')
    const activeState = join(activeHome, 'bundled-plugins')
    const profile = join(candidateHome, 'profiles/web')
    await mkdir(activeState, { recursive: true })
    await mkdir(join(profile, 'node_modules/dshmarket'), { recursive: true })
    await mkdir(join(candidateHome, 'bundled-plugins'), { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify(profileManifest({
      dshmarket: `file:${join(activeState, 'dshmarket-1.0.0.tgz')}`,
    })))
    await writeFile(join(profile, 'node_modules/dshmarket/package.json'), JSON.stringify({
      name: 'dshmarket', version: '1.0.0',
    }))
    await writeFile(join(candidateHome, 'bundled-plugins/dshmarket.seeded.json'), JSON.stringify({
      schema: 3, version: '1.0.0', ownership: 'desktop',
    }))
    const install = vi.fn(async (_archivePath: string, entry: BundledPluginManifestEntry) => {
      await materializeBundledPlugin(candidateHome, entry)
    })

    await expect(seedBundledPlugin({
      ...options,
      dshHome: candidateHome,
      sourceDshHome: activeHome,
      install,
    })).resolves.toBe('upgraded')
    expect(JSON.parse(await readFile(join(candidateHome, 'bundled-plugins/dshmarket.seeded.json'), 'utf8')))
      .toMatchObject({ schema: 4, ownership: 'desktop-archive', installedVersion: options.entry.version })
  })

  it('records a declared dependency with missing package files as unresolved', async () => {
    const options = await fixture()
    const profile = join(options.dshHome, 'profiles/web')
    await mkdir(profile, { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify(profileManifest({ dshmarket: '1.0.0' })))
    const install = vi.fn(async () => {})

    await expect(seedBundledPlugin({ ...options, install })).resolves.toBe('unresolved')
    expect(install).not.toHaveBeenCalled()
    expect(JSON.parse(await readFile(join(options.dshHome, 'bundled-plugins/dshmarket.seeded.json'), 'utf8')))
      .toMatchObject({ schema: 4, state: 'unresolved', ownership: 'user' })
    await expect(bundledPluginSeedIsSettled(options.dshHome, options.entry)).resolves.toBe(false)
  })

  it('does not turn a damaged marker with missing package files into an installed record', async () => {
    const options = await fixture()
    const profile = join(options.dshHome, 'profiles/web')
    const state = join(options.dshHome, 'bundled-plugins')
    await mkdir(profile, { recursive: true })
    await mkdir(state, { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify(profileManifest({ dshmarket: '1.0.0' })))
    await writeFile(join(state, 'dshmarket.seeded.json'), '{ damaged')
    const install = vi.fn()

    await expect(seedBundledPlugin({ ...options, install })).resolves.toBe('unresolved')
    expect(install).not.toHaveBeenCalled()
    expect(JSON.parse(await readFile(join(state, 'dshmarket.seeded.json'), 'utf8')))
      .toMatchObject({ schema: 4, state: 'unresolved', ownership: 'user' })
  })

  it('refuses an install callback that leaves the old resolved version in place', async () => {
    const options = await fixture()
    const profile = join(options.dshHome, 'profiles/web')
    await mkdir(join(profile, 'node_modules/dshmarket'), { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify(profileManifest({ dshmarket: '1.0.0' })))
    await writeFile(join(profile, 'node_modules/dshmarket/package.json'), JSON.stringify({
      name: 'dshmarket', version: '1.0.0',
    }))
    const entry = { ...options.entry, managedUpgradeFrom: ['1.0.0'] }
    await mkdir(join(options.dshHome, 'bundled-plugins'), { recursive: true })
    await writeFile(join(options.dshHome, 'bundled-plugins/dshmarket.seeded.json'), JSON.stringify({
      schema: 3, version: options.entry.version, ownership: 'external',
    }))

    await expect(seedBundledPlugin({ ...options, entry, install: async () => {} }))
      .rejects.toThrow('expected 1.12.1, actual 1.0.0')
  })

  it('refuses an install callback that omits the Profile bundle registration', async () => {
    const options = await fixture()
    const profile = join(options.dshHome, 'profiles/web')
    const installed = join(profile, 'node_modules/dshmarket')
    const state = join(options.dshHome, 'bundled-plugins')
    await mkdir(installed, { recursive: true })
    await mkdir(state, { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify(profileManifest({ dshmarket: '1.0.0' })))
    await writeFile(join(installed, 'package.json'), JSON.stringify({ name: 'dshmarket', version: '1.0.0' }))
    await writeFile(join(state, 'dshmarket.seeded.json'), JSON.stringify({
      schema: 3, version: '1.0.0', ownership: 'external',
    }))
    const entry = { ...options.entry, managedUpgradeFrom: ['1.0.0'] }

    await expect(seedBundledPlugin({
      ...options,
      entry,
      install: async () => {
        await writeFile(join(profile, 'package.json'), JSON.stringify({
          dependencies: { dshmarket: entry.version },
        }))
        await writeFile(join(installed, 'package.json'), JSON.stringify({
          name: 'dshmarket', version: entry.version,
        }))
      },
    })).rejects.toThrow('bundleRegistered=false')
  })

  it('preserves a snapshot-restored bundled version until an explicit install', async () => {
    const options = await fixture()
    const profile = join(options.dshHome, 'profiles', 'web')
    const state = join(options.dshHome, 'bundled-plugins')
    await mkdir(profile, { recursive: true })
    await mkdir(state, { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify(profileManifest({
      dshmarket: `file:${join(state, 'dshmarket-1.0.0.tgz')}`,
    })))
    await writeFile(join(state, 'dshmarket.seeded.json'), JSON.stringify({
      schema: 2, packageName: 'dshmarket', version: '1.0.0',
    }))
    await writeFile(join(state, 'snapshot-version-hold.json'), JSON.stringify({
      schema: 1, versions: [{ seedId: 'dshmarket', version: '1.0.0' }],
    }))
    const installed = join(profile, 'node_modules/dshmarket')
    await mkdir(installed, { recursive: true })
    await writeFile(join(installed, 'package.json'), JSON.stringify({ name: 'dshmarket', version: '1.0.0' }))
    const install = successfulInstall(options)

    await expect(seedBundledPlugin({ ...options, install })).resolves.toBe('verified')
    expect(install).not.toHaveBeenCalled()
    await expect(seedBundledPlugin({ ...options, restoreBundledVersion: true, install })).resolves.toBe('upgraded')
    expect(install).toHaveBeenCalledOnce()
  })

  it('does not replace a user-owned registry dependency when the bundled marker is older', async () => {
    const options = await fixture()
    const profile = join(options.dshHome, 'profiles', 'web')
    const state = join(options.dshHome, 'bundled-plugins')
    await mkdir(profile, { recursive: true })
    await mkdir(state, { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify(profileManifest({ dshmarket: '9.9.9' })))
    await mkdir(join(profile, 'node_modules/dshmarket'), { recursive: true })
    await writeFile(join(profile, 'node_modules/dshmarket/package.json'), JSON.stringify({ name: 'dshmarket', version: '9.9.9' }))
    await writeFile(join(state, 'dshmarket.seeded.json'), JSON.stringify({
      schema: 2, packageName: 'dshmarket', version: '1.0.0',
    }))
    const install = vi.fn(async () => {})

    await expect(seedBundledPlugin({ ...options, install })).resolves.toBe('preserved-user-version')
    expect(install).not.toHaveBeenCalled()
    expect(JSON.parse(await readFile(join(state, 'dshmarket.seeded.json'), 'utf8')))
      .toMatchObject({ schema: 4, installedVersion: '9.9.9', ownership: 'user' })
  })

  it('does not downgrade a newer desktop-owned preset', async () => {
    const options = await fixture()
    const profile = join(options.dshHome, 'profiles', 'web')
    const state = join(options.dshHome, 'bundled-plugins')
    await mkdir(profile, { recursive: true })
    await mkdir(state, { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify(profileManifest({
      dshmarket: `file:${join(state, 'dshmarket-2.0.0.tgz')}`,
    })))
    await writeFile(join(state, 'dshmarket.seeded.json'), JSON.stringify({
      schema: 3, packageName: 'dshmarket', version: '2.0.0', ownership: 'desktop',
    }))
    await mkdir(join(profile, 'node_modules/dshmarket'), { recursive: true })
    await writeFile(join(profile, 'node_modules/dshmarket/package.json'), JSON.stringify({ name: 'dshmarket', version: '2.0.0' }))
    const install = vi.fn(async () => {})

    await expect(seedBundledPlugin({ ...options, install })).resolves.toBe('preserved-user-version')
    expect(install).not.toHaveBeenCalled()
    expect(JSON.parse(await readFile(join(state, 'dshmarket.seeded.json'), 'utf8')))
      .toMatchObject({ schema: 4, installedVersion: '2.0.0', ownership: 'desktop-archive' })
  })

  it('does not replace a registry preset after a user changes its source', async () => {
    const options = await fixture()
    const profile = join(options.dshHome, 'profiles', 'web')
    const state = join(options.dshHome, 'bundled-plugins')
    const installed = join(profile, 'node_modules', 'dshmarket')
    await mkdir(installed, { recursive: true })
    await mkdir(state, { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify(profileManifest({ dshmarket: '1.0.0' })))
    await writeFile(join(installed, 'package.json'), JSON.stringify({
      name: 'dshmarket', version: '1.0.0',
    }))
    await writeFile(join(state, 'dshmarket.seeded.json'), JSON.stringify({
      schema: 3, packageName: 'dshmarket', version: '1.0.0', ownership: 'desktop',
    }))
    const install = vi.fn(async () => {})

    await expect(seedBundledPlugin({ ...options, install })).resolves.toBe('preserved-user-version')
    expect(install).not.toHaveBeenCalled()
    expect(JSON.parse(await readFile(join(state, 'dshmarket.seeded.json'), 'utf8')))
      .toMatchObject({ schema: 4, installedVersion: '1.0.0', ownership: 'user' })
  })

  it('repairs a legacy development marker whose dependency was written to the wrong home', async () => {
    const options = await fixture()
    const state = join(options.dshHome, 'bundled-plugins')
    await mkdir(state, { recursive: true })
    await writeFile(join(state, 'dshmarket.seeded.json'), JSON.stringify({ schema: 1 }))
    const install = successfulInstall(options)
    await expect(seedBundledPlugin({ ...options, repairLegacyMarker: true, install })).resolves.toBe('installed')
    expect(install).toHaveBeenCalledOnce()
    expect(JSON.parse(await readFile(join(state, 'dshmarket.seeded.json'), 'utf8')))
      .toMatchObject({ schema: 4, packageName: 'dshmarket', ownership: 'desktop-archive' })
  })

  it('allows an explicit manual install to replace an uninstall tombstone', async () => {
    const options = await fixture()
    const install = successfulInstall(options)
    await seedBundledPlugin({ ...options, install })
    await expect(seedBundledPlugin({ ...options, restoreBundledVersion: true, install })).resolves.toBe('upgraded')
    expect(install).toHaveBeenCalledTimes(2)
  })

  it('refuses a modified archive without writing a marker', async () => {
    const options = await fixture()
    const install = vi.fn(async () => {})
    await expect(seedBundledPlugin({
      ...options,
      entry: { ...options.entry, integrity: 'sha512-invalid' },
      install,
    })).rejects.toThrow(/integrity mismatch/)
    expect(install).not.toHaveBeenCalled()
    await expect(readFile(join(options.dshHome, 'bundled-plugins', 'dshmarket.seeded.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

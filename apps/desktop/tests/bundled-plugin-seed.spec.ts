import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  appendBundledPluginFailure,
  assertBundledPluginManifestEntry,
  bundledPluginSeedIsSettled,
  seedBundledPlugin,
  type BundledPluginManifestEntry,
} from '../src/bundled-plugin-seed.ts'

const roots: string[] = []

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

describe('bundled plugin seed', () => {
  it('creates the log directory before persisting an early install failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-bundled-plugin-log-'))
    roots.push(root)
    const logPath = join(root, 'missing', 'logs', 'harness.log')
    await appendBundledPluginFailure(logPath, new Error('pnpm failed'))
    await expect(readFile(logPath, 'utf8')).resolves.toContain('[bundled-plugin] Error: pnpm failed')
  })

  it('ships the pinned preset archives with matching integrity', async () => {
    const manifest = JSON.parse(await readFile(new URL('../bundled-plugins/manifest.json', import.meta.url), 'utf8')) as {
      schema: number
      plugins: BundledPluginManifestEntry[]
    }
    expect(manifest.schema).toBe(2)
    expect(manifest.plugins.map(entry => [entry.packageName, entry.installPolicy])).toEqual([
      ['dshmarket', 'startup'],
      ['@xmanrui/dsh-im', 'startup'],
      ['dsh-skill-picker', 'startup'],
      ['dsh-better-sidebar', 'startup'],
      ['dsh-pocket', 'startup'],
      ['dsh-font', 'diagnostic'],
      ['@dsh-diagnostic-lab/scoped-loader-mismatch', 'diagnostic'],
      ['@dsh-diagnostic-lab/loader-dependency-unavailable', 'diagnostic'],
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
    expect(new Set(manifest.plugins.map(entry => entry.seedId)).size).toBe(manifest.plugins.length)
    expect(manifest.plugins.find(entry => entry.packageName === 'dsh-better-sidebar')?.approvedBuilds)
      .toEqual(['node-pty'])
    expect(manifest.plugins.map(entry => entry.packageName)).not.toContain('@deepseek-ai/dsh-subagent-codex')
    expect(manifest.plugins.map(entry => entry.packageName)).not.toContain('@deepseek-ai/dsh-subagent-claude-code')
    for (const entry of manifest.plugins) {
      const bytes = await readFile(new URL(`../bundled-plugins/${entry.archive}`, import.meta.url))
      expect(`sha512-${createHash('sha512').update(bytes).digest('base64')}`).toBe(entry.integrity)
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
    const install = vi.fn(async () => {})
    await expect(seedBundledPlugin({ ...options, install })).resolves.toBe('installed')
    expect(install).toHaveBeenCalledOnce()
    await expect(seedBundledPlugin({ ...options, install })).resolves.toBe('already-seeded')
    expect(install).toHaveBeenCalledOnce()
    expect(JSON.parse(await readFile(join(options.dshHome, 'bundled-plugins', 'dshmarket.seeded.json'), 'utf8')))
      .toMatchObject({ packageName: 'dshmarket', version: '1.12.1' })
  })

  it('adopts an existing dependency without replacing its version', async () => {
    const options = await fixture()
    const profile = join(options.dshHome, 'profiles', 'web')
    await mkdir(profile, { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify({ dependencies: { dshmarket: '9.9.9' } }))
    const install = vi.fn(async () => {})
    const prepare = vi.fn(async () => {})
    await expect(seedBundledPlugin({ ...options, install, prepare })).resolves.toBe('already-installed')
    expect(install).not.toHaveBeenCalled()
    expect(prepare).toHaveBeenCalledOnce()
  })

  it('adopts an aliased dependency from the same GitHub repository without duplicating it', async () => {
    const options = await fixture()
    const profile = join(options.dshHome, 'profiles', 'web')
    await mkdir(profile, { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify({
      dependencies: {
        'custom-market-name': 'git+https://github.com/example/dshmarket.git#older-commit',
      },
    }))
    const entry = {
      ...options.entry,
      registrySpec: 'github:example/dshmarket#newer-commit',
    }
    const install = vi.fn(async () => {})
    const prepare = vi.fn(async () => {})
    await expect(seedBundledPlugin({ ...options, entry, install, prepare })).resolves.toBe('already-installed')
    expect(install).not.toHaveBeenCalled()
    expect(prepare).toHaveBeenCalledWith(entry)
  })

  it('merges reviewed build approvals when an existing marker still has its dependency', async () => {
    const options = await fixture()
    const profile = join(options.dshHome, 'profiles', 'web')
    const state = join(options.dshHome, 'bundled-plugins')
    await mkdir(profile, { recursive: true })
    await mkdir(state, { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify({ dependencies: { dshmarket: '1.0.0' } }))
    await writeFile(join(state, 'dshmarket.seeded.json'), JSON.stringify({ schema: 2 }))
    const prepare = vi.fn(async () => {})
    await expect(seedBundledPlugin({ ...options, install: vi.fn(), prepare })).resolves.toBe('already-seeded')
    expect(prepare).toHaveBeenCalledWith(options.entry)
  })

  it('uses the settled fast path only after reviewed build approvals have durable policy entries', async () => {
    const options = await fixture()
    const entry = { ...options.entry, approvedBuilds: ['node-pty'] }
    const profile = join(options.dshHome, 'profiles', 'web')
    const state = join(options.dshHome, 'bundled-plugins')
    await mkdir(profile, { recursive: true })
    await mkdir(state, { recursive: true })
    await writeFile(join(state, 'dshmarket.seeded.json'), JSON.stringify({
      schema: 2, version: entry.version,
    }))

    await expect(bundledPluginSeedIsSettled(options.dshHome, entry)).resolves.toBe(false)
    await writeFile(join(profile, 'pnpm-workspace.yaml'), 'allowBuilds:\n  node-pty: true\n')
    await expect(bundledPluginSeedIsSettled(options.dshHome, entry)).resolves.toBe(true)
  })

  it('upgrades a stale desktop-owned archive when the bundled version changes', async () => {
    const options = await fixture()
    const profile = join(options.dshHome, 'profiles', 'web')
    const state = join(options.dshHome, 'bundled-plugins')
    await mkdir(profile, { recursive: true })
    await mkdir(state, { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify({
      dependencies: { dshmarket: `file:${join(state, 'dshmarket-1.0.0.tgz')}` },
    }))
    await writeFile(join(state, 'dshmarket.seeded.json'), JSON.stringify({
      schema: 2, packageName: 'dshmarket', version: '1.0.0',
    }))
    const install = vi.fn(async () => {})

    await expect(seedBundledPlugin({ ...options, install })).resolves.toBe('installed')
    expect(install).toHaveBeenCalledWith(join(state, options.entry.archive), options.entry)
    await expect(readFile(join(state, 'dshmarket.seeded.json'), 'utf8')).resolves.toContain('"version": "1.12.1"')
  })

  it('preserves a snapshot-restored bundled version until an explicit install', async () => {
    const options = await fixture()
    const profile = join(options.dshHome, 'profiles', 'web')
    const state = join(options.dshHome, 'bundled-plugins')
    await mkdir(profile, { recursive: true })
    await mkdir(state, { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify({
      dependencies: { dshmarket: `file:${join(state, 'dshmarket-1.0.0.tgz')}` },
    }))
    await writeFile(join(state, 'dshmarket.seeded.json'), JSON.stringify({
      schema: 2, packageName: 'dshmarket', version: '1.0.0',
    }))
    await writeFile(join(state, 'snapshot-version-hold.json'), JSON.stringify({
      schema: 1, versions: [{ seedId: 'dshmarket', version: '1.0.0' }],
    }))
    const install = vi.fn(async () => {})

    await expect(seedBundledPlugin({ ...options, install })).resolves.toBe('already-seeded')
    expect(install).not.toHaveBeenCalled()
    await expect(seedBundledPlugin({ ...options, force: true, install })).resolves.toBe('installed')
    expect(install).toHaveBeenCalledOnce()
  })

  it('does not replace a user-owned registry dependency when the bundled marker is older', async () => {
    const options = await fixture()
    const profile = join(options.dshHome, 'profiles', 'web')
    const state = join(options.dshHome, 'bundled-plugins')
    await mkdir(profile, { recursive: true })
    await mkdir(state, { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify({ dependencies: { dshmarket: '9.9.9' } }))
    await writeFile(join(state, 'dshmarket.seeded.json'), JSON.stringify({
      schema: 2, packageName: 'dshmarket', version: '1.0.0',
    }))
    const install = vi.fn(async () => {})

    await expect(seedBundledPlugin({ ...options, install })).resolves.toBe('already-seeded')
    expect(install).not.toHaveBeenCalled()
  })

  it('repairs a legacy development marker whose dependency was written to the wrong home', async () => {
    const options = await fixture()
    const state = join(options.dshHome, 'bundled-plugins')
    await mkdir(state, { recursive: true })
    await writeFile(join(state, 'dshmarket.seeded.json'), JSON.stringify({ schema: 1 }))
    const install = vi.fn(async () => {})
    await expect(seedBundledPlugin({ ...options, repairLegacyMarker: true, install })).resolves.toBe('installed')
    expect(install).toHaveBeenCalledOnce()
    expect(JSON.parse(await readFile(join(state, 'dshmarket.seeded.json'), 'utf8')))
      .toMatchObject({ schema: 2, packageName: 'dshmarket' })
  })

  it('allows an explicit manual install to replace an uninstall tombstone', async () => {
    const options = await fixture()
    const install = vi.fn(async () => {})
    await seedBundledPlugin({ ...options, install })
    await expect(seedBundledPlugin({ ...options, force: true, install })).resolves.toBe('installed')
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

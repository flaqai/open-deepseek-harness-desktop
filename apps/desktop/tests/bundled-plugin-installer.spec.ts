import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BundledPluginInstaller,
  installBundledPluginSource,
  resolveBundledPluginResourcesDirectory,
  type BundledPluginManifest,
} from '../src/bundled-plugin-installer.ts'
import type { BundledPluginManifestEntry } from '../src/bundled-plugin-seed.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bundled-installer-'))
  roots.push(root)
  const resourcesDirectory = join(root, 'resources')
  await mkdir(resourcesDirectory)
  const bytes = Buffer.from('archive')
  for (const archive of ['startup.tgz', 'manual.tgz', 'diagnostic.tgz']) {
    await writeFile(join(resourcesDirectory, archive), bytes)
  }
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
  const manifest: BundledPluginManifest = {
    schema: 2,
    plugins: [
      {
        seedId: 'startup', packageName: 'startup', version: '1.0.0', profile: 'web',
        installPolicy: 'startup', registrySpec: 'startup@1.0.0', archive: 'startup.tgz', integrity,
      },
      {
        seedId: 'manual', packageName: 'manual', version: '2.0.0', profile: 'web',
        installPolicy: 'manual', registrySpec: 'manual@2.0.0', archive: 'manual.tgz', integrity,
      },
      {
        seedId: 'diagnostic', packageName: 'diagnostic', version: '3.0.0', profile: 'web',
        installPolicy: 'diagnostic', archive: 'diagnostic.tgz', integrity,
      },
    ],
  }
  return { root, resourcesDirectory, manifest }
}

describe('BundledPluginInstaller', () => {
  function twoStartupPlugins(manifest: BundledPluginManifest): BundledPluginManifest {
    const first = manifest.plugins[0]
    if (first === undefined) throw new Error('fixture requires one startup plugin')
    return {
      schema: 2,
      plugins: [
        first,
        {
          ...first,
          seedId: 'startup-two',
          packageName: 'startup-two',
          registrySpec: 'startup-two@1.0.0',
        },
      ],
    }
  }

  it('uses checked-in archives in development and packaged resources in releases', () => {
    expect(resolveBundledPluginResourcesDirectory(false, '/resources', '/checkout'))
      .toBe(join('/checkout', 'apps', 'desktop', 'bundled-plugins'))
    expect(resolveBundledPluginResourcesDirectory(true, '/resources', '/checkout'))
      .toBe(join('/resources', 'bundled-plugins'))
  })

  it('installs only the bundled archive without attempting the registry', async () => {
    const f = await fixture()
    const entry = f.manifest.plugins[0]
    const install = vi.fn(async () => {})
    await expect(installBundledPluginSource(entry, '/archive.tgz', install)).resolves.toBe('archive')
    expect(install).toHaveBeenCalledOnce()
    expect(install).toHaveBeenCalledWith('/archive.tgz', false)
  })

  it('seeds only startup entries and isolates one failure', async () => {
    const f = await fixture()
    const install = vi.fn(async () => { throw new Error('failed') })
    const onFailure = vi.fn(async () => {})
    const installer = new BundledPluginInstaller({
      manifest: f.manifest, resourcesDirectory: f.resourcesDirectory, dshHome: join(f.root, 'home'),
      install, onFailure,
    })
    const results = await installer.seedStartup()
    expect(results.map(item => item.entry.packageName)).toEqual(['startup'])
    expect(install).toHaveBeenCalledOnce()
    expect(onFailure).toHaveBeenCalledOnce()
  })

  it('wraps each startup plugin in an independent transaction and continues after failure', async () => {
    const f = await fixture()
    const manifest = twoStartupPlugins(f.manifest)
    const install = vi.fn(async () => {})
    const onFailure = vi.fn(async () => {})
    const withStartupTransaction = vi.fn(async <T>(
      entry: BundledPluginManifestEntry,
      operation: () => Promise<T>,
    ): Promise<T> => {
      if (entry.packageName === 'startup') throw new Error('first transaction failed')
      return operation()
    })
    const installer = new BundledPluginInstaller({
      manifest, resourcesDirectory: f.resourcesDirectory, dshHome: join(f.root, 'home'),
      install, onFailure, withStartupTransaction,
    })

    const results = await installer.seedStartup()

    expect(results).toHaveLength(2)
    expect(withStartupTransaction).toHaveBeenCalledTimes(2)
    expect(onFailure).toHaveBeenCalledOnce()
    expect(install).toHaveBeenCalledOnce()
  })

  it('skips plugins that have not started when the total startup budget is exhausted', async () => {
    const f = await fixture()
    const manifest = twoStartupPlugins(f.manifest)
    let now = 0
    const install = vi.fn(async () => { now = 101 })
    const onFailure = vi.fn(async () => {})
    const installer = new BundledPluginInstaller({
      manifest, resourcesDirectory: f.resourcesDirectory, dshHome: join(f.root, 'home'),
      install, onFailure, now: () => now, startupBudgetMs: 100,
    })

    const results = await installer.seedStartup()

    expect(results.map(item => item.result)).toEqual(['installed', undefined])
    expect(install).toHaveBeenCalledOnce()
    expect(onFailure).not.toHaveBeenCalled()
  })

  it('reports the current startup plugin and its real seed milestones', async () => {
    const f = await fixture()
    const progress: Array<{ packageName: string; index: number; total: number; stage: string; progress: number }> = []
    const installer = new BundledPluginInstaller({
      manifest: f.manifest, resourcesDirectory: f.resourcesDirectory, dshHome: join(f.root, 'home'),
      install: async () => {},
    })

    await installer.seedStartup((event) => {
      progress.push({
        packageName: event.entry.packageName,
        index: event.index,
        total: event.total,
        stage: event.stage,
        progress: event.progress,
      })
    })

    expect(progress).toEqual([
      { packageName: 'startup', index: 0, total: 1, stage: 'verifying', progress: 0 },
      { packageName: 'startup', index: 0, total: 1, stage: 'verifying', progress: 8 },
      { packageName: 'startup', index: 0, total: 1, stage: 'extracting', progress: 46 },
      { packageName: 'startup', index: 0, total: 1, stage: 'configuring', progress: 90 },
      { packageName: 'startup', index: 0, total: 1, stage: 'configuring', progress: 100 },
    ])

    progress.length = 0
    await installer.seedStartup(event => progress.push({
      packageName: event.entry.packageName,
      index: event.index,
      total: event.total,
      stage: event.stage,
      progress: event.progress,
    }))
    expect(progress).toEqual([
      { packageName: 'startup', index: 0, total: 1, stage: 'configuring', progress: 100 },
    ])
  })

  it('does not let a startup progress observer interrupt plugin installation', async () => {
    const f = await fixture()
    const install = vi.fn(async () => {})
    const installer = new BundledPluginInstaller({
      manifest: f.manifest, resourcesDirectory: f.resourcesDirectory, dshHome: join(f.root, 'home'), install,
    })

    await expect(installer.seedStartup(() => { throw new Error('observer failed') })).resolves.toHaveLength(1)
    expect(install).toHaveBeenCalledOnce()
  })

  it('handles bundled startup/manual requests and keeps newer registry versions Host-owned', async () => {
    const f = await fixture()
    let finishInstall: (() => void) | undefined
    const installPromise = new Promise<void>((resolve) => { finishInstall = resolve })
    const install = vi.fn(() => installPromise)
    const installer = new BundledPluginInstaller({
      manifest: f.manifest, resourcesDirectory: f.resourcesDirectory, dshHome: join(f.root, 'home'),
      install, createId: () => 'job-1',
    })
    expect(installer.startManual('web', 'other@1.0.0')).toEqual({ handled: false })
    expect(installer.startManual('web', 'diagnostic@3.0.0')).toEqual({ handled: false })
    expect(installer.startManual('web', 'manual@2.1.0')).toEqual({ handled: false })
    const first = installer.startManual('web', 'manual@2.0.0')
    const second = installer.startManual('web', 'manual@2.0.0')
    expect(first).toEqual(second)
    expect(first.handled).toBe(true)
    if (!first.handled) throw new Error('expected handled request')
    expect(first.snapshot.phase).toBe('running')
    expect(first.snapshot).toMatchObject({ stage: 'verifying', progress: 0 })
    expect(() => installer.getInstall('not-desktop')).toThrow(/invalid/)
    if (finishInstall === undefined) throw new Error('install promise did not expose its resolver')
    finishInstall()
    await vi.waitFor(() => { expect(installer.getInstall(first.snapshot.installId).phase).toBe('succeeded') })
    expect(install).toHaveBeenCalledOnce()
  })

  it('restores an explicitly requested startup entry from its bundled archive', async () => {
    const f = await fixture()
    const install = vi.fn(async () => {})
    const installer = new BundledPluginInstaller({
      manifest: f.manifest, resourcesDirectory: f.resourcesDirectory, dshHome: join(f.root, 'home'),
      install, createId: () => 'startup-restore',
    })

    const started = installer.startManual('web', 'startup')
    expect(started.handled).toBe(true)
    if (!started.handled) throw new Error('expected bundled startup restore')
    await vi.waitFor(() => { expect(installer.getInstall(started.snapshot.installId).phase).toBe('succeeded') })
    expect(install).toHaveBeenCalledOnce()
  })

  it('defers a manual entry once and preserves its durable uninstall marker', async () => {
    const f = await fixture()
    const install = vi.fn(async () => {})
    const installer = new BundledPluginInstaller({
      manifest: f.manifest, resourcesDirectory: f.resourcesDirectory, dshHome: join(f.root, 'home'), install,
    })
    const first = await installer.startDeferred('web', 'manual@2.0.0')
    expect(first.handled).toBe(true)
    if (!first.handled || first.snapshot === undefined) throw new Error('expected deferred job')
    await vi.waitFor(() => {
      expect(installer.getInstall(first.snapshot!.installId)).toMatchObject({
        phase: 'succeeded', stage: 'configuring', progress: 100,
      })
    })
    await expect(installer.startDeferred('web', 'manual@2.0.0')).resolves.toEqual({ handled: true })
    expect(install).toHaveBeenCalledOnce()
  })

  it('repairs a legacy deferred marker in development', async () => {
    const f = await fixture()
    const dshHome = join(f.root, 'home')
    await mkdir(join(dshHome, 'bundled-plugins'), { recursive: true })
    await writeFile(join(dshHome, 'bundled-plugins', 'manual.seeded.json'), JSON.stringify({ schema: 1 }))
    const install = vi.fn(async () => {})
    const installer = new BundledPluginInstaller({
      manifest: f.manifest, resourcesDirectory: f.resourcesDirectory, dshHome, install,
      repairLegacyMarkers: true,
    })
    const result = await installer.startDeferred('web', 'manual@2.0.0')
    expect(result.handled).toBe(true)
    if (!result.handled || result.snapshot === undefined) throw new Error('expected repair job')
    await vi.waitFor(() => { expect(installer.getInstall(result.snapshot!.installId).phase).toBe('succeeded') })
    expect(install).toHaveBeenCalledOnce()
  })

  it('does not automatically reinstall a manually bundled plugin after dependency quarantine', async () => {
    const f = await fixture()
    const dshHome = join(f.root, 'home')
    await mkdir(join(dshHome, 'quarantine'), { recursive: true })
    await writeFile(join(dshHome, 'quarantine', 'profile-plugins.json'), JSON.stringify({
      schema: 1,
      plugins: [{ profile: 'web', packageName: 'manual' }],
    }))
    const install = vi.fn(async () => {})
    const installer = new BundledPluginInstaller({
      manifest: f.manifest, resourcesDirectory: f.resourcesDirectory, dshHome, install,
    })

    await expect(installer.startDeferred('web', 'manual@2.0.0')).resolves.toEqual({ handled: true })
    expect(install).not.toHaveBeenCalled()

    const explicit = installer.startManual('web', 'manual@2.0.0')
    expect(explicit.handled).toBe(true)
    if (!explicit.handled) throw new Error('expected explicit install job')
    await vi.waitFor(() => { expect(installer.getInstall(explicit.snapshot.installId).phase).toBe('succeeded') })
    expect(install).toHaveBeenCalledOnce()
  })

  it('retains a bounded failure diagnostic for polling', async () => {
    const f = await fixture()
    const installer = new BundledPluginInstaller({
      manifest: f.manifest, resourcesDirectory: f.resourcesDirectory, dshHome: join(f.root, 'home'),
      install: async () => { throw new Error(`prefix-${'x'.repeat(5000)}-tail`) }, createId: () => 'failure',
    })
    const started = installer.startManual('web', 'manual@2.0.0')
    if (!started.handled) throw new Error('expected handled request')
    await vi.waitFor(() => { expect(installer.getInstall(started.snapshot.installId).phase).toBe('failed') })
    const settled = installer.getInstall(started.snapshot.installId)
    expect(settled.diagnostic?.length).toBeLessThanOrEqual(4000)
    expect(settled.diagnostic).toContain('-tail')
  })
})

import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BundledPluginInstaller,
  installBundledPluginSource,
  type BundledPluginManifest,
} from '../src/bundled-plugin-installer.ts'

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
  for (const archive of ['startup.tgz', 'manual.tgz']) await writeFile(join(resourcesDirectory, archive), bytes)
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
    ],
  }
  return { root, resourcesDirectory, manifest }
}

describe('BundledPluginInstaller', () => {
  it('prefers registry identity and falls back to the bundled archive', async () => {
    const f = await fixture()
    const entry = f.manifest.plugins[0]!
    const online = vi.fn(async () => {})
    await expect(installBundledPluginSource(entry, '/archive.tgz', online)).resolves.toBe('registry')
    expect(online).toHaveBeenCalledWith('startup@1.0.0', true)

    const fallback = vi.fn(async (spec: string) => {
      if (spec === 'startup@1.0.0') throw new Error('offline')
    })
    const onRegistryFailure = vi.fn()
    await expect(installBundledPluginSource(entry, '/archive.tgz', fallback, onRegistryFailure))
      .resolves.toBe('archive')
    expect(fallback.mock.calls).toEqual([['startup@1.0.0', true], ['/archive.tgz', false]])
    expect(onRegistryFailure).toHaveBeenCalledOnce()
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

  it('handles only an exact manual allowlist request and keeps one active writer', async () => {
    const f = await fixture()
    const deferred = Promise.withResolvers<undefined>()
    const install = vi.fn(() => deferred.promise)
    const installer = new BundledPluginInstaller({
      manifest: f.manifest, resourcesDirectory: f.resourcesDirectory, dshHome: join(f.root, 'home'),
      install, createId: () => 'job-1',
    })
    expect(installer.startManual('web', 'other@1.0.0')).toEqual({ handled: false })
    const first = installer.startManual('web', 'manual@2.0.0')
    const second = installer.startManual('web', 'manual@2.0.0')
    expect(first).toEqual(second)
    expect(first.handled).toBe(true)
    if (!first.handled) throw new Error('expected handled request')
    expect(first.snapshot.phase).toBe('running')
    expect(first.snapshot).toMatchObject({ stage: 'verifying', progress: 0 })
    expect(() => installer.getInstall('not-desktop')).toThrow(/invalid/)
    deferred.resolve(undefined)
    await vi.waitFor(() => { expect(installer.getInstall(first.snapshot.installId).phase).toBe('succeeded') })
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

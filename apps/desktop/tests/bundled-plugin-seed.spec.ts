import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedBundledPlugin, type BundledPluginManifestEntry } from '../src/bundled-plugin-seed.ts'

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
      archive: 'dshmarket.tgz',
      integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    },
  }
}

describe('bundled plugin seed', () => {
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
    await expect(seedBundledPlugin({ ...options, install })).resolves.toBe('already-installed')
    expect(install).not.toHaveBeenCalled()
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

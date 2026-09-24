import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { create } from 'tar'
import { afterEach, describe, expect, it } from 'vitest'
import { writePortablePluginBundle } from '../src/portable-plugin-bundle.ts'
import { mergePortablePluginStore } from '../src/portable-plugin-store.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(): Promise<{ root: string; bundle: string; home: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-portable-store-'))
  roots.push(root)
  await mkdir(join(root, 'source', 'package'), { recursive: true })
  await writeFile(join(root, 'source', 'package', 'package.json'), JSON.stringify({ name: 'example-plugin', version: '1.2.3' }))
  const archive = join(root, 'plugin.tgz')
  await create({ cwd: join(root, 'source'), file: archive, gzip: true }, ['package'])
  const bundle = join(root, 'bundle')
  const manifest = await writePortablePluginBundle(bundle, {
    platform: 'win32', architecture: 'x64', osVersion: 'Windows 11',
  }, [{ packageName: 'example-plugin', version: '1.2.3', archive }])
  await mkdir(join(bundle, 'store', 'v11', 'files'), { recursive: true })
  await mkdir(join(bundle, 'cache'))
  await writeFile(join(bundle, 'store', 'v11', 'files', 'fixture'), 'portable content')
  const storeHash = createHash('sha256')
    .update('d\0v11\0')
    .update('d\0v11/files\0')
    .update(`f\0v11/files/fixture\0${String(16)}\0`)
    .update('portable content').digest('hex')
  const emptyHash = createHash('sha256').digest('hex')
  await writeFile(join(bundle, 'manifest.json'), JSON.stringify({
    ...manifest, registry: 'https://registry.npmjs.org/',
    store: { sha256: storeHash, cacheSha256: emptyHash, verification: 'target-rehearsal-required' },
  }))
  const home = join(root, 'home')
  await mkdir(home)
  return { root, bundle, home }
}

describe('portable pnpm store import', () => {
  it('adds missing files, accepts identical entries, and never overwrites different content', async () => {
    const { bundle, home } = await fixture()
    const result = await mergePortablePluginStore(bundle, home)
    expect(result).toEqual({ filesAdded: 1, bytesAdded: 16 })
    const target = join(home, '.pnpm-store', 'v11', 'files', 'fixture')
    expect(await readFile(target, 'utf8')).toBe('portable content')
    expect(await mergePortablePluginStore(bundle, home)).toEqual({ filesAdded: 0, bytesAdded: 0 })
    await writeFile(target, 'different content')
    await expect(mergePortablePluginStore(bundle, home)).rejects.toThrow(/differs/u)
    expect(await readFile(target, 'utf8')).toBe('different content')
  })

  it('refuses linked destination directories without following them', async () => {
    const { root, bundle, home } = await fixture()
    const outside = join(root, 'outside')
    await mkdir(outside)
    await symlink(outside, join(home, '.pnpm-store'))
    await expect(mergePortablePluginStore(bundle, home)).rejects.toThrow(/regular directory/u)
  })
})

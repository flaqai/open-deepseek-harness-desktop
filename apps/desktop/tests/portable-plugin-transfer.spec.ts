import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { create } from 'tar'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyPreparedPortablePluginBundle, writePortablePluginBundle } from '../src/portable-plugin-bundle.ts'
import { packPortablePluginBundle, unpackPortablePluginBundle } from '../src/portable-plugin-transfer.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function preparedBundle(root: string): Promise<string> {
  const source = join(root, 'source')
  await mkdir(join(source, 'package'), { recursive: true })
  await writeFile(join(source, 'package', 'package.json'), JSON.stringify({ name: 'example-plugin', version: '1.2.3' }))
  const archive = join(root, 'plugin.tgz')
  await create({ cwd: source, file: archive, gzip: true }, ['package'])
  const directory = join(root, 'bundle')
  const manifest = await writePortablePluginBundle(directory, {
    platform: 'win32', architecture: 'x64', osVersion: 'Windows 11',
  }, [{ packageName: 'example-plugin', version: '1.2.3', archive }])
  await mkdir(join(directory, 'store'))
  await mkdir(join(directory, 'cache'))
  const emptyHash = createHash('sha256').digest('hex')
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({
    ...manifest, registry: 'https://registry.npmjs.org/',
    store: { sha256: emptyHash, cacheSha256: emptyHash, verification: 'target-rehearsal-required' },
  }))
  return directory
}

describe('single-file portable plugin transfer', () => {
  it('preserves a prepared bundle and refuses to overwrite an existing transfer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-portable-transfer-'))
    roots.push(root)
    const directory = await preparedBundle(root)
    const output = join(root, 'plugins.tgz')
    await packPortablePluginBundle(directory, output)
    const unpacked = await unpackPortablePluginBundle(output)
    try {
      await expect(verifyPreparedPortablePluginBundle(unpacked.directory)).resolves.toMatchObject({
        target: { platform: 'win32', architecture: 'x64', osVersion: 'Windows 11' },
      })
      await expect(packPortablePluginBundle(directory, output)).rejects.toThrow(/destination exists/u)
      await expect(readFile(output)).resolves.toBeInstanceOf(Buffer)
    } finally {
      await unpacked.cleanup()
    }
  })

  it('refuses a transfer containing symlinks before extraction', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-portable-transfer-'))
    roots.push(root)
    await mkdir(join(root, 'content', 'store'), { recursive: true })
    await symlink('/tmp/outside', join(root, 'content', 'store', 'linked'))
    const archive = join(root, 'unsafe.tgz')
    await create({ cwd: join(root, 'content'), file: archive, gzip: true }, ['store'])
    await expect(unpackPortablePluginBundle(archive)).rejects.toThrow(/unsafe portable plugin transfer/u)
  })
})

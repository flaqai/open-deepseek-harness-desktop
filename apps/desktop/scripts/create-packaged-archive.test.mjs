import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { list } from 'tar'
import { createPackagedArchive, sha256File, verifyPackagedTreeLinks } from './create-packaged-archive.mjs'

test('creates one portable root and its detached checksum', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-archive-test-'))
  try {
    const source = join(temporary, 'desktop-prebuilt-darwin-arm64')
    const archive = join(temporary, 'profile.tar')
    await mkdir(source)
    await writeFile(join(source, 'prebuilt-profile.json'), '{}\n')
    const result = await createPackagedArchive(source, archive, 'prebuilt-profile.tar')
    assert.equal(result.digest, await sha256File(archive))
    assert.equal(await readFile(`${archive}.sha256`, 'utf8'), `${result.digest}  prebuilt-profile.tar\n`)
    const paths = []
    await list({ file: archive, onReadEntry: entry => paths.push(entry.path) })
    assert.deepEqual(paths, ['desktop-prebuilt-darwin-arm64/', 'desktop-prebuilt-darwin-arm64/prebuilt-profile.json'])
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('rejects an unrecognized archive source root', async () => {
  await assert.rejects(createPackagedArchive('/tmp/unowned-profile', '/tmp/unowned-profile.tar'), /invalid source root/u)
})

test('rejects an unsafe installed resource name', async () => {
  await assert.rejects(createPackagedArchive('/tmp/desktop-prebuilt-linux-x64', '/tmp/profile.tar', '../profile.tar'), /invalid installed name/u)
})

for (const kind of ['relative escape', 'absolute', 'dangling', 'chained escape']) {
  test(`archive rejects ${kind} links before replacing an existing archive or digest`, async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'dsh-archive-links-'))
    const source = join(temporary, 'desktop-runtime-darwin-arm64')
    const archive = join(temporary, 'runtime.tar')
    try {
      await mkdir(join(source, 'node_modules/deep'), { recursive: true })
      await mkdir(join(temporary, 'external'))
      await writeFile(archive, 'previous qualified archive')
      await writeFile(`${archive}.sha256`, 'previous checksum')
      const link = join(source, 'node_modules/deep/resource')
      if (kind === 'relative escape') await symlink('../../../external', link, 'dir')
      if (kind === 'absolute') await symlink(join(temporary, 'external'), link, 'dir')
      if (kind === 'dangling') await symlink('missing', link)
      if (kind === 'chained escape') {
        await symlink('../external', join(source, 'bridge'), 'dir')
        await symlink('../../bridge', link, 'dir')
      }
      await assert.rejects(createPackagedArchive(source, archive), /(?:unsafe|escaping|unresolved) symlink/u)
      assert.equal(await readFile(archive, 'utf8'), 'previous qualified archive')
      assert.equal(await readFile(`${archive}.sha256`, 'utf8'), 'previous checksum')
    } finally { await rm(temporary, { recursive: true, force: true }) }
  })
}

test('whole-tree guard accepts internal relative executable links', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-archive-links-'))
  try {
    const source = join(temporary, 'desktop-runtime-darwin-arm64')
    await mkdir(join(source, 'package-runtime/bin'), { recursive: true })
    await mkdir(join(source, 'package-runtime/lib'), { recursive: true })
    await writeFile(join(source, 'package-runtime/lib/pnpm.mjs'), 'runtime script')
    await symlink('../lib/pnpm.mjs', join(source, 'package-runtime/bin/pnpm'))
    await verifyPackagedTreeLinks(source)
  } finally { await rm(temporary, { recursive: true, force: true }) }
})

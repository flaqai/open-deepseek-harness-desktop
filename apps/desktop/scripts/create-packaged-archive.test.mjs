import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { list } from 'tar'
import { createPackagedArchive, sha256File } from './create-packaged-archive.mjs'

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

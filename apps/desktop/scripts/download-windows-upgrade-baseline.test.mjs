import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { downloadVerifiedAsset, WINDOWS_UPGRADE_BASELINE } from './download-windows-upgrade-baseline.mjs'

const bytes = Buffer.from('verified public installer fixture')
const fixture = { url: WINDOWS_UPGRADE_BASELINE.url, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }

test('writes only exact asset bytes and rejects replacement or truncated downloads', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-baseline-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const destination = join(directory, 'installer.exe')
  await downloadVerifiedAsset(fixture, destination, { fetch: async () => new Response(bytes) })
  assert.deepEqual(await readFile(destination), bytes)
  for (const [name, content] of [['truncated', bytes.subarray(1)], ['replacement', Buffer.alloc(bytes.length)], ['oversized', Buffer.concat([bytes, bytes])]]) {
    const rejected = join(directory, `${name}.exe`)
    await assert.rejects(downloadVerifiedAsset(fixture, rejected, { fetch: async () => new Response(content) }), /size|SHA-256/u)
    await assert.rejects(readFile(rejected), { code: 'ENOENT' })
  }
})

test('HTTP failure never creates a file and an existing destination is preserved', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-baseline-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const destination = join(directory, 'installer.exe')
  await assert.rejects(downloadVerifiedAsset(fixture, destination, { fetch: async () => new Response('', { status: 404 }) }), /HTTP 404/u)
  await assert.rejects(readFile(destination), { code: 'ENOENT' })
  await writeFile(destination, 'existing')
  await assert.rejects(downloadVerifiedAsset(fixture, destination, { fetch: async () => new Response(bytes) }), { code: 'EEXIST' })
  assert.equal(await readFile(destination, 'utf8'), 'existing')
})

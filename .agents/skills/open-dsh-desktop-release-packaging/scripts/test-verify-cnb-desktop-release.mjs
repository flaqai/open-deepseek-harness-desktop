#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { INSTALLER_NAMES, verifyCnbDesktopRelease } from './verify-cnb-desktop-release.mjs'

const directory = await mkdtemp(join(tmpdir(), 'odsh-cnb-verify-'))
const metadataDirectory = await mkdtemp(join(tmpdir(), 'odsh-cnb-metadata-'))
await mkdir(directory, { recursive: true })
const assets = []
const checksums = []
const tag = 'odsh-v0.1.5-rc.9'
for (const name of INSTALLER_NAMES) {
  const bytes = Buffer.from(`fixture for ${name}\n`)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  await writeFile(join(directory, name), bytes)
  checksums.push(`${sha256}  ${name}`)
  assets.push({ name, size: bytes.byteLength, sha256,
    url: `https://cnb.cool/hecoococ/open-deepseek-harness-desktop/-/releases/download/${tag}/${name}` })
}
await writeFile(join(directory, 'SHA256SUMS'), `${checksums.join('\n')}\n`)
const version = tag.replace(/^odsh-v/u, '')
const metadata = new Map([
  [`workspace-runtimes-${version}.v2.json`, Buffer.from('{"schemaVersion":2}\n')],
  ['workspace-runtimes.v2.sigstore.json', Buffer.from('{"bundle":true}\n')],
])
for (const [name, bytes] of metadata) await writeFile(join(metadataDirectory, name), bytes)

const index = { schema: 'open-dsh-desktop/cnb-update-index/v1', revision: 39,
  generatedAt: '2026-09-17T01:00:00.000Z', expiresAt: '2026-09-17T07:00:00.000Z',
  releases: [{ version: '0.1.5-rc.9', tagName: tag, publishedAt: '2026-09-17T00:00:00Z',
    releaseUrl: `https://cnb.cool/hecoococ/open-deepseek-harness-desktop/-/releases/tag/${tag}`,
    withdrawn: false, assets }] }
const fetchImpl = async (input, init) => {
  const url = String(input)
  if (init?.method === 'HEAD') {
    const asset = assets.find(candidate => candidate.url === url)
    return asset === undefined ? new Response(null, { status: 404 }) : new Response(null,
      { status: 200, headers: { 'content-length': String(asset.size) } })
  }
  for (const [name, bytes] of metadata) {
    if (url.endsWith(`/${name}`)) return new Response(bytes)
  }
  return Response.json(index)
}

const verified = await verifyCnbDesktopRelease({ tag, releaseDirectory: directory, metadataDirectory, fetchImpl,
  now: new Date('2026-09-17T02:00:00.000Z') })
assert.equal(verified.revision, 39)
assert.equal(verified.assets.length, 8)
assert.equal(verified.metadata.length, 2)

await assert.rejects(verifyCnbDesktopRelease({ tag, releaseDirectory: directory, fetchImpl,
  now: new Date('2026-09-17T08:00:00.000Z') }), /expired/u)

const wrongIndexFetch = async (input, init) => {
  if (init?.method === 'HEAD') return await fetchImpl(input, init)
  return Response.json({ ...index, releases: [{ ...index.releases[0], assets: index.releases[0].assets.map((asset, position) =>
    position === 0 ? { ...asset, size: asset.size + 1 } : asset) }] })
}
await assert.rejects(verifyCnbDesktopRelease({ tag, releaseDirectory: directory, fetchImpl: wrongIndexFetch,
  now: new Date('2026-09-17T02:00:00.000Z') }), /index identity mismatch/u)

const wrongMetadataFetch = async (input, init) => {
  if (String(input).endsWith('/workspace-runtimes.v2.sigstore.json')) return new Response('changed')
  return await fetchImpl(input, init)
}
await assert.rejects(verifyCnbDesktopRelease({ tag, releaseDirectory: directory, metadataDirectory,
  fetchImpl: wrongMetadataFetch, now: new Date('2026-09-17T02:00:00.000Z') }), /metadata identity mismatch/u)

const zipName = 'DeepSeek-Harness-windows-x64.zip'
await rm(join(directory, zipName))
await assert.rejects(verifyCnbDesktopRelease({ tag, releaseDirectory: directory, fetchImpl,
  now: new Date('2026-09-17T02:00:00.000Z') }), /SHA256SUMS/u)
assets.splice(assets.findIndex(asset => asset.name === zipName), 1)
await writeFile(join(directory, 'SHA256SUMS'), checksums.filter(line => !line.endsWith(zipName)).join('\n') + '\n')
const legacy = await verifyCnbDesktopRelease({ tag, releaseDirectory: directory, fetchImpl,
  now: new Date('2026-09-17T02:00:00.000Z') })
assert.equal(legacy.assets.length, 7)
await rm(directory, { recursive: true, force: true })
await rm(metadataDirectory, { recursive: true, force: true })
console.log('verify-cnb-desktop-release tests passed')

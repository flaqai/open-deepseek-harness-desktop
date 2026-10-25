#!/usr/bin/env node

/** Verify that one anonymous CNB index entry and its downloads match a local desktop Release set. */

import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const CNB_REPOSITORY = 'hecoococ/open-deepseek-harness-desktop'
export const CNB_UPDATE_INDEX_URL = `https://cnb.cool/${CNB_REPOSITORY}/-/git/raw/master/desktop-update-v1.json`
export const INSTALLER_NAMES = Object.freeze([
  'DeepSeek-Harness-linux-x64.deb',
  'DeepSeek-Harness-linux-x64.rpm',
  'DeepSeek-Harness-macos-arm64.dmg',
  'DeepSeek-Harness-macos-arm64.zip',
  'DeepSeek-Harness-macos-x64.dmg',
  'DeepSeek-Harness-macos-x64.zip',
  'DeepSeek-Harness-windows-x64.exe',
  'DeepSeek-Harness-windows-x64.zip',
])

function parseChecksums(source) {
  const checksums = new Map()
  for (const line of source.split(/\r?\n/u)) {
    const match = /^([0-9a-f]{64})\s+\*?([^/\\]+)$/u.exec(line.trim())
    if (match !== null) checksums.set(match[2], match[1])
  }
  return checksums
}

async function checkedFetch(fetchImpl, url, init) {
  const response = await fetchImpl(url, init)
  if (!response.ok) throw new Error(`${new URL(url).hostname} request returned HTTP ${response.status}`)
  return response
}

/**
 * Verify one published CNB desktop Release without credentials.
 * @param {{ tag: string; releaseDirectory: string; metadataDirectory?: string; indexUrl?: string; fetchImpl?: typeof fetch; now?: Date }} options Verification inputs.
 * @returns {Promise<{ revision: number; generatedAt: string; expiresAt: string; releaseUrl: string; assets: Array<{ name: string; size: number; sha256: string; url: string }>; metadata: Array<{ name: string; size: number; sha256: string; url: string }> }>} Verified public identity.
 */
export async function verifyCnbDesktopRelease({ tag, releaseDirectory, metadataDirectory, indexUrl = CNB_UPDATE_INDEX_URL,
  fetchImpl = fetch, now = new Date() }) {
  if (!/^odsh-v[0-9A-Za-z][0-9A-Za-z._-]*$/u.test(tag)) throw new Error(`invalid desktop Release tag: ${tag}`)
  const expectedVersion = tag.replace(/^odsh-v/u, '')
  const resolvedDirectory = resolve(releaseDirectory)
  const entries = (await readdir(resolvedDirectory)).sort()
  const installerNames = entries.includes('DeepSeek-Harness-windows-x64.zip')
    ? INSTALLER_NAMES : INSTALLER_NAMES.filter(name => !name.endsWith('windows-x64.zip'))
  const expectedEntries = [...installerNames, 'SHA256SUMS'].sort()
  if (JSON.stringify(entries) !== JSON.stringify(expectedEntries)) {
    throw new Error('local release directory must contain the exact current or historical installer set and SHA256SUMS')
  }
  const checksums = parseChecksums(await readFile(resolve(resolvedDirectory, 'SHA256SUMS'), 'utf8'))
  if (checksums.size !== installerNames.length || installerNames.some(name => !checksums.has(name))) {
    throw new Error('local SHA256SUMS does not describe exactly the local installers')
  }

  const indexResponse = await checkedFetch(fetchImpl, indexUrl, { redirect: 'follow', headers: { Accept: 'application/json' } })
  const index = await indexResponse.json()
  if (index?.schema !== 'open-dsh-desktop/cnb-update-index/v1') throw new Error('CNB update index schema is unsupported')
  if (!Number.isSafeInteger(index.revision) || index.revision < 1) throw new Error('CNB update index revision is invalid')
  const generatedAt = Date.parse(index.generatedAt)
  const expiresAt = Date.parse(index.expiresAt)
  if (!Number.isFinite(generatedAt) || !Number.isFinite(expiresAt) || expiresAt <= generatedAt) {
    throw new Error('CNB update index timestamps are invalid')
  }
  if (expiresAt <= now.getTime()) throw new Error(`CNB update index expired at ${index.expiresAt}`)
  const matches = Array.isArray(index.releases) ? index.releases.filter(release => release?.tagName === tag) : []
  if (matches.length !== 1) throw new Error(`CNB update index must contain exactly one entry for ${tag}`)
  const [release] = matches
  if (release.version !== expectedVersion) throw new Error(`CNB version does not match ${tag}`)
  if (release.withdrawn !== false) throw new Error(`CNB Release is withdrawn: ${tag}`)
  const expectedReleaseUrl = `https://cnb.cool/${CNB_REPOSITORY}/-/releases/tag/${tag}`
  if (release.releaseUrl !== expectedReleaseUrl) throw new Error(`CNB Release URL does not match ${tag}`)
  if (!Array.isArray(release.assets) || release.assets.length !== installerNames.length) {
    throw new Error(`CNB Release does not contain the exact indexed installer set: ${tag}`)
  }

  const indexedNames = release.assets.map(asset => asset?.name).sort()
  if (JSON.stringify(indexedNames) !== JSON.stringify([...installerNames].sort())) {
    throw new Error(`CNB indexed installer names do not match the local Release: ${tag}`)
  }
  const verifiedAssets = []
  for (const name of installerNames) {
    const localPath = resolve(resolvedDirectory, name)
    const bytes = await readFile(localPath)
    const localSize = (await stat(localPath)).size
    const localSha256 = createHash('sha256').update(bytes).digest('hex')
    if (checksums.get(name) !== localSha256) throw new Error(`local checksum mismatch for ${name}`)
    const asset = release.assets.find(candidate => candidate.name === name)
    const expectedUrl = `https://cnb.cool/${CNB_REPOSITORY}/-/releases/download/${tag}/${name}`
    if (asset.size !== localSize || asset.sha256 !== localSha256 || asset.url !== expectedUrl) {
      throw new Error(`CNB index identity mismatch for ${name}`)
    }
    const response = await checkedFetch(fetchImpl, asset.url, { method: 'HEAD', redirect: 'follow' })
    const remoteSize = Number(response.headers.get('content-length'))
    if (!Number.isSafeInteger(remoteSize) || remoteSize !== localSize) {
      throw new Error(`CNB anonymous download size mismatch for ${name}`)
    }
    verifiedAssets.push({ name, size: localSize, sha256: localSha256, url: asset.url })
  }
  const verifiedMetadata = []
  if (metadataDirectory !== undefined) {
    const resolvedMetadata = resolve(metadataDirectory)
    const metadataNames = [`workspace-runtimes-${expectedVersion}.v2.json`, 'workspace-runtimes.v2.sigstore.json']
    const metadataEntries = (await readdir(resolvedMetadata)).sort()
    if (JSON.stringify(metadataEntries) !== JSON.stringify([...metadataNames].sort())) {
      throw new Error('local metadata directory must contain exactly the runtime catalog and Sigstore bundle')
    }
    for (const name of metadataNames) {
      const localBytes = await readFile(resolve(resolvedMetadata, name))
      const localSha256 = createHash('sha256').update(localBytes).digest('hex')
      const url = `https://cnb.cool/${CNB_REPOSITORY}/-/releases/download/${tag}/${name}`
      const response = await checkedFetch(fetchImpl, url, { redirect: 'follow' })
      const remoteBytes = Buffer.from(await response.arrayBuffer())
      const remoteSha256 = createHash('sha256').update(remoteBytes).digest('hex')
      if (remoteBytes.byteLength !== localBytes.byteLength || remoteSha256 !== localSha256) {
        throw new Error(`CNB runtime metadata identity mismatch for ${name}`)
      }
      verifiedMetadata.push({ name, size: localBytes.byteLength, sha256: localSha256, url })
    }
  }
  return { revision: index.revision, generatedAt: index.generatedAt, expiresAt: index.expiresAt,
    releaseUrl: release.releaseUrl, assets: verifiedAssets, metadata: verifiedMetadata }
}

function usage() {
  console.error('usage: verify-cnb-desktop-release.mjs <tag> <release-directory> [--metadata-directory <directory>] [--index-url <url>]')
  process.exit(2)
}

async function main() {
  const [tag, releaseDirectory, ...rest] = process.argv.slice(2)
  if (tag === undefined || releaseDirectory === undefined) usage()
  let metadataDirectory
  let indexUrl = CNB_UPDATE_INDEX_URL
  while (rest.length > 0) {
    const option = rest.shift()
    const value = rest.shift()
    if (value === undefined) usage()
    if (option === '--metadata-directory') metadataDirectory = value
    else if (option === '--index-url') indexUrl = value
    else usage()
  }
  const result = await verifyCnbDesktopRelease({ tag, releaseDirectory, metadataDirectory, indexUrl })
  console.log(`CNB Release verified: ${tag}`)
  console.log(`  index revision: ${result.revision}`)
  console.log(`  generated: ${result.generatedAt}`)
  console.log(`  expires: ${result.expiresAt}`)
  for (const asset of result.assets) console.log(`  ${asset.name}: ${asset.size} bytes, sha256:${asset.sha256}`)
  for (const asset of result.metadata) console.log(`  ${asset.name}: ${asset.size} bytes, sha256:${asset.sha256}`)
  console.log(`  Release: ${result.releaseUrl}`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) await main()

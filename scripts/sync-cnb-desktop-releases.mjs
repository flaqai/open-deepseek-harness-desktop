#!/usr/bin/env node

/** Mirror distributable GitHub installers to CNB and emit the anonymous update index. */

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const GITHUB_REPOSITORY = 'flaqai/open-deepseek-harness-desktop'
export const CNB_REPOSITORY = 'hecoococ/open-deepseek-harness-desktop'
export const CNB_DEFAULT_BRANCH = 'master'
const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPOSITORY}`
const CNB_API = `https://api.cnb.cool/${CNB_REPOSITORY}`
const ASSET_PATTERN = /^DeepSeek-Harness-(?:macos-(?:arm64|x64)\.(?:dmg|zip)|windows-x64\.exe|linux-x64\.(?:deb|rpm))$/u
const RELEASE_TAG_PATTERN = /^odsh-v[0-9A-Za-z][0-9A-Za-z._-]*$/u

export function parseChecksums(source) {
  const checksums = new Map()
  for (const line of source.split(/\r?\n/u)) {
    const match = /^([0-9a-fA-F]{64})\s+\*?([^/\\]+)$/u.exec(line.trim())
    if (match !== null) checksums.set(match[2], match[1].toLowerCase())
  }
  return checksums
}

export function distributableGithubReleases(releases) {
  return releases.filter(release => release?.draft === false && release?.prerelease === false
    && typeof release.tag_name === 'string' && typeof release.published_at === 'string'
    && Array.isArray(release.assets))
}

function headers(token, accept = 'application/json') {
  return { Accept: accept, Authorization: `Bearer ${token}`, 'User-Agent': 'Open-DSH-CNB-Sync', 'X-GitHub-Api-Version': '2022-11-28' }
}

async function checkedFetch(fetchImpl, url, init, expected = [200]) {
  const response = await fetchImpl(url, init)
  if (!expected.includes(response.status)) throw new Error(`${new URL(url).hostname} request returned HTTP ${response.status}`)
  return response
}

async function githubJson(fetchImpl, token, path) {
  return await (await checkedFetch(fetchImpl, `${GITHUB_API}${path}`, { headers: headers(token) })).json()
}

async function cnbJson(fetchImpl, token, path, init = {}, expected = [200]) {
  const response = await checkedFetch(fetchImpl, `${CNB_API}${path}`, {
    ...init, headers: { ...headers(token, 'application/vnd.cnb.api+json'), ...(init.headers ?? {}) },
  }, expected)
  return response.status === 204 ? undefined : await response.json()
}

async function assetBytes(fetchImpl, token, asset) {
  const response = await checkedFetch(fetchImpl, asset.url, {
    headers: headers(token, 'application/octet-stream'), redirect: 'follow',
  })
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!Number.isSafeInteger(asset.size) || bytes.byteLength !== asset.size) throw new Error(`GitHub asset size mismatch for ${asset.name}`)
  return bytes
}

async function ensureCnbRelease(fetchImpl, token, releases, githubRelease) {
  const existing = releases.find(release => release.tag_name === githubRelease.tag_name)
  if (existing !== undefined) return existing
  const created = await cnbJson(fetchImpl, token, '/-/releases', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag_name: githubRelease.tag_name, name: githubRelease.name || githubRelease.tag_name,
      body: githubRelease.body || '', draft: false, prerelease: false, make_latest: 'legacy', target_commitish: CNB_DEFAULT_BRANCH }),
  }, [201])
  releases.push(created)
  return created
}

async function deleteCnbReleases(fetchImpl, token, releases, tags, targetTag) {
  for (const tag of tags) {
    if (!RELEASE_TAG_PATTERN.test(tag)) throw new Error(`invalid CNB cleanup tag: ${tag}`)
    if (tag === targetTag) throw new Error(`refusing to delete the target CNB Release: ${tag}`)
    const release = releases.find(candidate => candidate.tag_name === tag)
    if (release === undefined) continue
    await cnbJson(fetchImpl, token, `/-/releases/${encodeURIComponent(release.id)}`, { method: 'DELETE' }, [200, 204])
    releases.splice(releases.indexOf(release), 1)
  }
}

async function uploadCnbAsset(fetchImpl, token, release, name, bytes, checksum) {
  const same = release.assets?.find(asset => asset.name === name && asset.size === bytes.byteLength
    && String(asset.hash_algo).toLowerCase() === 'sha256' && String(asset.hash_value).toLowerCase() === checksum)
  if (same !== undefined) return same
  const ticket = await cnbJson(fetchImpl, token, `/-/releases/${encodeURIComponent(release.id)}/asset-upload-url`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ asset_name: name, overwrite: true, size: bytes.byteLength, ttl: 0 }),
  }, [201])
  if (typeof ticket?.upload_url !== 'string' || typeof ticket?.verify_url !== 'string') throw new Error('CNB returned an invalid asset upload ticket')
  await checkedFetch(fetchImpl, ticket.upload_url, { method: 'PUT', body: bytes }, [200, 201, 204])
  const verify = new URL(ticket.verify_url)
  if (verify.protocol !== 'https:' || verify.hostname !== 'api.cnb.cool' || !verify.pathname.startsWith(`/${CNB_REPOSITORY}/-/releases/`)) {
    throw new Error('CNB returned an invalid asset confirmation URL')
  }
  await checkedFetch(fetchImpl, `${verify.href}${verify.search === '' ? '?' : '&'}ttl=0`, {
    method: 'POST', headers: headers(token, 'application/vnd.cnb.api+json'),
  })
  return { name, size: bytes.byteLength, hash_algo: 'sha256', hash_value: checksum }
}

export async function syncCnbDesktopReleases({ githubToken, cnbToken, outputPath, targetTag, cleanupTags = [], fetchImpl = fetch, now = new Date() }) {
  if (!githubToken || !cnbToken) throw new Error('GITHUB_TOKEN and CNB_TOKEN are required')
  if (targetTag !== undefined && !RELEASE_TAG_PATTERN.test(targetTag)) throw new Error(`invalid target GitHub Release tag: ${targetTag}`)
  const githubRelease = await githubJson(fetchImpl, githubToken,
    targetTag === undefined ? '/releases/latest' : `/releases/tags/${encodeURIComponent(targetTag)}`)
  const [distributableRelease] = distributableGithubReleases([githubRelease])
  if (distributableRelease === undefined) throw new Error(`GitHub Release is not distributable: ${targetTag ?? 'latest'}`)
  const cnbReleases = await cnbJson(fetchImpl, cnbToken, '/-/releases?page=1&page_size=100')
  await deleteCnbReleases(fetchImpl, cnbToken, cnbReleases, cleanupTags, distributableRelease.tag_name)
  const checksumAsset = distributableRelease.assets.find(asset => asset.name === 'SHA256SUMS')
  if (checksumAsset === undefined) throw new Error(`GitHub Release has no SHA256SUMS: ${distributableRelease.tag_name}`)
  const checksumBytes = await assetBytes(fetchImpl, githubToken, checksumAsset)
  if (checksumBytes.byteLength > 1024 * 1024) throw new Error(`SHA256SUMS is too large for ${distributableRelease.tag_name}`)
  const checksums = parseChecksums(checksumBytes.toString('utf8'))
  const installers = distributableRelease.assets.filter(asset => ASSET_PATTERN.test(asset.name) && checksums.has(asset.name))
  if (installers.length === 0) throw new Error(`GitHub Release has no verified installers: ${distributableRelease.tag_name}`)
  const cnbRelease = await ensureCnbRelease(fetchImpl, cnbToken, cnbReleases, distributableRelease)
  const assets = []
  for (const asset of installers) {
    const bytes = await assetBytes(fetchImpl, githubToken, asset)
    const checksum = checksums.get(asset.name)
    if (createHash('sha256').update(bytes).digest('hex') !== checksum) throw new Error(`GitHub checksum mismatch for ${asset.name}`)
    await uploadCnbAsset(fetchImpl, cnbToken, cnbRelease, asset.name, bytes, checksum)
    const url = `https://cnb.cool/${CNB_REPOSITORY}/-/releases/download/${distributableRelease.tag_name}/${asset.name}`
    const probe = await checkedFetch(fetchImpl, url, { method: 'HEAD', redirect: 'follow' })
    const size = Number(probe.headers.get('content-length'))
    if (Number.isFinite(size) && size !== bytes.byteLength) throw new Error(`CNB asset size mismatch for ${asset.name}`)
    assets.push({ name: asset.name, size: bytes.byteLength, sha256: checksum, url })
  }
  const version = distributableRelease.tag_name.replace(/^(?:odsh-|dsh-)?v/u, '')
  const indexReleases = [{ version, tagName: distributableRelease.tag_name, publishedAt: distributableRelease.published_at,
    releaseUrl: `https://cnb.cool/${CNB_REPOSITORY}/-/releases/tag/${distributableRelease.tag_name}`, withdrawn: false, assets }]
  const previous = await readFile(outputPath, 'utf8').then(JSON.parse).catch(() => undefined)
  const index = { schema: 'open-dsh-desktop/cnb-update-index/v1', revision: Number(previous?.revision ?? 0) + 1,
    generatedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 2 * 60 * 60_000).toISOString(), releases: indexReleases }
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(index, null, 2)}\n`)
  return index
}

async function main() {
  const output = resolve(process.argv[2] ?? '.artifacts/cnb-sync/desktop-update-v1.json')
  const targetTag = process.env.CNB_TARGET_TAG?.trim() || undefined
  const cleanupTags = (process.env.CNB_DELETE_TAGS ?? '').split(',').map(tag => tag.trim()).filter(Boolean)
  await syncCnbDesktopReleases({ githubToken: process.env.GITHUB_TOKEN, cnbToken: process.env.CNB_TOKEN,
    outputPath: output, targetTag, cleanupTags })
  console.log(`CNB desktop update index written to ${output}`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) await main()

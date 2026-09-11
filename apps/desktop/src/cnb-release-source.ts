/** Validated anonymous CNB update index used independently from GitHub. */

import { compareDesktopVersions, type DesktopReleaseStatus } from './release-checker.ts'
import type { ReleaseFetch } from './release-downloader.ts'

export const CNB_REPOSITORY = 'hecoococ/open-deepseek-harness-desktop'
export const CNB_DEFAULT_BRANCH = 'master'
export const CNB_UPDATE_INDEX_URL = `https://cnb.cool/${CNB_REPOSITORY}/-/git/raw/${CNB_DEFAULT_BRANCH}/desktop-update-v1.json`
const CNB_RELEASE_PREFIX = `/${CNB_REPOSITORY}/-/releases/`
const MAX_INDEX_BYTES = 1024 * 1024
const DEFAULT_TIMEOUT_MS = 15_000

export interface CnbReleaseAsset {
  name: string
  size: number
  sha256: string
  url: string
}

export interface CnbReleaseEntry {
  version: string
  tagName: string
  publishedAt: string
  releaseUrl: string
  withdrawn: boolean
  assets: readonly CnbReleaseAsset[]
}

export interface CnbReleaseIndex {
  schema: 'open-dsh-desktop/cnb-update-index/v1'
  revision: number
  generatedAt: string
  expiresAt: string
  releases: readonly CnbReleaseEntry[]
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

/** Allow only anonymous HTTPS files within the configured CNB repository. */
export function isAllowedCnbUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'cnb.cool'
      && decodeURIComponent(url.pathname).startsWith(CNB_RELEASE_PREFIX)
      && url.username === '' && url.password === '' && url.search === '' && url.hash === ''
  } catch { return false }
}

function parseAsset(raw: unknown, tagName: string): CnbReleaseAsset | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const value = raw as Record<string, unknown>
  if (typeof value.name !== 'string' || !/^[A-Za-z0-9._-]{1,180}$/u.test(value.name)) return undefined
  if (typeof value.size !== 'number' || !Number.isSafeInteger(value.size) || value.size <= 0) return undefined
  if (typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(value.sha256)) return undefined
  if (typeof value.url !== 'string' || !isAllowedCnbUrl(value.url)) return undefined
  const path = decodeURIComponent(new URL(value.url).pathname)
  if (path !== `${CNB_RELEASE_PREFIX}download/${tagName}/${value.name}`) return undefined
  return { name: value.name, size: value.size, sha256: value.sha256, url: value.url }
}

/** Parse and validate the bounded, public CNB update index. */
export function parseCnbReleaseIndex(raw: unknown, now = Date.now()): CnbReleaseIndex {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new TypeError('CNB update index must be an object')
  const source = raw as Record<string, unknown>
  if (source.schema !== 'open-dsh-desktop/cnb-update-index/v1') throw new TypeError('CNB update index schema is unsupported')
  if (!Number.isSafeInteger(source.revision) || Number(source.revision) < 1) throw new TypeError('CNB update index revision is invalid')
  if (!validDate(source.generatedAt) || !validDate(source.expiresAt)) throw new TypeError('CNB update index dates are invalid')
  if (Date.parse(source.expiresAt) <= now) throw new Error('CNB update index has expired')
  if (Date.parse(source.generatedAt) > now + 5 * 60_000) throw new Error('CNB update index was generated in the future')
  if (!Array.isArray(source.releases)) throw new TypeError('CNB update index releases are invalid')
  const releases = source.releases.map((rawRelease): CnbReleaseEntry => {
    if (typeof rawRelease !== 'object' || rawRelease === null || Array.isArray(rawRelease)) throw new TypeError('CNB Release entry is invalid')
    const release = rawRelease as Record<string, unknown>
    if (typeof release.version !== 'string' || compareDesktopVersions(release.version, release.version) === undefined) throw new TypeError('CNB Release version is invalid')
    if (typeof release.tagName !== 'string' || !/^(?:odsh-|dsh-)?v[0-9A-Za-z.-]+$/u.test(release.tagName)) throw new TypeError('CNB Release tag is invalid')
    if (release.tagName.replace(/^(?:odsh-|dsh-)?v/u, '') !== release.version) throw new TypeError('CNB Release tag does not match its version')
    if (!validDate(release.publishedAt) || typeof release.releaseUrl !== 'string' || !isAllowedCnbUrl(release.releaseUrl)) throw new TypeError('CNB Release metadata is invalid')
    if (decodeURIComponent(new URL(release.releaseUrl).pathname) !== `${CNB_RELEASE_PREFIX}tag/${release.tagName}`) throw new TypeError('CNB Release URL does not match its tag')
    if (typeof release.withdrawn !== 'boolean' || !Array.isArray(release.assets)) throw new TypeError('CNB Release state is invalid')
    const assets = release.assets.map(asset => parseAsset(asset, release.tagName as string))
    if (assets.some(asset => asset === undefined)) throw new TypeError('CNB Release asset is invalid')
    return { version: release.version, tagName: release.tagName, publishedAt: release.publishedAt,
      releaseUrl: release.releaseUrl, withdrawn: release.withdrawn, assets: assets as CnbReleaseAsset[] }
  })
  return { schema: source.schema, revision: Number(source.revision), generatedAt: source.generatedAt,
    expiresAt: source.expiresAt, releases }
}

/** Download one current CNB index with a bounded body and deadline. */
export async function fetchCnbReleaseIndex(fetchImpl: ReleaseFetch = fetch, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<CnbReleaseIndex> {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, timeoutMs)
  try {
    const response = await fetchImpl(CNB_UPDATE_INDEX_URL, {
      headers: { Accept: 'application/json', 'User-Agent': 'DeepSeek-Harness-Desktop' }, signal: controller.signal,
    })
    if (!response.ok) throw new Error(`CNB update index returned HTTP ${response.status}`)
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_INDEX_BYTES) throw new Error('CNB update index is too large')
    const body = await response.text()
    if (Buffer.byteLength(body) > MAX_INDEX_BYTES) throw new Error('CNB update index is too large')
    return parseCnbReleaseIndex(JSON.parse(body) as unknown)
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`CNB update index request timed out after ${Math.ceil(timeoutMs / 1_000)} seconds`)
    throw error
  } finally { clearTimeout(timer) }
}

/** Select the newest non-withdrawn CNB entry for the installed channel. */
export function selectCnbRelease(currentVersion: string, index: CnbReleaseIndex): DesktopReleaseStatus {
  const currentIsPrerelease = currentVersion.includes('-')
  const newest = index.releases
    .filter(entry => !entry.withdrawn && (currentIsPrerelease || !entry.version.includes('-')))
    .sort((a, b) => compareDesktopVersions(b.version, a.version) ?? 0)[0]
  if (newest === undefined || (compareDesktopVersions(newest.version, currentVersion) ?? 0) <= 0) return { phase: 'current', currentVersion }
  return { phase: 'available', currentVersion, latestVersion: newest.version, tagName: newest.tagName,
    publishedAt: newest.publishedAt, releaseUrl: newest.releaseUrl, source: 'cnb' }
}

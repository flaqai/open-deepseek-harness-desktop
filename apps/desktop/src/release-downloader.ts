/** Verified download and system-assisted opening of desktop Release installers. */

import { createHash } from 'node:crypto'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { DesktopReleaseStatus } from './release-checker.ts'

const REPOSITORY = 'flaqai/open-deepseek-harness-desktop'
const API_RELEASE_PREFIX = `https://api.github.com/repos/${REPOSITORY}/releases/tags/`
const RELEASE_DOWNLOAD_PREFIX = `/${REPOSITORY}/releases/download/`
const CHECKSUM_ASSET = 'SHA256SUMS'
const MAX_CHECKSUM_BYTES = 1024 * 1024

/** Accept only the tag families recognized by Release discovery for this exact version. */
export function isAllowedReleaseTag(tag: string, version: string): boolean {
  return tag === `odsh-v${version}` || tag === `dsh-v${version}` || tag === `v${version}`
}

/** Renderer-visible installer download state. */
export type DesktopReleaseDownloadStatus =
  | { phase: 'unsupported' }
  | { phase: 'idle' }
  | { phase: 'resolving'; version: string }
  | {
    phase: 'downloading'
    version: string
    fileName: string
    transferredBytes: number
    totalBytes: number
    percent: number
  }
  | { phase: 'verifying'; version: string; fileName: string }
  | { phase: 'ready'; version: string; fileName: string }
  | { phase: 'cancelled'; version: string }
  | { phase: 'error'; version?: string; message: string }

interface GitHubReleaseAsset {
  name?: unknown
  size?: unknown
  digest?: unknown
  browser_download_url?: unknown
}

interface GitHubReleaseDetails {
  draft?: unknown
  prerelease?: unknown
  tag_name?: unknown
  assets?: unknown
}

interface ReleaseAsset {
  name: string
  size: number
  url: string
  sha256?: string
}

interface DesktopReleaseDownloaderOptions {
  platform: NodeJS.Platform
  arch: string
  downloadDirectory: string
  getRelease(): DesktopReleaseStatus
  openPath(path: string): Promise<string>
  fetch?: typeof fetch
}

/** Resolve the single installer format that the desktop can open safely. */
export function installerAssetName(platform: NodeJS.Platform, arch: string): string | undefined {
  if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) {
    return `DeepSeek-Harness-macos-${arch}.dmg`
  }
  if (platform === 'win32' && arch === 'x64') return 'DeepSeek-Harness-windows-x64.exe'
  return undefined
}

/** Validate one immutable Release asset URL before downloading it. */
export function isAllowedReleaseAssetUrl(value: string, tag: string, fileName: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && url.hostname === 'github.com'
      && decodeURIComponent(url.pathname) === `${RELEASE_DOWNLOAD_PREFIX}${tag}/${fileName}`
      && url.search === ''
      && url.hash === ''
  } catch {
    return false
  }
}

/** Parse the exact SHA-256 entry for an installer filename. */
export function readReleaseChecksum(content: string, fileName: string): string | undefined {
  for (const line of content.split(/\r?\n/u)) {
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+)$/u.exec(line.trim())
    const checksum = match?.[1]
    if (checksum !== undefined && match?.[2] === fileName) return checksum.toLowerCase()
  }
  return undefined
}

function parseAsset(value: GitHubReleaseAsset, tag: string, expectedName: string): ReleaseAsset | undefined {
  if (value.name !== expectedName || typeof value.browser_download_url !== 'string') return undefined
  if (typeof value.size !== 'number' || !Number.isSafeInteger(value.size) || value.size <= 0) return undefined
  if (!isAllowedReleaseAssetUrl(value.browser_download_url, tag, expectedName)) return undefined
  const digest = typeof value.digest === 'string' ? /^sha256:([0-9a-fA-F]{64})$/u.exec(value.digest) : null
  return {
    name: expectedName,
    size: value.size,
    url: value.browser_download_url,
    ...(digest?.[1] === undefined ? {} : { sha256: digest[1].toLowerCase() }),
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/** Download, verify, and open the current platform's installer without replacing the application. */
export class DesktopReleaseDownloader {
  #status: DesktopReleaseDownloadStatus
  #running: Promise<DesktopReleaseDownloadStatus> | undefined
  #abortController: AbortController | undefined
  #readyPath: string | undefined
  readonly #listeners = new Set<(status: DesktopReleaseDownloadStatus) => void>()
  readonly #fetch: typeof fetch
  readonly #assetName: string | undefined

  constructor(readonly options: DesktopReleaseDownloaderOptions) {
    this.#assetName = installerAssetName(options.platform, options.arch)
    this.#status = this.#assetName === undefined ? { phase: 'unsupported' } : { phase: 'idle' }
    this.#fetch = options.fetch ?? fetch
  }

  get status(): DesktopReleaseDownloadStatus { return this.#status }

  subscribe(listener: (status: DesktopReleaseDownloadStatus) => void): () => void {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  #publish(status: DesktopReleaseDownloadStatus): DesktopReleaseDownloadStatus {
    this.#status = status
    for (const listener of [...this.#listeners]) {
      try { listener(status) } catch (error) { console.error('desktop: Release download listener failed', error) }
    }
    return status
  }

  /** Forget state from another Release while retaining any completed file on disk. */
  resetForRelease(release: DesktopReleaseStatus): void {
    if (this.#running !== undefined || this.#assetName === undefined) return
    if (release.phase === 'idle' || release.phase === 'checking') return
    const statusVersion = 'version' in this.#status ? this.#status.version : undefined
    if (release.phase !== 'available' || (statusVersion !== undefined && statusVersion !== release.latestVersion)) {
      this.#readyPath = undefined
      this.#publish({ phase: 'idle' })
    }
  }

  /** Start or join the current verified installer download. */
  start(): Promise<DesktopReleaseDownloadStatus> {
    if (this.#running !== undefined) return this.#running
    const release = this.options.getRelease()
    if (this.#assetName === undefined) return Promise.resolve(this.#publish({ phase: 'unsupported' }))
    if (release.phase !== 'available') {
      return Promise.resolve(this.#publish({ phase: 'error', message: 'No downloadable Release is currently selected.' }))
    }
    if (this.#status.phase === 'ready' && this.#status.version === release.latestVersion) {
      return Promise.resolve(this.#status)
    }
    const controller = new AbortController()
    this.#abortController = controller
    this.#publish({ phase: 'resolving', version: release.latestVersion })
    this.#running = this.#download(release.latestVersion, release.tagName, this.#assetName, controller.signal)
      .catch((error: unknown) => {
        if (isAbortError(error)) return this.#publish({ phase: 'cancelled', version: release.latestVersion })
        return this.#publish({ phase: 'error', version: release.latestVersion, message: errorMessage(error) })
      })
      .finally(() => {
        this.#running = undefined
        this.#abortController = undefined
      })
    return this.#running
  }

  /** Cancel only the active download owned by this manager. */
  cancel(): DesktopReleaseDownloadStatus {
    this.#abortController?.abort()
    return this.#status
  }

  /** Open a checksum-verified installer through the operating system. */
  async open(): Promise<{ error: string }> {
    if (this.#status.phase !== 'ready' || this.#readyPath === undefined) {
      return { error: 'The installer has not finished downloading.' }
    }
    return { error: await this.options.openPath(this.#readyPath) }
  }

  async #download(
    version: string,
    tag: string,
    fileName: string,
    signal: AbortSignal,
  ): Promise<DesktopReleaseDownloadStatus> {
    if (!isAllowedReleaseTag(tag, version)) throw new Error('Selected Release tag did not match its version.')
    const releaseResponse = await this.#fetch(`${API_RELEASE_PREFIX}${encodeURIComponent(tag)}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'DeepSeek-Harness-Desktop' },
      signal,
    })
    if (!releaseResponse.ok) throw new Error(`GitHub Release returned HTTP ${releaseResponse.status}`)
    const details: unknown = await releaseResponse.json()
    if (details === null || typeof details !== 'object') throw new Error('GitHub Release returned invalid metadata.')
    const releaseDetails = details as GitHubReleaseDetails
    if (releaseDetails.draft === true || releaseDetails.prerelease === true) {
      throw new Error('Release is no longer available for in-app updates.')
    }
    if (releaseDetails.tag_name !== tag || !Array.isArray(releaseDetails.assets)) {
      throw new Error('GitHub Release metadata did not match the selected version.')
    }
    const assets = releaseDetails.assets as GitHubReleaseAsset[]
    const installer = assets.map(asset => parseAsset(asset, tag, fileName)).find(asset => asset !== undefined)
    const checksums = assets.map(asset => parseAsset(asset, tag, CHECKSUM_ASSET)).find(asset => asset !== undefined)
    if (installer === undefined) {
      throw new Error(`Release ${version} does not contain ${fileName}.`)
    }
    let expectedChecksum = installer.sha256
    if (expectedChecksum === undefined && checksums !== undefined) {
      if (checksums.size > MAX_CHECKSUM_BYTES) throw new Error('Release checksum metadata is unexpectedly large.')
      const checksumResponse = await this.#fetch(checksums.url, { signal })
      if (!checksumResponse.ok) throw new Error(`Release checksums returned HTTP ${checksumResponse.status}`)
      const checksumText = await checksumResponse.text()
      if (Buffer.byteLength(checksumText) > MAX_CHECKSUM_BYTES) throw new Error('Release checksum metadata is unexpectedly large.')
      expectedChecksum = readReleaseChecksum(checksumText, fileName)
    }
    if (expectedChecksum === undefined) throw new Error(`Release checksums do not contain ${fileName}.`)

    const versionDirectory = join(this.options.downloadDirectory, version)
    const finalPath = join(versionDirectory, fileName)
    const partialPath = `${finalPath}.part`
    await mkdir(versionDirectory, { recursive: true })
    await rm(partialPath, { force: true })
    let completed = false
    try {
      const response = await this.#fetch(installer.url, { signal })
      if (!response.ok || response.body === null) throw new Error(`Release installer returned HTTP ${response.status}`)
      const file = await open(partialPath, 'wx')
      const reader = response.body.getReader()
      const hash = createHash('sha256')
      let transferredBytes = 0
      let lastPublishedAt = 0
      try {
        while (true) {
          const result = await reader.read()
          if (result.done) break
          signal.throwIfAborted()
          transferredBytes += result.value.byteLength
          if (transferredBytes > installer.size) throw new Error('Release installer exceeded its declared size.')
          hash.update(result.value)
          let offset = 0
          while (offset < result.value.byteLength) {
            const write = await file.write(result.value, offset, result.value.byteLength - offset)
            if (write.bytesWritten === 0) throw new Error('Release installer could not be written to disk.')
            offset += write.bytesWritten
          }
          const now = Date.now()
          if (now - lastPublishedAt >= 100 || transferredBytes === installer.size) {
            lastPublishedAt = now
            this.#publish({
              phase: 'downloading', version, fileName, transferredBytes, totalBytes: installer.size,
              percent: Math.min(100, Math.round((transferredBytes / installer.size) * 1000) / 10),
            })
          }
        }
      } finally {
        await file.close()
      }
      if (transferredBytes !== installer.size) throw new Error('Release installer size did not match its metadata.')
      this.#publish({ phase: 'verifying', version, fileName })
      const actualChecksum = hash.digest('hex')
      if (actualChecksum !== expectedChecksum) throw new Error('Release installer failed SHA-256 verification.')
      await rm(finalPath, { force: true })
      await rename(partialPath, finalPath)
      completed = true
      this.#readyPath = finalPath
      return this.#publish({ phase: 'ready', version, fileName })
    } finally {
      if (!completed) await rm(partialPath, { force: true })
    }
  }
}

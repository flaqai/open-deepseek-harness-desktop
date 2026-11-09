/** Verified, proxy-aware download and system-assisted opening of desktop Release installers. */

import { createHash, type Hash } from 'node:crypto'
import { mkdir, open, rename, rm, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import type { DesktopReleaseStatus } from './release-checker.ts'
import { BackgroundReleaseDownloads } from './background-release-download.ts'
import { fetchCnbReleaseIndex } from './cnb-release-source.ts'

const REPOSITORY = 'flaqai/open-deepseek-harness-desktop'
const API_RELEASE_PREFIX = `https://api.github.com/repos/${REPOSITORY}/releases/tags/`
const RELEASE_DOWNLOAD_PREFIX = `/${REPOSITORY}/releases/download/`
const CHECKSUM_ASSET = 'SHA256SUMS'
const MAX_CHECKSUM_BYTES = 1024 * 1024
const MAX_RELEASE_METADATA_BYTES = 5 * 1024 * 1024
const DEFAULT_HEADER_TIMEOUT_MS = 15_000
const DEFAULT_IDLE_TIMEOUT_MS = 30_000
const CNB_WITHDRAWAL_RECHECK_MS = 60_000
const REQUEST_HEADERS = { 'User-Agent': 'DeepSeek-Harness-Desktop' } as const

/** A fetch-compatible transport owned by the Electron main process. */
export type ReleaseFetch = (input: string | Request, init?: RequestInit) => Promise<Response>

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
    phase: 'switching'
    version: string
    fileName: string
    transferredBytes: number
    totalBytes: number
    resumeFromBytes: number
  }
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
  id?: unknown
  name?: unknown
  size?: unknown
  digest?: unknown
  url?: unknown
  browser_download_url?: unknown
}

interface GitHubReleaseDetails {
  draft?: unknown
  prerelease?: unknown
  tag_name?: unknown
  assets?: unknown
}

interface ReleaseAsset {
  id: number
  name: string
  size: number
  browserUrl: string
  apiUrl: string
  sha256?: string
}

interface DesktopReleaseDownloaderOptions {
  platform: NodeJS.Platform
  arch: string
  downloadDirectory: string
  getRelease(): DesktopReleaseStatus
  openPath(path: string): Promise<string>
  apiFetch?: ReleaseFetch
  systemFetch?: ReleaseFetch
  headerTimeoutMs?: number
  idleTimeoutMs?: number
}

type TransportName = 'system-network' | 'github-api'
type TransportStage = 'headers' | 'body' | 'http'

class ReleaseTransportError extends Error {
  constructor(
    message: string,
    readonly transport: TransportName,
    readonly stage: TransportStage,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'ReleaseTransportError'
  }
}

interface ActiveRequest {
  response: Response
  controller: AbortController
  dispose(): void
}

interface DownloadAccumulator {
  transferredBytes: number
  hash: Hash
  resumeValidator: ResumeValidator | undefined
}

interface ResumeValidator {
  value: string
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

/** Validate a GitHub API URL for one asset id in the fixed Release repository. */
export function isAllowedReleaseAssetApiUrl(value: string, assetId: number): boolean {
  try {
    const url = new URL(value)
    return Number.isSafeInteger(assetId)
      && assetId > 0
      && url.protocol === 'https:'
      && url.hostname === 'api.github.com'
      && decodeURIComponent(url.pathname) === `/repos/${REPOSITORY}/releases/assets/${assetId}`
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
  if (value.name !== expectedName || typeof value.browser_download_url !== 'string' || typeof value.url !== 'string') {
    return undefined
  }
  if (typeof value.id !== 'number' || !Number.isSafeInteger(value.id) || value.id <= 0) return undefined
  if (typeof value.size !== 'number' || !Number.isSafeInteger(value.size) || value.size <= 0) return undefined
  if (!isAllowedReleaseAssetUrl(value.browser_download_url, tag, expectedName)) return undefined
  if (!isAllowedReleaseAssetApiUrl(value.url, value.id)) return undefined
  const digest = typeof value.digest === 'string' ? /^sha256:([0-9a-fA-F]{64})$/u.exec(value.digest) : null
  return {
    id: value.id,
    name: expectedName,
    size: value.size,
    browserUrl: value.browser_download_url,
    apiUrl: value.url,
    ...(digest?.[1] === undefined ? {} : { sha256: digest[1].toLowerCase() }),
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function retryableHttpStatus(status: number): boolean {
  return status === 408 || status >= 500
}

function transportFailure(subject: string, response: Response, transport: TransportName): ReleaseTransportError {
  return new ReleaseTransportError(
    `${subject} returned HTTP ${response.status}`,
    transport,
    'http',
    retryableHttpStatus(response.status),
  )
}

function logTransportFailure(error: ReleaseTransportError): void {
  console.warn('desktop: Release download transport failed', {
    transport: error.transport,
    stage: error.stage,
    reason: error.message,
    retryable: error.retryable,
  })
}

function logFallbackFailure(error: unknown): void {
  if (error instanceof ReleaseTransportError) {
    logTransportFailure(error)
    return
  }
  console.warn('desktop: Release download transport failed', {
    transport: 'github-api',
    stage: 'response-validation',
    reason: 'The fallback response could not be accepted.',
    retryable: false,
  })
}

function throwIfUserCancelled(signal: AbortSignal): void {
  if (signal.aborted) signal.throwIfAborted()
}

async function beginRequest(
  transport: TransportName,
  fetcher: ReleaseFetch,
  input: string,
  init: RequestInit,
  userSignal: AbortSignal,
  headerTimeoutMs: number,
): Promise<ActiveRequest> {
  throwIfUserCancelled(userSignal)
  const controller = new AbortController()
  const timeoutError = new ReleaseTransportError('Release request timed out.', transport, 'headers', true)
  let rejectDeadline: (error: Error) => void = () => {}
  const deadline = new Promise<never>((_resolve, reject) => { rejectDeadline = reject })
  const cancelAttempt = (): void => {
    controller.abort()
    rejectDeadline(new DOMException('The download was cancelled.', 'AbortError'))
  }
  userSignal.addEventListener('abort', cancelAttempt, { once: true })
  const timer = setTimeout(() => {
    controller.abort(timeoutError)
    rejectDeadline(timeoutError)
  }, headerTimeoutMs)
  try {
    const response = await Promise.race([
      fetcher(input, { ...init, signal: controller.signal }),
      deadline,
    ])
    if (controller.signal.reason === timeoutError) throw timeoutError
    throwIfUserCancelled(userSignal)
    return {
      response,
      controller,
      dispose() { userSignal.removeEventListener('abort', cancelAttempt) },
    }
  } catch (error) {
    userSignal.removeEventListener('abort', cancelAttempt)
    throwIfUserCancelled(userSignal)
    if (error instanceof ReleaseTransportError) throw error
    if (controller.signal.reason === timeoutError) throw timeoutError
    if (error instanceof TypeError || isAbortError(error)) {
      throw new ReleaseTransportError('Release request could not connect.', transport, 'headers', true)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function readWithIdleTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  request: ActiveRequest,
  userSignal: AbortSignal,
  idleTimeoutMs: number,
  transport: TransportName,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  throwIfUserCancelled(userSignal)
  try {
    return await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
      const finish = (callback: () => void): void => {
        clearTimeout(timer)
        userSignal.removeEventListener('abort', cancelRead)
        callback()
      }
      const cancelRead = (): void => {
        request.controller.abort()
        finish(() => { reject(new DOMException('The download was cancelled.', 'AbortError')) })
      }
      const timer = setTimeout(() => {
        request.controller.abort()
        finish(() => { reject(new ReleaseTransportError('Release response stopped transferring data.', transport, 'body', true)) })
      }, idleTimeoutMs)
      userSignal.addEventListener('abort', cancelRead, { once: true })
      reader.read().then(
        (result) => { finish(() => { resolve(result) }) },
        (error: unknown) => {
          finish(() => { reject(error instanceof Error ? error : new Error(String(error))) })
        },
      )
    })
  } catch (error) {
    throwIfUserCancelled(userSignal)
    if (error instanceof ReleaseTransportError) throw error
    if (error instanceof TypeError || isAbortError(error)) {
      throw new ReleaseTransportError('Release response was interrupted.', transport, 'body', true)
    }
    throw error
  }
}

async function readSmallBody(
  request: ActiveRequest,
  limit: number,
  userSignal: AbortSignal,
  idleTimeoutMs: number,
  transport: TransportName,
): Promise<Buffer> {
  const body = request.response.body
  if (body === null) throw new ReleaseTransportError('Release response had no body.', transport, 'body', true)
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const result = await readWithIdleTimeout(reader, request, userSignal, idleTimeoutMs, transport)
    if (result.done) break
    total += result.value.byteLength
    if (total > limit) throw new Error('Release response was unexpectedly large.')
    chunks.push(result.value)
  }
  return Buffer.concat(chunks, total)
}

function responseResumeValidator(response: Response): ResumeValidator | undefined {
  const etag = response.headers.get('etag')
  if (etag !== null && !etag.startsWith('W/') && /^"[^"\r\n]+"$/u.test(etag)) return { value: etag }
  const lastModified = response.headers.get('last-modified')
  return lastModified === null || /[\r\n]/u.test(lastModified) ? undefined : { value: lastModified }
}

function contentRangeMatches(value: string | null, start: number, total: number): boolean {
  if (value === null) return false
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/u.exec(value)
  if (match === null) return false
  const parsedStart = Number(match[1])
  const parsedEnd = Number(match[2])
  const parsedTotal = Number(match[3])
  return Number.isSafeInteger(parsedStart)
    && Number.isSafeInteger(parsedEnd)
    && Number.isSafeInteger(parsedTotal)
    && parsedStart === start
    && parsedEnd >= parsedStart
    && parsedEnd < parsedTotal
    && parsedTotal === total
}

/** Download, verify, and open the current platform's installer without replacing the application. */
export class DesktopReleaseDownloader {
  #status: DesktopReleaseDownloadStatus
  #running: Promise<DesktopReleaseDownloadStatus> | undefined
  #abortController: AbortController | undefined
  #readyPath: string | undefined
  #selectedRelease: Extract<DesktopReleaseStatus, { phase: 'available' }> | undefined
  readonly #listeners = new Set<(status: DesktopReleaseDownloadStatus) => void>()
  readonly #apiFetch: ReleaseFetch
  readonly #systemFetch: ReleaseFetch
  readonly #assetName: string | undefined
  readonly #headerTimeoutMs: number
  readonly #idleTimeoutMs: number
  readonly #background: BackgroundReleaseDownloads

  constructor(readonly options: DesktopReleaseDownloaderOptions) {
    this.#assetName = installerAssetName(options.platform, options.arch)
    this.#status = this.#assetName === undefined ? { phase: 'unsupported' } : { phase: 'idle' }
    this.#apiFetch = options.apiFetch ?? fetch
    this.#systemFetch = options.systemFetch ?? this.#apiFetch
    this.#headerTimeoutMs = options.headerTimeoutMs ?? DEFAULT_HEADER_TIMEOUT_MS
    this.#idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
    this.#background = new BackgroundReleaseDownloads(false, () => {
      const release = this.options.getRelease()
      if (release.phase !== 'available' || (this.#running !== undefined && !this.#matchesSelection(release))) return false
      this.startInBackground()
      return true
    })
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

  #matchesSelection(release: Extract<DesktopReleaseStatus, { phase: 'available' }>): boolean {
    const selected = this.#selectedRelease
    return selected !== undefined && selected.latestVersion === release.latestVersion
      && selected.tagName === release.tagName && (selected.source ?? 'github') === (release.source ?? 'github')
  }

  /**
   * Apply the persisted silent-download choice without authorizing installation or cancelling manual work.
   * @param enabled - Whether newly observed available Releases may start downloading automatically.
   */
  setBackgroundEnabled(enabled: boolean): void { this.#background.setEnabled(enabled) }

  /** Preserve active and verified transfers during inconclusive discovery; revoke confirmed changed releases. */
  resetForRelease(release: DesktopReleaseStatus): void {
    if (this.#assetName === undefined) return
    if (release.phase === 'idle' || release.phase === 'checking' || release.phase === 'error') {
      this.#background.observe(release)
      return
    }
    const selected = release.phase === 'available' && this.#matchesSelection(release)
    if (this.#running !== undefined) {
      if (!selected) this.#abortController?.abort()
    } else if (!selected) {
      this.#readyPath = undefined
      this.#selectedRelease = undefined
      this.#publish({ phase: 'idle' })
    }
    this.#background.observe(release)
  }

  /** Start or join the current verified installer download. */
  start(): Promise<DesktopReleaseDownloadStatus> {
    if (this.#running !== undefined) return this.#running
    const release = this.options.getRelease()
    if (this.#assetName === undefined) return Promise.resolve(this.#publish({ phase: 'unsupported' }))
    if (this.#status.phase === 'ready' && (release.phase === 'checking' || release.phase === 'idle' || release.phase === 'error')) {
      return Promise.resolve(this.#status)
    }
    if (release.phase !== 'available') {
      return Promise.resolve(this.#publish({ phase: 'error', message: 'No downloadable Release is currently selected.' }))
    }
    if (this.#status.phase === 'ready' && this.#matchesSelection(release)) {
      return Promise.resolve(this.#status)
    }
    this.#selectedRelease = release
    const controller = new AbortController()
    this.#abortController = controller
    this.#publish({ phase: 'resolving', version: release.latestVersion })
    this.#running = (release.source === 'cnb'
      ? this.#downloadCnb(release.latestVersion, release.tagName, this.#assetName, controller.signal)
      : this.#download(release.latestVersion, release.tagName, this.#assetName, controller.signal))
      .catch((error: unknown) => {
        if (isAbortError(error)) return this.#publish({ phase: 'cancelled', version: release.latestVersion })
        return this.#publish({ phase: 'error', version: release.latestVersion, message: errorMessage(error) })
      })
      .finally(() => {
        this.#running = undefined
        this.#abortController = undefined
        this.#background.observe(this.options.getRelease())
      })
    return this.#running
  }

  /**
   * Start or join a main-process transfer without waiting for the installer body.
   * @returns Immediate shared status; completion continues through the existing status subscription.
   */
  startInBackground(): DesktopReleaseDownloadStatus {
    void this.start()
    return this.#status
  }

  /** Cancel only the active download owned by this manager. */
  cancel(): DesktopReleaseDownloadStatus {
    this.#abortController?.abort()
    return this.#status
  }

  /** Cancel an active transfer and wait for its temporary file cleanup. */
  async dispose(): Promise<void> {
    this.#background.dispose()
    this.#abortController?.abort()
    await this.#running
  }

  /** Open a checksum-verified installer through the operating system. */
  async open(): Promise<{ error: string }> {
    if (this.#status.phase !== 'ready' || this.#readyPath === undefined) {
      return { error: 'The installer has not finished downloading.' }
    }
    if (this.#selectedRelease?.source === 'cnb') {
      const readyRelease = this.#selectedRelease
      const index = await fetchCnbReleaseIndex(this.#systemFetch)
      const current = index.releases.find(entry => entry.version === readyRelease.latestVersion
        && entry.tagName === readyRelease.tagName)
      if (current === undefined || current.withdrawn) return { error: 'The CNB Release is no longer available for in-app updates.' }
    }
    return { error: await this.options.openPath(this.#readyPath) }
  }

  async #requestSmall(
    transport: TransportName,
    fetcher: ReleaseFetch,
    url: string,
    headers: HeadersInit,
    limit: number,
    signal: AbortSignal,
    subject: string,
  ): Promise<Buffer> {
    const request = await beginRequest(transport, fetcher, url, { headers }, signal, this.#headerTimeoutMs)
    try {
      if (!request.response.ok) throw transportFailure(subject, request.response, transport)
      return await readSmallBody(request, limit, signal, this.#idleTimeoutMs, transport)
    } catch (error) {
      request.controller.abort()
      throw error
    } finally {
      request.dispose()
    }
  }

  async #requestSmallWithFallback(
    asset: ReleaseAsset,
    signal: AbortSignal,
    version: string,
    displayFileName: string,
    totalBytes: number,
  ): Promise<Buffer> {
    try {
      return await this.#requestSmall(
        'system-network', this.#systemFetch, asset.browserUrl, REQUEST_HEADERS,
        MAX_CHECKSUM_BYTES, signal, 'Release checksums',
      )
    } catch (error) {
      throwIfUserCancelled(signal)
      if (!(error instanceof ReleaseTransportError) || !error.retryable) throw error
      logTransportFailure(error)
      this.#publish({ phase: 'switching', version, fileName: displayFileName, transferredBytes: 0, totalBytes, resumeFromBytes: 0 })
      try {
        return await this.#requestSmall(
          'github-api', this.#apiFetch, asset.apiUrl,
          { ...REQUEST_HEADERS, Accept: 'application/octet-stream' },
          MAX_CHECKSUM_BYTES, signal, 'Release checksums',
        )
      } catch (fallbackError) {
        throwIfUserCancelled(signal)
        logFallbackFailure(fallbackError)
        throw new Error('Both download channels failed. Check your network or proxy settings and retry.')
      }
    }
  }

  async #downloadInstallerAttempt(
    transport: TransportName,
    fetcher: ReleaseFetch,
    url: string,
    asset: ReleaseAsset,
    version: string,
    file: FileHandle,
    accumulator: DownloadAccumulator,
    signal: AbortSignal,
    resumeValidator?: ResumeValidator,
  ): Promise<ResumeValidator | undefined> {
    const requestedOffset = accumulator.transferredBytes
    const headers: Record<string, string> = { ...REQUEST_HEADERS, Accept: 'application/octet-stream' }
    if (requestedOffset > 0) {
      headers.Range = `bytes=${requestedOffset}-`
      if (resumeValidator !== undefined) headers['If-Range'] = resumeValidator.value
    }
    const request = await beginRequest(transport, fetcher, url, { headers }, signal, this.#headerTimeoutMs)
    try {
      const response = request.response
      if (requestedOffset > 0 && response.status === 416) {
        if (requestedOffset === asset.size) {
          request.controller.abort()
          return resumeValidator
        }
        throw transportFailure('Release installer', response, transport)
      }
      if (requestedOffset > 0 && response.status === 206) {
        if (!contentRangeMatches(response.headers.get('content-range'), requestedOffset, asset.size)) {
          throw new Error('Release installer returned an invalid Content-Range.')
        }
      } else if (response.status === 200) {
        if (requestedOffset > 0) {
          await file.truncate(0)
          accumulator.transferredBytes = 0
          accumulator.hash = createHash('sha256')
          this.#publish({ phase: 'switching', version, fileName: asset.name, transferredBytes: requestedOffset, totalBytes: asset.size, resumeFromBytes: 0 })
        }
      } else {
        throw transportFailure('Release installer', response, transport)
      }
      const body = response.body
      if (body === null) throw new ReleaseTransportError('Release installer had no body.', transport, 'body', true)
      const validator = responseResumeValidator(response) ?? resumeValidator
      accumulator.resumeValidator = validator
      const reader = body.getReader()
      let lastPublishedAt = 0
      while (true) {
        const result = await readWithIdleTimeout(reader, request, signal, this.#idleTimeoutMs, transport)
        if (result.done) break
        const position = accumulator.transferredBytes
        const nextSize = position + result.value.byteLength
        if (nextSize > asset.size) throw new Error('Release installer exceeded its declared size.')
        accumulator.hash.update(result.value)
        let offset = 0
        while (offset < result.value.byteLength) {
          const write = await file.write(result.value, offset, result.value.byteLength - offset, position + offset)
          if (write.bytesWritten === 0) throw new Error('Release installer could not be written to disk.')
          offset += write.bytesWritten
        }
        accumulator.transferredBytes = nextSize
        const now = Date.now()
        if (now - lastPublishedAt >= 100 || nextSize === asset.size) {
          lastPublishedAt = now
          this.#publish({ phase: 'downloading', version, fileName: asset.name, transferredBytes: nextSize, totalBytes: asset.size, percent: Math.min(100, Math.round((nextSize / asset.size) * 1000) / 10) })
        }
      }
      return validator
    } catch (error) {
      request.controller.abort()
      throw error
    } finally {
      request.dispose()
    }
  }

  async #downloadInstaller(
    asset: ReleaseAsset,
    version: string,
    partialPath: string,
    signal: AbortSignal,
    fallback = true,
  ): Promise<string> {
    const file = await open(partialPath, 'wx')
    const accumulator: DownloadAccumulator = {
      transferredBytes: 0,
      hash: createHash('sha256'),
      resumeValidator: undefined,
    }
    try {
      try {
        await this.#downloadInstallerAttempt('system-network', this.#systemFetch, asset.browserUrl, asset, version, file, accumulator, signal)
      } catch (error) {
        throwIfUserCancelled(signal)
        if (!fallback) throw error
        if (!(error instanceof ReleaseTransportError) || !error.retryable) throw error
        logTransportFailure(error)
        const resumeFromBytes = accumulator.transferredBytes
        this.#publish({ phase: 'switching', version, fileName: asset.name, transferredBytes: resumeFromBytes, totalBytes: asset.size, resumeFromBytes })
        try {
          await this.#downloadInstallerAttempt('github-api', this.#apiFetch, asset.apiUrl, asset, version, file, accumulator, signal, accumulator.resumeValidator)
        } catch (fallbackError) {
          throwIfUserCancelled(signal)
          logFallbackFailure(fallbackError)
          throw new Error('Both download channels failed. Check your network or proxy settings and retry.')
        }
      }
      if (accumulator.transferredBytes !== asset.size) throw new Error('Release installer size did not match its metadata.')
      this.#publish({ phase: 'verifying', version, fileName: asset.name })
      return accumulator.hash.digest('hex')
    } finally {
      await file.close()
    }
  }

  async #download(version: string, tag: string, fileName: string, signal: AbortSignal): Promise<DesktopReleaseDownloadStatus> {
    if (!isAllowedReleaseTag(tag, version)) throw new Error('Selected Release tag did not match its version.')
    const metadataRequest = await beginRequest(
      'github-api', this.#apiFetch, `${API_RELEASE_PREFIX}${encodeURIComponent(tag)}`,
      { headers: { ...REQUEST_HEADERS, Accept: 'application/vnd.github+json' } }, signal, this.#headerTimeoutMs,
    )
    let metadata: Buffer
    try {
      if (!metadataRequest.response.ok) throw transportFailure('GitHub Release', metadataRequest.response, 'github-api')
      metadata = await readSmallBody(metadataRequest, MAX_RELEASE_METADATA_BYTES, signal, this.#idleTimeoutMs, 'github-api')
    } catch (error) {
      metadataRequest.controller.abort()
      throw error
    } finally {
      metadataRequest.dispose()
    }
    let details: unknown
    try { details = JSON.parse(metadata.toString('utf8')) } catch { throw new Error('GitHub Release returned invalid metadata.') }
    if (details === null || typeof details !== 'object') throw new Error('GitHub Release returned invalid metadata.')
    const releaseDetails = details as GitHubReleaseDetails
    if (releaseDetails.draft === true || releaseDetails.prerelease === true) throw new Error('Release is no longer available for in-app updates.')
    if (releaseDetails.tag_name !== tag || !Array.isArray(releaseDetails.assets)) throw new Error('GitHub Release metadata did not match the selected version.')
    const assets = releaseDetails.assets as GitHubReleaseAsset[]
    const installer = assets.map(asset => parseAsset(asset, tag, fileName)).find(asset => asset !== undefined)
    const checksums = assets.map(asset => parseAsset(asset, tag, CHECKSUM_ASSET)).find(asset => asset !== undefined)
    if (installer === undefined) throw new Error(`Release ${version} does not contain a valid ${fileName}.`)
    let expectedChecksum = installer.sha256
    if (expectedChecksum === undefined && checksums !== undefined) {
      if (checksums.size > MAX_CHECKSUM_BYTES) throw new Error('Release checksum metadata is unexpectedly large.')
      const checksum = await this.#requestSmallWithFallback(checksums, signal, version, fileName, installer.size)
      expectedChecksum = readReleaseChecksum(checksum.toString('utf8'), fileName)
    }
    if (expectedChecksum === undefined) throw new Error(`Release checksums do not contain ${fileName}.`)

    const versionDirectory = join(this.options.downloadDirectory, version)
    const finalPath = join(versionDirectory, fileName)
    const partialPath = `${finalPath}.part`
    await mkdir(versionDirectory, { recursive: true })
    await rm(partialPath, { force: true })
    let completed = false
    let finalized = false
    try {
      const actualChecksum = await this.#downloadInstaller(installer, version, partialPath, signal)
      if (actualChecksum !== expectedChecksum) throw new Error('Release installer failed SHA-256 verification.')
      throwIfUserCancelled(signal)
      await rm(finalPath, { force: true })
      await rename(partialPath, finalPath)
      finalized = true
      throwIfUserCancelled(signal)
      completed = true
      this.#readyPath = finalPath
      return this.#publish({ phase: 'ready', version, fileName })
    } finally {
      if (!completed) {
        await rm(partialPath, { force: true })
        if (finalized) await rm(finalPath, { force: true })
      }
    }
  }

  async #downloadCnb(version: string, tag: string, fileName: string, signal: AbortSignal): Promise<DesktopReleaseDownloadStatus> {
    throwIfUserCancelled(signal)
    const index = await fetchCnbReleaseIndex(this.#systemFetch)
    throwIfUserCancelled(signal)
    const entry = index.releases.find(candidate => candidate.version === version && candidate.tagName === tag)
    if (entry === undefined || entry.withdrawn) throw new Error('CNB Release is no longer available for in-app updates.')
    const candidate = entry.assets.find(asset => asset.name === fileName)
    if (candidate === undefined) throw new Error(`CNB Release ${version} does not contain ${fileName}.`)
    const asset: ReleaseAsset = { id: 1, name: candidate.name, size: candidate.size,
      browserUrl: candidate.url, apiUrl: candidate.url, sha256: candidate.sha256 }
    const versionDirectory = join(this.options.downloadDirectory, version)
    const finalPath = join(versionDirectory, fileName)
    const partialPath = `${finalPath}.part`
    await mkdir(versionDirectory, { recursive: true })
    await rm(partialPath, { force: true })
    const transferController = new AbortController()
    const cancelTransfer = (): void => { transferController.abort() }
    signal.addEventListener('abort', cancelTransfer, { once: true })
    let withdrawalError: Error | undefined
    let recheckRunning = false
    const recheck = async (): Promise<void> => {
      if (recheckRunning || transferController.signal.aborted) return
      recheckRunning = true
      try {
        const currentIndex = await fetchCnbReleaseIndex(this.#systemFetch)
        const current = currentIndex.releases.find(release => release.version === version && release.tagName === tag)
        if (current === undefined || current.withdrawn) {
          withdrawalError = new Error('CNB Release was withdrawn while downloading.')
          transferController.abort()
        }
      } catch {
        // A transient recheck failure cannot validate withdrawal and does not replace the active verified transfer.
      } finally { recheckRunning = false }
    }
    const assertTransferCurrent = (): void => {
      if (withdrawalError !== undefined) throw withdrawalError
      throwIfUserCancelled(transferController.signal)
    }
    const recheckTimer = setInterval(() => { void recheck() }, CNB_WITHDRAWAL_RECHECK_MS)
    let completed = false
    let finalized = false
    try {
      let actualChecksum: string
      try { actualChecksum = await this.#downloadInstaller(asset, version, partialPath, transferController.signal, false) }
      catch (error) { throw withdrawalError ?? error }
      if (actualChecksum !== candidate.sha256) throw new Error('CNB Release installer failed SHA-256 verification.')
      assertTransferCurrent()
      await rm(finalPath, { force: true })
      await rename(partialPath, finalPath)
      finalized = true
      assertTransferCurrent()
      completed = true
      this.#readyPath = finalPath
      return this.#publish({ phase: 'ready', version, fileName })
    } finally {
      clearInterval(recheckTimer)
      signal.removeEventListener('abort', cancelTransfer)
      if (!completed) {
        await rm(partialPath, { force: true })
        if (finalized) await rm(finalPath, { force: true })
      }
    }
  }
}

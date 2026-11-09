import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DesktopReleaseDownloader, installerAssetName, isAllowedReleaseAssetApiUrl, isAllowedReleaseAssetUrl, isAllowedReleaseTag,
  readReleaseChecksum, type ReleaseFetch,
} from '../src/release-downloader.ts'
import type { DesktopReleaseStatus } from '../src/release-checker.ts'
import { CNB_UPDATE_INDEX_URL } from '../src/cnb-release-source.ts'

const tag = 'odsh-v0.1.0-rc.8'
const installerName = 'DeepSeek-Harness-macos-arm64.dmg'
const releaseUrl = `https://github.com/flaqai/open-deepseek-harness-desktop/releases/download/${tag}/`
const releaseApiUrl = `https://api.github.com/repos/flaqai/open-deepseek-harness-desktop/releases/tags/${tag}`
const assetApiUrl = (id: number): string => `https://api.github.com/repos/flaqai/open-deepseek-harness-desktop/releases/assets/${id}`
const temporaryDirectories: string[] = []

function requestUrl(input: string | Request): string {
  return typeof input === 'string' ? input : input.url
}

function releaseStatus() {
  return {
    phase: 'available' as const,
    currentVersion: '0.1.0-rc.7',
    latestVersion: '0.1.0-rc.8',
    tagName: tag,
    publishedAt: '2026-08-20T00:00:00Z',
    releaseUrl: `https://github.com/flaqai/open-deepseek-harness-desktop/releases/tag/${tag}`,
  }
}

function releaseAsset(name: string, content: Uint8Array, id: number, digest?: string) {
  return {
    id, name, size: content.byteLength, url: assetApiUrl(id),
    browser_download_url: `${releaseUrl}${name}`,
    ...(digest === undefined ? {} : { digest: `sha256:${digest}` }),
  }
}

function releaseResponse(assets: unknown[], extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ draft: false, prerelease: false, tag_name: tag, assets, ...extra }))
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-release-download-'))
  temporaryDirectories.push(directory)
  return directory
}

function createManager(
  directory: string,
  apiFetch: ReleaseFetch,
  systemFetch: ReleaseFetch,
  timeouts: { headerTimeoutMs?: number; idleTimeoutMs?: number } = {},
): DesktopReleaseDownloader {
  return new DesktopReleaseDownloader({
    platform: 'darwin', arch: 'arm64', downloadDirectory: directory,
    getRelease: releaseStatus, openPath: vi.fn(() => Promise.resolve('')),
    apiFetch, systemFetch, ...timeouts,
  })
}

function interruptedResponse(prefix: Uint8Array, headers: HeadersInit = {}): Response {
  let sent = false
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        sent = true
        controller.enqueue(prefix)
      } else {
        controller.error(new TypeError('interrupted'))
      }
    },
  }), { status: 200, headers })
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('desktop Release downloader', () => {
  it('retains the selected CNB release through transient checks and still refuses withdrawn installers', async () => {
    const directory = await temporaryDirectory()
    const installer = Buffer.from('verified CNB installer')
    const checksum = createHash('sha256').update(installer).digest('hex')
    const cnbUrl = `https://cnb.cool/hecoococ/open-deepseek-harness-desktop/-/releases/download/${tag}/${installerName}`
    const index = {
      schema: 'open-dsh-desktop/cnb-update-index/v1', revision: 1,
      generatedAt: new Date(Date.now() - 1_000).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      releases: [{
        version: '0.1.0-rc.8', tagName: tag, publishedAt: '2026-08-20T00:00:00Z', withdrawn: false,
        releaseUrl: `https://cnb.cool/hecoococ/open-deepseek-harness-desktop/-/releases/tag/${tag}`,
        assets: [{ name: installerName, size: installer.byteLength, sha256: checksum, url: cnbUrl }],
      }],
    }
    let selected: DesktopReleaseStatus = { ...releaseStatus(), source: 'cnb' }
    const fetchMock = vi.fn<ReleaseFetch>((input) => {
      if (requestUrl(input) === CNB_UPDATE_INDEX_URL) return Promise.resolve(new Response(JSON.stringify(index)))
      selected = { phase: 'checking', currentVersion: '0.1.0-rc.7' }
      manager.resetForRelease(selected)
      return Promise.resolve(new Response(installer))
    })
    const openPath = vi.fn(() => Promise.resolve(''))
    const manager = new DesktopReleaseDownloader({
      platform: 'darwin', arch: 'arm64', downloadDirectory: directory,
      getRelease: () => selected,
      openPath, systemFetch: fetchMock,
    })

    await expect(manager.start()).resolves.toEqual({
      phase: 'ready', version: '0.1.0-rc.8', fileName: installerName,
    })
    await expect(manager.open()).resolves.toEqual({ error: '' })
    expect(fetchMock.mock.calls.filter(([input]) => requestUrl(input) === CNB_UPDATE_INDEX_URL)).toHaveLength(2)
    expect(openPath).toHaveBeenCalledOnce()
    index.releases[0]!.withdrawn = true
    await expect(manager.open()).resolves.toEqual({ error: 'The CNB Release is no longer available for in-app updates.' })
    expect(openPath).toHaveBeenCalledOnce()
    await manager.dispose()
  })

  it('selects only the installer format the host can open', () => {
    expect(installerAssetName('darwin', 'arm64')).toBe(installerName)
    expect(installerAssetName('win32', 'x64')).toBe('DeepSeek-Harness-windows-x64.exe')
    expect(installerAssetName('linux', 'x64')).toBeUndefined()
    expect(installerAssetName('darwin', 'ia32')).toBeUndefined()
  })

  it('accepts only exact repository asset URLs and checksum entries', () => {
    expect(isAllowedReleaseAssetUrl(`${releaseUrl}${installerName}`, tag, installerName)).toBe(true)
    expect(isAllowedReleaseAssetUrl(`${releaseUrl}../other.dmg`, tag, installerName)).toBe(false)
    expect(isAllowedReleaseAssetUrl(`https://example.com/${installerName}`, tag, installerName)).toBe(false)
    expect(isAllowedReleaseAssetApiUrl(assetApiUrl(42), 42)).toBe(true)
    expect(isAllowedReleaseAssetApiUrl(assetApiUrl(42), 43)).toBe(false)
    expect(isAllowedReleaseAssetApiUrl('https://api.github.com/repos/other/project/releases/assets/42', 42)).toBe(false)
    const checksum = 'a'.repeat(64)
    expect(readReleaseChecksum(`${checksum}  ${installerName}\n`, installerName)).toBe(checksum)
    expect(readReleaseChecksum(`${checksum}  another.dmg\n`, installerName)).toBeUndefined()
    expect(isAllowedReleaseTag('odsh-v0.1.2-rc.1', '0.1.2-rc.1')).toBe(true)
    expect(isAllowedReleaseTag('dsh-v0.1.2-rc.1', '0.1.2-rc.1')).toBe(true)
    expect(isAllowedReleaseTag('v0.1.2-rc.1', '0.1.2-rc.1')).toBe(true)
    expect(isAllowedReleaseTag('odsh-v0.1.2-rc.2', '0.1.2-rc.1')).toBe(false)
  })

  it('downloads the platform installer, verifies SHA-256, and opens only the verified file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-release-download-'))
    temporaryDirectories.push(directory)
    const installer = Buffer.from('verified desktop installer')
    const checksum = createHash('sha256').update(installer).digest('hex')
    const installerUrl = `${releaseUrl}${installerName}`
    const fetchMock = vi.fn((input: string | Request) => {
      const url = requestUrl(input)
      if (url === releaseApiUrl) return Promise.resolve(releaseResponse([releaseAsset(installerName, installer, 1, checksum)]))
      if (url === installerUrl) return Promise.resolve(new Response(installer))
      return Promise.resolve(new Response('not found', { status: 404 }))
    })
    const openPath = vi.fn(() => Promise.resolve(''))
    const manager = new DesktopReleaseDownloader({
      platform: 'darwin',
      arch: 'arm64',
      downloadDirectory: directory,
      getRelease: releaseStatus,
      openPath,
      apiFetch: fetchMock,
      systemFetch: fetchMock,
    })
    const statuses: string[] = []
    manager.subscribe(status => statuses.push(status.phase))

    await expect(manager.start()).resolves.toEqual({
      phase: 'ready', version: '0.1.0-rc.8', fileName: installerName,
    })
    expect(statuses).toEqual(['resolving', 'downloading', 'verifying', 'ready'])
    await expect(readFile(join(directory, '0.1.0-rc.8', installerName))).resolves.toEqual(installer)
    await expect(manager.open()).resolves.toEqual({ error: '' })
    expect(openPath).toHaveBeenCalledWith(join(directory, '0.1.0-rc.8', installerName))
  })

  it('rejects a checksum mismatch and never opens the partial installer', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-release-download-'))
    temporaryDirectories.push(directory)
    const installer = Buffer.from('tampered installer')
    const fetchMock = vi.fn((input: string | Request) => {
      const url = requestUrl(input)
      if (url === releaseApiUrl) return Promise.resolve(releaseResponse([
        releaseAsset(installerName, installer, 1),
        { ...releaseAsset('SHA256SUMS', Buffer.alloc(100), 2), size: 100 },
      ]))
      if (url.endsWith('SHA256SUMS')) return Promise.resolve(new Response(`${'0'.repeat(64)}  ${installerName}\n`))
      return Promise.resolve(new Response(installer))
    })
    const manager = new DesktopReleaseDownloader({
      platform: 'darwin', arch: 'arm64', downloadDirectory: directory,
      getRelease: releaseStatus,
      openPath: vi.fn(() => Promise.resolve('')),
      apiFetch: fetchMock,
      systemFetch: fetchMock,
    })

    await expect(manager.start()).resolves.toMatchObject({
      phase: 'error', message: 'Release installer failed SHA-256 verification.',
    })
    await expect(stat(join(directory, '0.1.0-rc.8', `${installerName}.part`))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(manager.open()).resolves.toEqual({ error: 'The installer has not finished downloading.' })
  })

  it('rejects a selected Release that was changed to prerelease before download', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-release-download-'))
    temporaryDirectories.push(directory)
    const fetchMock = vi.fn(() => Promise.resolve(releaseResponse([], { prerelease: true })))
    const manager = new DesktopReleaseDownloader({
      platform: 'darwin', arch: 'arm64', downloadDirectory: directory,
      getRelease: releaseStatus,
      openPath: vi.fn(() => Promise.resolve('')),
      apiFetch: fetchMock,
      systemFetch: fetchMock,
    })

    await expect(manager.start()).resolves.toMatchObject({
      phase: 'error', message: 'Release is no longer available for in-app updates.',
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('rejects malformed installer identity and size metadata before using either asset URL', async () => {
    const installer = Buffer.from('metadata installer')
    const checksum = createHash('sha256').update(installer).digest('hex')
    const valid = releaseAsset(installerName, installer, 6, checksum)
    const invalidAssets = [
      { ...valid, id: 0 },
      { ...valid, id: 6.5 },
      { ...valid, size: 0 },
      { ...valid, size: Number.MAX_SAFE_INTEGER + 1 },
      { ...valid, url: assetApiUrl(7) },
      { ...valid, browser_download_url: `${releaseUrl}other.dmg` },
    ]
    for (const invalid of invalidAssets) {
      const directory = await temporaryDirectory()
      const apiFetch = vi.fn<ReleaseFetch>(() => Promise.resolve(releaseResponse([invalid])))
      const systemFetch = vi.fn<ReleaseFetch>(() => Promise.resolve(new Response(installer)))
      const manager = createManager(directory, apiFetch, systemFetch)

      await expect(manager.start()).resolves.toMatchObject({
        phase: 'error', message: `Release ${releaseStatus().latestVersion} does not contain a valid ${installerName}.`,
      })
      expect(apiFetch).toHaveBeenCalledOnce()
      expect(systemFetch).not.toHaveBeenCalled()
    }
  })

  it('uses the GitHub API asset after the system network cannot connect', async () => {
    const directory = await temporaryDirectory()
    const installer = Buffer.from('fallback installer')
    const checksum = createHash('sha256').update(installer).digest('hex')
    const asset = releaseAsset(installerName, installer, 7, checksum)
    const apiFetch = vi.fn<ReleaseFetch>(input => Promise.resolve(
      requestUrl(input) === releaseApiUrl ? releaseResponse([asset]) : new Response(installer),
    ))
    const systemFetch = vi.fn<ReleaseFetch>(() => Promise.reject(new TypeError('fetch failed')))
    const manager = createManager(directory, apiFetch, systemFetch)
    const statuses: string[] = []
    manager.subscribe(status => statuses.push(status.phase))

    await expect(manager.start()).resolves.toMatchObject({ phase: 'ready' })
    expect(statuses).toContain('switching')
    const assetCall = apiFetch.mock.calls.find(([input]) => requestUrl(input) === assetApiUrl(7))
    expect(new Headers(assetCall?.[1]?.headers).get('accept')).toBe('application/octet-stream')
  })

  it('resumes an interrupted system transfer from the exact API byte range', async () => {
    const directory = await temporaryDirectory()
    const first = Buffer.from('verified ')
    const rest = Buffer.from('resumed installer')
    const installer = Buffer.concat([first, rest])
    const checksum = createHash('sha256').update(installer).digest('hex')
    const asset = releaseAsset(installerName, installer, 8, checksum)
    let fallbackHeaders = new Headers()
    const apiFetch = vi.fn<ReleaseFetch>((input, init) => {
      if (requestUrl(input) === releaseApiUrl) return Promise.resolve(releaseResponse([asset]))
      fallbackHeaders = new Headers(init?.headers)
      return Promise.resolve(new Response(rest, {
        status: 206,
        headers: { 'content-range': `bytes ${first.byteLength}-${installer.byteLength - 1}/${installer.byteLength}` },
      }))
    })
    const systemFetch = vi.fn<ReleaseFetch>(() => Promise.resolve(interruptedResponse(first, { etag: '"asset-v1"' })))
    const manager = createManager(directory, apiFetch, systemFetch)

    await expect(manager.start()).resolves.toMatchObject({ phase: 'ready' })
    expect(fallbackHeaders.get('range')).toBe(`bytes=${first.byteLength}-`)
    expect(fallbackHeaders.get('if-range')).toBe('"asset-v1"')
    await expect(readFile(join(directory, releaseStatus().latestVersion, installerName))).resolves.toEqual(installer)
  })

  it('restarts safely when the API channel ignores the requested range', async () => {
    const directory = await temporaryDirectory()
    const first = Buffer.from('partial ')
    const installer = Buffer.from('complete fallback installer')
    const checksum = createHash('sha256').update(installer).digest('hex')
    const asset = releaseAsset(installerName, installer, 9, checksum)
    const apiFetch = vi.fn<ReleaseFetch>(input => Promise.resolve(
      requestUrl(input) === releaseApiUrl ? releaseResponse([asset]) : new Response(installer),
    ))
    const manager = createManager(directory, apiFetch, () => Promise.resolve(interruptedResponse(first)))
    const switching: Array<{ transferredBytes: number; resumeFromBytes: number }> = []
    manager.subscribe((status) => { if (status.phase === 'switching') switching.push(status) })

    await expect(manager.start()).resolves.toMatchObject({ phase: 'ready' })
    expect(switching).toEqual([
      { phase: 'switching', version: releaseStatus().latestVersion, fileName: installerName,
        transferredBytes: first.byteLength, totalBytes: installer.byteLength, resumeFromBytes: first.byteLength },
      { phase: 'switching', version: releaseStatus().latestVersion, fileName: installerName,
        transferredBytes: first.byteLength, totalBytes: installer.byteLength, resumeFromBytes: 0 },
    ])
    await expect(readFile(join(directory, releaseStatus().latestVersion, installerName))).resolves.toEqual(installer)
  })

  it('rejects an inconsistent Content-Range and removes the partial file', async () => {
    const directory = await temporaryDirectory()
    const first = Buffer.from('partial ')
    const rest = Buffer.from('rest')
    const installer = Buffer.concat([first, rest])
    const checksum = createHash('sha256').update(installer).digest('hex')
    const asset = releaseAsset(installerName, installer, 10, checksum)
    const apiFetch = vi.fn<ReleaseFetch>(input => Promise.resolve(
      requestUrl(input) === releaseApiUrl
        ? releaseResponse([asset])
        : new Response(rest, { status: 206, headers: { 'content-range': `bytes 0-3/${installer.byteLength}` } }),
    ))
    const manager = createManager(directory, apiFetch, () => Promise.resolve(interruptedResponse(first)))

    await expect(manager.start()).resolves.toMatchObject({
      phase: 'error', message: 'Both download channels failed. Check your network or proxy settings and retry.',
    })
    await expect(stat(join(directory, releaseStatus().latestVersion, `${installerName}.part`))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('verifies a complete partial file when the API reports range not satisfiable', async () => {
    const directory = await temporaryDirectory()
    const installer = Buffer.from('complete before stream failure')
    const checksum = createHash('sha256').update(installer).digest('hex')
    const asset = releaseAsset(installerName, installer, 17, checksum)
    const apiFetch = vi.fn<ReleaseFetch>(input => Promise.resolve(
      requestUrl(input) === releaseApiUrl
        ? releaseResponse([asset])
        : new Response('', { status: 416 }),
    ))
    const manager = createManager(directory, apiFetch, () => Promise.resolve(interruptedResponse(installer)))

    await expect(manager.start()).resolves.toMatchObject({ phase: 'ready' })
    await expect(readFile(join(directory, releaseStatus().latestVersion, installerName))).resolves.toEqual(installer)
  })

  it('falls back for HTTP 5xx but not for semantic HTTP failures', async () => {
    const installer = Buffer.from('installer')
    const checksum = createHash('sha256').update(installer).digest('hex')
    const asset = releaseAsset(installerName, installer, 11, checksum)
    const directory500 = await temporaryDirectory()
    const apiFetch500 = vi.fn<ReleaseFetch>(input => Promise.resolve(
      requestUrl(input) === releaseApiUrl ? releaseResponse([asset]) : new Response(installer),
    ))
    const manager500 = createManager(directory500, apiFetch500, () => Promise.resolve(new Response('', { status: 503 })))
    await expect(manager500.start()).resolves.toMatchObject({ phase: 'ready' })

    for (const status of [401, 403, 404, 429]) {
      const directory = await temporaryDirectory()
      const apiFetch = vi.fn<ReleaseFetch>(() => Promise.resolve(releaseResponse([asset])))
      const manager = createManager(directory, apiFetch, () => Promise.resolve(new Response('', { status })))
      await expect(manager.start()).resolves.toMatchObject({ phase: 'error', message: `Release installer returned HTTP ${status}` })
      expect(apiFetch).toHaveBeenCalledOnce()
    }
  })

  it('uses both channels for a checksum asset without resuming the small response', async () => {
    const directory = await temporaryDirectory()
    const installer = Buffer.from('checksum fallback installer')
    const checksum = createHash('sha256').update(installer).digest('hex')
    const checksumBody = Buffer.from(`${checksum}  ${installerName}\n`)
    const installerAsset = releaseAsset(installerName, installer, 12)
    const checksumAsset = releaseAsset('SHA256SUMS', checksumBody, 13)
    const apiFetch = vi.fn<ReleaseFetch>((input, init) => {
      const url = requestUrl(input)
      if (url === releaseApiUrl) return Promise.resolve(releaseResponse([installerAsset, checksumAsset]))
      expect(new Headers(init?.headers).get('range')).toBeNull()
      return Promise.resolve(new Response(checksumBody))
    })
    const systemFetch = vi.fn<ReleaseFetch>(input => requestUrl(input).endsWith('SHA256SUMS')
      ? Promise.reject(new TypeError('blocked'))
      : Promise.resolve(new Response(installer)))
    const manager = createManager(directory, apiFetch, systemFetch)

    await expect(manager.start()).resolves.toMatchObject({ phase: 'ready' })
    expect(apiFetch).toHaveBeenCalledWith(assetApiUrl(13), expect.anything())
  })

  it('does not enter the fallback channel after the user cancels', async () => {
    const directory = await temporaryDirectory()
    const installer = Buffer.from('cancelled installer')
    const checksum = createHash('sha256').update(installer).digest('hex')
    const asset = releaseAsset(installerName, installer, 14, checksum)
    let systemStarted!: () => void
    const started = new Promise<void>((resolve) => { systemStarted = resolve })
    const apiFetch = vi.fn<ReleaseFetch>(() => Promise.resolve(releaseResponse([asset])))
    const systemFetch = vi.fn<ReleaseFetch>(() => new Promise(() => {
      systemStarted()
    }))
    const manager = createManager(directory, apiFetch, systemFetch)
    const running = manager.start()
    await started
    manager.cancel()

    await expect(running).resolves.toMatchObject({ phase: 'cancelled' })
    expect(apiFetch).toHaveBeenCalledOnce()
    await expect(stat(join(directory, releaseStatus().latestVersion, `${installerName}.part`))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('falls back after header and body idle deadlines without imposing a total transfer deadline', async () => {
    const installer = Buffer.from('bounded installer')
    const checksum = createHash('sha256').update(installer).digest('hex')
    const asset = releaseAsset(installerName, installer, 15, checksum)
    for (const mode of ['headers', 'body'] as const) {
      const directory = await temporaryDirectory()
      const apiFetch = vi.fn<ReleaseFetch>(input => Promise.resolve(
        requestUrl(input) === releaseApiUrl ? releaseResponse([asset]) : new Response(installer),
      ))
      const systemFetch = mode === 'headers'
        ? vi.fn<ReleaseFetch>(() => new Promise(() => {}))
        : vi.fn<ReleaseFetch>(() => Promise.resolve(new Response(new ReadableStream<Uint8Array>({ pull() {} }))))
      const manager = createManager(directory, apiFetch, systemFetch, { headerTimeoutMs: 5, idleTimeoutMs: 5 })
      await expect(manager.start()).resolves.toMatchObject({ phase: 'ready' })
    }
  })

  it('joins concurrent starts and disposal waits for cancellation cleanup', async () => {
    const directory = await temporaryDirectory()
    const installer = Buffer.from('dispose installer')
    const checksum = createHash('sha256').update(installer).digest('hex')
    const asset = releaseAsset(installerName, installer, 16, checksum)
    let systemStarted!: () => void
    const started = new Promise<void>((resolve) => { systemStarted = resolve })
    const manager = createManager(
      directory,
      () => Promise.resolve(releaseResponse([asset])),
      () => new Promise(() => {
        systemStarted()
      }),
    )
    const first = manager.start()
    const second = manager.start()
    expect(second).toBe(first)
    await started
    await manager.dispose()
    await expect(first).resolves.toMatchObject({ phase: 'cancelled' })
    await expect(stat(join(directory, releaseStatus().latestVersion, `${installerName}.part`))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('acknowledges background starts immediately and preserves the transfer across unknown discovery states', async () => {
    const directory = await temporaryDirectory()
    const installer = Buffer.from('background installer')
    const checksum = createHash('sha256').update(installer).digest('hex')
    const asset = releaseAsset(installerName, installer, 17, checksum)
    const body = Promise.withResolvers<Response>()
    let selected: DesktopReleaseStatus = releaseStatus()
    const systemFetch = vi.fn<ReleaseFetch>(() => body.promise)
    const openPath = vi.fn(() => Promise.resolve(''))
    const manager = new DesktopReleaseDownloader({
      platform: 'darwin', arch: 'arm64', downloadDirectory: directory,
      getRelease: () => selected, openPath,
      apiFetch: () => Promise.resolve(releaseResponse([asset])), systemFetch,
    })
    expect(manager.startInBackground()).toMatchObject({ phase: 'resolving' })
    const running = manager.start()
    await vi.waitFor(() => { expect(systemFetch).toHaveBeenCalledOnce() })
    for (const state of [
      { phase: 'checking', currentVersion: '0.1.0-rc.7' },
      { phase: 'idle', currentVersion: '0.1.0-rc.7' },
      { phase: 'error', currentVersion: '0.1.0-rc.7', message: 'temporary network interruption' },
    ] satisfies DesktopReleaseStatus[]) {
      selected = state
      manager.resetForRelease(state)
      expect(manager.startInBackground()).not.toMatchObject({ phase: 'cancelled' })
      expect(manager.start()).toBe(running)
    }
    body.resolve(new Response(installer))
    await expect(running).resolves.toMatchObject({ phase: 'ready' })
    expect(openPath).not.toHaveBeenCalled()
    selected = { phase: 'checking', currentVersion: '0.1.0-rc.7' }
    manager.resetForRelease(selected)
    expect(manager.startInBackground()).toMatchObject({ phase: 'ready' })
    await expect(manager.open()).resolves.toEqual({ error: '' })
    expect(openPath).toHaveBeenCalledOnce()
    await manager.dispose()
  })

  it('cancels an active background transfer only after a confirmed release withdrawal', async () => {
    const directory = await temporaryDirectory()
    const installer = Buffer.from('withdrawn background installer')
    const checksum = createHash('sha256').update(installer).digest('hex')
    const asset = releaseAsset(installerName, installer, 18, checksum)
    const systemFetch = vi.fn<ReleaseFetch>(() => new Promise(() => {}))
    const manager = createManager(directory, () => Promise.resolve(releaseResponse([asset])), systemFetch)
    const running = manager.start()
    await vi.waitFor(() => { expect(systemFetch).toHaveBeenCalledOnce() })
    manager.resetForRelease({ phase: 'current', currentVersion: '0.1.0-rc.7' })
    await expect(running).resolves.toMatchObject({ phase: 'cancelled' })
    await expect(manager.open()).resolves.toMatchObject({ error: 'The installer has not finished downloading.' })
    await manager.dispose()
  })

  it('keeps automatic background downloads opt-in and never retries a cancelled version during polling', async () => {
    const directory = await temporaryDirectory()
    const installer = Buffer.from('quiet installer')
    const checksum = createHash('sha256').update(installer).digest('hex')
    const asset = releaseAsset(installerName, installer, 19, checksum)
    const apiFetch = vi.fn<ReleaseFetch>(() => Promise.resolve(releaseResponse([asset])))
    const systemFetch = vi.fn<ReleaseFetch>(() => new Promise(() => {}))
    const manager = createManager(directory, apiFetch, systemFetch)
    manager.resetForRelease(releaseStatus())
    expect(apiFetch).not.toHaveBeenCalled()
    manager.setBackgroundEnabled(true)
    const running = manager.start()
    await vi.waitFor(() => { expect(systemFetch).toHaveBeenCalledOnce() })
    manager.setBackgroundEnabled(false)
    expect(manager.start()).toBe(running)
    manager.setBackgroundEnabled(true)
    manager.cancel()
    await expect(running).resolves.toMatchObject({ phase: 'cancelled' })
    for (let poll = 0; poll < 3; poll++) manager.resetForRelease(releaseStatus())
    expect(apiFetch).toHaveBeenCalledOnce()
    await manager.dispose()
    manager.resetForRelease(releaseStatus())
    manager.setBackgroundEnabled(true)
    expect(apiFetch).toHaveBeenCalledOnce()
  })

  it('waits for an obsolete transfer to settle before automatically starting the new release', async () => {
    const directory = await temporaryDirectory()
    const installer = Buffer.from('new target installer')
    const checksum = createHash('sha256').update(installer).digest('hex')
    const oldAsset = releaseAsset(installerName, installer, 20, checksum)
    const newTag = 'odsh-v0.1.0-rc.9'
    const next = { ...releaseStatus(), latestVersion: '0.1.0-rc.9', tagName: newTag,
      releaseUrl: `https://github.com/flaqai/open-deepseek-harness-desktop/releases/tag/${newTag}` }
    const newAsset = { ...releaseAsset(installerName, installer, 21, checksum),
      browser_download_url: `${releaseUrl.replace(tag, newTag)}${installerName}` }
    let selected = releaseStatus()
    const apiFetch = vi.fn<ReleaseFetch>(input => Promise.resolve(requestUrl(input) === releaseApiUrl
      ? releaseResponse([oldAsset]) : releaseResponse([newAsset], { tag_name: newTag })))
    const systemFetch = vi.fn<ReleaseFetch>(input => requestUrl(input).includes(newTag)
      ? Promise.resolve(new Response(installer)) : new Promise(() => {}))
    const openPath = vi.fn(() => Promise.resolve(''))
    const manager = new DesktopReleaseDownloader({ platform: 'darwin', arch: 'arm64', downloadDirectory: directory,
      getRelease: () => selected, openPath, apiFetch, systemFetch })
    manager.setBackgroundEnabled(true)
    manager.resetForRelease(selected)
    await vi.waitFor(() => { expect(systemFetch).toHaveBeenCalledOnce() })
    selected = next
    manager.resetForRelease(next)
    await vi.waitFor(() => { expect(manager.status).toMatchObject({ phase: 'ready', version: next.latestVersion }) })
    expect(apiFetch).toHaveBeenCalledTimes(2)
    expect(systemFetch).toHaveBeenCalledTimes(2)
    expect(openPath).not.toHaveBeenCalled()
    await manager.dispose()
  })

  it('does not expose an installer when its release is revoked at final verification', async () => {
    const directory = await temporaryDirectory()
    const installer = Buffer.from('revoked during verification')
    const checksum = createHash('sha256').update(installer).digest('hex')
    const asset = releaseAsset(installerName, installer, 22, checksum)
    const retainedInstaller = join(directory, releaseStatus().latestVersion, installerName)
    await mkdir(join(directory, releaseStatus().latestVersion), { recursive: true })
    await writeFile(retainedInstaller, installer)
    const manager = createManager(directory,
      () => Promise.resolve(releaseResponse([asset])), () => Promise.resolve(new Response(installer)))
    const statuses: string[] = []
    const unsubscribe = manager.subscribe((status) => {
      statuses.push(status.phase)
      if (status.phase === 'verifying') manager.resetForRelease({ phase: 'current', currentVersion: '0.1.0-rc.7' })
    })
    await expect(manager.start()).resolves.toMatchObject({ phase: 'cancelled' })
    expect(statuses).not.toContain('ready')
    expect(await readFile(retainedInstaller)).toEqual(installer)
    await expect(manager.open()).resolves.toMatchObject({ error: 'The installer has not finished downloading.' })
    await expect(stat(join(directory, releaseStatus().latestVersion, `${installerName}.part`))).rejects.toMatchObject({ code: 'ENOENT' })
    unsubscribe()
    await manager.dispose()
  })

})

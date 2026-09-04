import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DesktopReleaseDownloader, installerAssetName, isAllowedReleaseAssetUrl, isAllowedReleaseTag,
  readReleaseChecksum,
} from '../src/release-downloader.ts'

const tag = 'odsh-v0.1.0-rc.8'
const installerName = 'DeepSeek-Harness-macos-arm64.dmg'
const releaseUrl = `https://github.com/flaqai/open-deepseek-harness-desktop/releases/download/${tag}/`
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('desktop Release downloader', () => {
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
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url === `https://api.github.com/repos/flaqai/open-deepseek-harness-desktop/releases/tags/${tag}`) {
        return Promise.resolve(new Response(JSON.stringify({
          draft: false,
          tag_name: tag,
          assets: [
            {
              name: installerName,
              size: installer.byteLength,
              digest: `sha256:${checksum}`,
              browser_download_url: installerUrl,
            },
          ],
        }), { status: 200, headers: { 'content-type': 'application/json' } }))
      }
      if (url === installerUrl) return Promise.resolve(new Response(installer))
      return Promise.resolve(new Response('not found', { status: 404 }))
    })
    const openPath = vi.fn(() => Promise.resolve(''))
    const manager = new DesktopReleaseDownloader({
      platform: 'darwin',
      arch: 'arm64',
      downloadDirectory: directory,
      getRelease: () => ({
        phase: 'available',
        currentVersion: '0.1.0-rc.7',
        latestVersion: '0.1.0-rc.8',
        tagName: tag,
        publishedAt: '2026-08-20T00:00:00Z',
        releaseUrl: `https://github.com/flaqai/open-deepseek-harness-desktop/releases/tag/${tag}`,
      }),
      openPath,
      fetch: fetchMock,
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
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url === `https://api.github.com/repos/flaqai/open-deepseek-harness-desktop/releases/tags/${tag}`) {
        return Promise.resolve(new Response(JSON.stringify({
          draft: false,
          tag_name: tag,
          assets: [
            { name: installerName, size: installer.byteLength, browser_download_url: `${releaseUrl}${installerName}` },
            { name: 'SHA256SUMS', size: 100, browser_download_url: `${releaseUrl}SHA256SUMS` },
          ],
        })))
      }
      if (url.endsWith('SHA256SUMS')) return Promise.resolve(new Response(`${'0'.repeat(64)}  ${installerName}\n`))
      return Promise.resolve(new Response(installer))
    })
    const manager = new DesktopReleaseDownloader({
      platform: 'darwin', arch: 'arm64', downloadDirectory: directory,
      getRelease: () => ({
        phase: 'available', currentVersion: '0.1.0-rc.7', latestVersion: '0.1.0-rc.8',
        tagName: tag,
        publishedAt: '2026-08-20T00:00:00Z',
        releaseUrl: `https://github.com/flaqai/open-deepseek-harness-desktop/releases/tag/${tag}`,
      }),
      openPath: vi.fn(() => Promise.resolve('')),
      fetch: fetchMock,
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
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      draft: false,
      prerelease: true,
      tag_name: tag,
      assets: [],
    }))))
    const manager = new DesktopReleaseDownloader({
      platform: 'darwin', arch: 'arm64', downloadDirectory: directory,
      getRelease: () => ({
        phase: 'available', currentVersion: '0.1.0-rc.7', latestVersion: '0.1.0-rc.8',
        tagName: tag,
        publishedAt: '2026-08-20T00:00:00Z',
        releaseUrl: `https://github.com/flaqai/open-deepseek-harness-desktop/releases/tag/${tag}`,
      }),
      openPath: vi.fn(() => Promise.resolve('')),
      fetch: fetchMock,
    })

    await expect(manager.start()).resolves.toMatchObject({
      phase: 'error', message: 'Release is no longer available for in-app updates.',
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})

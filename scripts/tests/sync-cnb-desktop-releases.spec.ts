import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error The workflow entry stays native ESM so GitHub Actions can run it without installing dependencies.
import { CNB_DEFAULT_BRANCH, DEFAULT_CNB_INDEX_TTL_HOURS, DESKTOP_INSTALLER_NAMES, distributableGithubReleases, isDesktopInstallerSet, parseChecksums, syncCnbDesktopReleases } from '../sync-cnb-desktop-releases.mjs'

const checkedParseChecksums = parseChecksums as (source: string) => Map<string, string>
const checkedDistributableReleases = distributableGithubReleases as (releases: unknown[]) => unknown[]
const installerNames = DESKTOP_INSTALLER_NAMES as readonly string[]
const requestUrl = (input: string | URL | Request): string => typeof input === 'string'
  ? input
  : input instanceof URL ? input.href : input.url
const checkedSync = syncCnbDesktopReleases as (options: {
  githubToken: string
  cnbToken: string
  outputPath: string
  targetTag?: string
  cleanupTags?: string[]
  fetchImpl: typeof fetch
  now: Date
  indexTtlHours?: number
}) => Promise<{ revision: number; expiresAt: string; releases: unknown[] }>

describe('CNB desktop Release sync', () => {
  it('mirrors current ZIP delivery and historical releases without accepting partial sets', () => {
    const check = isDesktopInstallerSet as (names: readonly string[]) => boolean
    expect(check(installerNames)).toBe(true)
    expect(check(installerNames.filter(name => !name.endsWith('windows-x64.zip')))).toBe(true)
    expect(check(installerNames.filter(name => !name.endsWith('windows-x64.exe')))).toBe(false)
    expect(check([...installerNames, 'DeepSeek-Harness-windows-x64.zip'])).toBe(false)
  })
  it('accepts only exact checksum lines and excludes withdrawn GitHub releases', () => {
    expect(checkedParseChecksums(`${'a'.repeat(64)}  DeepSeek-Harness-windows-x64.exe\ninvalid ../escape.exe`))
      .toEqual(new Map([['DeepSeek-Harness-windows-x64.exe', 'a'.repeat(64)]]))
    expect(checkedDistributableReleases([
      { draft: false, prerelease: false, tag_name: 'odsh-v1.0.0', published_at: '2026-09-10', assets: [] },
      { draft: false, prerelease: true, tag_name: 'odsh-v1.1.0', published_at: '2026-09-10', assets: [] },
      { draft: true, prerelease: false, tag_name: 'odsh-v1.2.0', published_at: '2026-09-10', assets: [] },
    ])).toHaveLength(1)
  })

  it.each([false, true])('mirrors verified formal assets and rejects a missing ZIP before advancing the index (legacy=%s)', async (legacy) => {
    const selectedNames = legacy ? installerNames.filter(name => !name.endsWith('windows-x64.zip')) : installerNames
    const directory = await mkdtemp(join(tmpdir(), 'dsh-cnb-sync-'))
    const outputPath = join(directory, 'desktop-update-v1.json')
    await writeFile(outputPath, JSON.stringify({ revision: 8 }))
    const installer = Buffer.from('installer')
    const checksum = createHash('sha256').update(installer).digest('hex')
    const checksumText = selectedNames.map(name => `${checksum}  ${name}`).join('\n') + '\n'
    const tag = 'odsh-v1.0.0'
    const githubRelease = {
      draft: false, prerelease: false, tag_name: tag, published_at: '2026-09-10T00:00:00Z',
      assets: [
        { name: 'SHA256SUMS', size: Buffer.byteLength(checksumText), url: 'https://api.github.com/assets/checksums' },
        ...selectedNames.map((name, index) => ({ name, size: installer.byteLength,
          url: `https://api.github.com/assets/installer-${index}` })),
        { name: 'workspace-runtimes-1.0.0.v2.json', size: installer.byteLength,
          url: 'https://api.github.com/assets/runtime-catalog' },
        { name: 'workspace-runtimes.v2.sigstore.json', size: installer.byteLength,
          url: 'https://api.github.com/assets/runtime-signature' },
      ],
    }
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      const url = requestUrl(input)
      if (url.endsWith(`/releases/tags/${tag}`)) return Promise.resolve(Response.json(githubRelease))
      if (url.includes('/-/releases?page=')) return Promise.resolve(Response.json([
        { id: 'old-1', tag_name: 'odsh-v0.9.0', assets: [] },
        { id: 'old-2', tag_name: 'odsh-v0.9.1', assets: [] },
      ]))
      if ((url.endsWith('/-/releases/old-1') || url.endsWith('/-/releases/old-2')) && init?.method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url.endsWith('/assets/checksums')) {
        return Promise.resolve(new Response(checksumText))
      }
      if (url.includes('/assets/installer-') || url.includes('/assets/runtime-')) return Promise.resolve(new Response(installer))
      if (url.endsWith('/-/releases') && init?.method === 'POST') {
        return Promise.resolve(Response.json({ id: 'release-1', tag_name: tag, assets: [] }, { status: 201 }))
      }
      if (url.endsWith('/asset-upload-url')) {
        return Promise.resolve(Response.json({
          upload_url: 'https://uploads.example.test/asset',
          verify_url: 'https://api.cnb.cool/hecoococ/open-deepseek-harness-desktop/-/releases/release-1/assets/asset-1',
        }, { status: 201 }))
      }
      if (url.startsWith('https://uploads.example.test/')) return Promise.resolve(new Response(null, { status: 204 }))
      if (init?.method === 'HEAD') {
        return Promise.resolve(new Response(null, { status: 200, headers: { 'content-length': String(installer.byteLength) } }))
      }
      if (url.includes('/assets/asset-1') && init?.method === 'POST') {
        return Promise.resolve(new Response(null, { status: 200 }))
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    })
    const result = await checkedSync({
      githubToken: 'github-token', cnbToken: 'cnb-token', outputPath, fetchImpl: fetchMock,
      targetTag: tag, cleanupTags: ['odsh-v0.9.0', 'odsh-v0.9.1'],
      now: new Date('2026-09-10T01:00:00Z'),
    })
    expect(result.revision).toBe(9)
    expect(result.expiresAt).toBe('2026-09-10T07:00:00.000Z')
    expect(DEFAULT_CNB_INDEX_TTL_HOURS).toBe(6)
    expect(result.releases).toHaveLength(1)
    expect((result.releases[0] as { assets: unknown[] }).assets).toHaveLength(selectedNames.length)
    expect(fetchMock.mock.calls.some(([input]) => requestUrl(input).endsWith('/assets/runtime-catalog'))).toBe(false)
    expect(JSON.parse(await readFile(outputPath, 'utf8'))).toMatchObject({ revision: 9 })
    expect(CNB_DEFAULT_BRANCH).toBe('master')
    const createReleaseCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      return url.endsWith('/-/releases') && init?.method === 'POST'
    })
    const createReleaseBody = createReleaseCall?.[1]?.body
    if (typeof createReleaseBody !== 'string') throw new TypeError('expected a serialized CNB Release request')
    expect(JSON.parse(createReleaseBody)).toMatchObject({ target_commitish: 'master' })
    const deletedUrls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE').map(([input]) => requestUrl(input))
    expect(deletedUrls).toEqual([
      'https://api.cnb.cool/hecoococ/open-deepseek-harness-desktop/-/releases/old-1',
      'https://api.cnb.cool/hecoococ/open-deepseek-harness-desktop/-/releases/old-2',
    ])
    expect(fetchMock.mock.calls.some(([input]) => requestUrl(input).includes('releases?per_page=20'))).toBe(false)
    if (!legacy) {
      githubRelease.assets = githubRelease.assets.filter(asset => !asset.name.endsWith('windows-x64.zip'))
      await expect(checkedSync({ githubToken: 'github-token', cnbToken: 'cnb-token', outputPath,
        targetTag: tag, fetchImpl: fetchMock, now: new Date('2026-09-10T01:00:00Z') }))
        .rejects.toThrow('installer assets and SHA256SUMS disagree')
      expect(JSON.parse(await readFile(outputPath, 'utf8'))).toMatchObject({ revision: 9 })
    }
  })

  it('refuses to publish an index for an incomplete installer set', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-cnb-sync-incomplete-'))
    const tag = 'odsh-v1.0.0'
    const installer = Buffer.from('installer')
    const checksum = createHash('sha256').update(installer).digest('hex')
    const checksumText = `${checksum}  DeepSeek-Harness-windows-x64.exe\n`
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const url = requestUrl(input)
      if (url.endsWith(`/releases/tags/${tag}`)) return Promise.resolve(Response.json({ draft: false, prerelease: false,
        tag_name: tag, published_at: '2026-09-10T00:00:00Z', assets: [
          { name: 'SHA256SUMS', size: Buffer.byteLength(checksumText), url: 'https://api.github.com/assets/checksums' },
          { name: 'DeepSeek-Harness-windows-x64.exe', size: installer.byteLength,
            url: 'https://api.github.com/assets/installer' },
        ] }))
      if (url.includes('/-/releases?page=')) return Promise.resolve(Response.json([]))
      if (url.endsWith('/assets/checksums')) return Promise.resolve(new Response(checksumText))
      return Promise.resolve(new Response(null, { status: 404 }))
    })
    await expect(checkedSync({ githubToken: 'github-token', cnbToken: 'cnb-token',
      outputPath: join(directory, 'index.json'), targetTag: tag, fetchImpl: fetchMock,
      now: new Date('2026-09-10T01:00:00Z') })).rejects.toThrow('does not contain the exact desktop installer set')
  })

  it('rejects an unsafe index lifetime before accessing either provider', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    await expect(checkedSync({ githubToken: 'github-token', cnbToken: 'cnb-token',
      outputPath: '/unused/index.json', fetchImpl: fetchMock, now: new Date('2026-09-10T01:00:00Z'),
      indexTtlHours: 0 })).rejects.toThrow('CNB index TTL hours must be an integer from 1 through 168')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses to delete the selected target Release', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-cnb-sync-target-delete-'))
    const tag = 'odsh-v1.0.0'
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const url = requestUrl(input)
      if (url.endsWith(`/releases/tags/${tag}`)) {
        return Promise.resolve(Response.json({ draft: false, prerelease: false, tag_name: tag,
          published_at: '2026-09-10T00:00:00Z', assets: [] }))
      }
      if (url.includes('/-/releases?page=')) return Promise.resolve(Response.json([]))
      return Promise.resolve(new Response(null, { status: 404 }))
    })
    await expect(checkedSync({ githubToken: 'github-token', cnbToken: 'cnb-token',
      outputPath: join(directory, 'index.json'), targetTag: tag, cleanupTags: [tag], fetchImpl: fetchMock,
      now: new Date('2026-09-10T01:00:00Z') })).rejects.toThrow(`refusing to delete the target CNB Release: ${tag}`)
  })
})

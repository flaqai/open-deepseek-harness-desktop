import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error The workflow entry stays native ESM so GitHub Actions can run it without installing dependencies.
import { CNB_DEFAULT_BRANCH, distributableGithubReleases, parseChecksums, syncCnbDesktopReleases } from '../sync-cnb-desktop-releases.mjs'

const checkedParseChecksums = parseChecksums as (source: string) => Map<string, string>
const checkedDistributableReleases = distributableGithubReleases as (releases: unknown[]) => unknown[]
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
}) => Promise<{ revision: number; releases: unknown[] }>

describe('CNB desktop Release sync', () => {
  it('accepts only exact checksum lines and excludes withdrawn GitHub releases', () => {
    expect(checkedParseChecksums(`${'a'.repeat(64)}  DeepSeek-Harness-windows-x64.exe\ninvalid ../escape.exe`))
      .toEqual(new Map([['DeepSeek-Harness-windows-x64.exe', 'a'.repeat(64)]]))
    expect(checkedDistributableReleases([
      { draft: false, prerelease: false, tag_name: 'odsh-v1.0.0', published_at: '2026-09-10', assets: [] },
      { draft: false, prerelease: true, tag_name: 'odsh-v1.1.0', published_at: '2026-09-10', assets: [] },
      { draft: true, prerelease: false, tag_name: 'odsh-v1.2.0', published_at: '2026-09-10', assets: [] },
    ])).toHaveLength(1)
  })

  it('mirrors verified formal assets before advancing the existing index revision', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-cnb-sync-'))
    const outputPath = join(directory, 'desktop-update-v1.json')
    await writeFile(outputPath, JSON.stringify({ revision: 8 }))
    const installer = Buffer.from('installer')
    const checksum = createHash('sha256').update(installer).digest('hex')
    const tag = 'odsh-v1.0.0'
    const githubRelease = {
      draft: false, prerelease: false, tag_name: tag, published_at: '2026-09-10T00:00:00Z',
      assets: [
        { name: 'SHA256SUMS', size: 64 + 2 + 'DeepSeek-Harness-windows-x64.exe'.length + 1,
          url: 'https://api.github.com/assets/checksums' },
        { name: 'DeepSeek-Harness-windows-x64.exe', size: installer.byteLength,
          url: 'https://api.github.com/assets/installer' },
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
        return Promise.resolve(new Response(`${checksum}  DeepSeek-Harness-windows-x64.exe\n`))
      }
      if (url.endsWith('/assets/installer')) return Promise.resolve(new Response(installer))
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
    expect(result.releases).toHaveLength(1)
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

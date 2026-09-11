import { describe, expect, it } from 'vitest'
import { CNB_UPDATE_INDEX_URL, parseCnbReleaseIndex, selectCnbRelease } from '../src/cnb-release-source.ts'

const now = Date.parse('2026-09-10T12:00:00Z')
const index = {
  schema: 'open-dsh-desktop/cnb-update-index/v1', revision: 3,
  generatedAt: '2026-09-10T11:00:00Z', expiresAt: '2026-09-10T13:00:00Z',
  releases: [{
    version: '0.1.5-rc.2', tagName: 'odsh-v0.1.5-rc.2', publishedAt: '2026-09-10T11:00:00Z',
    releaseUrl: 'https://cnb.cool/hecoococ/open-deepseek-harness-desktop/-/releases/tag/odsh-v0.1.5-rc.2',
    withdrawn: false,
    assets: [{ name: 'DeepSeek-Harness-windows-x64.exe', size: 42,
      sha256: 'a'.repeat(64), url: 'https://cnb.cool/hecoococ/open-deepseek-harness-desktop/-/releases/download/odsh-v0.1.5-rc.2/DeepSeek-Harness-windows-x64.exe' }],
  }],
} as const

describe('CNB Release source', () => {
  it('reads the anonymous index from the configured master branch', () => {
    expect(CNB_UPDATE_INDEX_URL).toBe('https://cnb.cool/hecoococ/open-deepseek-harness-desktop/-/git/raw/master/desktop-update-v1.json')
  })

  it('validates a fresh index and selects its newest release independently', () => {
    const parsed = parseCnbReleaseIndex(index, now)
    expect(selectCnbRelease('0.1.5-rc.1', parsed)).toMatchObject({
      phase: 'available', latestVersion: '0.1.5-rc.2', source: 'cnb',
    })
  })

  it('rejects expired indexes, foreign assets, and withdrawn releases', () => {
    expect(() => parseCnbReleaseIndex(index, Date.parse('2026-09-10T14:00:00Z'))).toThrow(/expired/u)
    expect(() => parseCnbReleaseIndex({ ...index, releases: [{ ...index.releases[0], assets: [{
      ...index.releases[0].assets[0], url: 'https://example.test/file.exe',
    }] }] }, now)).toThrow(/asset/u)
    const withdrawn = parseCnbReleaseIndex({ ...index, releases: [{ ...index.releases[0], withdrawn: true }] }, now)
    expect(selectCnbRelease('0.1.5-rc.1', withdrawn)).toEqual({ phase: 'current', currentVersion: '0.1.5-rc.1' })
  })
})

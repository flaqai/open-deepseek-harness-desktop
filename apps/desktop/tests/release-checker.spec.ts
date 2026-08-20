import { describe, expect, it, vi } from 'vitest'
import {
  compareDesktopVersions, DesktopReleaseChecker, isAllowedReleaseUrl, selectRelease,
} from '../src/release-checker.ts'

const url = 'https://github.com/flaqai/open-deepseek-harness-desktop/releases/tag/dsh-v0.1.0-rc.8'

describe('desktop Release checker', () => {
  it('compares stable and prerelease semantic versions', () => {
    expect(compareDesktopVersions('0.1.0-rc.8', '0.1.0-rc.7')).toBe(1)
    expect(compareDesktopVersions('0.1.0', '0.1.0-rc.99')).toBe(1)
    expect(compareDesktopVersions('invalid', '0.1.0')).toBeUndefined()
  })

  it('allows only Release pages from the configured repository', () => {
    expect(isAllowedReleaseUrl(url)).toBe(true)
    expect(isAllowedReleaseUrl('https://github.com/example/project/releases/tag/x')).toBe(false)
    expect(isAllowedReleaseUrl('javascript:alert(1)')).toBe(false)
  })

  it('accepts prereleases for an rc client but not for a stable client', () => {
    const releases = [{
      draft: false, prerelease: true, tag_name: 'dsh-v0.1.0-rc.8', html_url: url,
      published_at: '2026-08-20T00:00:00Z',
    }]
    expect(selectRelease('0.1.0-rc.7', releases)).toMatchObject({ phase: 'available', latestVersion: '0.1.0-rc.8' })
    expect(selectRelease('0.1.0', releases)).toEqual({ phase: 'current', currentVersion: '0.1.0' })
  })

  it('coalesces concurrent checks and contains request failures', async () => {
    const fetchReleases = vi.fn(() => Promise.reject(new Error('offline')))
    const checker = new DesktopReleaseChecker('0.1.0-rc.7', fetchReleases)
    const first = checker.check()
    const second = checker.check()
    expect(first).toBe(second)
    await expect(first).resolves.toMatchObject({ phase: 'error', message: 'offline' })
    expect(fetchReleases).toHaveBeenCalledOnce()
  })
})

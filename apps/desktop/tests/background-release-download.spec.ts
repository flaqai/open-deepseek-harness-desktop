import { describe, expect, it, vi } from 'vitest'
import { BackgroundReleaseDownloads } from '../src/background-release-download.ts'
import type { DesktopReleaseStatus } from '../src/release-checker.ts'

const available: DesktopReleaseStatus = {
  phase: 'available', currentVersion: '0.2.2-rc.1', latestVersion: '0.2.2-rc.2',
  tagName: 'odsh-v0.2.2-rc.2', publishedAt: '2026-11-08T00:00:00Z',
  releaseUrl: 'https://github.com/flaqai/open-deepseek-harness-desktop/releases/tag/odsh-v0.2.2-rc.2',
}

describe('background release downloads', () => {
  it('does nothing until the user enables automatic downloads', () => {
    const start = vi.fn()
    const background = new BackgroundReleaseDownloads(false, start)
    background.observe(available)
    expect(start).not.toHaveBeenCalled()
    background.setEnabled(true)
    expect(start).toHaveBeenCalledOnce()
  })

  it('starts once per selected release without retrying cancellation or failure on every poll', () => {
    const start = vi.fn()
    const background = new BackgroundReleaseDownloads(true, start)
    background.observe(available)
    background.observe({ phase: 'checking', currentVersion: available.currentVersion })
    background.observe({ phase: 'error', currentVersion: available.currentVersion, message: 'offline' })
    background.observe(available)
    background.observe(available)
    expect(start).toHaveBeenCalledOnce()
    background.observe({ ...available, latestVersion: '0.2.2-rc.3', tagName: 'odsh-v0.2.2-rc.3' })
    background.observe(available)
    expect(start).toHaveBeenCalledTimes(2)
  })

  it('disabling prevents future automatic starts; explicit re-enabling can retry', () => {
    const start = vi.fn()
    const background = new BackgroundReleaseDownloads(true, start)
    background.observe(available)
    background.setEnabled(false)
    background.observe({ ...available, latestVersion: '0.2.2-rc.3', tagName: 'odsh-v0.2.2-rc.3' })
    expect(start).toHaveBeenCalledOnce()
    background.setEnabled(true)
    expect(start).toHaveBeenCalledTimes(2)
    background.setEnabled(false)
    background.setEnabled(true)
    expect(start).toHaveBeenCalledTimes(3)
  })

  it('never downloads current or unavailable releases and retains no selection after revocation', () => {
    const start = vi.fn()
    const background = new BackgroundReleaseDownloads(false, start)
    background.observe(available)
    background.observe({ phase: 'current', currentVersion: available.currentVersion })
    background.setEnabled(true)
    expect(start).not.toHaveBeenCalled()
  })
  it('retries a deferred target when ownership becomes available, without retrying an accepted attempt', () => {
    const start = vi.fn<() => boolean>().mockReturnValueOnce(false).mockReturnValue(true)
    const background = new BackgroundReleaseDownloads(true, start)
    background.observe(available)
    background.observe(available)
    background.observe(available)
    expect(start).toHaveBeenCalledTimes(2)
  })

  it('ignores checker and preference changes after disposal', () => {
    const start = vi.fn()
    const background = new BackgroundReleaseDownloads(false, start)
    background.observe(available)
    background.dispose()
    background.setEnabled(true)
    background.observe(available)
    expect(start).not.toHaveBeenCalled()
  })

})

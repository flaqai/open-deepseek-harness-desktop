import { describe, expect, it } from 'vitest'
import {
  clampStartupProgress,
  mapBundledPluginProgress,
  parseDesktopStartupProgress,
} from '../src/startup-progress.ts'

describe('desktop startup progress', () => {
  it('maps ordered plugin milestones into the reserved startup interval', () => {
    const first = mapBundledPluginProgress('dshmarket', 0, 2, 'extracting', 46)
    const second = mapBundledPluginProgress('dsh-im', 1, 2, 'verifying', 8)

    expect(first).toEqual({ stage: 'extracting-plugin', progress: 47, detail: 'dshmarket' })
    expect(second).toEqual({ stage: 'verifying-plugin', progress: 62, detail: 'dsh-im' })
    expect(second.progress).toBeGreaterThan(first.progress)
  })

  it('clamps percentages and rejects malformed IPC values', () => {
    expect(clampStartupProgress(110.2)).toBe(100)
    expect(clampStartupProgress(-4.8)).toBe(0)
    expect(clampStartupProgress(Number.NaN)).toBe(0)
    expect(parseDesktopStartupProgress({ stage: 'checking-profile', progress: 28 })).toEqual({
      stage: 'checking-profile', progress: 28,
    })
    expect(parseDesktopStartupProgress({
      stage: 'checking-profile', progress: 28, startedAt: 10, deadlineAt: 20, state: 'degraded',
    })).toEqual({
      stage: 'checking-profile', progress: 28, startedAt: 10, deadlineAt: 20, state: 'degraded',
    })
    expect(parseDesktopStartupProgress({ stage: 'ready', progress: 99.6, detail: 'x'.repeat(200) }))
      .toEqual({ stage: 'ready', progress: 100, detail: 'x'.repeat(160) })
    expect(parseDesktopStartupProgress({ stage: 'unknown', progress: 20 })).toBeUndefined()
    expect(parseDesktopStartupProgress({ stage: 'ready', progress: '100' })).toBeUndefined()
    expect(parseDesktopStartupProgress({ stage: 'ready', progress: 100, detail: 1 })).toBeUndefined()
    expect(parseDesktopStartupProgress({ stage: 'ready', progress: 100, state: 'stuck' })).toBeUndefined()
    expect(parseDesktopStartupProgress(null)).toBeUndefined()
  })
})

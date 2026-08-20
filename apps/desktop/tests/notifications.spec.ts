import { describe, expect, it } from 'vitest'
import { createNotificationThrottle, desktopNotificationDictionary } from '../src/notifications.ts'

describe('desktop notifications', () => {
  it('selects Chinese copy only for Chinese locales', () => {
    expect(desktopNotificationDictionary('zh-CN').restart.title).toContain('恢复')
    expect(desktopNotificationDictionary('en-US').restart.title).toContain('recovering')
  })

  it('throttles each notification key independently', () => {
    const allow = createNotificationThrottle(60_000)
    expect(allow('restart', 100_000)).toBe(true)
    expect(allow('restart', 120_000)).toBe(false)
    expect(allow('failed', 120_000)).toBe(true)
    expect(allow('restart', 160_000)).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import { usesCustomWindowFrame } from '../src/window-frame.ts'

describe('desktop window frame policy', () => {
  it.each(['win32', 'linux'] as const)('uses Harness window chrome on %s', (platform) => {
    expect(usesCustomWindowFrame(platform)).toBe(true)
  })

  it('keeps the native macOS title bar', () => {
    expect(usesCustomWindowFrame('darwin')).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import {
  CUSTOM_WINDOW_TITLE_BAR_HEIGHT,
  usesCustomWindowFrame,
  withCustomWindowFrameInset,
} from '../src/window-frame.ts'

describe('desktop window frame policy', () => {
  it.each(['win32', 'linux'] as const)('uses Harness window chrome on %s', (platform) => {
    expect(usesCustomWindowFrame(platform)).toBe(true)
  })

  it('keeps the native macOS title bar', () => {
    expect(usesCustomWindowFrame('darwin')).toBe(false)
  })

  it.each(['win32', 'linux'] as const)('declares the custom title-bar inset on %s', (platform) => {
    const url = new URL(withCustomWindowFrameInset('http://127.0.0.1:64174/?token=one#session', platform))

    expect(url.searchParams.get('token')).toBe('one')
    expect(url.searchParams.get('dsh-desktop-mode')).toBe('advanced')
    expect(url.searchParams.get('dsh-desktop-platform')).toBe(platform)
    expect(url.searchParams.get('dsh-desktop-titlebar-inset')).toBe(String(CUSTOM_WINDOW_TITLE_BAR_HEIGHT))
    expect(url.hash).toBe('#session')
  })

  it('does not stamp the macOS Harness URL', () => {
    const url = 'http://127.0.0.1:64174/?token=one#session'
    expect(withCustomWindowFrameInset(url, 'darwin')).toBe(url)
  })
})

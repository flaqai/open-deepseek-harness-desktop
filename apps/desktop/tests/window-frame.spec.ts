import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CUSTOM_WINDOW_TITLE_BAR_HEIGHT,
  harnessContentBounds,
  isDesktopRenderer,
  usesCustomWindowFrame,
  withDesktopWindowMetadata,
} from '../src/window-frame.ts'

const readUtf8 = readFileSync as unknown as (path: URL, encoding: 'utf8') => string

describe('desktop window frame policy', () => {
  it.each(['win32', 'linux'] as const)('uses Harness window chrome on %s', (platform) => {
    expect(usesCustomWindowFrame(platform)).toBe(true)
  })

  it('keeps the native macOS title bar', () => {
    expect(usesCustomWindowFrame('darwin')).toBe(false)
  })

  it('does not grant one renderer another renderer\'s IPC capabilities', () => {
    const harnessRenderer = {}
    const titlebarRenderer = {}

    expect(isDesktopRenderer(harnessRenderer, harnessRenderer)).toBe(true)
    expect(isDesktopRenderer(titlebarRenderer, harnessRenderer)).toBe(false)
    expect(isDesktopRenderer(harnessRenderer, undefined)).toBe(false)
  })

  it.each(['win32', 'linux'] as const)('declares a contained Harness viewport on %s', (platform) => {
    const url = new URL(withDesktopWindowMetadata('http://127.0.0.1:64174/?token=one#session', platform))

    expect(url.searchParams.get('token')).toBe('one')
    expect(url.searchParams.get('dsh-desktop-mode')).toBe('advanced')
    expect(url.searchParams.get('dsh-desktop-platform')).toBe(platform)
    expect(url.searchParams.get('dsh-desktop-titlebar-inset')).toBe('0')
    expect(url.hash).toBe('#session')
  })

  it('does not stamp the macOS Harness URL', () => {
    const url = 'http://127.0.0.1:64174/?token=one#session'
    expect(withDesktopWindowMetadata(url, 'darwin')).toBe(url)
  })

  it('places the Harness renderer below the custom title bar', () => {
    expect(harnessContentBounds(1440, 920)).toEqual({
      x: 0,
      y: CUSTOM_WINDOW_TITLE_BAR_HEIGHT,
      width: 1440,
      height: 920 - CUSTOM_WINDOW_TITLE_BAR_HEIGHT,
    })
    expect(harnessContentBounds(100.9, 20.8)).toEqual({ x: 0, y: 20, width: 100, height: 0 })
    expect(harnessContentBounds(-1, -2)).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })

  it('keeps title-bar markup out of the Harness preload', () => {
    const preload = readUtf8(new URL('../src/preload.ts', import.meta.url), 'utf8')

    expect(preload).not.toContain('dsh-desktop-titlebar')
    expect(preload).not.toContain('dsh-desktop-custom-frame')
  })

  it('lets full-viewport client surfaces fill only the contained renderer', () => {
    const files = [
      '../../../packages/client/ui-primitives/src/Modal.module.css',
      '../../../packages/client/ui-settings-account/src/client/OnboardingSurface.module.css',
      '../../../packages/client/ui-attachment/src/DropOverlay.module.css',
      '../../../packages/client/ui-primitives/src/ImageLightbox.module.css',
      '../../../packages/client/ui-settings-general/src/client/SettingsRoot.module.css',
      '../../../packages/client/ui-settings-models/src/client/OnboardingModal.module.css',
      '../../../packages/client/ui-settings-models/src/client/SetupWizard.module.css',
    ]

    for (const file of files) {
      const css = readUtf8(new URL(file, import.meta.url), 'utf8')
      expect(css, file).not.toContain('--dsh-desktop-titlebar-inset')
    }
  })

  it('ships an isolated title-bar page and preload', () => {
    const html = readUtf8(new URL('../src/titlebar.html', import.meta.url), 'utf8')
    const preload = readUtf8(new URL('../src/titlebar-preload.ts', import.meta.url), 'utf8')
    const surface = readUtf8(new URL('../src/desktop-window-surface.ts', import.meta.url), 'utf8')
    const main = readUtf8(new URL('../src/main.ts', import.meta.url), 'utf8')

    expect(html).toContain('Content-Security-Policy')
    expect(html).toContain('data-action="close"')
    expect(html).toContain('height: 36px;')
    expect(preload).toContain("ipcRenderer.send('dsh:window:close')")
    expect(surface).toContain('new WebContentsView')
    expect(surface).toContain('contentView.setBounds(harnessContentBounds(')
    expect(surface).toContain('return createNativeSurface(options)')
    expect(main).toContain('if (!event.defaultPrevented) surface.dispose()')
  })
})

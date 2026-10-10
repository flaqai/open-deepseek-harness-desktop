// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FontFamilies, ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import { fontFamilyVariable } from '@deepseek-ai/dsh-client-ui-theme/src/theme-settings.ts'
import { CHAT_BACKGROUND_LAYOUT_ATTRIBUTE, COLOR_SCHEME_SOURCE_ATTRIBUTE, DARK_ATTRIBUTE, THEME_SOURCE_ATTRIBUTE, ThemePresenter } from '@deepseek-ai/dsh-client-ui-layout/src/client/theme-presenter.ts'

const LIGHT_THEME_COLOR = 'rgb(255, 255, 255)'
const DARK_THEME_COLOR = 'rgb(21, 21, 23)'

function snapshot(
  colorScheme: 'light' | 'dark',
  tokens: Record<string, string> = {},
  background: ThemeSnapshot['background'] = { id: 'none' },
  preference: ThemeSnapshot['preference'] = colorScheme,
  fontSize = 14,
  fontFamilies: FontFamilies = { text: '', code: '', terminal: '' },
): ThemeSnapshot {
  // The presenter must key off colorScheme, not the id — keep them distinct.
  const active = { id: `${colorScheme}-test`, colorScheme, tokens }
  return {
    preference, fontSizes: { text: fontSize, code: 11, terminal: 13 }, fontFamilies,
    active, themes: [active], background, revision: 1,
  }
}

function clearThemePresentation(): void {
  document.head.querySelectorAll('meta[name="theme-color"], style[data-theme-presenter-test]').forEach((node) => { node.remove() })
}

function themeColorMeta(): HTMLMetaElement | null {
  return document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
}

beforeEach(() => {
  clearThemePresentation()
  document.documentElement.style.removeProperty('color-scheme')
  document.documentElement.removeAttribute(COLOR_SCHEME_SOURCE_ATTRIBUTE)
  document.documentElement.removeAttribute(THEME_SOURCE_ATTRIBUTE)
  document.body.removeAttribute(DARK_ATTRIBUTE)
  document.body.removeAttribute('style')
  const style = document.createElement('style')
  style.dataset.themePresenterTest = ''
  style.textContent = `
    body { background-color: ${LIGHT_THEME_COLOR}; }
    body[${DARK_ATTRIBUTE}] { background-color: ${DARK_THEME_COLOR}; }
  `
  document.head.append(style)
})

afterEach(clearThemePresentation)

describe('ThemePresenter', () => {
  it('light scheme sets root color-scheme and leaves the dark attribute absent', () => {
    const presenter = new ThemePresenter()
    presenter.apply(snapshot('light'))
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(document.documentElement.getAttribute(COLOR_SCHEME_SOURCE_ATTRIBUTE)).toBe('light')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(false)
    expect(themeColorMeta()?.content).toBe(LIGHT_THEME_COLOR)
  })

  it('keeps system following distinct from a fixed dark palette for desktop chrome', () => {
    const presenter = new ThemePresenter()
    presenter.apply(snapshot('dark', {}, { id: 'none' }, 'system'))
    expect(document.documentElement.getAttribute(COLOR_SCHEME_SOURCE_ATTRIBUTE)).toBe('system')
    expect(document.documentElement.getAttribute(THEME_SOURCE_ATTRIBUTE)).toBe('system')
    presenter.apply(snapshot('dark'))
    expect(document.documentElement.getAttribute(COLOR_SCHEME_SOURCE_ATTRIBUTE)).toBe('dark')
    expect(document.documentElement.getAttribute(THEME_SOURCE_ATTRIBUTE)).toBe('dark')
  })

  it('dark scheme sets root color-scheme, the attribute, and metadata; switching to light updates one node', () => {
    const presenter = new ThemePresenter()
    presenter.apply(snapshot('dark'))
    const meta = themeColorMeta()
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(true)
    expect(meta?.content).toBe(DARK_THEME_COLOR)
    presenter.apply(snapshot('light'))
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(false)
    expect(themeColorMeta()).toBe(meta)
    expect(meta?.content).toBe(LIGHT_THEME_COLOR)
    expect(document.head.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1)
  })

  it('applies tokens as inline variables and clears the previous set on theme change', () => {
    const presenter = new ThemePresenter()
    presenter.apply(snapshot('dark', { '--dsw-alias-bg': '#111', '--dsw-alias-fg': '#eee' }))
    expect(document.body.style.getPropertyValue('--dsw-alias-bg')).toBe('#111')
    expect(document.body.style.getPropertyValue('--dsw-alias-fg')).toBe('#eee')
    presenter.apply(snapshot('light', { '--dsw-alias-bg': '#fff' }))
    expect(document.body.style.getPropertyValue('--dsw-alias-bg')).toBe('#fff')
    // The old theme's extra variable is gone, not merged.
    expect(document.body.style.getPropertyValue('--dsw-alias-fg')).toBe('')
  })

  it('projects and retracts the selected chat background', () => {
    const presenter = new ThemePresenter()
    presenter.apply(snapshot('dark', {}, {
      id: 'anime-starlight', url: '/anime.webp', layout: 'focus-right',
    }))
    expect(document.body.dataset.dshChatBackground).toBe('anime-starlight')
    expect(document.body.getAttribute(CHAT_BACKGROUND_LAYOUT_ATTRIBUTE)).toBe('focus-right')
    expect(document.body.style.getPropertyValue('--dsh-chat-background-image')).toContain('/anime.webp')
    presenter.apply(snapshot('dark'))
    expect(document.body.hasAttribute('data-dsh-chat-background')).toBe(false)
    expect(document.body.hasAttribute(CHAT_BACKGROUND_LAYOUT_ATTRIBUTE)).toBe(false)
    expect(document.body.style.getPropertyValue('--dsh-chat-background-image')).toBe('')
  })

  it('publishes the content font size and follows changes', () => {
    const presenter = new ThemePresenter()
    presenter.apply(snapshot('light'))
    expect(document.body.style.getPropertyValue('--dsh-content-font-size')).toBe('14px')
    expect(document.body.style.getPropertyValue('--dsh-code-font-size')).toBe('11px')
    expect(document.body.style.getPropertyValue('--dsh-terminal-font-size')).toBe('13px')
    presenter.apply(snapshot('light', {}, { id: 'none' }, 'light', 17))
    expect(document.body.style.getPropertyValue('--dsh-content-font-size')).toBe('17px')
  })

  it('publishes non-empty font lists and removes a list once it returns to the built-in stack', () => {
    const presenter = new ThemePresenter()
    presenter.apply(snapshot('light', {}, { id: 'none' }, 'light', 14, { text: '"Inter"', code: '"Iosevka"', terminal: '"Hack"' }))
    // The presenter writes the same variables the ui-theme boot script and token sheet use.
    for (const [kind, list] of [['text', '"Inter"'], ['code', '"Iosevka"'], ['terminal', '"Hack"']] as const) {
      expect(document.body.style.getPropertyValue(fontFamilyVariable(kind))).toBe(list)
    }
    presenter.apply(snapshot('light', {}, { id: 'none' }, 'light', 14, { text: '"Inter"', code: '"Iosevka"', terminal: '' }))
    expect(document.body.style.getPropertyValue('--dsh-font-family-text')).toBe('"Inter"')
    expect(document.body.style.getPropertyValue('--dsh-font-family-code')).toBe('"Iosevka"')
    expect(document.body.style.getPropertyValue('--dsh-font-family-terminal')).toBe('')
    presenter.apply(snapshot('light', {}, { id: 'none' }, 'light', 14, { text: '', code: '"Iosevka"', terminal: '"MesloLGS NF"' }))
    expect(document.body.style.getPropertyValue('--dsh-font-family-text')).toBe('')
    expect(document.body.style.getPropertyValue('--dsh-font-family-terminal')).toBe('"MesloLGS NF"')
    presenter.dispose()
    expect(document.body.style.getPropertyValue('--dsh-font-family-code')).toBe('')
    expect(document.body.style.getPropertyValue('--dsh-font-family-terminal')).toBe('')
  })

  it('publishes the theme source: system stays system, fixed preferences publish the resolved scheme', () => {
    const presenter = new ThemePresenter()
    presenter.apply(snapshot('dark', {}, { id: 'none' }, 'system', 14))
    expect(document.documentElement.getAttribute(THEME_SOURCE_ATTRIBUTE)).toBe('system')
    presenter.apply(snapshot('dark'))
    expect(document.documentElement.getAttribute(THEME_SOURCE_ATTRIBUTE)).toBe('dark')
    presenter.dispose()
    expect(document.documentElement.hasAttribute(THEME_SOURCE_ATTRIBUTE)).toBe(false)
  })

  it('dispose removes color-scheme, the attribute, the font-size axis, and every applied variable, sparing foreign inline styles', () => {
    document.body.style.setProperty('--foreign', 'kept')
    const presenter = new ThemePresenter()
    presenter.apply(snapshot('dark', { '--dsw-alias-bg': '#111' }))
    const meta = themeColorMeta()
    presenter.dispose()
    expect(document.documentElement.style.colorScheme).toBe('')
    expect(document.documentElement.hasAttribute(COLOR_SCHEME_SOURCE_ATTRIBUTE)).toBe(false)
    expect(document.documentElement.hasAttribute(THEME_SOURCE_ATTRIBUTE)).toBe(false)
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(false)
    expect(document.body.style.getPropertyValue('--dsw-alias-bg')).toBe('')
    expect(document.body.style.getPropertyValue('--dsh-content-font-size')).toBe('')
    expect(document.body.style.getPropertyValue('--dsh-code-font-size')).toBe('')
    expect(document.body.style.getPropertyValue('--foreign')).toBe('kept')
    expect(meta?.isConnected).toBe(false)
  })
})

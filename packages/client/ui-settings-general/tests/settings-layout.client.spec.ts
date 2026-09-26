/** Settings-panel geometry contract for contributed navigation and short viewports. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/SettingsRoot.module.css', import.meta.url)), 'utf8')

/** Read one exact selector's declarations from the CSS module source. */
function declarations(selector: string): Map<string, string> {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  for (const [, selectors = '', body = ''] of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectors.split(',').map(value => value.trim()).includes(selector)) continue
    const found = new Map<string, string>()
    for (const part of body.split(';')) {
      const colon = part.indexOf(':')
      if (colon === -1) continue
      found.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, ' '))
    }
    return found
  }
  return new Map()
}

describe('SettingsRoot.module.css geometry', () => {
  it('uses the renderer viewport without a desktop-titlebar offset', () => {
    expect(declarations('.overlay').get('inset')).toBe('0')
    expect(declarations('.panel').get('height')).toBe('min(800px, calc(100vh - 2 * max(24px, var(--dsh-frame-top-clearance, 24px))))')
    expect(declarations('.onboardingPanel').get('height')).toBe('min(820px, calc(100vh - 48px))')
    expect(declarations('.header').get('align-items')).toBe('center')
    expect(declarations('.actions').get('align-items')).toBe('center')
  })

  it('gives contributed navigation its own non-collapsing scrollport', () => {
    const nav = declarations('.nav')
    const list = declarations('.navList')
    const item = declarations('.navItem')

    expect(nav.get('min-height')).toBe('0')
    expect(nav.get('overflow')).toBe('hidden')
    expect(list.get('flex')).toBe('1')
    expect(list.get('min-height')).toBe('0')
    expect(list.get('overflow-y')).toBe('auto')
    expect(list.get('overscroll-behavior')).toBe('contain')
    expect(list.get('scrollbar-gutter')).toBe('stable')
    expect(list.get('position')).toBe('relative')
    expect(item.get('flex')).toBe('none')
  })

  it('uses an animated row gap, a theme-adaptive solid indicator, and a fixed pointer ghost', () => {
    expect(declarations('.navItem').get('transition'))
      .toBe('transform 180ms cubic-bezier(0.2, 0, 0, 1)')
    expect(declarations('.dropIndicator').get('height')).toBe('2px')
    expect(declarations('.dropIndicator').get('background')).toBe('var(--dsw-alias-label-primary)')
    expect(declarations('.dragGhost').get('position')).toBe('fixed')
    expect(declarations('.dragHandle').get('touch-action')).toBe('none')
    expect(css).not.toContain('data-drop-before')
    expect(css).not.toContain('data-drop-after')
    expect(css).not.toContain('transform: rotate(90deg)')
  })

  it('keeps phone navigation and actions inside a full-height safe-area panel', () => {
    expect(css).toMatch(/@media \(max-width: 680px\)[\s\S]*?\.panel\s*\{[\s\S]*?width: 100vw;[\s\S]*?height: 100dvh;/)
    expect(css).toMatch(/\.mobileNavClose\s*\{[\s\S]*?width: 44px;[\s\S]*?height: 44px;/)
    expect(css).toMatch(/\.mobileBack,[\s\S]*?\.close\s*\{[\s\S]*?width: 44px;[\s\S]*?height: 44px;/)
    expect(css).toContain('env(safe-area-inset-bottom)')
  })
})

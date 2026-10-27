import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/client/skeleton/ConversationRoot.module.css', import.meta.url), 'utf8')
const rules = [...css.replace(/\/\*[\s\S]*?\*\//gu, '').matchAll(/([^{}]+)\{([^{}]*)\}/gu)]

describe('conversation background floating controls', () => {
  it('keeps backdrop filters off header and composer ancestors of fixed tooltips', () => {
    const filteredSelectors = rules.flatMap(([, selector = '', declarations = '']) =>
      declarations.includes('backdrop-filter:') ? selector.split(',').map(value => value.trim()) : [])
      .filter(selector => /\.(?:header|composerSeat)(?:::before)?$/u.test(selector))
    expect(filteredSelectors).toHaveLength(2)
    expect(filteredSelectors.every(selector => selector.endsWith('::before'))).toBe(true)
  })

  it('keeps the background layer out of pointer hit testing and normal layout', () => {
    const layer = rules.find(([, selector = '']) => selector.includes('.composerSeat::before'))?.[2]
    expect(layer).toBeDefined()
    expect(layer).toContain('pointer-events: none')
    expect(layer).toContain('position: absolute')
    expect(layer).toContain('z-index: -1')
    expect(layer).toContain('inset: 0')
  })
})

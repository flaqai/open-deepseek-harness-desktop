import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const styles = readFileSync(new URL('../src/client/NasRuntimeSection.module.css', import.meta.url), 'utf8')
const theme = readFileSync(new URL('../../ui-theme/src/styles/design-platform.css', import.meta.url), 'utf8')
const base = readFileSync(new URL('../../ui-theme/src/styles/base.css', import.meta.url), 'utf8')

it('uses semantic colors for NAS cards, fields, badges and notices without light-only fallbacks', () => {
  expect(styles).not.toMatch(/--dsh-(?:text|surface|border)|#[\da-f]{3,8}\b|rgba?\(/iu)
  expect(styles).toContain('color: var(--dsw-alias-label-primary)')
  expect(styles).toContain('background: var(--dsw-alias-settings-card-fill)')
  expect(styles).toContain('var(--dsw-alias-settings-card-stroke)')
  expect(styles).toContain('background: var(--dsw-alias-state-warn-tertiary)')
  expect(styles).toContain('.message { background: var(--dsw-alias-state-business-tertiary); }')
  expect(styles).toContain('.field input::placeholder')
  expect(styles).toContain('.field select:focus-visible')
})

it('resolves all NAS semantic colors through light and dark theme definitions', () => {
  const blocks = [...theme.matchAll(/\n(body(?:\[data-ds-dark-theme\])?) \{([\s\S]*?)\n\}/gu)]
  const light = blocks.find(match => match[1] === 'body' && match[2]?.includes('--dsw-alias-bg-base:'))?.[2] ?? ''
  const dark = blocks.find(match => match[1] === 'body[data-ds-dark-theme]' && match[2]?.includes('--dsw-alias-bg-base:'))?.[2] ?? ''
  const shared = [...base.matchAll(/(--dsw-alias-[\w-]+): var\((--dsw-alias-[\w-]+)\)/gu)]
  for (const token of new Set(styles.match(/--dsw-alias-[\w-]+/gu))) {
    const target = shared.find(match => match[1] === token)?.[2] ?? token
    expect(light, `light theme: ${token}`).toContain(`${target}:`)
    expect(dark, `dark theme: ${token}`).toContain(`${target}:`)
  }
  expect(light).not.toBe(dark)
})

import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('uses shared typography and theme-owned colors instead of light-only fallbacks', () => {
  const css = readFileSync(new URL('../src/client/McpSettings.module.css', import.meta.url), 'utf8')
  const theme = readFileSync(new URL('../../../client/ui-theme/src/styles/design-platform.css', import.meta.url), 'utf8')
  const blocks = [...theme.matchAll(/\n(body(?:\[data-ds-dark-theme\])?) \{([\s\S]*?)\n\}/gu)]
  const light = blocks.find(match => match[1] === 'body' && match[2]?.includes('--dsw-alias-bg-base:'))?.[2] ?? ''
  const dark = blocks.find(match => match[1] === 'body[data-ds-dark-theme]' && match[2]?.includes('--dsw-alias-bg-base:'))?.[2] ?? ''
  expect(css).not.toMatch(/#[\da-f]{3,8}\b/iu)
  expect(css).not.toContain('--dsh-text')
  expect(css).toContain('font: var(--dsw-font-base-strong-16)')
  expect(css).toContain('font: var(--dsw-font-s-14)')
  for (const token of new Set(css.match(/--dsw-alias-[\w-]+/gu))) {
    if (token.startsWith('--dsw-alias-settings-card')) continue
    expect(light, `light theme: ${token}`).toContain(`${token}:`)
    expect(dark, `dark theme: ${token}`).toContain(`${token}:`)
  }
})

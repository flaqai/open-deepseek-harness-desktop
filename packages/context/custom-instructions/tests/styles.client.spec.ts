import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('../src/client/CustomInstructions.module.css', import.meta.url), 'utf8')
const theme = readFileSync(new URL('../../../client/ui-theme/src/styles/design-platform.css', import.meta.url), 'utf8')

describe('custom prompt theme styling', () => {
  it('uses shared theme colors instead of light-only fallback colors', () => {
    expect(styles).not.toContain('--dsh-color-')
    expect(styles).not.toMatch(/#[\da-f]{3,8}\b/iu)
    expect(styles).toContain('background: var(--dsw-alias-bg-layer-1)')
    expect(styles).toContain('color: var(--dsw-alias-label-primary)')
    expect(styles).toContain('color: var(--dsw-alias-label-secondary)')
    expect(styles).toContain('--dsw-alias-state-business-primary')
  })

  it('resolves every editor color in both light and dark theme definitions', () => {
    const blocks = [...theme.matchAll(/\n(body(?:\[data-ds-dark-theme\])?) \{([\s\S]*?)\n\}/gu)]
    const light = blocks.find(match => match[1] === 'body' && match[2]?.includes('--dsw-alias-bg-base:'))?.[2] ?? ''
    const dark = blocks.find(match => match[1] === 'body[data-ds-dark-theme]' && match[2]?.includes('--dsw-alias-bg-base:'))?.[2] ?? ''
    const tokens = new Set(styles.match(/--dsw-alias-[\w-]+/gu))
    for (const token of tokens) {
      expect(light, `light theme: ${token}`).toContain(`${token}:`)
      expect(dark, `dark theme: ${token}`).toContain(`${token}:`)
    }
  })
})

import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('sizes NAS settings with shared typography and preserves touch input sizing', () => {
  const styles = readFileSync(new URL('../src/client/NasRuntimeSection.module.css', import.meta.url), 'utf8')
  expect(styles).toContain('font: var(--dsw-font-s-14)')
  expect(styles).toContain('.page h2 { font: var(--dsw-font-base-strong-16); }')
  expect(styles).toContain('.page h3 { font: var(--dsw-font-s-strong-14); }')
  expect(styles).toContain('font: var(--dsw-font-xs-13)')
  expect(styles).toContain('@media (pointer: coarse)')
  expect(styles).toContain('font: var(--dsw-font-base-16)')
})

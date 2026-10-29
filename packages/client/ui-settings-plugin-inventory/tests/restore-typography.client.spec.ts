import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it.each(['ImportedPluginRestore', 'PortablePluginExport'])('aligns %s recovery cards with settings typography and surfaces', (name) => {
  const styles = readFileSync(new URL(`../src/client/${name}.module.css`, import.meta.url), 'utf8')
  expect(styles).toContain('font: var(--dsw-font-s-14)')
  expect(styles).toContain('font: var(--dsw-font-base-strong-16)')
  expect(styles).toContain('var(--dsw-alias-settings-card-fill)')
  expect(styles).toContain('var(--dsw-alias-settings-card-stroke)')
  expect(styles).not.toContain('font-size: 18px')
  expect(styles).not.toContain('box-shadow: var(--dsw-elevation-panel)')
})

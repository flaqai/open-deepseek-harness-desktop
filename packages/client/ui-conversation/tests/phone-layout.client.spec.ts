import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('leaves mobile viewport and navigation to the official layout', () => {
  const css = readFileSync(new URL('../src/client/skeleton/ConversationRoot.module.css', import.meta.url), 'utf8')
  expect(css).not.toContain('@media (max-width: 680px)')
  expect(css).not.toContain('0 64px')
})

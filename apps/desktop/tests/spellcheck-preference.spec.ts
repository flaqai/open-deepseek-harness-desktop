import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { SpellcheckPreference } from '../src/spellcheck-preference.ts'
it('retains a device-local toggle across new instances', () => {
  const home = mkdtempSync(join(tmpdir(), 'spelling-preference-'))
  try {
    const file = join(home, 'spellcheck.json')
    const first = new SpellcheckPreference(file)
    expect(first.enabled).toBe(true)
    first.set(false)
    expect(new SpellcheckPreference(file).enabled).toBe(false)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 1, enabled: false })
  } finally { rmSync(home, { recursive: true, force: true }) }
})

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BundledPluginStartupCooldown } from '../src/bundled-plugin-cooldown.ts'

const homes: string[] = []
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }) })

describe('bundled plugin startup cooldown', () => {
  it('skips an identical failed version for five minutes and clears after success', async () => {
    const home = mkdtempSync(join(tmpdir(), 'bundled-plugin-cooldown-'))
    homes.push(home)
    let now = Date.parse('2026-09-05T00:00:00.000Z')
    const cooldown = new BundledPluginStartupCooldown(home, () => now)

    expect(await cooldown.shouldAttempt('dshmarket', '1.41.0')).toBe(true)
    await cooldown.record('dshmarket', '1.41.0')
    expect(await cooldown.shouldAttempt('dshmarket', '1.41.0')).toBe(false)
    expect(await cooldown.shouldAttempt('dshmarket', '1.42.0')).toBe(true)
    now += 5 * 60_000
    expect(await cooldown.shouldAttempt('dshmarket', '1.41.0')).toBe(true)
    await cooldown.clear('dshmarket')
    expect(await cooldown.shouldAttempt('dshmarket', '1.41.0')).toBe(true)
  })
})

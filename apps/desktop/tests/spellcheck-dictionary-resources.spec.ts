/** Packaged Hunspell assets are pinned and shipped only to Windows/Linux. */
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { z } from 'zod'

const desktopDirectory = fileURLToPath(new URL('../', import.meta.url))
const script = join(desktopDirectory, 'scripts/spellcheck-dictionaries.mjs')
const configSchema = z.object({
  extraResources: z.array(z.looseObject({ from: z.string(), to: z.string() })),
  files: z.array(z.string()),
})

describe('bundled spellcheck resource validation', () => {
  it('validates every actual bundled dictionary, license and Electron release pin in the build checker', () => {
    expect(execFileSync(process.execPath, [script, '--check'], { encoding: 'utf8' }))
      .toMatch('Verified 7 offline dictionaries for Electron 44.9.3')
  })

  it('rejects an unreviewed ZIP without changing installed resources', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'odsh-spellcheck-refresh-test-'))
    const asset = join(desktopDirectory, 'assets/spellcheck-dictionaries/en-US-10-1.bdic')
    const before = await readFile(asset)
    try {
      const zip = join(directory, 'dictionary.zip')
      await writeFile(zip, 'unreviewed')
      expect(() => execFileSync(process.execPath, [script, '--refresh', zip], { stdio: 'pipe' }))
        .toThrow('does not match the reviewed source integrity')
      expect(await readFile(asset)).toEqual(before)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('includes the reviewed resources in Windows/Linux and excludes them from the macOS package', async () => {
    for (const platform of ['windows', 'linux', 'macos']) {
      const file = platform === 'windows' ? 'electron-builder.yml' : `electron-builder.${platform}.yml`
      const config = configSchema.parse(parse(await readFile(join(desktopDirectory, file), 'utf8')))
      const dictionaryResources = config.extraResources.filter(entry => entry.to === 'spellcheck-dictionaries')
      expect(dictionaryResources).toEqual(platform === 'macos' ? [] : [{
        from: 'assets/spellcheck-dictionaries', to: 'spellcheck-dictionaries', filter: ['**/*'],
      }])
      expect(config.files.some(pattern => pattern.startsWith('assets'))).toBe(false)
    }
  })
})

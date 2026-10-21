import { spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const powershell = process.env.DSH_TEST_PWSH ?? (process.platform === 'win32' ? 'powershell.exe' : undefined)

it.skipIf(!powershell)('inventories real 259/260/261-character files and long directories with exact sizes', () => {
  if (!powershell) throw new Error('PowerShell runtime was not selected')
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'payload-long-')))
  try {
    const result = spawnSync(powershell, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', fileURLToPath(new URL('./fixtures/installer-payload-long-path.ps1', import.meta.url)),
      '-TestDirectory', directory,
    ], { encoding: 'utf8', timeout: 25_000 })
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status, result.stderr + result.stdout).toBe(0)
    for (const length of [259, 260, 261]) expect(result.stdout).toContain(`PASS payload-inventory-boundary-${length}`)
    expect(result.stdout).toContain('PASS payload-inventory-deep-directory')
  } finally { rmSync(directory, { recursive: true, force: true }) }
}, 30_000)

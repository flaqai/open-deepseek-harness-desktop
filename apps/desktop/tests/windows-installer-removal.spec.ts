import { spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const powershell = process.env.DSH_TEST_PWSH ?? (process.platform === 'win32' ? 'powershell.exe' : undefined)

it.skipIf(!powershell)('stages, restores and commits real long-path payloads while refusing unsafe recovery', () => {
  if (!powershell) throw new Error('PowerShell runtime was not selected')
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'removal-')))
  try {
    const result = spawnSync(powershell, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', fileURLToPath(new URL('./fixtures/installer-removal.behavior.ps1', import.meta.url)),
      '-TestDirectory', directory,
    ], { encoding: 'utf8', timeout: 30_000 })
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status, result.stderr + result.stdout).toBe(0)
    for (const scenario of ['transaction-boundary-259', 'transaction-boundary-260', 'transaction-boundary-261', 'interrupted-marker', 'nested-bridge-validation', 'rollback-collision', 'cleanup-warning-retains-journal', 'reparse-refusal']) {
      expect(result.stdout).toContain(`PASS ${scenario}`)
    }
    if (process.platform === 'win32') expect(result.stdout).toContain('PASS native-file-lock-rollback')
  } finally { rmSync(directory, { recursive: true, force: true }) }
}, 35_000)

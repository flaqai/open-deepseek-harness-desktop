import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const powershell = process.env.DSH_TEST_PWSH ?? (process.platform === 'win32' ? 'powershell.exe' : undefined)

it.skipIf(!powershell)('classifies processes, refuses unsafe roots, and fails closed on unreadable app processes', () => {
  if (!powershell) throw new Error('PowerShell runtime was not selected')
  const testDirectory = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-process-guard-')))
  try {
    const result = spawnSync(powershell, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', fileURLToPath(new URL('./installer-process-guard.behavior.ps1', import.meta.url)),
      '-GuardScript', fileURLToPath(new URL('../build/installer-process-guard.ps1', import.meta.url)),
      '-TestDirectory', testDirectory,
    ], { encoding: 'utf8', timeout: 30_000 })
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr + result.stdout).toBe(0)
    expect(result.stdout).toContain('PASS process classification')
    expect(result.stdout).toContain('PASS entrypoint failure and logging')
    expect(result.stdout).toContain('PASS path validation')
    expect(readFileSync(join(testDirectory, 'junction-target', 'must-survive-link-cleanup.txt'), 'utf8')).toBe('synthetic sentinel')
  } finally {
    rmSync(testDirectory, { recursive: true, force: true })
  }
}, 35_000)

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const powershell = process.env.DSH_TEST_PWSH ?? (process.platform === 'win32' ? 'powershell.exe' : undefined)

it.skipIf(!powershell)('repairs only verified orphan records and preserves replacements on failure', () => {
  if (!powershell) throw new Error('PowerShell runtime was not selected')
  const result = spawnSync(powershell, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', fileURLToPath(new URL('./fixtures/windows-registration.behavior.ps1', import.meta.url)),
  ], { encoding: 'utf8', timeout: 30_000 })
  expect(result.error).toBeUndefined()
  expect(result.status, result.stdout + result.stderr).toBe(0)
  for (const scenario of ['repair-CurrentUser', 'repair-AllUsers', 'install-record-without-uninstall-entry',
    'uninstall-entry-without-install-record', 'installer-orphan-diagnosis', 'installer-repair-no-consent', 'existing-install-refused', 'explicit-confirmation',
    'unknown-directory-refused', 'conflicting-directories', 'nested-records-refused', 'backup-failure-no-deletion',
    'deletion-failure-rolls-back', 'concurrent-replacement-preserved', 'tampered-backup-refused',
    'directory-reappeared-refused', 'uninstall-path-mismatch', 'uninstall-version-mismatch', 'uninstall-matching-version',
    'uninstall-missing-registration', 'uninstall-other-scope-replacement', 'no-records']) {
    expect(result.stdout).toContain(`PASS ${scenario}`)
  }
}, 35_000)

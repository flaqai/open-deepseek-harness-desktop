import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const powershell = process.env.DSH_TEST_PWSH ?? (process.platform === 'win32' ? 'powershell.exe' : undefined)

it.skipIf(!powershell)('bounds old-uninstaller retries and preserves installation failure evidence', () => {
  if (!powershell) throw new Error('PowerShell runtime was not selected')
  const result = spawnSync(powershell, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', fileURLToPath(new URL('./fixtures/installer-upgrade.behavior.ps1', import.meta.url)),
  ], { encoding: 'utf8', timeout: 30_000 })
  expect(result.error).toBeUndefined()
  expect(result.status, result.stderr + result.stdout).toBe(0)
  for (const scenario of ['module-independent-sha256', 'stage-retry-1', 'stage-retry-12', 'success', 'retry-cleanup', 'persistent-cleanup', 'non-retryable',
    'fallback-in-place', 'both-launch-failed', 'fallback-retry', 'invalid-registration',
    'unsafe-directories', 'incomplete-cleanup', 'invalid-arguments', 'log-write-failure', 'missing-uninstaller', 'uninstaller-tampering']) {
    expect(result.stdout).toContain(`PASS ${scenario}`)
  }
}, 35_000)

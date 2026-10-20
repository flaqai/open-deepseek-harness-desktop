import { spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const powershell = process.env.DSH_TEST_PWSH ?? (process.platform === 'win32' ? 'powershell.exe' : undefined)
const fixture = fileURLToPath(new URL('./fixtures/installer-extract.behavior.ps1', import.meta.url))
const sevenzip = process.env.DSH_TEST_7ZIP

describe.skipIf(!powershell)('Windows installer archive extraction', () => {
  for (const scenario of ['success', 'nonzero', 'start-failure', 'missing-archive', 'staging-not-empty',
    'relative-path', 'reparse-path', 'root-destination', 'log-failure', 'log-inside-staging']) {
    it(scenario, () => {
      if (!powershell) throw new Error('PowerShell runtime was not selected')
      const directory = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-extract-')))
      try {
        const result = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', fixture,
          '-Scenario', scenario, '-FixtureDirectory', directory], { encoding: 'utf8', timeout: 20_000 })
        expect(result.error).toBeUndefined()
        expect(result.status, result.stderr + result.stdout).toBe(0)
        const report = JSON.parse(result.stdout.trim()) as { exitCode: number; calls: number }
        expect(report.exitCode).toBe(scenario === 'success' ? 0 : 44)
        expect(report.calls).toBe(['success', 'nonzero', 'start-failure'].includes(scenario) ? 1 : 0)
      } finally { rmSync(directory, { recursive: true, force: true }) }
    }, 25_000)
  }
})

describe.skipIf(!powershell || !sevenzip)('Native installer extraction integration', () => {
  for (const scenario of ['native-success', 'native-corrupt']) {
    it(scenario, () => {
      if (!powershell || !sevenzip) throw new Error('PowerShell and 7-Zip runtimes are required')
      const directory = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-native-extract-')))
      try {
        const result = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', fixture,
          '-Scenario', scenario, '-FixtureDirectory', directory, '-RealExtractor', sevenzip], { encoding: 'utf8', timeout: 20_000 })
        expect(result.error).toBeUndefined()
        expect(result.status, result.stderr + result.stdout).toBe(0)
        const report = JSON.parse(result.stdout.trim()) as { exitCode: number; extractedText: string | null }
        expect(report.exitCode, result.stderr).toBe(scenario === 'native-success' ? 0 : 44)
        expect(report.extractedText).toBe(scenario === 'native-success' ? 'verified extraction fixture' : null)
      } finally { rmSync(directory, { recursive: true, force: true }) }
    }, 25_000)
  }
})

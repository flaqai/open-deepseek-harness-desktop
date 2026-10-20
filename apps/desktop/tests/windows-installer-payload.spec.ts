import { execFile } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execute = promisify(execFile)
const fixture = fileURLToPath(new URL('./fixtures/installer-payload.ps1', import.meta.url))
const runtime = process.env.DSH_TEST_PWSH ?? (process.platform === 'win32' ? 'powershell.exe' : undefined)

describe.skipIf(!runtime)('Windows installer payload behavior', () => {
  for (const [scenario, systemDirectory] of [
    ['robocopy-path-32bit-process', 'Sysnative'],
    ['robocopy-path-64bit-process', 'System32'],
    ['robocopy-path-32bit-os', 'System32'],
  ] as const) {
    it(scenario, async () => {
      const directory = await realpath(await mkdtemp(join(tmpdir(), 'dsh-payload-')))
      try {
        const result = await execute(runtime ?? 'powershell.exe', ['-NoProfile', '-NonInteractive', '-File', fixture,
          '-Scenario', scenario, '-FixtureDirectory', directory], { timeout: 20_000 })
        const report = JSON.parse(result.stdout.trim()) as { selectedPath: string }
        expect(report.selectedPath).toBe(join(directory, systemDirectory, 'robocopy.exe'))
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    }, 25_000)
  }
  for (const scenario of [
    'success', 'robocopy-warning', 'copy-failure', 'copy-start-failure', 'missing-file',
    'wrong-size', 'extra-file', 'wrong-app-version', 'wrong-core-version', 'overlap',
    'root-target', 'source-reparse', 'target-reparse', 'copy-source-reparse', 'copy-target-reparse',
    'missing-executable', 'missing-manifest', 'malformed-manifest', 'prefix-sibling', 'independent-core-version',
  ]) {
    it(scenario, async () => {
      const directory = await realpath(await mkdtemp(join(tmpdir(), 'dsh-payload-')))
      try {
        const result = await execute(runtime ?? 'powershell.exe', ['-NoProfile', '-NonInteractive', '-File', fixture,
          '-Scenario', scenario, '-FixtureDirectory', directory], { timeout: 20_000 })
        const report = JSON.parse(result.stdout.trim()) as { exitCode: number; copyCalls: number; diagnosticPath: string }
        const success = ['success', 'robocopy-warning', 'prefix-sibling', 'independent-core-version'].includes(scenario)
        const validationFailure = ['overlap', 'root-target', 'source-reparse', 'target-reparse', 'missing-executable', 'missing-manifest'].includes(scenario)
        const copyFailure = ['copy-failure', 'copy-start-failure'].includes(scenario)
        expect(report.exitCode).toBe(success ? 0 : validationFailure ? 40 : copyFailure ? 41 : 42)
        const events = (await readFile(report.diagnosticPath, 'utf8')).trim().split('\n')
          .map(line => JSON.parse(line) as { stage: string; outcome: string })
        expect(events.at(-1)?.outcome).toBe(success ? 'verified' : 'failed')
        expect(events.some(event => event.stage === 'complete')).toBe(success)
        if (validationFailure) {
          expect(report.copyCalls).toBe(0)
        }
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    }, 25_000)
  }
})

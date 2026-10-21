import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const powershell = process.env.DSH_TEST_PWSH ?? (process.platform === 'win32' ? 'powershell.exe' : undefined)

it.skipIf(!powershell)('upgrades legacy payloads at source and rollback MAX_PATH boundaries without losing user data', () => {
  if (!powershell) throw new Error('PowerShell runtime was not selected')
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'lp-')))
  try {
    const result = spawnSync(powershell, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', fileURLToPath(new URL('./fixtures/installer-long-path-upgrade.behavior.ps1', import.meta.url)),
      '-TestDirectory', directory,
    ], { encoding: 'utf8', timeout: 30_000 })
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status, result.stderr + result.stdout).toBe(0)
    for (const scenario of ['source-259', 'source-260', 'source-261', 'rollback-only-260']) {
      expect(result.stdout).toContain(`PASS ${scenario}`)
    }
  } finally { rmSync(directory, { recursive: true, force: true }) }
}, 35_000)

it.skipIf(!powershell)('preserves actual upgrade script arguments and restores files after both uninstaller launches fail', () => {
  if (!powershell) throw new Error('PowerShell runtime was not selected')
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'lp-entry-')))
  try {
    const installation = join(directory, 'actual installation')
    const temporary = join(directory, 'temporary')
    const diagnostics = join(directory, 'actual diagnostics')
    mkdirSync(installation)
    mkdirSync(temporary)
    const executable = join(installation, 'Test Desktop.exe')
    const uninstaller = join(installation, 'Uninstall Test Desktop.exe')
    const sentinel = join(directory, 'user-data')
    writeFileSync(executable, 'original application')
    writeFileSync(uninstaller, 'not an executable - real launch must fail')
    writeFileSync(sentinel, 'preserve user data')
    const result = spawnSync(powershell, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', fileURLToPath(new URL('../build/installer-upgrade.ps1', import.meta.url)),
      '-InstallDirectory', installation, '-UninstallerPath', uninstaller,
      '-UninstallerName', 'Uninstall Test Desktop.exe', '-AppExecutable', 'Test Desktop.exe',
      '-UninstallArguments', '/currentuser --updated', '-TemporaryDirectory', temporary, '-DiagnosticDirectory', diagnostics,
    ], { encoding: 'utf8', timeout: 30_000 })
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status, result.stderr + result.stdout).toBe(3)
    const records = readFileSync(join(diagnostics, 'upgrade.jsonl'), 'utf8').trim().split(/\r?\n/u).map((line) => {
      const record: unknown = JSON.parse(line)
      if (typeof record !== 'object' || record === null || !('stage' in record) || typeof record.stage !== 'string') {
        throw new Error('Upgrade journal contains an invalid stage record')
      }
      return { stage: record.stage, installDirectory: 'installDirectory' in record ? record.installDirectory : undefined }
    })
    expect(records.find(record => record.stage === 'uninstall-start')?.installDirectory).toBe(installation)
    expect(records.some(record => record.stage === 'uninstall-launch-failed')).toBe(true)
    expect(records.some(record => record.stage === 'uninstall-files-restored')).toBe(true)
    expect(readFileSync(executable, 'utf8')).toBe('original application')
    expect(readFileSync(uninstaller, 'utf8')).toBe('not an executable - real launch must fail')
    expect(readFileSync(sentinel, 'utf8')).toBe('preserve user data')
  } finally { rmSync(directory, { recursive: true, force: true }) }
}, 35_000)

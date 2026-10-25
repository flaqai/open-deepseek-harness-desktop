import { spawnSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const toolDirectory = new URL('../../../tools/windows-install-repair/', import.meta.url)
const powershell = process.env.DSH_TEST_PWSH ?? (process.platform === 'win32' ? 'powershell.exe' : undefined)

it('keeps standalone repair launchers synchronized with their audited sources', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('generate-launchers.mjs', toolDirectory)), '--check'], { encoding: 'utf8' })
  expect(result.status, result.stdout + result.stderr).toBe(0)
})

it.skipIf(process.platform !== 'win32')('preserves exclamation marks when the parent CMD enables delayed expansion', () => {
  const directory = mkdtempSync(join(tmpdir(), 'odsh ! launcher-'))
  try {
    const launcher = readFileSync(new URL('START-REPAIR.cmd', toolDirectory), 'utf8')
    const commandStart = launcher.indexOf('"%ODSH_REPAIR_POWERSHELL%" -NoLogo')
    if (commandStart < 0) throw new Error('PowerShell launcher entry was not found')
    const prefix = launcher.slice(0, commandStart)
    const path = join(directory, 'repair-bootstrap.cmd')
    const output = join(directory, 'actual-path.txt')
    writeFileSync(path, prefix + '"%ODSH_REPAIR_POWERSHELL%" -NoLogo -NoProfile -Command "[IO.File]::WriteAllText($env:ODSH_TEST_RESULT, $env:ODSH_REPAIR_LAUNCHER)"\r\nexit /b %ERRORLEVEL%\r\n')
    const result = spawnSync('cmd.exe', ['/d', '/v:on', '/c', 'repair-bootstrap.cmd'], {
      cwd: directory, encoding: 'utf8', timeout: 30_000, env: { ...process.env, ODSH_TEST_RESULT: output },
    })
    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(readFileSync(output, 'utf8')).toBe(path)
  } finally { rmSync(directory, { recursive: true, force: true }) }
}, 35_000)

it.skipIf(!powershell)('runs the embedded repair payload after extracting only its launcher', () => {
  if (!powershell) throw new Error('PowerShell runtime was not selected')
  const directory = mkdtempSync(join(tmpdir(), 'odsh 独立 ! repair-'))
  try {
    for (const filename of ['START-REPAIR.cmd', 'START-ALL-USERS-REPAIR.cmd']) {
      const launcher = readFileSync(new URL(filename, toolDirectory), 'utf8')
      const path = join(directory, filename)
      writeFileSync(path, launcher)
      const scope = filename === 'START-REPAIR.cmd' ? 'CurrentUser' : 'AllUsers'
      // Exercise the same payload extraction as Windows PowerShell. Only the CMD file is present.
      const command = "$payload = ([IO.File]::ReadAllText($env:ODSH_TEST_LAUNCHER) -split ':ODSH_PAYLOAD\\r?\\n', 2)[1].Trim(); $code = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload)); $tokens = $null; $errors = $null; [void][Management.Automation.Language.Parser]::ParseInput($code, [ref]$tokens, [ref]$errors); if ($errors.Count -ne 0) { throw ($errors | Out-String) }; . ([ScriptBlock]::Create($code)) -Scope $env:ODSH_TEST_SCOPE; function Assert-DesktopRepairEnvironment {}; function Get-DesktopRegistrationPlan { param($Scope) [pscustomobject]@{Scope=$Scope; Status='Missing'; InstallDirectory=$null} }; $result = Invoke-DesktopRepairTool -RepairScope $Scope -OutputRoot $env:ODSH_TEST_OUTPUT -InspectOnly; exit $result"
      const result = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
        encoding: 'utf8', timeout: 30_000,
        env: { ...process.env, ODSH_TEST_LAUNCHER: path, ODSH_TEST_OUTPUT: join(directory, 'report'), ODSH_TEST_SCOPE: scope },
      })
      expect(result.status, result.stdout + result.stderr).toBe(0)
      expect(result.stdout).toContain('Nothing was changed')
      expect(result.stdout).toContain(`Registration scope: ${scope}`)
    }
  } finally { rmSync(directory, { recursive: true, force: true }) }
}, 65_000)

it.skipIf(!powershell)('requires consent and confines each support repair to its selected scope', () => {
  if (!powershell) throw new Error('PowerShell runtime was not selected')
  const result = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    fileURLToPath(new URL('./fixtures/windows-install-repair-tool.behavior.ps1', import.meta.url))], { encoding: 'utf8', timeout: 30_000 })
  expect(result.status, result.stdout + result.stderr).toBe(0)
  for (const scenario of ['already-missing', 'live-installation-refused', 'inspect-orphan-read-only', 'cancel-preserves-registration',
    'confirmed-current-user', 'confirmed-all-users', 'environment-refused-before-inspection', 'unsafe-registration-refused',
    'repair-failure-visible', 'unknown-plan-refused', 'unknown-outcome-visible']) {
    expect(result.stdout).toContain(`PASS ${scenario}`)
  }
}, 35_000)

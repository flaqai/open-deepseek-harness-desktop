import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const buildRoot = fileURLToPath(new URL('../build/', import.meta.url))
const scriptsRoot = fileURLToPath(new URL('../scripts/', import.meta.url))

describe('Windows installer process guard', () => {
  it('overrides the broad electron-builder process check', async () => {
    const installer = await readFile(`${buildRoot}/installer.nsh`, 'utf8')
    expect(installer).toContain('!macro customCheckAppRunning')
    expect(installer).toContain('installer-process-guard.ps1')
    expect(installer).toContain('GetCurrentProcessId')
    expect(installer).toContain('GetCurrentProcessId() i.r9')
    expect(installer).toContain('-ExcludeProcessId $9')
    expect(installer).not.toContain('-ExcludeProcessId $R9')
    expect(installer).toContain('-DiagnosticDirectory "$DesktopDiagnosticDirectory"')
    expect(installer).toContain('IfFileExists "$INSTDIR\\${APP_EXECUTABLE_FILENAME}" process_guard_inspect')
    expect(installer).toContain('IfFileExists "$INSTDIR\\resources\\*.*" process_guard_inspect')
  })

  it('declares custom translations with LCIDs available before MUI languages load', async () => {
    const installer = await readFile(`${buildRoot}/installer.nsh`, 'utf8')
    expect(installer).toContain('LangString CliPageTitle 2052 "命令行工具"')
    expect(installer).toContain('LangString CliPageTitle 1033 "Command-line tool"')
    expect(installer).toContain('LangString UninstallDataPageTitle 2052 "本地配置和数据"')
    expect(installer).toContain('LangString UninstallDataPageTitle 1033 "Local configuration and data"')
    expect(installer).not.toContain('${LANG_SIMPCHINESE}')
    expect(installer).not.toContain('${LANG_ENGLISH}')
  })

  it('offers explicit irreversible app-data deletion while preserving it by default', async () => {
    const installer = await readFile(`${buildRoot}/installer.nsh`, 'utf8')

    expect(installer).toContain('UninstPage custom un.UninstallDataPageCreate un.UninstallDataPageLeave')
    expect(installer).not.toMatch(/^\s*Page custom un\.UninstallDataPageCreate un\.UninstallDataPageLeave$/m)
    expect(installer).toContain(
      'WriteINIStr "$PLUGINSDIR\\desktop-uninstall.ini" "data" "delete" "1"',
    )
    expect(installer).toContain(
      'ReadINIStr $R0 "$PLUGINSDIR\\desktop-uninstall.ini" "data" "delete"',
    )
    expect(installer).toContain('${NSD_Uncheck} $R9')
    expect(installer).toContain('${NSD_GetState} $R9 $0')
    expect(installer).toContain('MB_YESNO|MB_DEFBUTTON2|MB_ICONEXCLAMATION')
    expect(installer).toContain('LangString UninstallDataWarning 2052 "警告：删除后无法恢复。')
    expect(installer).toContain('同一应用根目录内的源码开发版数据均不会被删除。')
    expect(installer).toContain('${GetOptions} $R0 "--updated" $R1')
    expect(installer).toContain('${If} $R0 == "1"')
    expect(installer).not.toContain('${isUpdated}')
    const uninstallSection = installer.slice(installer.indexOf('!ifdef BUILD_UNINSTALLER'))
    expect(uninstallSection).toContain('!macro customHeader\n    Function un.UninstallDataPageCreate')
    expect(installer).toContain('Function un.RemoveInstalledDesktopData')
    expect(installer).toContain('StrCpy $R8 "0"')
    expect(installer).toContain('StrCmp $R8 "0" uninstall_data_removed')
    expect(installer).toContain('StrCmp $2 "development" uninstall_data_scan_continue')
    expect(installer).not.toContain('RMDir /r "$APPDATA\\open-deepseek-harness-desktop"')
    expect(installer).toContain('LangString UninstallDataDeleteFailed 2052')
    expect(installer).not.toContain('RMDir /r "$PROFILE\\.dsh"')
    expect(installer).not.toContain('data-home-setup.json')
  })

  it('matches only the exact app or the resources directory boundary', async () => {
    const guard = await readFile(`${buildRoot}/installer-process-guard.ps1`, 'utf8')
    expect(guard).toContain('[string]::Equals($processPath, $appPath, $comparison)')
    expect(guard).toContain('$processPath.StartsWith($resourcesPrefix, $comparison)')
    expect(guard).toContain("[System.IO.Path]::Combine($installRoot, 'resources') + [System.IO.Path]::DirectorySeparatorChar")
    expect(guard).toContain('$process.ProcessId -eq $ExcludedId')
    expect(guard).not.toContain('$path.StartsWith($installRoot')
  })

  it('reports exact process details and verifies cleanup before installation continues', async () => {
    const guard = await readFile(`${buildRoot}/installer-process-guard.ps1`, 'utf8')
    expect(guard).toContain('PID {0}  {1}  parentPID={2}  {3}')
    expect(guard).toContain('$ExitProcessesRemain = 30')
    expect(guard).toContain('$remaining = @(Get-DesktopOwnedProcesses)')
    expect(guard).toContain('for ($attempt = 1; $attempt -le 3; $attempt += 1)')
    expect(guard).not.toContain('Stop-Process -Id')
    expect(guard).toContain('DshInstallerProcessLease')
    expect(guard).toContain('TerminateProcess(handle, 1)')
    expect(guard).toContain('GetProcessTimes(h, out creation')
    expect(guard).toContain('PostMessage(window, 0x0010')
    expect(guard).toContain('DeepSeek-Harness-process-guard.log')
  })

  it('intercepts upstream uninstall and payload retries before generic dialogs or registration', async () => {
    const installer = await readFile(`${buildRoot}/installer.nsh`, 'utf8')
    const helper = await readFile(`${buildRoot}/installer-upgrade.ps1`, 'utf8')
    const patch = await readFile(fileURLToPath(new URL('../../../patches/app-builder-lib@26.17.0.patch', import.meta.url)), 'utf8')

    expect(installer).toContain('!macro customUnInstallCheck')
    expect(installer).toContain('!macro customUnInstallCheckCurrentUser')
    expect(installer.match(/Call DesktopHandleOldUninstallResult/g)).toHaveLength(2)
    expect(installer).toContain('!macro customUninstallOldVersion')
    expect(patch).toContain('+  !ifmacrodef customUninstallOldVersion')
    expect(patch).toContain('+  !ifmacrodef customExtractUsing7za')
    expect(installer).toContain('StrCpy $DesktopOldDirectory "$installationDir"')
    expect(installer).toContain('!insertmacro DesktopCheckProcesses "$DesktopOldDirectory"')
    expect(helper).toContain('$attempt -le 12')
    expect(helper).toContain('Start-Sleep -Seconds 5')
    expect(helper).toContain('/S /KEEP_APP_DATA ')
    expect(installer).toContain('!macro customUninstallMissingRegistration')
    expect(installer).toContain('SetErrorLevel 2\n      Quit')
    expect(installer).toContain('installer-payload.ps1')
    expect(installer).toContain('copy-verified version=${VERSION}')
    expect(installer).not.toContain('CopyFiles /SILENT')
    expect(installer).not.toContain('appCannotBeClosed')
    expect(installer).not.toContain('DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString"')
    expect(installer).not.toContain('SetOverwrite on')
  })

  it('exercises a same-directory upgrade after an external file lock outlives the default retry', async () => {
    const smoke = await readFile(`${scriptsRoot}/smoke-windows-package.ps1`, 'utf8')
    const lockFixture = await readFile(`${scriptsRoot}/hold-file-lock.ps1`, 'utf8')
    const qualification = await readFile(`${scriptsRoot}/windows-upgrade-qualification.ps1`, 'utf8')

    expect(smoke).toContain("Join-Path $PSScriptRoot 'hold-file-lock.ps1'")
    expect(smoke).toContain("$lockStart.ArgumentList.Add('20')")
    expect(smoke).toContain('$upgradeExit = Invoke-DesktopQualificationInstaller -Start $installStart')
    expect(smoke).toContain('if ($upgradeExit -ne 0)')
    expect(qualification).toContain('$installerProcess = [System.Diagnostics.Process]::Start($Start)')
    expect(qualification).toContain('Invoke-DesktopWizardAutomation -Process $installerProcess')
    expect(qualification).not.toContain('$installerProcess.Kill(')
    expect(lockFixture).toContain('[System.IO.FileShare]::Read')
    expect(lockFixture).not.toContain('[System.IO.FileShare]::Write')
    expect(lockFixture).not.toContain('[System.IO.FileShare]::Delete')
    expect(lockFixture).toContain('$stream.Dispose()')
  })
})

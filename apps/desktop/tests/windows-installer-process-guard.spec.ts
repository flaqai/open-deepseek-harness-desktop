import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const buildRoot = fileURLToPath(new URL('../build/', import.meta.url))

describe('Windows installer process guard', () => {
  it('overrides the broad electron-builder process check', async () => {
    const installer = await readFile(`${buildRoot}/installer.nsh`, 'utf8')
    expect(installer).toContain('!macro customCheckAppRunning')
    expect(installer).toContain('installer-process-guard.ps1')
    expect(installer).toContain('GetCurrentProcessId')
    expect(installer).toContain('GetCurrentProcessId() i.r9')
    expect(installer).toContain('-ExcludeProcessId $9')
    expect(installer).not.toContain('-ExcludeProcessId $R9')
    expect(installer).toContain('DeepSeek-Harness-process-guard.log')
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
    expect(installer).toContain('StrCpy $DesktopUninstallMode "preserve"')
    expect(installer).toContain('${NSD_Uncheck} $UninstallDataCheckboxHandle')
    expect(installer).toContain('EnableWindow $UninstallDataCheckboxHandle 1')
    expect(installer).toContain('MB_YESNO|MB_DEFBUTTON2|MB_ICONEXCLAMATION')
    expect(installer).toContain('LangString UninstallDataWarning 2052 "警告：删除后无法恢复。')
    expect(installer).toContain('同一应用根目录内的源码开发版数据均不会被删除。')
    expect(installer).toContain('${GetOptions} $R0 "--updated" $R1')
    expect(installer).toContain('${OrIf} $DesktopUninstallMode == "update"')
    expect(installer).toContain('${If} $DesktopUninstallMode == "delete"')
    expect(installer).not.toContain('${isUpdated}')
    const uninstallSection = installer.slice(installer.indexOf('!ifdef BUILD_UNINSTALLER'))
    expect(uninstallSection).toContain('!macro customHeader\n    Function un.UninstallDataPageCreate')
    expect(installer).toContain('Function un.RemoveInstalledDesktopData')
    expect(installer).toContain('StrCmp $2 "development" uninstall_data_scan_continue')
    expect(installer).not.toContain('RMDir /r "$APPDATA\\open-deepseek-harness-desktop"')
    expect(installer).toContain('LangString UninstallDataDeleteFailed 2052')
    expect(installer).not.toContain('RMDir /r "$PROFILE\\.dsh"')
    expect(installer).not.toContain('data-home-setup.json')
  })

  it('matches only the exact app or the resources directory boundary', async () => {
    const guard = await readFile(`${buildRoot}/installer-process-guard.ps1`, 'utf8')
    expect(guard).toContain('[string]::Equals($path, $appPath, $comparison)')
    expect(guard).toContain('$path.StartsWith($resourcesPrefix, $comparison)')
    expect(guard).toContain("[System.IO.Path]::Combine($installRoot, 'resources') + [System.IO.Path]::DirectorySeparatorChar")
    expect(guard).toContain('$_.ProcessId -ne $ExcludeProcessId')
    expect(guard).not.toContain('$path.StartsWith($installRoot')
  })

  it('reports exact process details and verifies cleanup before installation continues', async () => {
    const guard = await readFile(`${buildRoot}/installer-process-guard.ps1`, 'utf8')
    expect(guard).toContain('PID {0}  {1}  {2}')
    expect(guard).toContain('$ExitProcessesRemain = 30')
    expect(guard).toContain('$remaining = @(Get-DesktopOwnedProcesses)')
    expect(guard).toContain('for ($attempt = 1; $attempt -le 3; $attempt += 1)')
    expect(guard).toContain('Stop-Process -Id $process.ProcessId -Force')
    expect(guard).toContain('DshInstallerWindow')
    expect(guard).toContain('PostMessage($liveProcess.MainWindowHandle, 0x0010')
    expect(guard).toContain('DeepSeek-Harness-process-guard.log')
  })
})

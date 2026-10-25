[CmdletBinding()]
param(
  [ValidateSet('CurrentUser', 'AllUsers')][string]$Scope = 'CurrentUser',
  [switch]$CheckOnly
)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../apps/desktop/build/windows-registration.ps1')

function Assert-DesktopRepairEnvironment([string]$RepairScope) {
  if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or -not [Environment]::Is64BitProcess) {
    throw 'Run this tool with 64-bit Windows PowerShell on the affected Windows account.'
  }
  if ($RepairScope -eq 'AllUsers') {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    try {
      $principal = New-Object Security.Principal.WindowsPrincipal $identity
      if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'All-users repair requires Run as administrator. This tool never elevates automatically.'
      }
    } finally { $identity.Dispose() }
  }
}

function Confirm-DesktopRegistrationRepair($Plan, [string]$OutputRoot) {
  Add-Type -AssemblyName System.Windows.Forms
  $scopeText = if ($Plan.Scope -eq 'CurrentUser') { '当前用户 / Current user (HKCU)' } else { '所有用户 / All users (HKLM)' }
  $text = "旧程序目录已经不存在，是否修复残留的安装记录？`r`nRepair stale installation records for a missing program directory?`r`n`r`n范围 / Scope: $scopeText`r`n旧目录 / Old directory: $($Plan.InstallDirectory)`r`n备份 / Backups: $OutputRoot`r`n`r`n请先关闭安装器。只清理本应用的固定注册项，不删除文件、配置或历史，不修改 PATH。`r`nClose installers first. Only this application's verified registration is removed; files, configuration, history and PATH are preserved."
  return [Windows.Forms.MessageBox]::Show($text, 'Open DSH 安装记录修复 / Registration repair', 'YesNo', 'Warning', 'Button2') -eq 'Yes'
}

function Write-DesktopRepairReport([string]$OutputRoot, $Report) {
  [void][IO.Directory]::CreateDirectory($OutputRoot)
  [IO.File]::WriteAllText((Join-Path $OutputRoot 'repair-result.json'), ($Report | ConvertTo-Json -Depth 4), [Text.Encoding]::UTF8)
}

# Returns 0 only for completed, cancelled or read-only operations; failed repairs return 1.
function Invoke-DesktopRepairTool([string]$RepairScope, [string]$OutputRoot, [switch]$InspectOnly) {
  $report = [ordered]@{ tool = 'OpenDSH Windows registration repair'; scope = $RepairScope; status = 'inspecting' }
  try {
    Assert-DesktopRepairEnvironment $RepairScope
    $plan = Get-DesktopRegistrationPlan -Scope $RepairScope
    $report['installation'] = $plan.InstallDirectory
    $report.status = $plan.Status
    Write-Host "Registration scope: $RepairScope; status: $($plan.Status)"
    if ($plan.Status -eq 'Missing') {
      Write-Host 'No matching installation records exist. Nothing was changed.'
    } elseif ($plan.Status -eq 'Present') {
      throw 'The installation directory still exists. Use the normal uninstaller; this tool will not remove a live installation registration.'
    } elseif ($plan.Status -ne 'Orphaned') {
      throw 'Registration state is unknown. Nothing was changed.'
    } elseif ($InspectOnly) {
      Write-Host "Verified missing directory: $($plan.InstallDirectory). Check-only mode; nothing was changed."
    } elseif (-not (Confirm-DesktopRegistrationRepair $plan $OutputRoot)) {
      $report.status = 'cancelled'
      Write-Host 'Cancelled. Nothing was changed.'
    } else {
      $result = Invoke-DesktopRegistrationRepair -Plan $plan -OutputRoot $OutputRoot -Confirmed
      if ($result.Status -notin @('Repaired', 'Missing')) { throw 'Repair outcome is unknown. Preserve the backups and contact support.' }
      $report.status = $result.Status
      $report['backupDirectory'] = $result.BackupDirectory
      Write-Host "Repair completed. Backups: $($result.BackupDirectory)"
      Write-Host 'Run the installer again. No application files or personal data were deleted.'
    }
    Write-DesktopRepairReport $OutputRoot $report
    Write-Host "Diagnostic report: $OutputRoot"
    return 0
  } catch {
    $report.status = 'stopped'
    $report['error'] = $_.Exception.Message
    Write-Host ('STOPPED / 已停止: ' + $_.Exception.Message) -ForegroundColor Red
    try { Write-DesktopRepairReport $OutputRoot $report }
    catch { Write-Host ('Could not save diagnostic report: ' + $_.Exception.Message) }
    Write-Host "Keep the complete error and backups at: $OutputRoot"
    return 1
  }
}

if ($MyInvocation.InvocationName -ne '.') {
  if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA) -or -not [IO.Path]::IsPathRooted($env:LOCALAPPDATA)) {
    Write-Host 'LOCALAPPDATA is unavailable. Nothing was changed.' -ForegroundColor Red
    exit 1
  }
  $outputRoot = Join-Path (Join-Path $env:LOCALAPPDATA 'OpenDSH-Repair') ([DateTime]::Now.ToString('yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N'))
  exit (Invoke-DesktopRepairTool -RepairScope $Scope -OutputRoot $outputRoot -InspectOnly:$CheckOnly)
}

[CmdletBinding()]
param(
  [ValidateSet('inspect', 'repair', 'validateUninstall')][string]$Action,
  [ValidateSet('HKEY_CURRENT_USER', 'HKEY_LOCAL_MACHINE')][string]$RegistryRoot,
  [string]$ExpectedInstallDirectory,
  [string]$ExpectedVersion,
  [string]$DiagnosticDirectory,
  [switch]$Confirmed
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-registration.ps1')

function Invoke-DesktopInstallerRegistration {
  param([string]$Action, [string]$RegistryRoot, [string]$ExpectedInstallDirectory, [string]$ExpectedVersion, [string]$DiagnosticDirectory, [switch]$Confirmed)
  $scope = switch ($RegistryRoot) { 'HKEY_CURRENT_USER' { 'CurrentUser' }; 'HKEY_LOCAL_MACHINE' { 'AllUsers' }; default { throw 'An explicit installation registry root is required.' } }
  $plan = Get-DesktopRegistrationPlan -Scope $scope -ExpectedInstallDirectory $ExpectedInstallDirectory
  if ($Action -eq 'inspect') {
    if ($plan.Status -eq 'Orphaned') {
      Write-Host ('Verified orphaned installation: ' + $plan.InstallDirectory)
      return 10
    }
    return 0
  }
  if ($Action -eq 'repair') {
    if ($plan.Status -ne 'Orphaned') { throw 'The installation is not an orphaned registration. Nothing was repaired.' }
    $result = Invoke-DesktopRegistrationRepair -Plan $plan -OutputRoot $DiagnosticDirectory -Confirmed:$Confirmed
    Write-Host ('Orphaned installation registration removed; application files and personal data were not removed. Backups: ' + $result.BackupDirectory)
    return 0
  }
  if ($Action -eq 'validateUninstall') {
    if ([string]::IsNullOrEmpty($ExpectedInstallDirectory) -or [string]::IsNullOrEmpty($ExpectedVersion)) { throw 'Uninstall validation requires the running uninstaller directory and version.' }
    if ($plan.Status -eq 'Missing') { throw 'No matching installation registration exists. File removal was refused; use the current installer or contact support.' }
    $uninstallRecord = @($plan.Records | Where-Object { $_.Path -eq @(Get-DesktopRegistrationKeys)[1] })
    if ($uninstallRecord.Count -ne 1 -or (Get-DesktopRegistrationString $uninstallRecord[0] 'DisplayVersion') -cne $ExpectedVersion) { throw 'This uninstaller cannot verify that it owns the registered application version.' }
    foreach ($record in $plan.Records) {
      $version = Get-DesktopRegistrationString $record 'DisplayVersion'
      if ($null -ne $version -and $version -cne $ExpectedVersion) { throw 'A different application version owns the installation registration. This uninstaller stopped before removing files or personal data.' }
    }
    return 0
  }
  throw 'Unknown registration operation.'
}

if ($MyInvocation.InvocationName -ne '.') {
  try {
    $code = Invoke-DesktopInstallerRegistration -Action $Action -RegistryRoot $RegistryRoot -ExpectedInstallDirectory $ExpectedInstallDirectory -ExpectedVersion $ExpectedVersion -DiagnosticDirectory $DiagnosticDirectory -Confirmed:$Confirmed
    exit $code
  } catch {
    [Console]::Error.WriteLine('Installation registration inspection stopped: ' + $_.Exception.Message)
    exit 3
  }
}

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../build/windows-registration.ps1')
. (Join-Path $PSScriptRoot '../../build/installer-registration.ps1')
$nativeDirectoryState = ${function:Get-DesktopRegistrationDirectoryState}

$script:keys = @(Get-DesktopRegistrationKeys)
$script:directoryState = 'Missing'
$script:database = @{}
$script:backups = @{}
$script:deletes = @()
$script:exports = @()
$script:exportFailure = 0
$script:deleteFailure = 0
$script:concurrentRecord = $false
$script:directoryAppears = $false
$script:tamperBackup = $false
$root = Join-Path ([IO.Path]::GetTempPath()) ('dsh-registration-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($root)

function Assert-Registration($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Copy-RegistrationRecord($Record) {
  if ($null -eq $Record) { return $null }
  $values = [ordered]@{}
  foreach ($name in $Record.Values.Keys) { $values[$name] = [ordered]@{ Kind = $Record.Values[$name].Kind; Value = $Record.Values[$name].Value } }
  return [pscustomobject]@{ Path = $Record.Path; Values = $values; Children = @($Record.Children) }
}
function New-RegistrationRecord([string]$Path, [hashtable]$Values) {
  $result = [ordered]@{}
  foreach ($name in @($Values.Keys | Sort-Object)) { $result[$name] = [ordered]@{ Kind = 'String'; Value = $Values[$name] } }
  return [pscustomobject]@{ Path = $Path; Values = $result; Children = @() }
}
function Reset-Registration([string]$Scope = 'CurrentUser', [string]$Directory = 'E:\任意 用户\DSH', [string]$Version = '0.2.1-rc.3') {
  $script:database = @{}
  $script:backups = @{}
  $script:deletes = @()
  $script:exports = @()
  $script:exportFailure = 0
  $script:deleteFailure = 0
  $script:concurrentRecord = $false
  $script:directoryAppears = $false
  $script:tamperBackup = $false
  $script:directoryState = 'Missing'
  $mode = if ($Scope -eq 'CurrentUser') { 'currentuser' } else { 'allusers' }
  $script:database["$Scope/$($script:keys[0])"] = New-RegistrationRecord $script:keys[0] @{ InstallLocation = $Directory; ShortcutName = 'Open DeepSeek Harness Desktop' }
  $command = '"' + $Directory + '\Uninstall DeepSeek Harness.exe" /' + $mode
  $script:database["$Scope/$($script:keys[1])"] = New-RegistrationRecord $script:keys[1] @{ DisplayName = "Open DeepSeek Harness Desktop $Version"; DisplayVersion = $Version; UninstallString = $command; QuietUninstallString = ($command + ' /S') }
}
function Read-DesktopRegistrationKey([string]$Scope, [string]$Path) { return Copy-RegistrationRecord $script:database["$Scope/$Path"] }
function Get-DesktopRegistrationDirectoryState([string]$Directory) {
  if ($script:directoryState -eq 'Denied') { throw 'Access denied; state unknown.' }
  return $script:directoryState
}
function Export-DesktopRegistrationKey([string]$Scope, $Record, [string]$File) {
  $script:exports += "$Scope/$($Record.Path)"
  if ($script:exports.Count -eq $script:exportFailure) { throw 'Injected backup failure.' }
  $script:backups[$File] = @{ Scope = $Scope; Record = Copy-RegistrationRecord $Record }
  [IO.File]::WriteAllText($File, (Get-DesktopRegistrationFingerprint $Record))
  if ($script:directoryAppears) { $script:directoryState = 'Present' }
}
function Remove-DesktopRegistrationKey([string]$Scope, [string]$Path) {
  Assert-Registration ($script:exports.Count -eq 2) 'A record was deleted before all backups completed.'
  $script:deletes += "$Scope/$Path"
  if ($script:deletes.Count -eq $script:deleteFailure) {
    if ($script:concurrentRecord) { $script:database["$Scope/$($script:keys[0])"] = New-RegistrationRecord $script:keys[0] @{ InstallLocation = 'C:\new application'; ShortcutName = 'Open DeepSeek Harness Desktop' } }
    if ($script:tamperBackup) { foreach ($file in $script:backups.Keys) { [IO.File]::WriteAllText($file, 'tampered') } }
    throw 'Injected deletion failure.'
  }
  $script:database.Remove("$Scope/$Path")
}
function Restore-DesktopRegistrationKey([string]$File) {
  $backup = $script:backups[$File]
  $script:database["$($backup.Scope)/$($backup.Record.Path)"] = Copy-RegistrationRecord $backup.Record
}
function Expect-RegistrationFailure([string]$Name, [scriptblock]$Action, [string]$Expected) {
  $failure = $null
  try { & $Action } catch { $failure = $_.Exception.Message }
  Assert-Registration ($null -ne $failure -and $failure.Contains($Expected)) "$Name did not reject as expected: $failure"
  Write-Host "PASS $Name"
}

try {
  if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) {
    Assert-Registration ((& $nativeDirectoryState $root) -eq 'Present') 'Native directory inspection did not find its fixture.'
    Assert-Registration ((& $nativeDirectoryState (Join-Path $root 'missing\app')) -eq 'Missing') 'Native directory inspection did not distinguish missing descendants.'
    $junction = Join-Path $root 'linked'
    [void](New-Item -ItemType Junction -Path $junction -Target $root)
    try {
      Expect-RegistrationFailure 'native-reparse-refused' { & $nativeDirectoryState (Join-Path $junction 'missing') } 'reparse point'
    } finally { [IO.Directory]::Delete($junction, $false) }
    Write-Host 'PASS native-directory-states'
  }
  foreach ($scope in @('CurrentUser', 'AllUsers')) {
    Reset-Registration $scope
    $plan = Get-DesktopRegistrationPlan -Scope $scope
    Assert-Registration ($plan.Status -eq 'Orphaned' -and $plan.InstallDirectory -eq 'E:\任意 用户\DSH') 'Arbitrary username/path was not supported.'
    $result = Invoke-DesktopRegistrationRepair -Plan $plan -OutputRoot $root -Confirmed
    Assert-Registration ($result.Status -eq 'Repaired' -and $script:database.Count -eq 0 -and $script:deletes.Count -eq 2) 'Metadata-only repair did not complete.'
    Assert-Registration (@($script:deletes | Where-Object { -not $_.StartsWith($scope + '/') }).Count -eq 0) 'Repair touched another installation scope.'
    Write-Host "PASS repair-$scope"
  }
  Reset-Registration
  $script:database.Remove("CurrentUser/$($script:keys[1])")
  Assert-Registration ((Get-DesktopRegistrationPlan -Scope CurrentUser).Status -eq 'Orphaned') 'A leftover install-location record was not diagnosed.'
  Write-Host 'PASS install-record-without-uninstall-entry'
  Reset-Registration
  $script:database.Remove("CurrentUser/$($script:keys[0])")
  Assert-Registration ((Get-DesktopRegistrationPlan -Scope CurrentUser).Status -eq 'Orphaned') 'A leftover uninstall entry could not resolve its old directory.'
  Write-Host 'PASS uninstall-entry-without-install-record'
  Reset-Registration
  Assert-Registration ((Invoke-DesktopInstallerRegistration -Action inspect -RegistryRoot HKEY_CURRENT_USER -ExpectedInstallDirectory 'E:\任意 用户\DSH') -eq 10) 'Installer did not report an explicit orphan state.'
  Write-Host 'PASS installer-orphan-diagnosis'
  Reset-Registration
  Expect-RegistrationFailure 'installer-repair-no-consent' { Invoke-DesktopInstallerRegistration -Action repair -RegistryRoot HKEY_CURRENT_USER -ExpectedInstallDirectory 'E:\任意 用户\DSH' -DiagnosticDirectory $root } 'explicit confirmation'
  Assert-Registration ($script:deletes.Count -eq 0) 'Unconfirmed installer repair changed registration.'
  Reset-Registration
  $script:directoryState = 'Present'
  $plan = Get-DesktopRegistrationPlan -Scope CurrentUser
  Expect-RegistrationFailure 'existing-install-refused' { Invoke-DesktopRegistrationRepair -Plan $plan -OutputRoot $root -Confirmed } 'verified orphaned'
  Reset-Registration
  $plan = Get-DesktopRegistrationPlan -Scope CurrentUser
  Expect-RegistrationFailure 'explicit-confirmation' { Invoke-DesktopRegistrationRepair -Plan $plan -OutputRoot $root } 'explicit confirmation'
  Reset-Registration
  $script:directoryState = 'Denied'
  Expect-RegistrationFailure 'unknown-directory-refused' { Get-DesktopRegistrationPlan -Scope CurrentUser } 'unknown'
  foreach ($field in @('DisplayName', 'DisplayVersion', 'UninstallString', 'QuietUninstallString')) {
    Reset-Registration
    $script:database["CurrentUser/$($script:keys[1])"].Values[$field].Value = 'unrelated value'
    Expect-RegistrationFailure "invalid-$field" { Get-DesktopRegistrationPlan -Scope CurrentUser } $(switch ($field) { 'DisplayName' { 'identify' }; 'DisplayVersion' { 'disagree' }; 'UninstallString' { 'invalid' }; 'QuietUninstallString' { 'agree' } })
  }
  Reset-Registration
  $script:database["CurrentUser/$($script:keys[0])"].Values.InstallLocation.Value = 'C:\another app'
  Expect-RegistrationFailure 'conflicting-directories' { Get-DesktopRegistrationPlan -Scope CurrentUser } 'different directories'
  Reset-Registration
  $script:database["CurrentUser/$($script:keys[0])"].Children = @('Unexpected')
  Expect-RegistrationFailure 'nested-records-refused' { Get-DesktopRegistrationPlan -Scope CurrentUser } 'child keys'
  Reset-Registration
  $plan = Get-DesktopRegistrationPlan -Scope CurrentUser
  $script:exportFailure = 2
  Expect-RegistrationFailure 'backup-failure-no-deletion' { Invoke-DesktopRegistrationRepair -Plan $plan -OutputRoot $root -Confirmed } 'backup failure'
  Assert-Registration ($script:deletes.Count -eq 0 -and $script:database.Count -eq 2) 'Backup failure changed registration.'
  Reset-Registration
  $plan = Get-DesktopRegistrationPlan -Scope CurrentUser
  $script:deleteFailure = 2
  Expect-RegistrationFailure 'deletion-failure-rolls-back' { Invoke-DesktopRegistrationRepair -Plan $plan -OutputRoot $root -Confirmed } 'removed records were restored'
  Assert-Registration ($script:database.Count -eq 2) 'Failed repair did not restore both records.'
  Reset-Registration
  $plan = Get-DesktopRegistrationPlan -Scope CurrentUser
  $script:deleteFailure = 2
  $script:concurrentRecord = $true
  Expect-RegistrationFailure 'concurrent-replacement-preserved' { Invoke-DesktopRegistrationRepair -Plan $plan -OutputRoot $root -Confirmed } 'restoration requires attention'
  Assert-Registration ($script:database["CurrentUser/$($script:keys[0])"].Values.InstallLocation.Value -eq 'C:\new application') 'Rollback overwrote concurrent registration.'
  Reset-Registration
  $plan = Get-DesktopRegistrationPlan -Scope CurrentUser
  $script:deleteFailure = 2
  $script:tamperBackup = $true
  Expect-RegistrationFailure 'tampered-backup-refused' { Invoke-DesktopRegistrationRepair -Plan $plan -OutputRoot $root -Confirmed } 'backup changed'
  Reset-Registration
  $plan = Get-DesktopRegistrationPlan -Scope CurrentUser
  $script:directoryAppears = $true
  Expect-RegistrationFailure 'directory-reappeared-refused' { Invoke-DesktopRegistrationRepair -Plan $plan -OutputRoot $root -Confirmed } 'directory appeared'
  Assert-Registration ($script:deletes.Count -eq 0) 'Directory appearance still removed registration.'
  Reset-Registration
  Expect-RegistrationFailure 'uninstall-path-mismatch' { Invoke-DesktopInstallerRegistration -Action validateUninstall -RegistryRoot HKEY_CURRENT_USER -ExpectedInstallDirectory 'C:\another' -ExpectedVersion '0.2.1-rc.3' } 'directory changed'
  Reset-Registration
  Expect-RegistrationFailure 'uninstall-version-mismatch' { Invoke-DesktopInstallerRegistration -Action validateUninstall -RegistryRoot HKEY_CURRENT_USER -ExpectedInstallDirectory 'E:\任意 用户\DSH' -ExpectedVersion '0.2.1-rc.2' } 'registered application version'
  Reset-Registration
  $script:directoryState = 'Present'
  Assert-Registration ((Invoke-DesktopInstallerRegistration -Action validateUninstall -RegistryRoot HKEY_CURRENT_USER -ExpectedInstallDirectory 'E:\任意 用户\DSH' -ExpectedVersion '0.2.1-rc.3') -eq 0) 'Matching uninstaller was refused.'
  Write-Host 'PASS uninstall-matching-version'
  Reset-Registration AllUsers
  Expect-RegistrationFailure 'uninstall-other-scope-replacement' { Invoke-DesktopInstallerRegistration -Action validateUninstall -RegistryRoot HKEY_CURRENT_USER -ExpectedInstallDirectory 'E:\任意 用户\DSH' -ExpectedVersion '0.2.1-rc.3' } 'No matching installation registration'
  Assert-Registration ($script:database.Count -eq 2 -and $script:deletes.Count -eq 0) 'A stale uninstaller altered the replacement installation scope.'
  $script:database = @{}
  Assert-Registration ((Get-DesktopRegistrationPlan -Scope CurrentUser).Status -eq 'Missing') 'Clean installation had stale records.'
  Expect-RegistrationFailure 'uninstall-missing-registration' { Invoke-DesktopInstallerRegistration -Action validateUninstall -RegistryRoot HKEY_CURRENT_USER -ExpectedInstallDirectory 'E:\任意 用户\DSH' -ExpectedVersion '0.2.1-rc.3' } 'No matching installation registration'
  Write-Host 'PASS no-records'
  foreach ($directory in @('C:\', '\\server\share\app', 'C:relative', 'C:\safe\..\other', 'C:\app:stream', 'C:\trailing.', 'C:\CON', 'C:\duplicate\\component')) {
    Expect-RegistrationFailure ('unsafe-path-' + $directory) { Get-DesktopRegistrationDirectory $directory } ''
  }
} finally { [IO.Directory]::Delete($root, $true) }

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../build/installer-upgrade.ps1')

$root = Join-Path ([System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../../.artifacts'))) ('dsh-upgrade-' + [guid]::NewGuid().ToString('N'))
[void][System.IO.Directory]::CreateDirectory($root)
$root = (Get-Item -LiteralPath $root).FullName
$script:outcomes = @()
$script:runs = @()
$script:waits = 0
$script:keepOldFiles = $false
$script:breakLogAfterProcess = $false
$script:runArguments = @()
$script:tamperUninstaller = $false
$script:replaceUninstallerWithLink = $false
function Invoke-DesktopUninstallerProcess($Executable, $Arguments, $WorkingDirectory) {
  $script:runs += $Executable
  $script:runArguments += $Arguments
  $next = $script:outcomes[0]
  $script:outcomes = @($script:outcomes | Select-Object -Skip 1)
  if ($next.launched -and $next.exitCode -eq 0 -and -not $script:keepOldFiles) {
    Remove-Item -LiteralPath $script:activeExecutable -Force
    if ($script:tamperUninstaller) { [System.IO.File]::WriteAllText($script:activeUninstaller, 'changed after uninstall') }
    if ($script:replaceUninstallerWithLink) {
      [System.IO.File]::Delete($script:activeUninstaller)
      $linkKind = if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) { 'Junction' } else { 'SymbolicLink' }
      [void](New-Item -ItemType $linkKind -Path $script:activeUninstaller -Target $script:tamperTarget)
    }
  }
  if ($script:breakLogAfterProcess) {
    $logFile = Join-Path $script:activeDiagnostics 'upgrade.jsonl'
    [System.IO.File]::Delete($logFile)
    [void][System.IO.Directory]::CreateDirectory($logFile)
  }
  return $next
}
function Wait-DesktopUpgradeRetry { $script:waits += 1 }
function Assert-Upgrade($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Run-UpgradeCase([string]$Name, [object[]]$Outcomes, [int]$Expected, [int]$Runs, [int]$Waits) {
  $caseRoot = Join-Path $root $Name
  $install = Join-Path $caseRoot 'old install'
  $temporary = Join-Path $caseRoot 'temporary'
  $diagnostics = Join-Path $caseRoot 'diagnostics'
  [void][System.IO.Directory]::CreateDirectory($install)
  [void][System.IO.Directory]::CreateDirectory($temporary)
  $uninstaller = Join-Path $install 'Uninstall Test Desktop.exe'
  $script:activeUninstaller = $uninstaller
  [System.IO.File]::WriteAllText($uninstaller, 'fixture')
  $script:activeExecutable = Join-Path $install 'Test Desktop.exe'
  [System.IO.File]::WriteAllText($script:activeExecutable, 'old app')
  $script:outcomes = $Outcomes
  $script:runs = @()
  $script:runArguments = @()
  $script:waits = 0
  $code = Invoke-DesktopOldUninstall -InstallDirectory $install -UninstallerPath $uninstaller -UninstallerName 'Uninstall Test Desktop.exe' -AppExecutable 'Test Desktop.exe' -UninstallArguments '/currentuser --updated --keep-shortcuts' -TemporaryDirectory $temporary -DiagnosticDirectory $diagnostics
  Assert-Upgrade ($code -eq $Expected) "$Name returned $code rather than $Expected"
  Assert-Upgrade ($script:runs.Count -eq $Runs) "$Name executed $($script:runs.Count) times"
  Assert-Upgrade ($script:waits -eq $Waits) "$Name waited $($script:waits) times"
  Assert-Upgrade ($script:runArguments[0].Contains('/KEEP_APP_DATA /currentuser --updated --keep-shortcuts _?=' + $install)) "$Name lost data-preservation, mode, or actual old-directory arguments"
  $trace = Get-Content -LiteralPath (Join-Path $diagnostics 'upgrade.jsonl') -Raw
  Assert-Upgrade ($trace.Contains('old install')) "$Name did not retain the actual old directory"
  if ($Expected -ne 0) { Assert-Upgrade (Test-Path -LiteralPath $script:activeExecutable) "$Name damaged the old app" }
  if ($Expected -eq 0) { Assert-Upgrade (-not (Test-Path -LiteralPath $uninstaller)) "$Name left the validated old uninstaller in the payload destination" }
  Write-Output "PASS $Name"
}

function Run-RefusedUpgradeCase([string]$Name, [scriptblock]$Configure, [int]$ExpectedRuns = 0, [bool]$ExpectOldExecutable = $true) {
  $caseRoot = Join-Path $root $Name
  $install = Join-Path $caseRoot 'registered old install'
  $temporary = Join-Path $caseRoot 'temporary'
  $diagnostics = Join-Path $caseRoot 'diagnostics'
  [void][System.IO.Directory]::CreateDirectory($install)
  [void][System.IO.Directory]::CreateDirectory($temporary)
  $uninstaller = Join-Path $install 'Uninstall Test Desktop.exe'
  $script:activeUninstaller = $uninstaller
  [System.IO.File]::WriteAllText($uninstaller, 'fixture')
  $script:activeExecutable = Join-Path $install 'Test Desktop.exe'
  $script:activeDiagnostics = $diagnostics
  [System.IO.File]::WriteAllText($script:activeExecutable, 'old app')
  $parameters = @{
    InstallDirectory = $install; UninstallerPath = $uninstaller; UninstallerName = 'Uninstall Test Desktop.exe';
    AppExecutable = 'Test Desktop.exe'; UninstallArguments = '/currentuser --updated';
    TemporaryDirectory = $temporary; DiagnosticDirectory = $diagnostics
  }
  $script:outcomes = @(@{ launched = $true; exitCode = 0 })
  $script:runs = @()
  $script:runArguments = @()
  $script:waits = 0
  & $Configure $parameters
  $code = Invoke-DesktopOldUninstall @parameters
  Assert-Upgrade ($code -eq 3) "$Name returned $code instead of refusing the upgrade"
  Assert-Upgrade ($script:runs.Count -eq $ExpectedRuns) "$Name ran the uninstaller an unsafe number of times"
  Assert-Upgrade ((Test-Path -LiteralPath $script:activeExecutable) -eq $ExpectOldExecutable) "$Name reported the wrong old-file state"
}
try {
  Run-UpgradeCase 'success' @(@{ launched = $true; exitCode = 0 }) 0 1 0
  Run-UpgradeCase 'retry-cleanup' @(@{ launched = $true; exitCode = 2 }, @{ launched = $true; exitCode = 0 }) 0 2 1
  Run-UpgradeCase 'persistent-cleanup' @(1..12 | ForEach-Object { @{ launched = $true; exitCode = 2 } }) 2 12 11
  Run-UpgradeCase 'non-retryable' @(@{ launched = $true; exitCode = 7 }) 7 1 0
  Run-UpgradeCase 'fallback-in-place' @(@{ launched = $false; errorCode = 5 }, @{ launched = $true; exitCode = 0 }) 0 2 0
  Run-UpgradeCase 'both-launch-failed' @(@{ launched = $false; errorCode = 5 }, @{ launched = $false; errorCode = 5 }) 3 2 0
  Run-UpgradeCase 'fallback-retry' @(@{ launched = $false; errorCode = 5 }, @{ launched = $true; exitCode = 2 }, @{ launched = $true; exitCode = 0 }) 0 3 1
  Assert-Upgrade ($script:runs[1] -eq $script:runs[2]) 'A failed temporary launch was attempted again after selecting the original uninstaller.'
  $invalid = Join-Path $root 'invalid-registration'
  [void][System.IO.Directory]::CreateDirectory($invalid)
  $script:runs = @()
  $code = Invoke-DesktopOldUninstall -InstallDirectory $invalid -UninstallerPath (Join-Path $root 'elsewhere.exe') -UninstallerName 'Uninstall Test Desktop.exe' -AppExecutable 'Test Desktop.exe' -UninstallArguments '/currentuser --updated' -TemporaryDirectory $root -DiagnosticDirectory (Join-Path $root 'invalid-log')
  Assert-Upgrade ($code -ne 0 -and $script:runs.Count -eq 0) 'Invalid registry paths launched an uninstaller'
  Write-Output 'PASS invalid-registration'

  Run-RefusedUpgradeCase 'temp-inside-old' { param($parameters) $parameters.TemporaryDirectory = $parameters.InstallDirectory }
  Run-RefusedUpgradeCase 'log-inside-old' { param($parameters) $parameters.DiagnosticDirectory = Join-Path $parameters.InstallDirectory 'logs' }
  Run-RefusedUpgradeCase 'root-old' { param($parameters) $parameters.InstallDirectory = [System.IO.Path]::GetPathRoot($root) }
  Run-RefusedUpgradeCase 'relative-temp' { param($parameters) $parameters.TemporaryDirectory = 'temporary' }
  Write-Output 'PASS unsafe-directories'

  $script:keepOldFiles = $true
  Run-RefusedUpgradeCase 'success-with-old-files' { param($parameters) } 1
  $script:keepOldFiles = $false
  Run-RefusedUpgradeCase 'success-with-old-resources' {
    param($parameters)
    $resources = Join-Path $parameters.InstallDirectory 'resources'
    [void][System.IO.Directory]::CreateDirectory($resources)
    [System.IO.File]::WriteAllText((Join-Path $resources 'old-runtime.txt'), 'old runtime')
  } 1 $false
  Write-Output 'PASS incomplete-cleanup'

  foreach ($arguments in @('/allusers /currentuser --updated', '/currentuser --updated --updated', '/currentuser', '/currentuser --updated /REMOVE_APP_DATA', '/currentuser --updated "injected"', "/currentuser --updated`n--keep-shortcuts")) {
    Run-RefusedUpgradeCase ('invalid-arguments-' + [guid]::NewGuid().ToString('N')) { param($parameters) $parameters.UninstallArguments = $arguments }
  }
  Run-RefusedUpgradeCase 'invalid-name' { param($parameters) $parameters.AppExecutable = '../Test.exe' }
  Write-Output 'PASS invalid-arguments'

  Run-RefusedUpgradeCase 'missing-uninstaller' { param($parameters) [System.IO.File]::Delete($parameters.UninstallerPath) }
  Write-Output 'PASS missing-uninstaller'

  Run-RefusedUpgradeCase 'log-unwritable' {
    param($parameters)
    [void][System.IO.Directory]::CreateDirectory((Join-Path $parameters.DiagnosticDirectory 'upgrade.jsonl'))
  }
  $script:breakLogAfterProcess = $true
  Run-RefusedUpgradeCase 'log-breaks-after-launch' {
    param($parameters)
    $script:outcomes = @(@{ launched = $true; exitCode = 2 })
  } 1
  $script:breakLogAfterProcess = $false
  Write-Output 'PASS log-write-failure'

  $script:tamperUninstaller = $true
  Run-RefusedUpgradeCase 'changed-old-uninstaller' { param($parameters) } 1 $false
  $script:tamperUninstaller = $false
  Assert-Upgrade ((Get-Content -LiteralPath $script:activeUninstaller -Raw) -eq 'changed after uninstall') 'A changed old uninstaller was deleted.'
  $script:tamperTarget = Join-Path $root 'external-link-target'
  [void][System.IO.Directory]::CreateDirectory($script:tamperTarget)
  [System.IO.File]::WriteAllText((Join-Path $script:tamperTarget 'preserved.txt'), 'preserve')
  $script:replaceUninstallerWithLink = $true
  Run-RefusedUpgradeCase 'linked-old-uninstaller' { param($parameters) } 1 $false
  $script:replaceUninstallerWithLink = $false
  Assert-Upgrade ((Get-Content -LiteralPath (Join-Path $script:tamperTarget 'preserved.txt') -Raw) -eq 'preserve') 'Old uninstaller cleanup followed a replacement link.'
  Remove-Item -LiteralPath $script:activeUninstaller -Force
  Write-Output 'PASS uninstaller-tampering'
} finally {
  Remove-Item -LiteralPath $root -Recurse -Force
}

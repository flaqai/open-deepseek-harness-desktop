$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-upgrade-qualification.ps1')

function Assert-UpgradeTest([bool] $Condition, [string] $Message) {
  if (-not $Condition) { throw $Message }
}

function Assert-UpgradeRejects([scriptblock] $Action, [string] $Expected) {
  $rejected = $false
  try { & $Action } catch {
    if ($_.Exception.Message -notlike "*$Expected*") { throw }
    $rejected = $true
  }
  Assert-UpgradeTest $rejected "Expected rejection: $Expected"
}

$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) "dsh-upgrade-behavior-$([Guid]::NewGuid())"
New-Item -ItemType Directory -Path $testRoot -ErrorAction Stop | Out-Null
try {
  Assert-UpgradeTest (Test-DesktopUpgradeRegistration -KeyName '{0361fe6e-270e-56a3-9f11-0d722f41d3b6}' -DisplayName 'Old desktop name') 'Stable app identity was not detected after a display-name change.'
  Assert-UpgradeTest (Test-DesktopUpgradeRegistration -KeyName 'different-key' -DisplayName 'Open DeepSeek Harness Desktop') 'Named desktop registration was not detected.'
  Assert-UpgradeTest (-not (Test-DesktopUpgradeRegistration -KeyName 'different-key' -DisplayName 'Other app')) 'An unrelated app was treated as a desktop installation.'
  $sentinel = Join-Path $testRoot 'data'
  $sentinelText = 'synthetic user data'
  [System.IO.File]::WriteAllText($sentinel, $sentinelText)
  $before = [ordered]@{
    executable = 'old-executable'
    uninstaller = 'old-uninstaller'
    registrations = @([ordered]@{ key = 'old-key'; version = 'alpha.2'; directory = 'old-directory'; uninstaller = 'old-path' })
  }
  $copyState = { $before | ConvertTo-Json -Depth 5 | ConvertFrom-Json }
  $after = & $copyState
  Assert-DesktopUpgradeFailurePreservedState -ExitCode 2 -Before $before -After $after -Sentinel $sentinel -ExpectedSentinel $sentinelText
  Assert-UpgradeRejects { Assert-DesktopUpgradeFailurePreservedState -ExitCode 0 -Before $before -After $after -Sentinel $sentinel -ExpectedSentinel $sentinelText } 'reported success'
  foreach ($field in @('executable', 'uninstaller')) {
    $after = & $copyState
    $after.$field = 'candidate-file'
    Assert-UpgradeRejects { Assert-DesktopUpgradeFailurePreservedState -ExitCode 2 -Before $before -After $after -Sentinel $sentinel -ExpectedSentinel $sentinelText } 'previous application and uninstaller'
  }
  foreach ($field in @('key', 'version', 'directory', 'uninstaller')) {
    $after = & $copyState
    $after.registrations[0].$field = 'candidate-registration'
    Assert-UpgradeRejects { Assert-DesktopUpgradeFailurePreservedState -ExitCode 2 -Before $before -After $after -Sentinel $sentinel -ExpectedSentinel $sentinelText } 'uninstall registration'
  }
  $after = & $copyState
  [System.IO.File]::WriteAllText($sentinel, 'changed')
  Assert-UpgradeRejects { Assert-DesktopUpgradeFailurePreservedState -ExitCode 2 -Before $before -After $after -Sentinel $sentinel -ExpectedSentinel $sentinelText } 'user-data sentinel'
  Remove-Item -LiteralPath $sentinel -ErrorAction Stop
  Assert-UpgradeRejects { Assert-DesktopUpgradeFailurePreservedState -ExitCode 2 -Before $before -After $after -Sentinel $sentinel -ExpectedSentinel $sentinelText } 'user-data sentinel'

  $silent = New-DesktopQualificationInstallerStart -Installer 'candidate.exe' -Directory 'C:\private test\目标'
  Assert-UpgradeTest ($silent.ArgumentList -contains '/S') 'Default installer was not silent.'
  Assert-UpgradeTest ($silent.ArgumentList[-1] -eq '/D=C:\private test\目标') 'Install directory must remain the final NSIS argument.'
  Assert-UpgradeTest ($silent.ArgumentList -contains '/currentuser') 'Default installation mode changed.'
  $interactive = New-DesktopQualificationInstallerStart -Installer 'candidate.exe' -Directory 'C:\other' -Mode allusers -Interactive
  Assert-UpgradeTest ($interactive.ArgumentList -notcontains '/S') 'Manual qualification must display installer UI.'
  Assert-UpgradeTest ($interactive.ArgumentList -contains '/allusers') 'Explicit installation mode was dropped.'
} finally {
  Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction Stop
}
Write-Host 'Windows previous-release failure preservation and installer argument behavior passed.'

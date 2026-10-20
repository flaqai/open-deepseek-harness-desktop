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
  $script:nativeProbeRoots = [Collections.Generic.List[string]]::new()
  $script:nativeProbeDisposals = 0
  function Start-DesktopNativeEntryProcess {
    param([System.Diagnostics.ProcessStartInfo] $Start)
    Assert-UpgradeTest ($Start.ArgumentList -contains '--dsh-native-smoke') 'Probe must not start the normal host or an uninstaller.'
    $rootArgument = @($Start.ArgumentList | Where-Object { $_.StartsWith('--dsh-package-smoke-root=') })
    Assert-UpgradeTest ($rootArgument.Count -eq 1) 'Probe must select one private data directory.'
    $nativeRoot = $rootArgument[0].Substring('--dsh-package-smoke-root='.Length)
    Assert-UpgradeTest ([IO.Path]::IsPathRooted($nativeRoot) -and (Test-Path -LiteralPath $nativeRoot -PathType Container)) 'Native smoke directory must exist before process launch.'
    $script:nativeProbeRoots.Add($nativeRoot)
    $probe = [pscustomobject]@{
      ExitCode = 0
      StandardOutput = [IO.StringReader]::new('DSH_NATIVE_SMOKE_READY')
      StandardError = [IO.StringReader]::new('')
    }
    $probe | Add-Member ScriptMethod WaitForExit { param($Milliseconds) return $true }
    $probe | Add-Member ScriptMethod Kill { param($Tree) throw 'A completed native probe must not be terminated.' }
    $probe | Add-Member ScriptMethod Dispose { $this.StandardOutput.Dispose(); $this.StandardError.Dispose(); $script:nativeProbeDisposals++ }
    return $probe
  }
  Assert-PreviousDesktopNativeEntry -Executable 'synthetic-native-entry.exe' -EvidenceRoot $testRoot
  Assert-PreviousDesktopNativeEntry -Executable 'synthetic-native-entry.exe' -EvidenceRoot $testRoot
  Assert-UpgradeTest ($script:nativeProbeRoots.Count -eq 2 -and $script:nativeProbeRoots[0] -ne $script:nativeProbeRoots[1]) 'Each native probe must allocate a fresh private directory.'
  Assert-UpgradeTest ($script:nativeProbeDisposals -eq 2) 'Completed native probes must release their process handles.'
  foreach ($version in @('0.2.1-alpha.2', '0.2.1-rc.2.1')) {
    Assert-DesktopRegisteredVersion -InstalledVersion $version -ExpectedVersion $version -Registrations @(@{ version = $version })
    Assert-UpgradeRejects { Assert-DesktopRegisteredVersion -InstalledVersion '0.2.1.0' -ExpectedVersion $version -Registrations @(@{ version = $version }) } 'found package version'
    Assert-UpgradeRejects { Assert-DesktopRegisteredVersion -InstalledVersion $version -ExpectedVersion $version -Registrations @(@{ version = '0.2.1.0' }) } 'uninstall registration'
    Assert-UpgradeRejects { Assert-DesktopRegisteredVersion -InstalledVersion $version -ExpectedVersion $version -Registrations @() } 'uninstall registration'
    Assert-UpgradeRejects { Assert-DesktopRegisteredVersion -InstalledVersion $version -ExpectedVersion $version -Registrations @(@{ version = $version }, @{ version = $version }) } 'uninstall registration'
  }
  Assert-UpgradeRejects { Assert-DesktopRegisteredVersion -InstalledVersion '0.2.1-alpha.2' -ExpectedVersion '0.2.1-rc.2.1' -Registrations @(@{ version = '0.2.1-rc.2.1' }) } 'found package version'
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

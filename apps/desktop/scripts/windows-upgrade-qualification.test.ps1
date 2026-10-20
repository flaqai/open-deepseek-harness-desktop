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
  foreach ($unrelatedExit in @(1, 3, 20, 1223, -1)) {
    Assert-UpgradeRejects { Assert-DesktopUpgradeFailurePreservedState -ExitCode $unrelatedExit -Before $before -After $after -Sentinel $sentinel -ExpectedSentinel $sentinelText } 'must reach atomic cleanup failure exit 2'
  }
  $diagnosticRoot = Join-Path $testRoot 'diagnostics'
  New-Item -ItemType Directory -Path $diagnosticRoot -ErrorAction Stop | Out-Null
  $oldDiagnostic = Join-Path $diagnosticRoot 'old.dsh-install'
  New-Item -ItemType Directory -Path $oldDiagnostic -ErrorAction Stop | Out-Null
  $previousDirectories = @(Get-DesktopUpgradeDiagnosticDirectories -Root $diagnosticRoot)
  $currentDiagnostic = Join-Path $diagnosticRoot 'current.dsh-install'
  New-Item -ItemType Directory -Path $currentDiagnostic -ErrorAction Stop | Out-Null
  $records = @(@{ stage = 'uninstall-start'; installDirectory = $testRoot })
  for ($attempt = 1; $attempt -le 12; $attempt++) { $records += @{ stage = 'uninstall-result'; attempt = $attempt; exitCode = 2 } }
  $records += @{ stage = 'uninstall-failed'; attempt = 12; exitCode = 2 }
  $log = Join-Path $currentDiagnostic 'upgrade.jsonl'
  $serializeRecords = { param($Items) @($Items | ForEach-Object { $_ | ConvertTo-Json -Compress }) | Set-Content -LiteralPath $log -Encoding utf8 }
  & $serializeRecords $records
  Copy-Item -LiteralPath $log -Destination (Join-Path $oldDiagnostic 'upgrade.jsonl')
  Assert-DesktopAtomicCleanupBudget -Root $diagnosticRoot -PreviousDirectories $previousDirectories -InstallDirectory $testRoot -EvidenceRoot $testRoot
  Assert-UpgradeTest ((Get-Content -LiteralPath (Join-Path $testRoot 'persistent-lock-upgrade.jsonl')).Count -eq 14) 'The exact verified retry log must remain available as evidence.'
  $cases = @('wrong-root', 'wrong-exit', 'missing-attempt', 'wrong-order', 'wrong-final', 'launch-error')
  foreach ($case in $cases) {
    $changed = $records | ConvertTo-Json -Depth 5 | ConvertFrom-Json
    switch ($case) {
      'wrong-root' { $changed[0].installDirectory = $oldDiagnostic }
      'wrong-exit' { $changed[6].exitCode = 3 }
      'missing-attempt' { $changed = @($changed[0..11]) + @($changed[-1]) }
      'wrong-order' { $changed[2].attempt = 1 }
      'wrong-final' { $changed[-1].exitCode = 3 }
      'launch-error' { $changed += [pscustomobject]@{ stage = 'uninstall-launch-failed'; attempt = 12 } }
    }
    & $serializeRecords $changed
    Assert-UpgradeRejects { Assert-DesktopAtomicCleanupBudget -Root $diagnosticRoot -PreviousDirectories $previousDirectories -InstallDirectory $testRoot -EvidenceRoot $testRoot } 'Atomic cleanup retry evidence'
  }
  & $serializeRecords $records
  Assert-UpgradeRejects { Assert-DesktopAtomicCleanupBudget -Root $diagnosticRoot -PreviousDirectories @() -InstallDirectory $testRoot -EvidenceRoot $testRoot } 'exactly one'
  Remove-Item -LiteralPath $log -ErrorAction Stop
  Assert-UpgradeRejects { Assert-DesktopAtomicCleanupBudget -Root $diagnosticRoot -PreviousDirectories $previousDirectories -InstallDirectory $testRoot -EvidenceRoot $testRoot } 'exactly one'
  $savedTemp = $env:TEMP
  $savedRunnerTemp = $env:RUNNER_TEMP
  try {
    $env:TEMP = $diagnosticRoot
    $env:RUNNER_TEMP = $diagnosticRoot
    $mainSnapshot = @(Get-DesktopUpgradeDiagnosticDirectories -Root $diagnosticRoot)
    $mainDirectory = Join-Path $diagnosticRoot 'main.dsh-install'
    New-Item -ItemType Directory -Path $mainDirectory -ErrorAction Stop | Out-Null
    [IO.File]::WriteAllText((Join-Path $mainDirectory 'installer.log'), "installer-init mode=1 target=PRIVATE_SECRET`nuninstall-result=3 old=PRIVATE_SECRET`nunknown PRIVATE_SECRET", [Text.Encoding]::Unicode)
    @{ stage = 'uninstall-invalid-state'; errorCode = -1; error = 'The uninstaller reported success but previous runtime files remain. PRIVATE_SECRET'; commandLine = 'PRIVATE_SECRET' } |
      ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $mainDirectory 'upgrade.jsonl') -Encoding utf8
    [IO.File]::WriteAllText((Join-Path $mainDirectory 'unrelated.log'), 'PRIVATE_SECRET')
    $oversizedDirectory = Join-Path $diagnosticRoot 'oversized.dsh-install'
    New-Item -ItemType Directory -Path $oversizedDirectory -ErrorAction Stop | Out-Null
    [IO.File]::WriteAllText((Join-Path $oversizedDirectory 'upgrade.jsonl'), ('x' * 65537))
    $linkDirectory = Join-Path $diagnosticRoot 'linked.dsh-install'
    New-Item -ItemType Directory -Path $linkDirectory -ErrorAction Stop | Out-Null
    [void][IO.File]::CreateSymbolicLink((Join-Path $linkDirectory 'upgrade.jsonl'), (Join-Path $mainDirectory 'unrelated.log'))
    Save-DesktopMainInstallerDiagnostics -Root $diagnosticRoot -PreviousDirectories $mainSnapshot -SnapshotAvailable $true
    $reportPath = Join-Path $diagnosticRoot 'main-installer-diagnostics.json'
    $encodedReport = Get-Content -LiteralPath $reportPath -Raw
    $report = $encodedReport | ConvertFrom-Json
    Assert-UpgradeTest ($report.status -eq 'degraded' -and $report.directories.Count -eq 3) 'Collector must capture only new diagnostics and flag unsafe or oversized logs.'
    Assert-UpgradeTest (-not $encodedReport.Contains('PRIVATE_SECRET') -and -not $encodedReport.Contains('unrelated.log')) 'Collector must omit arbitrary log content, paths, command lines, and unrelated files.'
    $mainRecord = @($report.directories | Where-Object { $_.directory -eq 'main.dsh-install' })[0]
    Assert-UpgradeTest ($mainRecord.files[0].events[1].stage -eq 'uninstall-result' -and $mainRecord.files[0].events[1].result -eq 3) 'Installer UTF-16 numeric result must survive projection.'
    Assert-UpgradeTest ($mainRecord.files[1].events[0].errorKind -eq 'previous-runtime-remains') 'Upgrade invalid-state failure must retain its classified cause.'
    Save-DesktopMainInstallerDiagnostics -Root $diagnosticRoot -PreviousDirectories @() -SnapshotAvailable $false
    Assert-UpgradeTest ((Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json).status -eq 'unavailable') 'Unavailable snapshot must not collect unrelated old logs.'
    Remove-Item -LiteralPath $reportPath -ErrorAction Stop
    New-Item -ItemType Directory -Path $reportPath -ErrorAction Stop | Out-Null
    Assert-UpgradeRejects {
      try { throw 'primary-install-exit-2' } finally { Save-DesktopMainInstallerDiagnostics -Root $diagnosticRoot -PreviousDirectories $mainSnapshot -SnapshotAvailable $true }
    } 'primary-install-exit-2'
  } finally {
    $env:TEMP = $savedTemp
    $env:RUNNER_TEMP = $savedRunnerTemp
  }
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
  Assert-UpgradeTest ($silent.Arguments -ceq '/S /currentuser /ADDCLI=1 /D=C:\private test\目标') 'NSIS must receive its exact final unquoted directory tail, preserving spaces and Unicode.'
  Assert-UpgradeTest ($silent.ArgumentList.Count -eq 0 -and -not $silent.UseShellExecute) 'NSIS must not receive .NET ArgumentList auto-quoting or a shell.'
  $interactive = New-DesktopQualificationInstallerStart -Installer 'candidate.exe' -Directory 'C:\other' -Mode allusers -Interactive
  Assert-UpgradeTest ($interactive.Arguments -ceq '/allusers /ADDCLI=1 /D=C:\other' -and $interactive.ArgumentList.Count -eq 0) 'Interactive NSIS switches must remain allowlisted with an unquoted final directory.'
  foreach ($invalidDirectory in @('relative\target', 'C:relative', 'C:\', '\\server\share\target', 'C:/target', 'C:\target\..\other', 'C:\tar"get', "C:\target`rnext", "C:\target`nnext", "C:\target`tnext", "C:\target$([char]0)next", 'C:\target:stream')) {
    Assert-UpgradeRejects { New-DesktopQualificationInstallerStart -Installer 'candidate.exe' -Directory $invalidDirectory } 'absolute local Windows installation directory'
  }
  $modeRejected = $false
  try { $null = New-DesktopQualificationInstallerStart -Installer 'candidate.exe' -Directory 'C:\target' -Mode 'currentuser /S' } catch { $modeRejected = $true }
  Assert-UpgradeTest $modeRejected 'NSIS mode must reject arbitrary command-line switches.'
} finally {
  Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction Stop
}
Write-Host 'Windows previous-release failure preservation and installer argument behavior passed.'

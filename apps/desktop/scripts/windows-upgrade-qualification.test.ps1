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
  $sameFixture = Get-DesktopQualificationInstallDirectories -Root $testRoot
  $changedFixture = Get-DesktopQualificationInstallDirectories -Root $testRoot -ChangeDirectory
  Assert-UpgradeTest ($sameFixture.Candidate -eq $sameFixture.Previous -and $changedFixture.Candidate -ne $changedFixture.Previous) 'Same and changed upgrade fixtures must preserve their distinct directory semantics.'
  foreach ($fixtureRoot in @($changedFixture.Candidate, $changedFixture.Previous)) {
    $leaf = [IO.Path]::GetFileName($fixtureRoot)
    Assert-UpgradeTest ($leaf -match '[\u4e00-\u9fff]' -and $leaf.StartsWith('Open DeepSeek Harness Desktop ', [StringComparison]::Ordinal) -and $leaf.Length -eq 31) 'Both fixed install fixtures must retain the wizard APP_FILENAME, Chinese characters and spaces.'
    # The fixed public alpha.2 payload measured 193 characters beyond its root.
    # This guards these CI fixtures only; it is not a production path guarantee.
    foreach ($windowsOwner in @('D:\a\_temp\s-abcdef', 'D:\a\_temp\q-123456789abc\s-abcdef')) {
      $windowsRoot = $windowsOwner + '\' + $leaf
      Assert-UpgradeTest (($windowsRoot.Length + 193) -lt 260) 'Fixed administrator and standard-user fixtures must fit the measured legacy baseline path budget.'
    }
  }
  $metadataOwner = Join-Path $testRoot 'metadata-owner'
  $sameMetadataRoot = Join-Path $metadataOwner 'old'
  $changedMetadataRoot = Join-Path $metadataOwner 'old previous'
  $relativeParts = [Collections.Generic.List[string]]::new()
  $remaining = 258 - $sameMetadataRoot.Length - 1
  while ($remaining -gt 100) { $relativeParts.Add(('d' * 40)); $remaining -= 41 }
  if ($remaining -lt 1) { throw 'Synthetic metadata root is unexpectedly too long.' }
  $relativeParts.Add(('f' * $remaining))
  $relativeFile = [string]::Join([IO.Path]::DirectorySeparatorChar, $relativeParts)
  foreach ($directory in @($sameMetadataRoot, $changedMetadataRoot)) {
    $file = Join-Path $directory $relativeFile
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($file))
    [IO.File]::WriteAllText($file, 'PRIVATE_METADATA_CONTENT')
  }
  $sameMetadata = Get-DesktopInstallationPathMetadata -Directory $sameMetadataRoot -OwnerRoot $metadataOwner
  $changedMetadata = Get-DesktopInstallationPathMetadata -Directory $changedMetadataRoot -OwnerRoot $metadataOwner
  Assert-UpgradeTest ($sameMetadata.status -eq 'present' -and $sameMetadata.maximumFilePathLength -eq 258 -and $sameMetadata.fileCountAtLeast260 -eq 0 -and $sameMetadata.totalFileCount -eq 1) 'Metadata must count the real synthetic file length below MAX_PATH.'
  Assert-UpgradeTest ($changedMetadata.status -eq 'present' -and $changedMetadata.maximumFilePathLength -eq 267 -and $changedMetadata.fileCountAtLeast260 -eq 1 -and $changedMetadata.totalFileCount -eq 1) 'Nine extra root characters must be reflected without claiming a MAX_PATH diagnosis.'
  $partialMetadata = Get-DesktopInstallationPathMetadata -Directory $sameMetadataRoot -OwnerRoot $metadataOwner -MaximumEntries 1
  Assert-UpgradeTest ($partialMetadata.status -eq 'degraded' -and $partialMetadata.reason -eq 'scan-budget-exhausted' -and $partialMetadata.visitedEntries -eq 1) 'An exhausted metadata budget must report partial counts.'
  $unownedMetadata = Get-DesktopInstallationPathMetadata -Directory $testRoot -OwnerRoot $metadataOwner
  Assert-UpgradeTest ($unownedMetadata.status -eq 'degraded' -and $unownedMetadata.reason -eq 'unowned-root' -and $unownedMetadata.totalFileCount -eq 0) 'Metadata must not enumerate outside the owned fixture.'
  $metadataLink = Join-Path $sameMetadataRoot 'linked-installation'
  [void][IO.Directory]::CreateSymbolicLink($metadataLink, $changedMetadataRoot)
  try {
    $linkedMetadata = Get-DesktopInstallationPathMetadata -Directory $sameMetadataRoot -OwnerRoot $metadataOwner
    Assert-UpgradeTest ($linkedMetadata.status -eq 'degraded' -and $linkedMetadata.reparsePointsSkipped -eq 1 -and $linkedMetadata.totalFileCount -eq 1) 'Metadata traversal must not follow linked directories.'
    $linkedRootMetadata = Get-DesktopInstallationPathMetadata -Directory $metadataLink -OwnerRoot $metadataOwner
    Assert-UpgradeTest ($linkedRootMetadata.status -eq 'degraded' -and $linkedRootMetadata.reason -eq 'unsafe-root' -and $linkedRootMetadata.totalFileCount -eq 0) 'Metadata must not enumerate through a linked installation root.'
  } finally { [IO.Directory]::Delete($metadataLink) }
  $metadataJson = @($sameMetadata, $changedMetadata, $partialMetadata, $linkedMetadata) | ConvertTo-Json -Depth 4
  Assert-UpgradeTest (-not $metadataJson.Contains($metadataOwner) -and -not $metadataJson.Contains($relativeFile) -and -not $metadataJson.Contains('PRIVATE_METADATA_CONTENT')) 'Metadata must omit paths, file names, and contents.'
  $currentProcess = [Diagnostics.Process]::GetCurrentProcess()
  try {
    $liveLock = Get-DesktopShortLockMetadata -Process $currentProcess
    Assert-UpgradeTest ($liveLock.status -eq 'present' -and $liveLock.hasExited -eq $false -and $null -eq $liveLock.exitCode -and $null -ne $liveLock.startTimeUtc) 'A live locker must not be reported as completed.'
  } finally { $currentProcess.Dispose() }
  $lockProbeStart = [Diagnostics.ProcessStartInfo]::new()
  $lockProbeStart.FileName = (Get-Process -Id $PID).Path
  $lockProbeStart.UseShellExecute = $false
  $lockRelease = Join-Path $metadataOwner 'locker-release'
  $lockReleaseLiteral = $lockRelease.Replace("'", "''")
  $lockProbeCommand = "`$deadline = (Get-Date).AddSeconds(30); while (-not [IO.File]::Exists('$lockReleaseLiteral')) { if ((Get-Date) -gt `$deadline) { exit 9 }; Start-Sleep -Milliseconds 50 }; exit 7"
  foreach ($argument in @('-NoLogo', '-NoProfile', '-NonInteractive', '-Command', $lockProbeCommand)) { $lockProbeStart.ArgumentList.Add($argument) }
  $lockProbe = [Diagnostics.Process]::Start($lockProbeStart)
  try {
    $initialLock = Get-DesktopShortLockMetadata -Process $lockProbe
    Assert-UpgradeTest ($initialLock.status -eq 'present' -and $initialLock.hasExited -eq $false) 'Locker must remain live until the owned release signal.'
    [IO.File]::WriteAllText($lockRelease, '')
    if (-not $lockProbe.WaitForExit(10000)) { $lockProbe.Kill($true); $lockProbe.WaitForExit(); throw 'Metadata process fixture did not settle.' }
    $completedLock = Get-DesktopShortLockMetadata -Process $lockProbe
    Assert-UpgradeTest ($completedLock.status -eq 'present' -and $completedLock.hasExited -eq $true -and $completedLock.exitCode -eq 7 -and $null -ne $completedLock.exitTimeUtc) 'An exited locker must retain its actual exit and time evidence.'
  } finally { $lockProbe.Dispose() }
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
  $diagnosticLocker = [Diagnostics.Process]::GetCurrentProcess()
  try {
    $env:TEMP = $diagnosticRoot
    $env:RUNNER_TEMP = Join-Path $diagnosticRoot 's-aBc123'
    New-Item -ItemType Directory -Path $env:RUNNER_TEMP -ErrorAction Stop | Out-Null
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
    Save-DesktopMainInstallerDiagnostics -Root $diagnosticRoot -PreviousDirectories $mainSnapshot -SnapshotAvailable $true -OldInstallationMetadata $changedMetadata -ShortLocker $diagnosticLocker -ShortLockBeforeMain $initialLock
    $reportPath = Join-Path $diagnosticRoot 'main-installer-diagnostics.json'
    $encodedReport = Get-Content -LiteralPath $reportPath -Raw
    $report = $encodedReport | ConvertFrom-Json
    Assert-UpgradeTest ($report.status -eq 'degraded' -and $report.directories.Count -eq 3) 'Collector must capture only new diagnostics and flag unsafe or oversized logs.'
    Assert-UpgradeTest (-not $encodedReport.Contains('PRIVATE_SECRET') -and -not $encodedReport.Contains('unrelated.log')) 'Collector must omit arbitrary log content, paths, command lines, and unrelated files.'
    Assert-UpgradeTest ($report.oldInstallation.maximumFilePathLength -eq 267 -and $report.oldInstallation.fileCountAtLeast260 -eq 1 -and $report.shortLock.hasExited -eq $false -and $report.shortLockBeforeMain.hasExited -eq $false) 'Main diagnostics must retain numeric pre-install metadata and actual locker observations.'
    Assert-UpgradeTest (-not $encodedReport.Contains($metadataOwner) -and -not $encodedReport.Contains('PRIVATE_METADATA_CONTENT')) 'Main diagnostics must not add raw paths or file contents through metadata.'
    $mainRecord = @($report.directories | Where-Object { $_.directory -eq 'main.dsh-install' })[0]
    Assert-UpgradeTest ($mainRecord.files[0].events[1].stage -eq 'uninstall-result' -and $mainRecord.files[0].events[1].result -eq 3) 'Installer UTF-16 numeric result must survive projection.'
    Assert-UpgradeTest ($mainRecord.files[1].events[0].errorKind -eq 'previous-runtime-remains') 'Upgrade invalid-state failure must retain its classified cause.'
    Assert-UpgradeTest ($report.temporaryRootLength -eq $diagnosticRoot.Length -and $report.evidenceRootLength -eq $env:RUNNER_TEMP.Length) 'Diagnostics must record numeric original TEMP and nested evidence lengths.'
    Remove-Item -LiteralPath $reportPath -ErrorAction Stop
    $validEvidenceRoot = $env:RUNNER_TEMP
    $env:RUNNER_TEMP = $testRoot
    Save-DesktopMainInstallerDiagnostics -Root $diagnosticRoot -PreviousDirectories $mainSnapshot -SnapshotAvailable $true
    Assert-UpgradeTest (-not (Test-Path -LiteralPath $reportPath)) 'An unrelated evidence root must not authorize TEMP collection.'
    $env:RUNNER_TEMP = $validEvidenceRoot
    Save-DesktopMainInstallerDiagnostics -Root $diagnosticRoot -PreviousDirectories @() -SnapshotAvailable $false
    Assert-UpgradeTest ((Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json).status -eq 'unavailable') 'Unavailable snapshot must not collect unrelated old logs.'
    Remove-Item -LiteralPath $reportPath -ErrorAction Stop
    New-Item -ItemType Directory -Path $reportPath -ErrorAction Stop | Out-Null
    Assert-UpgradeRejects {
      try { throw 'primary-install-exit-2' } finally { Save-DesktopMainInstallerDiagnostics -Root $diagnosticRoot -PreviousDirectories $mainSnapshot -SnapshotAvailable $true }
    } 'primary-install-exit-2'
  } finally {
    $diagnosticLocker.Dispose()
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

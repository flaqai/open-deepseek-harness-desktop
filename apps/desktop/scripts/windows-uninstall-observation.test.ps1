$ErrorActionPreference = 'Stop'
$tokens = $null
$parseErrors = $null
$tree = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'smoke-windows-package.ps1'), [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'Installed smoke failed syntax parsing.' }
foreach ($name in @('Select-DesktopUninstallProcesses', 'Wait-DesktopUninstallCompletion')) {
  $definition = @($tree.FindAll({ param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
  }, $true))
  if ($definition.Count -ne 1) { throw "Expected one $name observation helper." }
  . ([scriptblock]::Create($definition[0].Extent.Text))
}

function New-UninstallTestSnapshot([bool] $Complete, [object[]] $Processes = @()) {
  return [pscustomobject]@{
    LauncherExited = $true; LauncherExitCode = 0
    PathRestored = $Complete; RegistrationRemoved = $Complete; InstallationRemoved = $Complete
    Processes = @($Processes | Where-Object { $null -ne $_ })
  }
}
function Invoke-UninstallObservationCase([scriptblock] $Read, [string] $ErrorKind = '') {
  $clock = @{ Now = 0 }
  $samples = [Collections.Generic.List[object]]::new()
  $readCase = { & $Read $clock.Now }.GetNewClosure()
  $elapsed = { $clock.Now }.GetNewClosure()
  $pause = { param($milliseconds) $clock.Now += 10000 }.GetNewClosure()
  $report = { param($sample) $samples.Add($sample) }.GetNewClosure()
  $failure = $null
  try { Wait-DesktopUninstallCompletion -ReadSnapshot $readCase -ElapsedMilliseconds $elapsed -Pause $pause -Report $report }
  catch { $failure = $_.Exception.Message }
  if ($ErrorKind -eq '' -and $null -ne $failure) { throw $failure }
  if ($ErrorKind -ne '' -and ($null -eq $failure -or $failure -notlike "*$ErrorKind*")) { throw "Expected bounded failure: $ErrorKind; received $failure" }
  if (($samples | ConvertTo-Json -Depth 8 -Compress) -match 'PRIVATE|Identity|Activity|CreationDate|CommandLine|ExecutablePath') { throw 'Observation emitted private process metadata.' }
  if ($samples.Count -gt 33) { throw 'Observation diagnostics exceeded its bounded sampling budget.' }
  return [pscustomobject]@{ Elapsed = $clock.Now; Samples = $samples; Failure = $failure }
}

$slow = Invoke-UninstallObservationCase {
  param($time)
  $processes = if ($time -lt 190000) { @([pscustomobject]@{ ProcessId = 42; Identity = 'PRIVATE'; Activity = $time }) } else { @() }
  New-UninstallTestSnapshot ($time -ge 180000) $processes
}
if ($slow.Elapsed -ne 190000) { throw 'Progress beyond the old 120-second cutoff must settle only after the temporary uninstaller exits.' }

$active = Invoke-UninstallObservationCase {
  param($time)
  $processes = if ($time -lt 30000) { @([pscustomobject]@{ ProcessId = 43; Identity = 'PRIVATE'; Activity = 0 }) } else { @() }
  New-UninstallTestSnapshot $true $processes
}
if ($active.Elapsed -ne 30000) { throw 'Restored owned state cannot pass while its temporary uninstaller is alive.' }

$states = Invoke-UninstallObservationCase {
  param($time)
  $snapshot = New-UninstallTestSnapshot $false
  $snapshot.LauncherExited = $time -ge 20000
  $snapshot.LauncherExitCode = $(if ($snapshot.LauncherExited) { 0 } else { $null })
  $snapshot.PathRestored = $time -ge 70000
  $snapshot.RegistrationRemoved = $time -ge 120000
  $snapshot.InstallationRemoved = $time -ge 170000
  $snapshot
}
if ($states.Elapsed -ne 170000) { throw 'Forward owned-state transitions must count as progress without a journal.' }

$orphanTracker = @{}
$orphanRead = {
  param($time)
  $nativeRows = @()
  if ($time -eq 0) {
    $nativeRows += [pscustomobject]@{ ProcessId = 20; ParentProcessId = 0; Name = 'Un_A.exe'; ExecutablePath = 'C:\private\~nsu.tmp\Un_A.exe'; CreationDate = [datetime]'2026-11-06T00:00:00Z' }
  }
  if ($time -lt 30000) {
    $nativeRows += [pscustomobject]@{ ProcessId = 21; ParentProcessId = 20; Name = 'powershell.exe'; ExecutablePath = 'C:\Windows\powershell.exe'; CreationDate = [datetime]'2026-11-06T00:00:01Z' }
  }
  $selected = @(Select-DesktopUninstallProcesses -Rows $nativeRows -LauncherId 1 -LauncherExited $true -InstallerTemporary 'C:\private' -TrackedProcesses $orphanTracker)
  $processes = @($selected | ForEach-Object { [pscustomobject]@{ ProcessId = $_.ProcessId; Identity = "PRIVATE$($_.ProcessId)"; Activity = $time } })
  New-UninstallTestSnapshot $true $processes
}.GetNewClosure()
$orphan = Invoke-UninstallObservationCase $orphanRead
if ($orphan.Elapsed -ne 30000) { throw "An observed helper must remain owned after its Un_A parent exits; passed prematurely at $($orphan.Elapsed)." }

$missing = Invoke-UninstallObservationCase { New-UninstallTestSnapshot $false } -ErrorKind 'no progress'
if ($missing.Elapsed -ne 60000) { throw 'Missing journals/processes cannot substitute for all three restored-state checks.' }

$stalled = Invoke-UninstallObservationCase {
  New-UninstallTestSnapshot $false @([pscustomobject]@{ ProcessId = 44; Identity = 'PRIVATE'; Activity = 0 })
} -ErrorKind 'no progress'
if ($stalled.Elapsed -ne 60000) { throw 'A live but idle temporary uninstaller must fail the no-progress budget.' }

$many = Invoke-UninstallObservationCase {
  New-UninstallTestSnapshot $false @(1..40 | ForEach-Object { [pscustomobject]@{ ProcessId = $_; Identity = "PRIVATE$_"; Activity = 0 } })
} -ErrorKind 'no progress'
if ($many.Samples[0].ownedProcessIds.Count -ne 32) { throw 'Diagnostic PID samples must remain bounded while observing the complete process set.' }

$busy = Invoke-UninstallObservationCase {
  param($time)
  New-UninstallTestSnapshot $false @([pscustomobject]@{ ProcessId = 45; Identity = 'PRIVATE'; Activity = $time })
} -ErrorKind 'total budget'
if ($busy.Elapsed -ne 300000) { throw 'Continuous activity cannot extend the five-minute total budget.' }

$launcher = Invoke-UninstallObservationCase {
  param($time)
  $snapshot = New-UninstallTestSnapshot $true @([pscustomobject]@{ ProcessId = 46; Identity = 'PRIVATE'; Activity = $time })
  $snapshot.LauncherExited = $false
  $snapshot.LauncherExitCode = $null
  $snapshot
} -ErrorKind 'total budget'
if ($launcher.Elapsed -ne 300000) { throw 'Launcher waiting and removal observation must share the same total budget.' }

Invoke-UninstallObservationCase {
  $snapshot = New-UninstallTestSnapshot $true
  $snapshot.LauncherExitCode = 3
  $snapshot
} -ErrorKind 'launcher exited with 3' | Out-Null

foreach ($field in @('PathRestored', 'RegistrationRemoved', 'InstallationRemoved')) {
  $oneMissing = {
    $snapshot = New-UninstallTestSnapshot $true
    $snapshot.$field = $false
    $snapshot
  }.GetNewClosure()
  Invoke-UninstallObservationCase $oneMissing -ErrorKind 'no progress' | Out-Null
}
Invoke-UninstallObservationCase { throw 'PRIVATE raw state failure' } -ErrorKind 'metadata unavailable' | Out-Null

$rows = @(
  [pscustomobject]@{ ProcessId = 1; ParentProcessId = 0; Name = 'launcher.exe'; ExecutablePath = 'C:\install\uninstall.exe' },
  [pscustomobject]@{ ProcessId = 2; ParentProcessId = 1; Name = 'Un_A.exe'; ExecutablePath = 'C:\private\~nsu.tmp\Un_A.exe' },
  [pscustomobject]@{ ProcessId = 3; ParentProcessId = 2; Name = 'powershell.exe'; ExecutablePath = 'C:\Windows\powershell.exe' },
  [pscustomobject]@{ ProcessId = 4; ParentProcessId = 0; Name = 'Un_A.exe'; ExecutablePath = 'C:\private-other\Un_A.exe' },
  [pscustomobject]@{ ProcessId = 5; ParentProcessId = 0; Name = 'node.exe'; ExecutablePath = 'C:\unrelated\node.exe' }
)
foreach ($row in $rows) { $row | Add-Member -NotePropertyName CreationDate -NotePropertyValue ([datetime]'2026-11-06T00:00:00Z').AddSeconds($row.ProcessId) }
$owned = @(Select-DesktopUninstallProcesses -Rows $rows -LauncherId 1 -LauncherExited $true -InstallerTemporary 'C:\private')
if (($owned.ProcessId -join ',') -ne '2,3') { throw 'Only the exact private temporary uninstaller and its helpers belong to final removal.' }
$running = @(Select-DesktopUninstallProcesses -Rows $rows -LauncherId 1 -LauncherExited $false -InstallerTemporary 'C:\private')
if (($running.ProcessId -join ',') -ne '1,2,3') { throw 'The initial launcher must be included while still running.' }
$tracked = @{}
$null = Select-DesktopUninstallProcesses -Rows $rows -LauncherId 1 -LauncherExited $true -InstallerTemporary 'C:\private' -TrackedProcesses $tracked
$grandchild = [pscustomobject]@{ ProcessId = 7; ParentProcessId = 3; Name = 'worker.exe'; ExecutablePath = 'C:\Windows\worker.exe'; CreationDate = [datetime]'2026-11-06T00:00:07Z' }
$afterParentExit = @(Select-DesktopUninstallProcesses -Rows @($rows[2], $grandchild) -LauncherId 1 -LauncherExited $true -InstallerTemporary 'C:\private' -TrackedProcesses $tracked)
if (($afterParentExit.ProcessId -join ',') -ne '3,7') { throw 'Observed orphan helpers must retain their newly created descendants.' }
$reusedPid = [pscustomobject]@{ ProcessId = 3; ParentProcessId = 0; Name = 'powershell.exe'; ExecutablePath = 'C:\Windows\powershell.exe'; CreationDate = [datetime]'2026-11-07T00:00:00Z' }
$reused = @(Select-DesktopUninstallProcesses -Rows @($reusedPid) -LauncherId 1 -LauncherExited $true -InstallerTemporary 'C:\private' -TrackedProcesses $tracked)
if ($reused.Count -ne 0 -or $tracked.Count -ne 0) { throw 'A reused PID with another creation time must lose ownership.' }
$staleChild = [pscustomobject]@{ ProcessId = 8; ParentProcessId = 3; Name = 'unrelated.exe'; ExecutablePath = 'C:\unrelated\unrelated.exe'; CreationDate = [datetime]'2026-11-05T00:00:00Z' }
$withoutStale = @(Select-DesktopUninstallProcesses -Rows @($rows + $staleChild) -LauncherId 1 -LauncherExited $true -InstallerTemporary 'C:\private')
if (($withoutStale.ProcessId -join ',') -ne '2,3') { throw 'A child created before its supposed parent cannot establish ownership through a recycled parent PID.' }
$trackedUnknown = @{ 3 = ([datetime]$rows[2].CreationDate).ToUniversalTime().Ticks }
$unknownCreation = [pscustomobject]@{ ProcessId = 3; ParentProcessId = 0; Name = 'powershell.exe'; ExecutablePath = 'C:\Windows\powershell.exe'; CreationDate = $null }
$unknownCreationRejected = $false
try { Select-DesktopUninstallProcesses -Rows @($unknownCreation) -LauncherId 1 -LauncherExited $true -InstallerTemporary 'C:\private' -TrackedProcesses $trackedUnknown | Out-Null }
catch { $unknownCreationRejected = $_.Exception.Message -match 'identity metadata unavailable' }
if (-not $unknownCreationRejected) { throw 'An observed helper with unavailable creation time cannot silently disappear from ownership.' }
$unknown = [pscustomobject]@{ ProcessId = 6; ParentProcessId = 0; Name = 'Un_A.exe'; ExecutablePath = $null }
$unknownRejected = $false
try { Select-DesktopUninstallProcesses -Rows @($unknown) -LauncherId 1 -LauncherExited $true -InstallerTemporary 'C:\private' | Out-Null }
catch { $unknownRejected = $_.Exception.Message -match 'metadata unavailable' }
if (-not $unknownRejected) { throw 'Unavailable temporary-uninstaller ownership cannot be treated as an empty process list.' }
Write-Host 'Windows bounded final-uninstall observation behavior passed.'

param(
  [Parameter(Mandatory = $true)][string]$GuardScript,
  [Parameter(Mandatory = $true)][string]$TestDirectory
)
$ErrorActionPreference = 'Stop'
$testRoot = Join-Path $TestDirectory 'fixture'
[void][System.IO.Directory]::CreateDirectory($testRoot)
$testRoot = (Get-Item -LiteralPath $testRoot).FullName
$linkedRoot = $null
function Remove-GuardFixtureLink {
  param([string]$Link)
  if ([string]::IsNullOrEmpty($Link)) { return }
  $entry = Get-Item -LiteralPath $Link -Force -ErrorAction SilentlyContinue
  if ($null -eq $entry) { return }
  if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) { throw 'Fixture link cleanup refused an ordinary directory.' }
  if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) {
    # PowerShell 5.1 Remove-Item and recursive .NET Framework deletion mishandle junctions.
    # RemoveDirectoryW unlinks only this directory entry and never traverses its target.
    if (-not ('DshGuardFixtureNative' -as [type])) {
      Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class DshGuardFixtureNative {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool RemoveDirectoryW(string path);
}
'@
    }
    if (-not [DshGuardFixtureNative]::RemoveDirectoryW($Link)) {
      throw [ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error())
    }
  } else { [IO.Directory]::Delete($Link, $false) }
}
try {
  . $GuardScript -Action inspect -InstallDirectory $testRoot -AppExecutable 'Harness.exe' -ExcludeProcessId 99999
  $oldRoot = Join-Path $testRoot 'Old'
  $newRoot = Join-Path $testRoot 'New'
  $processes = @(
    [pscustomobject]@{ ProcessId = 1; ParentProcessId = 0; Name = 'Harness.exe'; ExecutablePath = (Join-Path $oldRoot 'Harness.exe') },
    [pscustomobject]@{ ProcessId = 2; ParentProcessId = 1; Name = 'node.exe'; ExecutablePath = $null },
    [pscustomobject]@{ ProcessId = 3; ParentProcessId = 0; Name = 'Harness.exe'; ExecutablePath = $null },
    [pscustomobject]@{ ProcessId = 4; ParentProcessId = 0; Name = 'node.exe'; ExecutablePath = $null },
    [pscustomobject]@{ ProcessId = 5; ParentProcessId = 0; Name = 'System'; ExecutablePath = $null },
    [pscustomobject]@{ ProcessId = 6; ParentProcessId = 0; Name = 'node.exe'; ExecutablePath = (Join-Path $newRoot 'resources-backup/node.exe') },
    [pscustomobject]@{ ProcessId = 7; ParentProcessId = 0; Name = 'node.exe'; ExecutablePath = (Join-Path $newRoot 'resources/node.exe') },
    [pscustomobject]@{ ProcessId = 99999; ParentProcessId = 0; Name = 'Harness.exe'; ExecutablePath = $null }
  )
  $result = Get-GuardProcessClassification $processes @($oldRoot, $newRoot) 'Harness.exe' 99999
  if (($result.Owned.ProcessId -join ',') -ne '1,7') { throw 'Both installation roots must match without matching resources-backup.' }
  if (($result.Uncertain.ProcessId -join ',') -ne '2,3') { throw 'Only unreadable app identities and owned descendants may block inspection.' }
  Write-Output 'PASS process classification'

  $baseTime = [datetime]::UtcNow.AddMinutes(-10)
  foreach ($process in $processes) { $process | Add-Member -NotePropertyName CreationDate -NotePropertyValue ($baseTime.AddSeconds($process.ProcessId)) }
  $staleChild = [pscustomobject]@{ ProcessId = 20; ParentProcessId = 1; Name = 'system-worker.exe'; ExecutablePath = $null; CreationDate = $baseTime }
  $intermediate = [pscustomobject]@{ ProcessId = 21; ParentProcessId = 1; Name = 'worker.exe'; ExecutablePath = 'unrelated'; CreationDate = $baseTime.AddSeconds(5) }
  $staleGrandchild = [pscustomobject]@{ ProcessId = 22; ParentProcessId = 21; Name = 'system-worker.exe'; ExecutablePath = $null; CreationDate = $baseTime.AddSeconds(2) }
  $sameTimeChild = [pscustomobject]@{ ProcessId = 23; ParentProcessId = 1; Name = 'worker.exe'; ExecutablePath = $null; CreationDate = $processes[0].CreationDate }
  $undatedChild = [pscustomobject]@{ ProcessId = 24; ParentProcessId = 1; Name = 'worker.exe'; ExecutablePath = $null; CreationDate = $null }
  $invalidDateParent = [pscustomobject]@{ ProcessId = 25; ParentProcessId = 1; Name = 'worker.exe'; ExecutablePath = 'unrelated'; CreationDate = 'invalid-date' }
  $unknownAncestry = [pscustomobject]@{ ProcessId = 26; ParentProcessId = 25; Name = 'worker.exe'; ExecutablePath = $null; CreationDate = $baseTime.AddSeconds(30) }
  $undatedApp = [pscustomobject]@{ ProcessId = 27; ParentProcessId = 0; Name = 'Harness.exe'; ExecutablePath = $null; CreationDate = $null }
  $result = Get-GuardProcessClassification @($processes[0], $staleChild, $intermediate, $staleGrandchild, $sameTimeChild, $undatedChild, $processes[2], $invalidDateParent, $unknownAncestry, $undatedApp) @($oldRoot) 'Harness.exe' 99999
  if (($result.Uncertain.ProcessId -join ',') -ne '3,23,24,26,27') { throw 'Every ancestry edge must reject newer reused parents, retain equal-time ancestry, and fail closed for missing dates or exact app names.' }
  # Negative control executes only the pure classifier, never a process action.
  $mutantBody = (Get-Command Get-GuardProcessClassification).ScriptBlock.ToString().Replace('if ($null -ne $childTime -and $null -ne $parentTime -and $parentTime -gt $childTime) { break }', '')
  $mutant = & ([scriptblock]::Create($mutantBody)) @($processes[0], $staleChild, $intermediate, $staleGrandchild) @($oldRoot) 'Harness.exe' 99999
  if (($mutant.Uncertain.ProcessId -join ',') -ne '20,22') { throw 'Negative control did not reproduce stale parent PID association.' }
  Write-Output 'PASS creation identity ancestry'

  Initialize-GuardNative
  $missingIdentityRejected = $false
  try { [void](Open-GuardProcessLease $undatedChild) } catch { $missingIdentityRejected = $true }
  if (-not $missingIdentityRejected) { throw 'Stopping an undated process must be refused.' }
  if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) {
    $self = [Diagnostics.Process]::GetCurrentProcess()
    try {
      $selfSnapshot = Get-CimInstance -ClassName Win32_Process -Filter ("ProcessId={0}" -f $self.Id)
      $lease = [DshInstallerProcessLease]::Open([uint32]$self.Id, $selfSnapshot.CreationDate, $selfSnapshot.ExecutablePath)
      if ($null -eq $lease) { throw 'Real CIM creation identity must match GetProcessTimes at microsecond precision.' }
      $lease.Dispose()
      $reusedLease = [DshInstallerProcessLease]::Open([uint32]$self.Id, $selfSnapshot.CreationDate.AddSeconds(-1), $selfSnapshot.ExecutablePath)
      if ($null -ne $reusedLease) { $reusedLease.Dispose(); throw 'A recycled PID with a different creation time was accepted.' }
      $wrongPathLease = [DshInstallerProcessLease]::Open([uint32]$self.Id, $selfSnapshot.CreationDate, ($selfSnapshot.ExecutablePath + '.other'))
      if ($null -ne $wrongPathLease) { $wrongPathLease.Dispose(); throw 'A process path mismatch was accepted.' }
    } finally { $self.Dispose() }
    $ownedChild = Start-Process -FilePath $selfSnapshot.ExecutablePath -ArgumentList @('-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 60') -PassThru
    $childLease = $null
    try {
      $childSnapshot = Get-CimInstance -ClassName Win32_Process -Filter ("ProcessId={0}" -f $ownedChild.Id)
      $childLease = [DshInstallerProcessLease]::Open([uint32]$ownedChild.Id, $childSnapshot.CreationDate, $childSnapshot.ExecutablePath)
      if ($null -eq $childLease) { throw 'Owned native child lease was not acquired.' }
      $childLease.Terminate()
      if (-not $ownedChild.WaitForExit(10000)) { throw 'Native handle termination did not settle.' }
    } finally {
      if ($null -ne $childLease) { $childLease.Dispose() }
      if (-not $ownedChild.HasExited) { $ownedChild.Kill(); $ownedChild.WaitForExit() }
      $ownedChild.Dispose()
    }
    Write-Output 'PASS native stable process handle'
  }

  $global:dshLeaseOperations = @()
  $global:dshLeaseDisposed = 0
  $global:dshLeaseStale = $false
  $global:dshLeaseFails = $false
  function Open-GuardProcessLease {
    param($Process)
    if ($global:dshLeaseStale) { return $null }
    $value = [pscustomobject]@{}
    $value | Add-Member -MemberType ScriptMethod -Name RequestClose -Value { $global:dshLeaseOperations += 'close'; if ($global:dshLeaseFails) { throw 'close failure fixture' } }
    $value | Add-Member -MemberType ScriptMethod -Name Terminate -Value { $global:dshLeaseOperations += 'terminate'; if ($global:dshLeaseFails) { throw 'terminate failure fixture' } }
    $value | Add-Member -MemberType ScriptMethod -Name Dispose -Value { $global:dshLeaseDisposed++ }
    return $value
  }
  $diagnosticPath = Join-Path $testRoot 'lease.log'
  foreach ($operation in @('close', 'terminate')) {
    $global:dshLeaseStale = $true
    if (Invoke-GuardProcessAction $processes[0] $operation) { throw 'A stale PID must not report an action.' }
    if ($global:dshLeaseOperations.Count -ne 0) { throw 'A stale PID was closed or terminated.' }
  }
  $global:dshLeaseStale = $false
  foreach ($operation in @('close', 'terminate')) {
    if (-not (Invoke-GuardProcessAction $processes[0] $operation)) { throw 'Matching process lease did not receive its action.' }
  }
  if (($global:dshLeaseOperations -join ',') -ne 'close,terminate' -or $global:dshLeaseDisposed -ne 2) { throw 'Each action must use and dispose its held identity lease.' }
  $global:dshLeaseFails = $true
  $refused = $false
  try { [void](Invoke-GuardProcessAction $processes[0] 'terminate') } catch { $refused = $true }
  if (-not $refused -or $global:dshLeaseDisposed -ne 3) { throw 'Native action failure must propagate and dispose its process handle.' }
  Write-Output 'PASS stable process action disposal'

  $validRoot = Get-NormalizedDirectory $newRoot
  if ($validRoot -ne $newRoot) { throw 'A new installation directory must remain valid.' }
  foreach ($invalid in @([System.IO.Path]::GetPathRoot($testRoot), 'relative-directory')) {
    $refused = $false
    try { [void](Get-NormalizedDirectory $invalid) } catch { $refused = $true }
    if (-not $refused) { throw "Unsafe installation root was accepted: $invalid" }
  }
  $linkedRoot = Join-Path $testRoot 'linked-root'
  $linkTarget = Join-Path $TestDirectory 'junction-target'
  [void][IO.Directory]::CreateDirectory($linkTarget)
  $linkSentinel = Join-Path $linkTarget 'must-survive-link-cleanup.txt'
  [IO.File]::WriteAllText($linkSentinel, 'synthetic sentinel')
  # Junctions are supported without developer-mode privileges on Windows.
  if ([System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT) {
    [void](New-Item -ItemType Junction -Path $linkedRoot -Target $linkTarget)
  }
  else { [void](New-Item -ItemType SymbolicLink -Path $linkedRoot -Target $linkTarget) }
  $refused = $false
  try { [void](Get-NormalizedDirectory (Join-Path $linkedRoot 'Harness')) } catch { $refused = $true }
  Remove-GuardFixtureLink $linkedRoot
  if (-not [IO.File]::Exists($linkSentinel) -or [IO.File]::ReadAllText($linkSentinel) -ne 'synthetic sentinel') { throw 'Junction cleanup traversed the target.' }
  if (-not $refused) { throw 'A linked installation root was accepted.' }
  Write-Output 'PASS path validation'

  $global:dshGuardQueryFails = $false
  $global:dshGuardFixtureProcesses = $processes
  $global:dshGuardStopCount = 0
  $global:dshGuardSnapshots = @()
  $global:dshGuardQueryCount = 0
  function Get-CimInstance {
    param([string]$ClassName, [string]$ErrorAction)
    $global:dshGuardQueryCount++
    if ($global:dshGuardQueryFails) { throw 'CIM access denied fixture' }
    if ($global:dshGuardSnapshots.Count -gt 0) {
      $index = [Math]::Min($global:dshGuardQueryCount - 1, $global:dshGuardSnapshots.Count - 1)
      $snapshot = $global:dshGuardSnapshots[$index]
      if ($snapshot.Fails) { throw 'CIM refresh access denied fixture' }
      return $snapshot.Processes
    }
    return $global:dshGuardFixtureProcesses
  }
  function Stop-Process {
    param([int]$Id, [switch]$Force, [string]$ErrorAction)
    $global:dshGuardStopCount += 1
    throw 'No process should be stopped in these failure cases.'
  }
  $diagnostics = Join-Path $testRoot 'logs'
  $ownedProcess = $processes[0]
  $transientGit = [pscustomobject]@{ ProcessId = 8208; ParentProcessId = 1; Name = 'git.exe'; ExecutablePath = $null; CreationDate = $baseTime.AddSeconds(20) }
  $global:dshGuardSnapshots = @(
    [pscustomobject]@{ Processes = @($ownedProcess, $transientGit); Fails = $false },
    [pscustomobject]@{ Processes = @($ownedProcess); Fails = $false }
  )
  & $GuardScript -Action inspect -InstallDirectory $oldRoot -AppExecutable 'Harness.exe' -ExcludeProcessId 99999 -DiagnosticDirectory $diagnostics
  if ($LASTEXITCODE -ne 10 -or $global:dshGuardQueryCount -ne 2) { throw 'An exited unreadable descendant must be resolved by one fresh complete snapshot.' }
  if ($global:dshGuardStopCount -ne 0) { throw 'Transient unreadable processes must not be stopped.' }
  Write-Output 'PASS transient process resampling'
  $global:dshGuardQueryCount = 0
  $reusedGit = [pscustomobject]@{ ProcessId = 8208; ParentProcessId = 0; Name = 'git.exe'; ExecutablePath = (Join-Path $testRoot 'unrelated/git.exe') }
  $global:dshGuardSnapshots = @(
    [pscustomobject]@{ Processes = @($ownedProcess, $transientGit); Fails = $false },
    [pscustomobject]@{ Processes = @($ownedProcess, $reusedGit); Fails = $false }
  )
  & $GuardScript -Action inspect -InstallDirectory $oldRoot -AppExecutable 'Harness.exe' -ExcludeProcessId 99999 -DiagnosticDirectory $diagnostics
  if ($LASTEXITCODE -ne 10 -or $global:dshGuardQueryCount -ne 2 -or $global:dshGuardStopCount -ne 0) { throw 'A reused unrelated PID must not retain ownership from an earlier snapshot.' }
  $global:dshGuardQueryCount = 0
  $global:dshGuardSnapshots = @(
    [pscustomobject]@{ Processes = @($ownedProcess, $transientGit); Fails = $false },
    [pscustomobject]@{ Processes = @(); Fails = $true }
  )
  & $GuardScript -Action stop -InstallDirectory $oldRoot -AppExecutable 'Harness.exe' -ExcludeProcessId 99999 -DiagnosticDirectory $diagnostics
  if ($LASTEXITCODE -ne 20 -or $global:dshGuardQueryCount -ne 2 -or $global:dshGuardStopCount -ne 0) { throw 'A failed refresh must stop inspection without stopping any process.' }
  Write-Output 'PASS refreshed ownership and query failure'
  $global:dshGuardSnapshots = @()
  foreach ($operation in @('inspect', 'stop')) {
    $global:dshGuardQueryCount = 0
    & $GuardScript -Action $operation -InstallDirectory $newRoot -AdditionalInstallDirectory $oldRoot -AppExecutable 'Harness.exe' -ExcludeProcessId 99999 -DiagnosticDirectory $diagnostics
    if ($LASTEXITCODE -ne 20) { throw "$operation must refuse uncertain processes with exit code 20." }
    if ($global:dshGuardQueryCount -ne 4) { throw "$operation must stop after three additional uncertain snapshots." }
  }
  if ($global:dshGuardStopCount -ne 0) { throw 'An uncertain process was stopped.' }
  $log = Get-Content -LiteralPath (Join-Path $diagnostics 'DeepSeek-Harness-process-guard.log') -Raw
  if (-not $log.Contains('action=inspect') -or -not $log.Contains('action=stop')) { throw 'Stop overwrote inspect diagnostics.' }
  if (-not $log.Contains('uncertain PID=2 name=node.exe parentPID=1')) { throw 'Uncertain process details were omitted.' }
  if (-not $log.Contains('unreadable PID=4 name=node.exe parentPID=0')) { throw 'Unreadable unrelated process was not recorded.' }
  $global:dshGuardQueryFails = $true
  & $GuardScript -Action inspect -InstallDirectory $newRoot -AppExecutable 'Harness.exe' -ExcludeProcessId 99999 -DiagnosticDirectory $diagnostics
  if ($LASTEXITCODE -ne 20) { throw 'CIM failures must not be reported as zero matching processes.' }
  $global:dshGuardQueryFails = $false
  $global:dshGuardFixtureProcesses = @($processes | Where-Object { $_.ProcessId -in @(4, 5, 6, 99999) })
  & $GuardScript -Action inspect -InstallDirectory $newRoot -AppExecutable 'Harness.exe' -ExcludeProcessId 99999 -DiagnosticDirectory $diagnostics
  if ($LASTEXITCODE -ne 0) { throw 'Unrelated unreadable Node or OS processes must not block installation.' }
  $global:dshGuardFixtureProcesses = @($processes | Where-Object { $_.ProcessId -in @(1, 7) })
  $global:dshGuardQueryCount = 0
  & $GuardScript -Action inspect -InstallDirectory $newRoot -AdditionalInstallDirectory $oldRoot -AppExecutable 'Harness.exe' -ExcludeProcessId 99999 -DiagnosticDirectory $diagnostics
  if ($LASTEXITCODE -ne 10) { throw 'Both old and new installation processes must be detected.' }
  if ($global:dshGuardQueryCount -ne 1) { throw 'A fully readable process snapshot must not trigger additional sampling.' }
  Write-Output 'PASS entrypoint failure and logging'
}
finally {
  Remove-GuardFixtureLink $linkedRoot
  [System.IO.Directory]::Delete($testRoot, $true)
}

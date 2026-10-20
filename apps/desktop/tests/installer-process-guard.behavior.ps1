param(
  [Parameter(Mandatory = $true)][string]$GuardScript,
  [Parameter(Mandatory = $true)][string]$TestDirectory
)
$ErrorActionPreference = 'Stop'
$testRoot = Join-Path $TestDirectory 'fixture'
[void][System.IO.Directory]::CreateDirectory($testRoot)
$testRoot = (Get-Item -LiteralPath $testRoot).FullName
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

  $validRoot = Get-NormalizedDirectory $newRoot
  if ($validRoot -ne $newRoot) { throw 'A new installation directory must remain valid.' }
  foreach ($invalid in @([System.IO.Path]::GetPathRoot($testRoot), 'relative-directory')) {
    $refused = $false
    try { [void](Get-NormalizedDirectory $invalid) } catch { $refused = $true }
    if (-not $refused) { throw "Unsafe installation root was accepted: $invalid" }
  }
  $linkedRoot = Join-Path $testRoot 'linked-root'
  # Junctions are supported without developer-mode privileges on Windows.
  if ([System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT) {
    [void](New-Item -ItemType Junction -Path $linkedRoot -Target $testRoot)
  }
  else { [void](New-Item -ItemType SymbolicLink -Path $linkedRoot -Target $testRoot) }
  $refused = $false
  try { [void](Get-NormalizedDirectory (Join-Path $linkedRoot 'Harness')) } catch { $refused = $true }
  Remove-Item -LiteralPath $linkedRoot -Force
  if (-not $refused) { throw 'A linked installation root was accepted.' }
  Write-Output 'PASS path validation'

  $global:dshGuardQueryFails = $false
  $global:dshGuardFixtureProcesses = $processes
  $global:dshGuardStopCount = 0
  function Get-CimInstance {
    param([string]$ClassName, [string]$ErrorAction)
    if ($global:dshGuardQueryFails) { throw 'CIM access denied fixture' }
    return $global:dshGuardFixtureProcesses
  }
  function Stop-Process {
    param([int]$Id, [switch]$Force, [string]$ErrorAction)
    $global:dshGuardStopCount += 1
    throw 'No process should be stopped in these failure cases.'
  }
  $diagnostics = Join-Path $testRoot 'logs'
  foreach ($operation in @('inspect', 'stop')) {
    & $GuardScript -Action $operation -InstallDirectory $newRoot -AdditionalInstallDirectory $oldRoot -AppExecutable 'Harness.exe' -ExcludeProcessId 99999 -DiagnosticDirectory $diagnostics
    if ($LASTEXITCODE -ne 20) { throw "$operation must refuse uncertain processes with exit code 20." }
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
  & $GuardScript -Action inspect -InstallDirectory $newRoot -AdditionalInstallDirectory $oldRoot -AppExecutable 'Harness.exe' -ExcludeProcessId 99999 -DiagnosticDirectory $diagnostics
  if ($LASTEXITCODE -ne 10) { throw 'Both old and new installation processes must be detected.' }
  Write-Output 'PASS entrypoint failure and logging'
}
finally {
  [System.IO.Directory]::Delete($testRoot, $true)
}

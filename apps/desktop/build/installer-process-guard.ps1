[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('inspect', 'stop')][string]$Action,
  [Parameter(Mandatory = $true)][string]$InstallDirectory,
  [Parameter(Mandatory = $true)][string]$AppExecutable,
  [Parameter(Mandatory = $true)][int]$ExcludeProcessId,
  # When present, inspect this old installation together with the target.
  [string]$AdditionalInstallDirectory,
  # When omitted, retain the legacy TEMP log location used by older installers.
  [string]$DiagnosticDirectory
)

$ErrorActionPreference = 'Stop'
$ExitNoProcesses = 0
$ExitProcessesFound = 10
$ExitInspectionFailed = 20
$ExitProcessesRemain = 30

function Write-GuardTrace([string]$Message) {
  Add-Content -LiteralPath $diagnosticPath -Value ("{0:o} {1}" -f (Get-Date), $Message) -Encoding utf8
}

function Get-NormalizedDirectory([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path) -or -not [System.IO.Path]::IsPathRooted($Path)) {
    throw 'The installation directory must be an absolute local directory.'
  }
  if ($Path.StartsWith('\\') -or $Path -match '^[a-zA-Z]:[^\\/]') {
    throw 'Network, device, and drive-relative installation directories are not supported.'
  }
  $normalized = [System.IO.Path]::GetFullPath($Path).TrimEnd([char[]]@('\', '/'))
  $root = [System.IO.Path]::GetPathRoot($normalized).TrimEnd([char[]]@('\', '/'))
  if ([string]::Equals($normalized, $root, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'A filesystem root cannot be used as an installation directory.'
  }
  $ancestor = $normalized
  while (-not [string]::IsNullOrEmpty($ancestor)) {
    if (Test-Path -LiteralPath $ancestor) {
      $item = Get-Item -LiteralPath $ancestor -Force -ErrorAction Stop
      if (-not $item.PSIsContainer -or ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
        throw 'Installation directories cannot traverse files, junctions, or symbolic links.'
      }
    }
    $ancestor = [System.IO.Path]::GetDirectoryName($ancestor)
  }
  return $normalized
}

# Classifies a CIM snapshot without querying or stopping processes. Unreadable
# app identities or descendants of a confirmed owned process require inspection.
function Get-GuardProcessClassification([object[]]$Processes, [string[]]$InstallRoots, [string]$Executable, [int]$ExcludedId) {
  $comparison = [System.StringComparison]::OrdinalIgnoreCase
  $owned = @()
  $unreadable = @()
  $byId = @{}
  $ownedIds = @{}
  foreach ($process in $Processes) {
    $byId[[int]$process.ProcessId] = $process
    if ($process.ProcessId -eq $ExcludedId) { continue }
    $processPath = $process.ExecutablePath
    if ([string]::IsNullOrWhiteSpace($processPath)) {
      $unreadable += $process
      continue
    }
    foreach ($installRoot in $InstallRoots) {
      $appPath = [System.IO.Path]::Combine($installRoot, $Executable)
      $resourcesPrefix = [System.IO.Path]::Combine($installRoot, 'resources') + [System.IO.Path]::DirectorySeparatorChar
      if ([string]::Equals($processPath, $appPath, $comparison) -or $processPath.StartsWith($resourcesPrefix, $comparison)) {
        $owned += $process
        $ownedIds[[int]$process.ProcessId] = $true
        break
      }
    }
  }
  $uncertain = @()
  foreach ($process in $unreadable) {
    $associated = [string]::Equals($process.Name, $Executable, $comparison)
    $parentId = [int]$process.ParentProcessId
    $visited = @{}
    while (-not $associated -and $parentId -ne 0 -and -not $visited.ContainsKey($parentId)) {
      $visited[$parentId] = $true
      if ($ownedIds.ContainsKey($parentId)) { $associated = $true; break }
      if (-not $byId.ContainsKey($parentId)) { break }
      $parentId = [int]$byId[$parentId].ParentProcessId
    }
    if ($associated) { $uncertain += $process }
  }
  return [pscustomobject]@{ Owned = @($owned | Sort-Object ProcessId); Uncertain = @($uncertain | Sort-Object ProcessId); Unreadable = @($unreadable | Sort-Object ProcessId) }
}

function Write-ProcessReport([object[]]$Processes, [string]$Heading) {
  Write-Output $Heading
  foreach ($process in $Processes | Select-Object -First 12) {
    Write-Output ("PID {0}  {1}  parentPID={2}  {3}" -f $process.ProcessId, $process.Name, $process.ParentProcessId, $process.ExecutablePath)
  }
  if ($Processes.Count -gt 12) { Write-Output ("... and {0} more process(es)" -f ($Processes.Count - 12)) }
}

function Get-DesktopOwnedProcesses {
  # Short-lived descendants can exit while CIM builds its snapshot. Only a
  # complete fresh snapshot may resolve missing paths or changed PID ownership.
  for ($refresh = 0; $refresh -le 3; $refresh++) {
    $snapshot = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop)
    $classification = Get-GuardProcessClassification $snapshot $installRoots $AppExecutable $ExcludeProcessId
    foreach ($process in $classification.Owned) {
      Write-GuardTrace ("owned PID={0} name={1} parentPID={2} path={3}" -f $process.ProcessId, $process.Name, $process.ParentProcessId, $process.ExecutablePath)
    }
    foreach ($process in $classification.Unreadable) {
      Write-GuardTrace ("unreadable PID={0} name={1} parentPID={2}" -f $process.ProcessId, $process.Name, $process.ParentProcessId)
    }
    foreach ($process in $classification.Uncertain) {
      Write-GuardTrace ("uncertain PID={0} name={1} parentPID={2} executable path unavailable" -f $process.ProcessId, $process.Name, $process.ParentProcessId)
    }
    if ($classification.Uncertain.Count -eq 0) { return $classification.Owned }
    if ($refresh -lt 3) {
      Write-GuardTrace ("Refreshing uncertain process snapshot ({0}/3)." -f ($refresh + 1))
      Start-Sleep -Milliseconds 200
      continue
    }
    $report = Write-ProcessReport $classification.Uncertain 'Unable to inspect possible application processes; close them or retry with matching privileges:'
    foreach ($line in $report) { Write-Host $line }
    throw 'Possible application processes have unreadable executable paths; no uncertain process was stopped.'
  }
}

if ($MyInvocation.InvocationName -eq '.') { return }

try {
  $logRoot = [System.IO.Path]::GetTempPath()
  if (-not [string]::IsNullOrWhiteSpace($DiagnosticDirectory)) {
    $logRoot = Get-NormalizedDirectory $DiagnosticDirectory
    [void][System.IO.Directory]::CreateDirectory($logRoot)
  }
  $diagnosticPath = Join-Path $logRoot 'DeepSeek-Harness-process-guard.log'
  Write-GuardTrace ("action={0} installerPid={1}" -f $Action, $ExcludeProcessId)
  if ([System.IO.Path]::GetFileName($AppExecutable) -ne $AppExecutable -or $AppExecutable -match '[\\/:]') {
    throw 'AppExecutable must be an executable filename, not a path.'
  }
  $installRoots = @((Get-NormalizedDirectory $InstallDirectory))
  if (-not [string]::IsNullOrWhiteSpace($AdditionalInstallDirectory)) {
    $installRoots += Get-NormalizedDirectory $AdditionalInstallDirectory
  }
  foreach ($installRoot in $installRoots) { Write-GuardTrace ("installRoot={0}" -f $installRoot) }
  Write-GuardTrace 'Inspecting installation-owned processes.'
  $processes = @(Get-DesktopOwnedProcesses)
  Write-GuardTrace ("Inspection found {0} process(es)." -f $processes.Count)
  if ($processes.Count -eq 0) {
    Write-Output 'No DeepSeek Harness installation-owned processes are running.'
    exit $ExitNoProcesses
  }
  if ($Action -eq 'inspect') {
    Write-ProcessReport $processes ("Detected {0} DeepSeek Harness process(es):" -f $processes.Count)
    exit $ExitProcessesFound
  }
  Write-ProcessReport $processes ("Closing {0} DeepSeek Harness process(es):" -f $processes.Count)
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DshInstallerWindow {
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
}
'@
  foreach ($process in $processes) {
    try {
      $liveProcess = Get-Process -Id $process.ProcessId -ErrorAction Stop
      if ($liveProcess.MainWindowHandle -ne [IntPtr]::Zero) {
        Write-GuardTrace ("Posting WM_CLOSE to PID {0}." -f $process.ProcessId)
        [void][DshInstallerWindow]::PostMessage($liveProcess.MainWindowHandle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
      }
    }
    catch { Write-Output ("Graceful close skipped for PID {0}: {1}" -f $process.ProcessId, $_.Exception.Message) }
  }
  Start-Sleep -Milliseconds 1500
  Write-GuardTrace 'Graceful-close wait completed.'
  $remaining = @()
  for ($attempt = 1; $attempt -le 3; $attempt += 1) {
    $remaining = @(Get-DesktopOwnedProcesses)
    Write-GuardTrace ("Force-stop attempt {0} found {1} process(es)." -f $attempt, $remaining.Count)
    if ($remaining.Count -eq 0) { break }
    foreach ($process in $remaining) {
      try {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
        Write-Output ("Stopped PID {0} ({1}) on attempt {2}." -f $process.ProcessId, $process.Name, $attempt)
      }
      catch { Write-Output ("Could not stop PID {0} ({1}) on attempt {2}: {3}" -f $process.ProcessId, $process.Name, $attempt, $_.Exception.Message) }
    }
    Start-Sleep -Milliseconds 1000
  }
  $remaining = @(Get-DesktopOwnedProcesses)
  Write-GuardTrace ("Final inspection found {0} process(es)." -f $remaining.Count)
  if ($remaining.Count -gt 0) {
    Write-ProcessReport $remaining ("Unable to close {0} installation-owned process(es):" -f $remaining.Count)
    exit $ExitProcessesRemain
  }
  Write-Output 'All DeepSeek Harness installation-owned processes were closed.'
  exit $ExitNoProcesses
}
catch {
  $failure = $_.Exception.Message
  if (-not [string]::IsNullOrEmpty($diagnosticPath)) {
    try { Write-GuardTrace ("Failed: {0}" -f $failure) }
    catch { Write-Output ("Diagnostic log write failed: {0}" -f $_.Exception.Message) }
  }
  Write-Output ("Process inspection failed: {0}" -f $failure)
  exit $ExitInspectionFailed
}

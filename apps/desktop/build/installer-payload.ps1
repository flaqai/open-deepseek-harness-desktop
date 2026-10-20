[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$SourceDirectory,
  [Parameter(Mandatory = $true)][string]$InstallDirectory,
  [Parameter(Mandatory = $true)][string]$AppExecutable,
  [Parameter(Mandatory = $true)][string]$ExpectedVersion,
  [Parameter(Mandatory = $true)][string]$DiagnosticDirectory
)

$ErrorActionPreference = 'Stop'

# Only a verified copy returns zero. Failures leave the installation incomplete;
# the caller owns stopping registration and displaying the diagnostic directory.
function Get-InstallerSafeDirectory([string]$Directory) {
  if ([string]::IsNullOrWhiteSpace($Directory) -or -not [System.IO.Path]::IsPathRooted($Directory)) {
    throw 'An absolute, nonempty directory is required.'
  }
  $fullPath = [System.IO.Path]::GetFullPath($Directory)
  $root = [System.IO.Path]::GetPathRoot($fullPath)
  $fullPath = $fullPath.TrimEnd([char[]]@('\', '/'))
  if ([string]::IsNullOrEmpty($fullPath) -or $fullPath -eq $root.TrimEnd([char[]]@('\', '/'))) {
    throw 'A filesystem root cannot be a payload directory.'
  }
  foreach ($protected in @($env:USERPROFILE, $env:WINDIR, $env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:ProgramData)) {
    if (-not [string]::IsNullOrEmpty($protected) -and [string]::Equals($fullPath, $protected.TrimEnd([char[]]@('\', '/')), [System.StringComparison]::OrdinalIgnoreCase)) {
      throw 'A shared operating-system or user root cannot be a payload directory.'
    }
  }
  $ancestor = $fullPath
  while (-not [string]::IsNullOrEmpty($ancestor)) {
    if (Test-Path -LiteralPath $ancestor) {
      $item = Get-Item -LiteralPath $ancestor -Force
      if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw ("Reparse-point paths are not allowed: {0}" -f $ancestor)
      }
      if (-not $item.PSIsContainer) { throw ("A directory path refers to a file: {0}" -f $ancestor) }
    }
    $parent = [System.IO.Path]::GetDirectoryName($ancestor)
    if ($parent -eq $ancestor) { break }
    $ancestor = $parent
  }
  return $fullPath
}

function Test-InstallerDirectoryOverlap([string]$First, [string]$Second) {
  $comparison = [System.StringComparison]::OrdinalIgnoreCase
  $separator = [System.IO.Path]::DirectorySeparatorChar
  return [string]::Equals($First, $Second, $comparison) -or
    $First.StartsWith($Second + $separator, $comparison) -or
    $Second.StartsWith($First + $separator, $comparison)
}

# Enumerate one level at a time so neither junctions nor file symlinks are followed.
function Get-InstallerPayloadInventory([string]$Directory) {
  $files = New-Object 'System.Collections.Generic.Dictionary[string,long]' ([System.StringComparer]::OrdinalIgnoreCase)
  $pending = New-Object 'System.Collections.Generic.Stack[string]'
  $pending.Push($Directory)
  while ($pending.Count -gt 0) {
    foreach ($item in Get-ChildItem -LiteralPath $pending.Pop() -Force -ErrorAction Stop) {
      if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw ("Payload contains a reparse point: {0}" -f $item.FullName)
      }
      if ($item.PSIsContainer) { $pending.Push($item.FullName) }
      else { $files.Add($item.FullName.Substring($Directory.Length + 1), $item.Length) }
    }
  }
  return ,$files
}

function Write-InstallerPayloadEvent([string]$LogPath, [string]$Stage, [string]$Outcome, [object]$Details) {
  $event = @{ timestamp = [DateTime]::UtcNow.ToString('o'); stage = $Stage; outcome = $Outcome; details = $Details }
  [System.IO.File]::AppendAllText($LogPath, (($event | ConvertTo-Json -Depth 5 -Compress) + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
}

function Get-InstallerAppVersion([string]$ExecutablePath) {
  return [System.Diagnostics.FileVersionInfo]::GetVersionInfo($ExecutablePath).ProductVersion
}

function Invoke-InstallerRobocopy([string]$Source, [string]$Destination, [string]$LogPath) {
  $robocopy = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::Windows)) 'System32/robocopy.exe'
  if (-not (Test-Path -LiteralPath $robocopy -PathType Leaf)) { throw 'Windows Robocopy is unavailable.' }
  # Do not inherit PowerShell 7 native-command error promotion: Robocopy 1..7 are successful statuses.
  $PSNativeCommandUseErrorActionPreference = $false
  & $robocopy $Source $Destination /E /COPY:DAT /DCOPY:DAT /XJ /R:2 /W:1 /NP /FP ("/UNILOG:{0}" -f $LogPath) | Out-Null
  return $LASTEXITCODE
}

function Invoke-InstallerPayloadCopy {
  param([string]$SourceDirectory, [string]$InstallDirectory, [string]$AppExecutable, [string]$ExpectedVersion, [string]$DiagnosticDirectory)
  $diagnosticPath = $null
  $stage = 'validation'
  $exitCode = 40
  try {
    $diagnostics = Get-InstallerSafeDirectory $DiagnosticDirectory
    [void][System.IO.Directory]::CreateDirectory($diagnostics)
    $diagnosticPath = Join-Path $diagnostics 'payload.jsonl'
    $stream = [System.IO.File]::Open($diagnosticPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read)
    $stream.Dispose()
  }
  catch {
    return [pscustomobject]@{ ExitCode = 43; DiagnosticPath = $diagnosticPath; Message = ("Cannot initialize payload diagnostics: {0}" -f $_.Exception.Message) }
  }
  try {
    Write-InstallerPayloadEvent $diagnosticPath $stage 'started' @{ source = $SourceDirectory; destination = $InstallDirectory; expectedVersion = $ExpectedVersion }
    $source = Get-InstallerSafeDirectory $SourceDirectory
    $destination = Get-InstallerSafeDirectory $InstallDirectory
    foreach ($pair in @(@($source, $destination), @($source, $diagnostics), @($destination, $diagnostics))) {
      if (Test-InstallerDirectoryOverlap $pair[0] $pair[1]) { throw 'Source, destination and diagnostic directories must not overlap.' }
    }
    if (-not (Test-Path -LiteralPath $source -PathType Container)) { throw 'The extracted payload directory does not exist.' }
    if ([string]::IsNullOrWhiteSpace($AppExecutable) -or [System.IO.Path]::GetFileName($AppExecutable) -ne $AppExecutable -or $AppExecutable.IndexOfAny([char[]]@('\', '/')) -ge 0) {
      throw 'The application executable must be a filename, not a path.'
    }
    if ([string]::IsNullOrWhiteSpace($ExpectedVersion)) { throw 'The expected version is required.' }
    $sourceFiles = Get-InstallerPayloadInventory $source
    $coreRelative = Join-Path (Join-Path 'resources' 'harness') 'package.json'
    if (-not $sourceFiles.ContainsKey($AppExecutable) -or -not $sourceFiles.ContainsKey($coreRelative)) {
      throw 'The extracted payload is missing its application executable or Harness manifest.'
    }
    if (Test-Path -LiteralPath $destination) { [void](Get-InstallerPayloadInventory $destination) }
    Write-InstallerPayloadEvent $diagnosticPath $stage 'validated' @{ source = $source; destination = $destination; expectedVersion = $ExpectedVersion; files = $sourceFiles.Count }

    $stage = 'copy'
    $exitCode = 41
    $copyExitCode = Invoke-InstallerRobocopy $source $destination (Join-Path $diagnostics 'robocopy.log')
    Write-InstallerPayloadEvent $diagnosticPath $stage 'exited' @{ exitCode = $copyExitCode; log = (Join-Path $diagnostics 'robocopy.log') }
    if ($null -eq $copyExitCode -or $copyExitCode -lt 0 -or $copyExitCode -ge 8) { throw ("Robocopy failed with exit code {0}." -f $copyExitCode) }

    $stage = 'verification'
    $exitCode = 42
    [void](Get-InstallerSafeDirectory $source)
    [void](Get-InstallerSafeDirectory $destination)
    $sourceAfter = Get-InstallerPayloadInventory $source
    $destinationFiles = Get-InstallerPayloadInventory $destination
    if ($sourceFiles.Count -ne $sourceAfter.Count) { throw 'The extracted file inventory changed during copying.' }
    foreach ($relative in $sourceFiles.Keys) {
      if (-not $sourceAfter.ContainsKey($relative) -or $sourceAfter[$relative] -ne $sourceFiles[$relative]) { throw ("Extracted payload changed: {0}" -f $relative) }
      if (-not $destinationFiles.ContainsKey($relative)) { throw ("Installed file is missing: {0}" -f (Join-Path $destination $relative)) }
      if ($destinationFiles[$relative] -ne $sourceFiles[$relative]) { throw ("Installed file size differs: {0}" -f (Join-Path $destination $relative)) }
    }
    if ($destinationFiles.Count -ne $sourceFiles.Count) { throw 'The installed directory contains files outside the extracted payload.' }
    $appVersion = Get-InstallerAppVersion (Join-Path $destination $AppExecutable)
    # Community patch releases can retain the same upstream Harness version.
    $sourceCore = Get-Content -LiteralPath (Join-Path $source $coreRelative) -Raw | ConvertFrom-Json
    $core = Get-Content -LiteralPath (Join-Path $destination $coreRelative) -Raw | ConvertFrom-Json
    if ($appVersion -cne $ExpectedVersion) { throw ("Installed executable version differs: expected {0}; got {1}." -f $ExpectedVersion, $appVersion) }
    if ([string]::IsNullOrWhiteSpace($sourceCore.version) -or $core.version -cne $sourceCore.version) { throw ("Installed Harness version differs from payload: expected {0}; got {1}." -f $sourceCore.version, $core.version) }
    Write-InstallerPayloadEvent $diagnosticPath 'complete' 'verified' @{ files = $destinationFiles.Count; appVersion = $appVersion; coreVersion = $core.version }
    return [pscustomobject]@{ ExitCode = 0; DiagnosticPath = $diagnosticPath; Message = 'Payload files and versions verified.' }
  }
  catch {
    $message = $_.Exception.Message
    try { Write-InstallerPayloadEvent $diagnosticPath $stage 'failed' @{ exitCode = $exitCode; message = $message; installation = 'incomplete'; restored = $false } }
    catch { $message += (" Diagnostic writing also failed: {0}" -f $_.Exception.Message) }
    return [pscustomobject]@{ ExitCode = $exitCode; DiagnosticPath = $diagnosticPath; Message = $message }
  }
}

if ($MyInvocation.InvocationName -ne '.') {
  $result = Invoke-InstallerPayloadCopy -SourceDirectory $SourceDirectory -InstallDirectory $InstallDirectory -AppExecutable $AppExecutable -ExpectedVersion $ExpectedVersion -DiagnosticDirectory $DiagnosticDirectory
  Write-Output $result.Message
  Write-Output ("Payload diagnostics: {0}" -f $result.DiagnosticPath)
  exit $result.ExitCode
}

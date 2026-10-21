param([Parameter(Mandatory = $true)] [string] $TestDirectory)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../build/installer-upgrade.ps1')
Initialize-DesktopRemovalNative

# Only the external legacy NSIS process and its retry clock are replaced. The
# upgrade orchestration, integrity checks, filesystem and journal remain real.
function Invoke-DesktopUninstallerProcess($Executable, $Arguments, $WorkingDirectory) {
  $script:calls++
  foreach ($file in @([DshRemovalNative]::Inventory($script:installation) | Where-Object { -not $_.Directory })) {
    $relative = $file.RelativePath
    $source = Join-Path $script:installation $relative
    $rollback = Join-Path (Join-Path $WorkingDirectory 'nsABCD.tmp/old-install') $relative
    if ($source.Length -ge 260 -or $rollback.Length -ge 260) {
      $script:boundaryFailures++
      return @{ launched = $true; exitCode = 2 }
    }
  }
  [IO.File]::Delete((Join-Path $script:installation 'Test Desktop.exe'))
  $resources = Join-Path $script:installation 'resources'
  if ([IO.Directory]::Exists($resources)) { [IO.Directory]::Delete($resources, $true) }
  return @{ launched = $true; exitCode = 0 }
}
function Wait-DesktopUpgradeRetry { $script:waits++ }
function New-ExactLengthPayload([string] $Directory, [int] $Length) {
  $parent = Join-Path $Directory 'resources'
  [DshRemovalNative]::CreatePrivateDirectory($parent)
  while (($Length - $parent.Length - 1) -gt 100) {
    $parent = Join-Path $parent ('d' * 40)
    [DshRemovalNative]::CreatePrivateDirectory($parent)
  }
  $leafLength = $Length - $parent.Length - 1
  if ($leafLength -lt 1) { throw 'Fixture root leaves no room for the exact-length payload.' }
  $file = Join-Path $parent ('f' * $leafLength)
  [DshRemovalNative]::WriteJournal($file, 'original long payload', $true)
  if ($file.Length -ne $Length -or ([DshRemovalNative]::Inspect($file)).Length -le 0) { throw 'Fixture did not reach its exact absolute path boundary.' }
  return $file
}

$root = Join-Path $TestDirectory ('lp-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root -ErrorAction Stop | Out-Null
$root = (Get-Item -LiteralPath $root).FullName
$failures = @()
try {
  foreach ($scenario in @('source-259', 'source-260', 'source-261', 'rollback-only-260')) {
    $caseRoot = Join-Path $root $scenario
    # Make the source parent longer than the short rollback parent, so the
    # source boundary cases do not accidentally test rollback amplification.
    $script:installation = Join-Path $caseRoot ('installation-' + ('p' * 48))
    $temporary = Join-Path $caseRoot 'tmp'
    if ($scenario -eq 'rollback-only-260') { $temporary = Join-Path $caseRoot ('temporary-' + ('t' * 70)) }
    $diagnostics = Join-Path $caseRoot 'diagnostics'
    foreach ($directory in @($script:installation, $temporary)) { [void][IO.Directory]::CreateDirectory($directory) }
    $uninstaller = Join-Path $script:installation 'Uninstall Test Desktop.exe'
    $application = Join-Path $script:installation 'Test Desktop.exe'
    [IO.File]::WriteAllText($uninstaller, 'synthetic immutable uninstaller')
    [IO.File]::WriteAllText($application, 'old application')
    $sentinel = Join-Path $caseRoot 'user-data.bin'
    [IO.File]::WriteAllText($sentinel, 'user data must survive')
    $targetLength = if ($scenario -like 'source-*') { [int]$scenario.Substring(7) } else {
      $rollbackRoot = Join-Path $temporary 'nsABCD.tmp/old-install'
      260 - $rollbackRoot.Length + $script:installation.Length
    }
    $payload = New-ExactLengthPayload -Directory $script:installation -Length $targetLength
    if ($scenario -eq 'rollback-only-260' -and $payload.Length -ge 260) { throw 'Rollback-only control must keep its source below MAX_PATH.' }
    $script:calls = 0; $script:waits = 0; $script:boundaryFailures = 0
    $result = Invoke-DesktopOldUninstall -InstallDirectory $script:installation -UninstallerPath $uninstaller `
      -UninstallerName 'Uninstall Test Desktop.exe' -AppExecutable 'Test Desktop.exe' `
      -UninstallArguments '/currentuser --updated --keep-shortcuts' -TemporaryDirectory $temporary -DiagnosticDirectory $diagnostics
    $records = @(Get-Content -LiteralPath (Join-Path $diagnostics 'upgrade.jsonl') | ForEach-Object { $_ | ConvertFrom-Json })
    if ($result -ne 0) {
      $outcomes = @($records | Where-Object { $_.stage -eq 'uninstall-result' })
      if ($result -ne 2 -or $outcomes.Count -ne 12 -or $script:boundaryFailures -ne 12 -or $script:waits -ne 11 -or
          @($outcomes | Where-Object { $_.exitCode -ne 2 }).Count -ne 0) { throw 'Regression failed at an unrelated seam, rather than twelve legacy path-boundary failures.' }
      $failures += "$scenario returned exit 2 after 12 path-boundary attempts (expected successful upgrade)"
      Write-Output "RED $scenario exit=2 attempts=12 boundaryFailures=12"
    } else {
      if ([DshRemovalNative]::Exists($application) -or [DshRemovalNative]::Exists($uninstaller) -or [DshRemovalNative]::Exists($payload)) { throw 'Successful upgrade left previous payload behind.' }
      Write-Output "PASS $scenario"
    }
    if ([IO.File]::ReadAllText($sentinel) -cne 'user data must survive') { throw 'Upgrade modified the user-data sentinel.' }
  }
  if ($failures.Count -ne 0) { throw ($failures -join '; ') }
} finally {
  foreach ($entry in @([DshRemovalNative]::Inventory($root) | Sort-Object { $_.RelativePath.Length } -Descending)) {
    [DshRemovalNative]::Delete((Join-Path $root $entry.RelativePath), $entry)
  }
  [DshRemovalNative]::Delete($root, [DshRemovalNative]::Inspect($root))
}

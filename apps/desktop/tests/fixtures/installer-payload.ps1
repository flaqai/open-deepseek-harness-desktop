param([string]$Scenario, [string]$FixtureDirectory)
$ErrorActionPreference = 'Stop'
$source = Join-Path $FixtureDirectory 'source'
$target = Join-Path $FixtureDirectory 'installed'
$diagnostics = Join-Path $FixtureDirectory 'diagnostics'
[void][System.IO.Directory]::CreateDirectory((Join-Path $source 'resources/harness'))
[System.IO.File]::WriteAllText((Join-Path $source 'Desktop.exe'), 'fixture executable')
[System.IO.File]::WriteAllText((Join-Path $source 'resources/harness/package.json'), '{"version":"0.2.1-rc.2"}')
[System.IO.File]::WriteAllText((Join-Path $source 'resource.txt'), 'payload')
. (Join-Path $PSScriptRoot '../../build/installer-payload.ps1') -SourceDirectory $source -InstallDirectory $target -AppExecutable 'Desktop.exe' -ExpectedVersion '0.2.1-rc.2' -DiagnosticDirectory $diagnostics
if ($Scenario.StartsWith('robocopy-path-')) {
  $os64 = $Scenario -ne 'robocopy-path-32bit-os'
  $process64 = $Scenario -eq 'robocopy-path-64bit-process'
  $selectedPath = Get-InstallerRobocopyPath -WindowsDirectory $FixtureDirectory -Is64BitOperatingSystem $os64 -Is64BitProcess $process64
  @{ selectedPath = $selectedPath } | ConvertTo-Json -Compress
  exit 0
}
$script:copyCalls = 0
function New-FixtureDirectoryLink([string]$LinkPath, [string]$TargetPath) {
  $linkType = 'SymbolicLink'
  if ($env:OS -eq 'Windows_NT') { $linkType = 'Junction' }
  [void](New-Item -ItemType $linkType -Path $LinkPath -Target $TargetPath)
}
function Get-DesktopPeVersion([string]$ExecutablePath) {
  if ($Scenario -eq 'wrong-pe-core') { return '0.2.2.0' }
  if ($Scenario -eq 'changed-pe-version' -and $ExecutablePath.Contains('installed')) { return '0.2.1.2' }
  return '0.2.1.0'
}
function Invoke-InstallerRobocopy([string]$Source, [string]$Destination, [string]$LogPath) {
  $script:copyCalls += 1
  if ($Scenario -eq 'copy-start-failure') { throw 'fixture: process failed to start' }
  if ($Scenario -eq 'copy-failure') { return 8 }
  [void][System.IO.Directory]::CreateDirectory($Destination)
  Get-ChildItem -LiteralPath $Source -Force | Copy-Item -Destination $Destination -Recurse -Force
  switch ($Scenario) {
    'missing-file' { Remove-Item -LiteralPath (Join-Path $Destination 'resource.txt') }
    'wrong-size' { [System.IO.File]::WriteAllText((Join-Path $Destination 'resource.txt'), 'truncated') }
    'extra-file' { [System.IO.File]::WriteAllText((Join-Path $Destination 'obsolete.txt'), 'stale') }
    'wrong-core-version' { [System.IO.File]::WriteAllText((Join-Path $Destination 'resources/harness/package.json'), '{"version":"0.2.1-rc.1"}') }
    'copy-source-reparse' { New-FixtureDirectoryLink (Join-Path $Source 'changed-link') $FixtureDirectory }
    'copy-target-reparse' { New-FixtureDirectoryLink (Join-Path $Destination 'changed-link') $FixtureDirectory }
  }
  if ($Scenario -eq 'robocopy-warning') { return 7 }
  return 1
}
switch ($Scenario) {
  'overlap' { $target = Join-Path $source 'nested' }
  'root-target' { $target = [System.IO.Path]::GetPathRoot($target) }
  'source-reparse' { New-FixtureDirectoryLink (Join-Path $source 'linked') $FixtureDirectory }
  'target-reparse' { New-FixtureDirectoryLink $target $FixtureDirectory }
  'missing-executable' { Remove-Item -LiteralPath (Join-Path $source 'Desktop.exe') }
  'missing-manifest' { Remove-Item -LiteralPath (Join-Path $source 'resources/harness/package.json') }
  'malformed-manifest' { [System.IO.File]::WriteAllText((Join-Path $source 'resources/harness/package.json'), 'not JSON') }
  'prefix-sibling' { $target = $source + '-installed' }
  'independent-core-version' { [System.IO.File]::WriteAllText((Join-Path $source 'resources/harness/package.json'), '{"version":"0.2.1-alpha.3"}') }
}
$result = Invoke-InstallerPayloadCopy -SourceDirectory $source -InstallDirectory $target -AppExecutable 'Desktop.exe' -ExpectedVersion '0.2.1-rc.2' -DiagnosticDirectory $diagnostics
@{ exitCode = $result.ExitCode; copyCalls = $script:copyCalls; diagnosticPath = $result.DiagnosticPath } | ConvertTo-Json -Compress

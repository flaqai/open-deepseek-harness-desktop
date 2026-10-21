param([Parameter(Mandatory = $true)] [string] $TestDirectory)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../build/installer-removal.ps1')
Initialize-DesktopRemovalNative

function Assert-Removal([bool] $Condition, [string] $Message) { if (-not $Condition) { throw $Message } }
function New-RemovalFixture([string] $Name) {
  $caseRoot = Join-Path $TestDirectory $Name
  $installation = Join-Path $caseRoot 'installation'
  $diagnostics = Join-Path $caseRoot 'diagnostics'
  foreach ($directory in @($caseRoot, $installation, $diagnostics)) { [DshRemovalNative]::CreatePrivateDirectory($directory) }
  $uninstaller = Join-Path $installation 'Uninstall Test.exe'
  [DshRemovalNative]::WriteJournal($uninstaller, 'excluded uninstaller', $true)
  $app = Join-Path $installation 'Test.exe'
  [DshRemovalNative]::WriteJournal($app, 'original application', $true)
  $sentinel = Join-Path $caseRoot 'user-data.txt'
  [DshRemovalNative]::WriteJournal($sentinel, 'user data', $true)
  return @{ Root = $installation; Diagnostic = $diagnostics; Uninstaller = $uninstaller; App = $app; Sentinel = $sentinel; Case = $caseRoot }
}
function Start-FixtureRemoval($Fixture) {
  return Start-DesktopRemovalTransaction -InstallDirectory $Fixture.Root -UninstallerName 'Uninstall Test.exe' -DiagnosticDirectory $Fixture.Diagnostic
}
function Assert-RemovalRejects([scriptblock] $Action, [string] $Message) {
  $rejected = $false
  try { & $Action } catch { $rejected = $true }
  Assert-Removal $rejected $Message
}

foreach ($length in @(259, 260, 261)) {
  $fixture = New-RemovalFixture "boundary-$length"
  $parent = Join-Path $fixture.Root 'resources'
  [DshRemovalNative]::CreatePrivateDirectory($parent)
  while (($length - $parent.Length - 1) -gt 100) {
    $parent = Join-Path $parent ('d' * 40)
    [DshRemovalNative]::CreatePrivateDirectory($parent)
  }
  $payload = Join-Path $parent ('f' * ($length - $parent.Length - 1))
  [DshRemovalNative]::WriteJournal($payload, 'long payload bytes', $true)
  $before = [DshRemovalNative]::ReadJournal($payload, 1024)
  Assert-Removal ($payload.Length -eq $length -and ([DshRemovalNative]::Inspect($payload)).Length -gt 0) 'Boundary payload must exist at the exact requested absolute length.'
  $tx = Start-FixtureRemoval $fixture
  try {
    Assert-Removal ($tx.State -eq 'staged' -and -not [DshRemovalNative]::Exists($payload) -and [DshRemovalNative]::Exists($fixture.Uninstaller)) 'Staging must move the long payload while retaining only the validated uninstaller.'
    Assert-Removal (@([DshRemovalNative]::Children($fixture.Root)).Count -eq 1) 'Staged installation must contain exactly one excluded entry.'
    Undo-DesktopRemovalTransaction -Transaction $tx
    Assert-Removal (([DshRemovalNative]::ReadJournal($payload, 1024)) -ceq $before) 'Undo must restore exact payload bytes.'
    Assert-Removal (-not [DshRemovalNative]::Exists($tx.Quarantine)) 'Successful undo must clean its own quarantine.'
  } finally { Close-DesktopRemovalLock $tx }
  $tx = Start-FixtureRemoval $fixture
  try {
    $completed = Complete-DesktopRemovalTransaction -Transaction $tx
    Assert-Removal ($completed.Committed -and $null -eq $completed.Warning -and -not [DshRemovalNative]::Exists($payload) -and -not [DshRemovalNative]::Exists($tx.Quarantine)) 'Complete must remove staged payload and journal without warnings.'
    Assert-Removal (([DshRemovalNative]::ReadJournal($fixture.Sentinel, 1024)).TrimEnd() -ceq 'user data') 'Removal must not alter user data outside the installation.'
  } finally { Close-DesktopRemovalLock $tx }
  Write-Output "PASS transaction-boundary-$length"
}

$fixture = New-RemovalFixture 'interrupted'
$tx = Start-FixtureRemoval $fixture
try {
  Close-DesktopRemovalLock $tx
  Assert-RemovalRejects { Start-FixtureRemoval $fixture } 'An interrupted transaction marker must stop a second removal.'
  Assert-Removal ([DshRemovalNative]::Exists($tx.ManifestPath)) 'Interrupted marker refusal must retain the original recovery journal.'
  Undo-DesktopRemovalTransaction -Transaction $tx
} finally { Close-DesktopRemovalLock $tx }
Write-Output 'PASS interrupted-marker'

$fixture = New-RemovalFixture 'nested-bridge'
$tx = Start-FixtureRemoval $fixture
$savedBridgeRoot = $env:DSH_REMOVAL_BRIDGE_ROOT
$savedBridgeQuarantine = $env:DSH_REMOVAL_BRIDGE_QUARANTINE
try {
  $env:DSH_REMOVAL_BRIDGE_ROOT = $fixture.Root
  $env:DSH_REMOVAL_BRIDGE_QUARANTINE = $tx.Quarantine
  Assert-Removal (Test-DesktopRemovalBridge $fixture.Root 'Uninstall Test.exe') 'A valid bound coordinator must permit nested uninstall delegation.'
  $env:DSH_REMOVAL_BRIDGE_ROOT = $fixture.Case
  Assert-RemovalRejects { Test-DesktopRemovalBridge $fixture.Root 'Uninstall Test.exe' } 'Forged bridge installation identity must be refused.'
  $env:DSH_REMOVAL_BRIDGE_ROOT = $fixture.Root
  $env:DSH_REMOVAL_BRIDGE_QUARANTINE = $fixture.Diagnostic
  Assert-RemovalRejects { Test-DesktopRemovalBridge $fixture.Root 'Uninstall Test.exe' } 'A nonmatching quarantine must not authorize delegation.'
  $env:DSH_REMOVAL_BRIDGE_QUARANTINE = $tx.Quarantine
  [DshRemovalNative]::WriteJournal($fixture.App, 'unexpected nested payload', $true)
  Assert-RemovalRejects { Test-DesktopRemovalBridge $fixture.Root 'Uninstall Test.exe' } 'A nonempty unstaged installation must not authorize nested delegation.'
  [DshRemovalNative]::Delete($fixture.App, [DshRemovalNative]::Inspect($fixture.App))
  Undo-DesktopRemovalTransaction -Transaction $tx
} finally {
  Close-DesktopRemovalLock $tx
  if ($null -eq $savedBridgeRoot) { Remove-Item Env:DSH_REMOVAL_BRIDGE_ROOT -ErrorAction SilentlyContinue } else { $env:DSH_REMOVAL_BRIDGE_ROOT = $savedBridgeRoot }
  if ($null -eq $savedBridgeQuarantine) { Remove-Item Env:DSH_REMOVAL_BRIDGE_QUARANTINE -ErrorAction SilentlyContinue } else { $env:DSH_REMOVAL_BRIDGE_QUARANTINE = $savedBridgeQuarantine }
}
Write-Output 'PASS nested-bridge-validation'

$fixture = New-RemovalFixture 'collision'
$tx = Start-FixtureRemoval $fixture
try {
  [DshRemovalNative]::WriteJournal($fixture.App, 'new unexpected application', $true)
  Assert-RemovalRejects { Undo-DesktopRemovalTransaction -Transaction $tx } 'Undo must refuse to overwrite a new file at the old application path.'
  $stagedApp = @($tx.Files | Where-Object { $_.Source -eq $fixture.App })[0]
  Assert-Removal (([DshRemovalNative]::ReadJournal($fixture.App, 1024)).TrimEnd() -ceq 'new unexpected application') 'Rollback collision must preserve the new file.'
  Assert-Removal ($stagedApp.Moved -and ([DshRemovalNative]::ReadJournal($stagedApp.Destination, 1024)).TrimEnd() -ceq 'original application' -and [DshRemovalNative]::Exists($tx.ManifestPath)) 'Rollback collision must retain original bytes and recovery journal.'
} finally { Close-DesktopRemovalLock $tx }
Write-Output 'PASS rollback-collision'

$fixture = New-RemovalFixture 'cleanup-warning'
$tx = Start-FixtureRemoval $fixture
try {
  $unexpected = Join-Path $tx.Quarantine 'unexpected-file'
  [DshRemovalNative]::WriteJournal($unexpected, 'retain unknown bytes', $true)
  $completed = Complete-DesktopRemovalTransaction -Transaction $tx
  Assert-Removal ($completed.Committed -and $null -ne $completed.Warning) 'Unexpected quarantine entries must report committed cleanup requiring attention.'
  Assert-Removal ([DshRemovalNative]::Exists($tx.ManifestPath) -and ([DshRemovalNative]::ReadJournal($tx.ManifestPath, 1048576)).Contains('"committed"')) 'Incomplete committed cleanup must retain its recovery journal.'
  Assert-Removal (([DshRemovalNative]::ReadJournal($unexpected, 1024)).TrimEnd() -ceq 'retain unknown bytes') 'Cleanup must not delete unrecognized quarantine files.'
} finally { Close-DesktopRemovalLock $tx }
Write-Output 'PASS cleanup-warning-retains-journal'

$fixture = New-RemovalFixture 'reparse'
$target = Join-Path $fixture.Case 'external-target'
[DshRemovalNative]::CreatePrivateDirectory($target)
[DshRemovalNative]::WriteJournal((Join-Path $target 'sentinel'), 'must survive', $true)
$kind = if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) { 'Junction' } else { 'SymbolicLink' }
[void](New-Item -ItemType $kind -Path (Join-Path $fixture.Root 'linked') -Target $target)
$reparseFailure = $null
try { Start-FixtureRemoval $fixture } catch { $reparseFailure = $_.Exception.ToString() }
Assert-Removal ($null -ne $reparseFailure -and $reparseFailure -match 'reparse') 'A real junction/symlink must be refused specifically as a reparse entry, not an unrelated path-alias error.'
Assert-Removal ([DshRemovalNative]::Exists($fixture.App) -and ([DshRemovalNative]::ReadJournal((Join-Path $target 'sentinel'), 1024)).TrimEnd() -ceq 'must survive') 'Reparse refusal must preserve the installation and external target.'
Write-Output 'PASS reparse-refusal'

if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) {
  Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class DshRemovalAliasFixture {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern uint GetShortPathNameW(string path, StringBuilder output, uint size);
}
'@
  $fixture = New-RemovalFixture 'native long alias directory'
  $aliasBuffer = [Text.StringBuilder]::new(32768)
  $aliasSize = [DshRemovalAliasFixture]::GetShortPathNameW($fixture.Root, $aliasBuffer, [uint32]$aliasBuffer.Capacity)
  if ($aliasSize -eq 0 -or $aliasSize -ge $aliasBuffer.Capacity) { throw 'Native short-path lookup failed for the owned fixture.' }
  $alias = $aliasBuffer.ToString()
  if ($alias -match '~[0-9]') {
    Assert-Removal (([DshRemovalNative]::Inspect($alias)).Identity -eq ([DshRemovalNative]::Inspect($fixture.Root)).Identity) 'Legitimate native 8.3 alias must resolve to the same ordinary directory identity.'
    $tx = Start-DesktopRemovalTransaction -InstallDirectory $alias -UninstallerName 'Uninstall Test.exe' -DiagnosticDirectory $fixture.Diagnostic
    try { Undo-DesktopRemovalTransaction -Transaction $tx } finally { Close-DesktopRemovalLock $tx }
    Assert-Removal (([DshRemovalNative]::ReadJournal($fixture.App, 1024)).TrimEnd() -ceq 'original application') 'Alias staging/undo must restore the same physical payload.'
    Write-Output 'PASS native-8dot3-alias'
  } else { Write-Output 'UNVERIFIED native-8dot3-alias filesystem returned no short-name alias' }
  $fixture = New-RemovalFixture 'held-file'
  $held = [IO.File]::Open($fixture.App, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  try {
    Assert-RemovalRejects { Start-FixtureRemoval $fixture } 'A real Windows deny-delete handle must prevent staging.'
    Assert-Removal (([DshRemovalNative]::ReadJournal($fixture.App, 1024)).TrimEnd() -ceq 'original application') 'Failed native staging must restore/preserve original bytes.'
  } finally { $held.Dispose() }
  $tx = Start-FixtureRemoval $fixture
  try { Undo-DesktopRemovalTransaction -Transaction $tx } finally { Close-DesktopRemovalLock $tx }
  Write-Output 'PASS native-file-lock-rollback'
} else { Write-Output 'UNVERIFIED native-file-lock-rollback requires Windows sharing semantics' }

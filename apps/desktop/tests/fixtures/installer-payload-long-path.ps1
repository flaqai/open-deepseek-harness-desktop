param([Parameter(Mandatory = $true)][string]$TestDirectory)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../build/installer-removal.ps1')
Initialize-DesktopRemovalNative
. (Join-Path $PSScriptRoot '../../build/installer-payload.ps1') -SourceDirectory $TestDirectory -InstallDirectory $TestDirectory -AppExecutable 'Test.exe' -ExpectedVersion '0.2.1-rc.2.2' -DiagnosticDirectory $TestDirectory

function New-PayloadBoundaryPath([string]$Root, [int]$Length, [bool]$Directory) {
  $parent = $Root
  while (($Length - $parent.Length - 1) -gt 100) {
    $parent = Join-Path $parent ('d' * 40)
    [DshRemovalNative]::CreatePrivateDirectory($parent)
  }
  $path = Join-Path $parent ('p' * ($Length - $parent.Length - 1))
  if ($Directory) { [DshRemovalNative]::CreatePrivateDirectory($path) }
  else { [DshRemovalNative]::WriteJournal($path, 'boundary payload bytes', $true) }
  if ($path.Length -ne $Length) { throw 'Fixture did not create the exact absolute boundary length.' }
  return $path
}

foreach ($length in @(259, 260, 261)) {
  $root = Join-Path $TestDirectory ('leaf-' + $length)
  [DshRemovalNative]::CreatePrivateDirectory($root)
  $leaf = New-PayloadBoundaryPath $root $length $false
  $actual = [DshRemovalNative]::Inspect($leaf)
  if ($actual.Directory -or $actual.Length -le 0) { throw 'Native fixture creation did not produce a nonempty file.' }
  # Exercise the production enumerator, not a mock or the native setup adapter.
  $inventory = Get-InstallerPayloadInventory $root
  $relative = $leaf.Substring($root.Length + 1)
  if ($inventory.Count -ne 1 -or -not $inventory.ContainsKey($relative) -or $inventory[$relative] -ne $actual.Length) {
    throw ("Payload inventory omitted or mis-sized the real {0}-character file." -f $length)
  }
  Write-Output ("PASS payload-inventory-boundary-{0}" -f $length)
}

$root = Join-Path $TestDirectory 'deep-directory'
[DshRemovalNative]::CreatePrivateDirectory($root)
$longDirectory = New-PayloadBoundaryPath $root 261 $true
$deepLeaf = Join-Path $longDirectory 'leaf.txt'
[DshRemovalNative]::WriteJournal($deepLeaf, 'deep payload bytes', $true)
$inventory = Get-InstallerPayloadInventory $root
$relative = $deepLeaf.Substring($root.Length + 1)
if ($inventory.Count -ne 1 -or -not $inventory.ContainsKey($relative) -or $inventory[$relative] -ne ([DshRemovalNative]::Inspect($deepLeaf)).Length) {
  throw 'Payload inventory omitted or mis-sized a file below a real long directory.'
}
Write-Output 'PASS payload-inventory-deep-directory'

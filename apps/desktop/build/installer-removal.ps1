[CmdletBinding()]
param([string]$InstallDirectory, [string]$UninstallerName, [string]$DiagnosticDirectory)

$ErrorActionPreference = 'Stop'

function Initialize-DesktopRemovalNative {
  if (-not ('DshRemovalNative' -as [type])) {
    Add-Type -Path (Join-Path $PSScriptRoot 'installer-removal-native.cs') -ErrorAction Stop
  }
}

function Get-DesktopRemovalRoot([string]$Directory, [switch]$ForDiagnostics) {
  Initialize-DesktopRemovalNative
  if ([string]::IsNullOrWhiteSpace($Directory) -or -not [IO.Path]::IsPathRooted($Directory) -or $Directory.StartsWith('\\') -or $Directory -match '^[A-Za-z]:[^\\/]') {
    throw 'Removal requires a fully qualified local directory.'
  }
  $full = [DshRemovalNative]::Canonical($Directory).TrimEnd([char[]]@('\', '/'))
  $drive = [IO.Path]::GetPathRoot($full).TrimEnd([char[]]@('\', '/'))
  if ($full -eq $drive) { throw 'Removal refuses a filesystem root.' }
  foreach ($folder in @('Windows', 'System', 'SystemX86', 'ProgramFiles', 'ProgramFilesX86', 'CommonProgramFiles', 'CommonProgramFilesX86', 'CommonApplicationData', 'UserProfile', 'ApplicationData', 'LocalApplicationData', 'DesktopDirectory', 'MyDocuments')) {
    $protected = [Environment]::GetFolderPath([Environment+SpecialFolder]::$folder)
    if ([string]::IsNullOrWhiteSpace($protected)) { continue }
    $protected = [IO.Path]::GetFullPath($protected).TrimEnd([char[]]@('\', '/'))
    if ([string]::Equals($full, $protected, [StringComparison]::OrdinalIgnoreCase) -or $protected.StartsWith($full + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
      throw 'Removal refuses a protected system or user directory.'
    }
    if (-not $ForDiagnostics -and $folder -in @('Windows', 'System', 'SystemX86') -and $full.StartsWith($protected + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
      throw 'Removal refuses installation inside an operating-system directory.'
    }
  }
  $ancestor = $full
  while (-not [string]::IsNullOrEmpty($ancestor)) {
    $entry = [DshRemovalNative]::Inspect($ancestor)
    if (-not $entry.Directory) { throw 'Removal paths must traverse only ordinary directories.' }
    $ancestor = [DshRemovalNative]::Parent($ancestor)
  }
  return $full
}

function Get-DesktopRemovalPrefix([string]$Root) {
  $hash = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = $hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($Root.ToUpperInvariant()))
    return '.dsh-remove-' + ([BitConverter]::ToString($bytes).Replace('-', '').Substring(0, 16)) + '-'
  } finally { $hash.Dispose() }
}

function Write-DesktopRemovalJournal($Transaction, [string]$Stage, [hashtable]$Fields) {
  $event = [ordered]@{ time = [DateTime]::UtcNow.ToString('o'); stage = $Stage }
  foreach ($key in $Fields.Keys) { $event[$key] = $Fields[$key] }
  [DshRemovalNative]::WriteJournal($Transaction.ManifestPath, ($event | ConvertTo-Json -Compress -Depth 10), $false)
}

function Assert-DesktopRemovalBinding($Transaction) {
  if (([DshRemovalNative]::Inspect($Transaction.Root)).Identity -ne $Transaction.RootIdentity -or
    ([DshRemovalNative]::Inspect($Transaction.Quarantine)).Identity -ne $Transaction.QuarantineIdentity) {
    throw ('Removal directory identity changed. Recovery data retained at ' + $Transaction.Quarantine)
  }
}

function Close-DesktopRemovalLock($Transaction) {
  if ($null -ne $Transaction.LockStream) { $Transaction.LockStream.Dispose(); $Transaction.LockStream = $null }
}

function Remove-DesktopRemovalJournalFiles($Transaction) {
  foreach ($child in [DshRemovalNative]::Children($Transaction.Quarantine)) {
    if ([IO.Path]::GetFileName($child) -notin @('transaction.jsonl', 'transaction.lock')) { throw 'Removal quarantine contains unexpected files; retaining the journal.' }
  }
  Close-DesktopRemovalLock $Transaction
  foreach ($name in @('transaction.jsonl', 'transaction.lock')) {
    $path = Join-Path $Transaction.Quarantine $name
    if ([DshRemovalNative]::Exists($path)) { [DshRemovalNative]::Delete($path, [DshRemovalNative]::Inspect($path)) }
  }
  if (@([DshRemovalNative]::Children($Transaction.Quarantine)).Count -ne 0) { throw 'Removal quarantine contains unexpected files; retaining the directory.' }
  [DshRemovalNative]::Delete($Transaction.Quarantine, [DshRemovalNative]::Inspect($Transaction.Quarantine))
}

function Start-DesktopRemovalTransaction {
  param([Parameter(Mandatory = $true)][string]$InstallDirectory,
    [Parameter(Mandatory = $true)][string]$UninstallerName,
    [Parameter(Mandatory = $true)][string]$DiagnosticDirectory)
  $root = Get-DesktopRemovalRoot $InstallDirectory
  $diagnostics = Get-DesktopRemovalRoot $DiagnosticDirectory -ForDiagnostics
  if ($diagnostics -eq $root -or $diagnostics.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or $root.StartsWith($diagnostics + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Removal diagnostics and installation directories must not overlap.'
  }
  if ([string]::IsNullOrWhiteSpace($UninstallerName) -or [IO.Path]::GetFileName($UninstallerName) -ne $UninstallerName -or $UninstallerName -match '[\\/:]' -or -not $UninstallerName.EndsWith('.exe', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Removal requires an exact uninstaller executable basename.'
  }
  $uninstaller = Join-Path $root $UninstallerName
  $excluded = [DshRemovalNative]::Inspect($uninstaller)
  if ($excluded.Directory) { throw 'The excluded uninstaller is not an ordinary file.' }
  $parent = [DshRemovalNative]::Parent($root)
  $prefix = Get-DesktopRemovalPrefix $root
  foreach ($sibling in [DshRemovalNative]::Children($parent)) {
    if ([IO.Path]::GetFileName($sibling).StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
      throw ('An unfinished removal requires recovery before retrying. Keep the installation and quarantine: ' + $sibling)
    }
  }
  $inventory = @([DshRemovalNative]::Inventory($root))
  $files = @($inventory | Where-Object { -not $_.Directory -and -not [string]::Equals($_.RelativePath, $UninstallerName, [StringComparison]::OrdinalIgnoreCase) })
  $directories = @($inventory | Where-Object { $_.Directory } | Sort-Object { $_.RelativePath.Length } -Descending)
  # Atomic creation of one deterministic reservation serializes removals of
  # this root, including contenders that observed no transaction concurrently.
  $quarantine = Join-Path $parent ($prefix + 'active')
  [DshRemovalNative]::CreatePrivateDirectory($quarantine)
  $tx = [pscustomobject]@{
    Root = $root; RootIdentity = ([DshRemovalNative]::Inspect($root)).Identity
    Quarantine = $quarantine; QuarantineIdentity = ([DshRemovalNative]::Inspect($quarantine)).Identity
    ManifestPath = (Join-Path $quarantine 'transaction.jsonl'); LockStream = $null
    Files = (New-Object 'System.Collections.Generic.List[object]'); Directories = (New-Object 'System.Collections.Generic.List[object]'); Entries = (New-Object 'System.Collections.Generic.List[object]'); State = 'preparing'; ExcludedUninstaller = $excluded
  }
  try {
    $tx.LockStream = [DshRemovalNative]::OpenLock((Join-Path $quarantine 'transaction.lock'))
    $ordinal = 0
    foreach ($entry in @($files) + @($directories)) {
      $item = [pscustomobject]@{ Entry = $entry; Source = (Join-Path $root $entry.RelativePath); Destination = (Join-Path $quarantine ('entry-' + $ordinal.ToString('D8'))); Moved = $false }
      $tx.Entries.Add($item)
      if ($entry.Directory) { $tx.Directories.Add($item) } else { $tx.Files.Add($item) }
      $ordinal++
    }
    $manifest = [ordered]@{ schema = 'desktop-removal/v1'; root = $root; rootIdentity = $tx.RootIdentity; quarantine = $quarantine; quarantineIdentity = $tx.QuarantineIdentity; excludedUninstaller = $UninstallerName; excludedIdentity = $excluded.Identity; entries = @($tx.Entries | ForEach-Object { @{ relativePath = $_.Entry.RelativePath; identity = $_.Entry.Identity; length = $_.Entry.Length; directory = $_.Entry.Directory; destination = [IO.Path]::GetFileName($_.Destination) } }) }
    [DshRemovalNative]::WriteJournal($tx.ManifestPath, ($manifest | ConvertTo-Json -Compress -Depth 10), $true)
    $tx.State = 'moving'
    foreach ($item in $tx.Entries) {
      Assert-DesktopRemovalBinding $tx
      Write-DesktopRemovalJournal $tx 'move-intent' @{ source = $item.Entry.RelativePath; destination = [IO.Path]::GetFileName($item.Destination) }
      [DshRemovalNative]::Move($item.Source, $item.Destination, $item.Entry)
      $item.Moved = $true
      Write-DesktopRemovalJournal $tx 'move-complete' @{ source = $item.Entry.RelativePath }
    }
    $left = @([DshRemovalNative]::Children($root))
    if ($left.Count -ne 1 -or -not [string]::Equals($left[0], $uninstaller, [StringComparison]::OrdinalIgnoreCase) -or ([DshRemovalNative]::Inspect($uninstaller)).Identity -ne $excluded.Identity) { throw 'The staged installation contains unexpected entries.' }
    Write-DesktopRemovalJournal $tx 'staged' @{}
    $tx.State = 'staged'
    return $tx
  } catch {
    $failure = $_
    try { Undo-DesktopRemovalTransaction $tx }
    catch { throw ('Removal staging failed and restoration is incomplete. Keep recovery data at ' + $quarantine + '. ' + $_.Exception.Message) }
    $failure.Exception.Data['RemovalStage'] = 'stage'
    throw $failure
  }
}

function Undo-DesktopRemovalTransaction {
  param([Parameter(Mandatory = $true)]$Transaction)
  if ($Transaction.State -eq 'committed') { throw 'Committed removal cannot be rolled back.' }
  $failures = @()
  try {
    Assert-DesktopRemovalBinding $Transaction
    for ($index = $Transaction.Entries.Count - 1; $index -ge 0; $index--) {
      $item = $Transaction.Entries[$index]
      if (-not $item.Moved) { continue }
      try {
        Write-DesktopRemovalJournal $Transaction 'restore-intent' @{ source = $item.Entry.RelativePath }
        [DshRemovalNative]::Move($item.Destination, $item.Source, $item.Entry)
        $item.Moved = $false
        Write-DesktopRemovalJournal $Transaction 'restore-complete' @{ source = $item.Entry.RelativePath }
      } catch { $failures += $_.Exception.Message }
    }
    if ($failures.Count -gt 0) { throw ($failures -join '; ') }
    $Transaction.State = 'restored'
    Remove-DesktopRemovalJournalFiles $Transaction
  } finally { Close-DesktopRemovalLock $Transaction }
}

function Complete-DesktopRemovalTransaction {
  param([Parameter(Mandatory = $true)]$Transaction)
  if ($Transaction.State -ne 'staged') { throw 'Only a fully staged removal may be committed.' }
  if (([DshRemovalNative]::Inspect($Transaction.Quarantine)).Identity -ne $Transaction.QuarantineIdentity) { throw 'Removal quarantine identity changed before commit.' }
  Write-DesktopRemovalJournal $Transaction 'committed' @{}
  $Transaction.State = 'committed'
  $warning = $null
  try {
    foreach ($item in $Transaction.Entries) {
      if ($item.Moved) { [DshRemovalNative]::Delete($item.Destination, $item.Entry); $item.Moved = $false }
    }
    Remove-DesktopRemovalJournalFiles $Transaction
  } catch { $warning = 'Removal committed, but backup cleanup is incomplete. Keep ' + $Transaction.Quarantine + '. ' + $_.Exception.Message }
  finally { Close-DesktopRemovalLock $Transaction }
  return [pscustomobject]@{ Committed = $true; Warning = $warning; Quarantine = $Transaction.Quarantine }
}

function Test-DesktopRemovalBridge([string]$Root, [string]$Name) {
  $bridgeRoot = [Environment]::GetEnvironmentVariable('DSH_REMOVAL_BRIDGE_ROOT')
  $quarantine = [Environment]::GetEnvironmentVariable('DSH_REMOVAL_BRIDGE_QUARANTINE')
  if ([string]::IsNullOrWhiteSpace($bridgeRoot) -and [string]::IsNullOrWhiteSpace($quarantine)) { return $false }
  if (-not [string]::Equals($bridgeRoot, $Root, [StringComparison]::OrdinalIgnoreCase)) { throw 'Nested removal root does not match its coordinator.' }
  $safeQuarantine = Get-DesktopRemovalRoot $quarantine
  if (-not [string]::Equals([DshRemovalNative]::Parent($safeQuarantine), [DshRemovalNative]::Parent($Root), [StringComparison]::OrdinalIgnoreCase) -or -not [IO.Path]::GetFileName($safeQuarantine).StartsWith((Get-DesktopRemovalPrefix $Root), [StringComparison]::OrdinalIgnoreCase)) { throw 'Nested removal quarantine is not a matching sibling.' }
  $records = @(([DshRemovalNative]::ReadJournal((Join-Path $safeQuarantine 'transaction.jsonl'), 16777216)).TrimEnd() -split '\r?\n')
  $manifest = $records[0] | ConvertFrom-Json
  $last = $records[$records.Count - 1] | ConvertFrom-Json
  if ($manifest.schema -ne 'desktop-removal/v1' -or $manifest.root -ne $Root -or $manifest.quarantine -ne $safeQuarantine -or $manifest.excludedUninstaller -ne $Name -or $last.stage -ne 'staged' -or
    $manifest.rootIdentity -ne ([DshRemovalNative]::Inspect($Root)).Identity -or $manifest.quarantineIdentity -ne ([DshRemovalNative]::Inspect($safeQuarantine)).Identity) { throw 'Nested removal journal binding is invalid.' }
  $children = @([DshRemovalNative]::Children($Root))
  $excluded = Join-Path $Root $Name
  if ($children.Count -ne 1 -or $children[0] -ne $excluded -or ([DshRemovalNative]::Inspect($excluded)).Identity -ne $manifest.excludedIdentity) { throw 'Nested removal requires an already staged empty installation.' }
  return $true
}

if ($MyInvocation.InvocationName -ne '.') {
  $transaction = $null
  try {
    $root = Get-DesktopRemovalRoot $InstallDirectory
    if (Test-DesktopRemovalBridge $root $UninstallerName) { [Console]::WriteLine('Removal is owned by the validated upgrade coordinator.'); exit 0 }
    $transaction = Start-DesktopRemovalTransaction -InstallDirectory $root -UninstallerName $UninstallerName -DiagnosticDirectory $DiagnosticDirectory
    $result = Complete-DesktopRemovalTransaction $transaction
    if ($null -ne $result.Warning) { [Console]::Error.WriteLine($result.Warning) }
    exit 0
  } catch {
    $failure = $_
    if ($null -ne $transaction -and $transaction.State -ne 'committed') {
      try { Undo-DesktopRemovalTransaction $transaction }
      catch { [Console]::Error.WriteLine('Removal restoration is incomplete. Keep ' + $transaction.Quarantine + '. ' + $_.Exception.Message) }
    }
    [Console]::Error.WriteLine('Application-file removal stopped: ' + $failure.Exception.Message)
    if ($failure.Exception.Data['RemovalStage'] -eq 'stage') { exit 2 }
    exit 3
  }
}

# Shared installation-record inspection and metadata-only orphan repair.
# Dot-sourcing defines functions without reading the registry or changing state.

function Get-DesktopRegistrationKeys {
  return @('Software\0361fe6e-270e-56a3-9f11-0d722f41d3b6', 'Software\Microsoft\Windows\CurrentVersion\Uninstall\0361fe6e-270e-56a3-9f11-0d722f41d3b6')
}

function Open-DesktopRegistrationHive([string]$Scope) {
  if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or -not [Environment]::Is64BitProcess) {
    throw 'Use 64-bit Windows PowerShell on the affected Windows account.'
  }
  $hive = switch ($Scope) {
    'CurrentUser' { [Microsoft.Win32.RegistryHive]::CurrentUser }
    'AllUsers' { [Microsoft.Win32.RegistryHive]::LocalMachine }
    default { throw 'Select CurrentUser or AllUsers explicitly.' }
  }
  return [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, [Microsoft.Win32.RegistryView]::Registry64)
}

function Read-DesktopRegistrationKey([string]$Scope, [string]$Path) {
  if ($Path -notin @(Get-DesktopRegistrationKeys)) { throw 'Unapproved installation registry path.' }
  $base = Open-DesktopRegistrationHive $Scope
  $key = $null
  try {
    $key = $base.OpenSubKey($Path, $false)
    if ($null -eq $key) { return $null }
    $values = [ordered]@{}
    foreach ($name in @($key.GetValueNames() | Sort-Object)) {
      $values[$name] = [ordered]@{ Kind = $key.GetValueKind($name).ToString(); Value = $key.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) }
    }
    return [pscustomobject]@{ Path = $Path; Values = $values; Children = @($key.GetSubKeyNames()) }
  } finally {
    if ($null -ne $key) { $key.Dispose() }
    $base.Dispose()
  }
}

function Get-DesktopRegistrationString($Record, [string]$Name) {
  if (-not $Record.Values.Contains($Name)) { return $null }
  $entry = $Record.Values[$Name]
  if ($entry.Kind -ne 'String' -or $entry.Value -isnot [string]) { throw "Unexpected installation registry type: $Name" }
  return $entry.Value
}

function Get-DesktopRegistrationFingerprint($Record) {
  if ($null -eq $Record) { return 'missing' }
  return ($Record | ConvertTo-Json -Depth 12 -Compress)
}

function Get-DesktopRegistrationDirectory([string]$Directory) {
  if ([string]::IsNullOrWhiteSpace($Directory) -or $Directory -notmatch '^[a-zA-Z]:\\' -or $Directory -match '[\x00-\x1f"*?<>|/]' -or $Directory.Substring(2).Contains(':')) {
    throw 'Installation records must name a fully qualified local Windows directory.'
  }
  $full = $Directory.TrimEnd('\')
  if ($full.Length -le 3) { throw 'A filesystem root cannot be an installation directory.' }
  if (@($full.Substring(3).Split('\') | Where-Object { $_ -eq '' -or $_ -in @('.', '..') -or $_.EndsWith('.') -or $_.EndsWith(' ') -or $_ -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)' }).Count -gt 0) {
    throw 'Installation records contain an ambiguous directory component.'
  }
  return $full
}

# Inaccessible/offline roots and access-denied paths are unknown, never missing.
function Get-DesktopRegistrationDirectoryState([string]$Directory) {
  $drive = New-Object IO.DriveInfo ([IO.Path]::GetPathRoot($Directory))
  if (-not $drive.IsReady -or $drive.DriveType -notin @([IO.DriveType]::Fixed, [IO.DriveType]::Removable)) {
    throw 'The installation drive is unavailable or is not a local disk. No registration may be removed.'
  }
  $ancestor = [IO.Path]::GetPathRoot($Directory)
  $rootAttributes = [IO.File]::GetAttributes($ancestor)
  if (($rootAttributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or ($rootAttributes -band [IO.FileAttributes]::Directory) -eq 0) { throw 'The installation drive root is not a normal directory.' }
  $missing = $false
  foreach ($part in $Directory.Substring($ancestor.Length).Split('\')) {
    if ($missing) { break }
    $ancestor = [IO.Path]::Combine($ancestor, $part)
    try { $attributes = [IO.File]::GetAttributes($ancestor) }
    catch [IO.DirectoryNotFoundException] { $missing = $true; continue }
    catch [IO.FileNotFoundException] { $missing = $true; continue }
    if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'The installation directory traverses a reparse point.' }
    if (($attributes -band [IO.FileAttributes]::Directory) -eq 0) { throw 'The installation path is not a directory.' }
  }
  if ($missing) { return 'Missing' }
  return 'Present'
}

# Returns a verified plan. A present installation is never eligible for repair.
function Get-DesktopRegistrationPlan {
  param([ValidateSet('CurrentUser', 'AllUsers')][string]$Scope, [string]$ExpectedInstallDirectory)
  $records = @()
  $location = $null
  $keys = @(Get-DesktopRegistrationKeys)
  foreach ($path in $keys) {
    $record = Read-DesktopRegistrationKey $Scope $path
    if ($null -eq $record) { continue }
    if ($record.Children.Count -ne 0) { throw 'Installation records contain unexpected child keys; manual review is required.' }
    if ($path -eq $keys[0]) {
      $candidate = Get-DesktopRegistrationDirectory (Get-DesktopRegistrationString $record 'InstallLocation')
      if ((Get-DesktopRegistrationString $record 'ShortcutName') -notin @('DeepSeek Harness', 'Open DeepSeek Harness Desktop')) { throw 'The install record does not identify this application.' }
    } else {
      $display = Get-DesktopRegistrationString $record 'DisplayName'
      $match = [regex]::Match([string]$display, '^(DeepSeek Harness|Open DeepSeek Harness Desktop)(?: (?<Version>\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?))?( \(only current user\))?$', [Text.RegularExpressions.RegexOptions]::CultureInvariant)
      if (-not $match.Success) { throw 'The uninstall record does not identify this application.' }
      if ($Scope -eq 'AllUsers' -and $display.EndsWith(' (only current user)')) { throw 'The uninstall record has inconsistent installation scope.' }
      $version = Get-DesktopRegistrationString $record 'DisplayVersion'
      if ($match.Groups['Version'].Success -and $null -ne $version -and $version -cne $match.Groups['Version'].Value) { throw 'DisplayName and DisplayVersion disagree.' }
      $command = Get-DesktopRegistrationString $record 'UninstallString'
      $commandMatch = [regex]::Match([string]$command, '^"(?<Path>[a-zA-Z]:\\[^"\r\n]+\\Uninstall (?:DeepSeek Harness|Open DeepSeek Harness Desktop)\.exe)"\s+/(?<Mode>currentuser|allusers)$', [Text.RegularExpressions.RegexOptions]::CultureInvariant)
      $mode = if ($Scope -eq 'CurrentUser') { 'currentuser' } else { 'allusers' }
      if (-not $commandMatch.Success -or $commandMatch.Groups['Mode'].Value -cne $mode) { throw 'The uninstaller command or installation scope is invalid.' }
      $uninstaller = $commandMatch.Groups['Path'].Value
      $candidate = Get-DesktopRegistrationDirectory ($uninstaller.Substring(0, $uninstaller.LastIndexOf('\')))
      $explicit = Get-DesktopRegistrationString $record 'InstallLocation'
      if ($null -ne $explicit -and -not [string]::Equals((Get-DesktopRegistrationDirectory $explicit), $candidate, [StringComparison]::OrdinalIgnoreCase)) { throw 'The uninstall record names conflicting directories.' }
      foreach ($name in @('QuietUninstallString')) {
        $quiet = Get-DesktopRegistrationString $record $name
        if ($null -ne $quiet -and $quiet -cne ($command + ' /S')) { throw 'The quiet uninstaller command does not agree with the uninstall command.' }
      }
    }
    if ($null -ne $location -and -not [string]::Equals($candidate, $location, [StringComparison]::OrdinalIgnoreCase)) { throw 'Installation records name different directories.' }
    $location = $candidate
    $records += $record
  }
  if ($records.Count -eq 0) { return [pscustomobject]@{ Status = 'Missing'; Scope = $Scope; InstallDirectory = $null; Records = @() } }
  if (-not [string]::IsNullOrEmpty($ExpectedInstallDirectory) -and -not [string]::Equals($location, (Get-DesktopRegistrationDirectory $ExpectedInstallDirectory), [StringComparison]::OrdinalIgnoreCase)) { throw 'The installation directory changed; registration cleanup was refused.' }
  $state = Get-DesktopRegistrationDirectoryState $location
  return [pscustomobject]@{ Status = $(if ($state -eq 'Missing') { 'Orphaned' } else { 'Present' }); Scope = $Scope; InstallDirectory = $location; Records = $records }
}

function Get-DesktopRegistrationBackupHash([string]$File) {
  $algorithm = [Security.Cryptography.SHA256]::Create()
  $stream = $null
  try { $stream = [IO.File]::OpenRead($File); return [BitConverter]::ToString($algorithm.ComputeHash($stream)) }
  finally { if ($null -ne $stream) { $stream.Dispose() }; $algorithm.Dispose() }
}

function Export-DesktopRegistrationKey([string]$Scope, $Record, [string]$File) {
  $hive = if ($Scope -eq 'CurrentUser') { 'HKCU' } else { 'HKLM' }
  $longHive = if ($Scope -eq 'CurrentUser') { 'HKEY_CURRENT_USER' } else { 'HKEY_LOCAL_MACHINE' }
  $output = & (Join-Path $env:SystemRoot 'System32\reg.exe') export "$hive\$($Record.Path)" $File 2>&1
  if ($LASTEXITCODE -ne 0 -or -not [IO.File]::Exists($File)) { throw "Registry backup failed. No record may be removed. $output" }
  if (-not [IO.File]::ReadAllText($File, [Text.Encoding]::Unicode).Contains("[$longHive\$($Record.Path)]")) { throw 'Registry backup identity verification failed.' }
}

function Remove-DesktopRegistrationKey([string]$Scope, [string]$Path) {
  if ($Path -notin @(Get-DesktopRegistrationKeys)) { throw 'Unapproved installation registry path.' }
  $base = Open-DesktopRegistrationHive $Scope
  try { $base.DeleteSubKey($Path, $true) } finally { $base.Dispose() }
}

function Restore-DesktopRegistrationKey([string]$File) {
  $output = & (Join-Path $env:SystemRoot 'System32\reg.exe') import $File /reg:64 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Registry restoration failed: $output" }
}

function Assert-DesktopRegistrationPlanUnchanged($Plan) {
  if ((Get-DesktopRegistrationDirectoryState $Plan.InstallDirectory) -ne 'Missing') { throw 'The old directory appeared; cleanup was refused.' }
  foreach ($path in @(Get-DesktopRegistrationKeys)) {
    $original = @($Plan.Records | Where-Object { $_.Path -ceq $path })
    $expected = if ($original.Count -eq 0) { $null } else { $original[0] }
    if ((Get-DesktopRegistrationFingerprint (Read-DesktopRegistrationKey $Plan.Scope $path)) -cne (Get-DesktopRegistrationFingerprint $expected)) { throw 'Installation records changed concurrently. Cleanup was refused.' }
  }
}

# All backups precede removal; failure restores only absent, unchanged records.
# No files, PATH entries, credentials, settings, or history are removed.
function Invoke-DesktopRegistrationRepair {
  param($Plan, [string]$OutputRoot, [switch]$Confirmed)
  if ($Plan.Status -eq 'Missing') { return [pscustomobject]@{ Status = 'Missing'; BackupDirectory = $null } }
  if (-not $Confirmed -or $Plan.Status -ne 'Orphaned') { throw 'Repair requires explicit confirmation and a verified orphaned installation.' }
  $fresh = Get-DesktopRegistrationPlan -Scope $Plan.Scope -ExpectedInstallDirectory $Plan.InstallDirectory
  if ((Get-DesktopRegistrationFingerprint $fresh) -cne (Get-DesktopRegistrationFingerprint $Plan)) { throw 'The repair plan changed. Inspect again before confirming.' }
  $backup = Join-Path $OutputRoot ('registration-backup-' + [DateTime]::Now.ToString('yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N'))
  [void][IO.Directory]::CreateDirectory($backup)
  $files = @{}
  $hashes = @{}
  for ($index = 0; $index -lt $Plan.Records.Count; $index++) {
    $record = $Plan.Records[$index]
    $file = Join-Path $backup ("record-$index.reg")
    Export-DesktopRegistrationKey $Plan.Scope $record $file
    $files[$record.Path] = $file
    $hashes[$record.Path] = Get-DesktopRegistrationBackupHash $file
  }
  [IO.File]::WriteAllText((Join-Path $backup 'RESTORE-README.txt'), 'Registry backups only. Do not import these after installing a new version. Keep this folder if repair fails; do not delete personal data.')
  Assert-DesktopRegistrationPlanUnchanged $Plan
  $removed = @()
  try {
    foreach ($record in $Plan.Records) {
      if ((Get-DesktopRegistrationDirectoryState $Plan.InstallDirectory) -ne 'Missing') { throw 'The installation directory appeared; repair stopped.' }
      foreach ($path in @(Get-DesktopRegistrationKeys)) {
        if (@($removed | Where-Object { $_.Path -ceq $path }).Count -gt 0) { $expected = $null }
        else { $expected = @($Plan.Records | Where-Object { $_.Path -ceq $path }); if ($expected.Count -eq 0) { $expected = $null } else { $expected = $expected[0] } }
        if ((Get-DesktopRegistrationFingerprint (Read-DesktopRegistrationKey $Plan.Scope $path)) -cne (Get-DesktopRegistrationFingerprint $expected)) { throw 'Installation records changed during repair.' }
      }
      $removed += $record
      Remove-DesktopRegistrationKey $Plan.Scope $record.Path
      if ($null -ne (Read-DesktopRegistrationKey $Plan.Scope $record.Path)) { throw 'An installation record reappeared concurrently.' }
    }
    foreach ($path in @(Get-DesktopRegistrationKeys)) {
      if ($null -ne (Read-DesktopRegistrationKey $Plan.Scope $path)) { throw 'An installation record reappeared during repair.' }
    }
  } catch {
    $failure = $_.Exception.Message
    $errors = @()
    foreach ($record in $removed) {
      try {
        $existing = Read-DesktopRegistrationKey $Plan.Scope $record.Path
        if ((Get-DesktopRegistrationFingerprint $existing) -ceq (Get-DesktopRegistrationFingerprint $record)) { continue }
        if ($null -ne $existing) { throw 'A record reappeared; automatic restoration cannot overwrite it.' }
        if ((Get-DesktopRegistrationBackupHash $files[$record.Path]) -cne $hashes[$record.Path]) { throw 'The backup changed; automatic restoration was refused.' }
        Restore-DesktopRegistrationKey $files[$record.Path]
        if ((Get-DesktopRegistrationFingerprint (Read-DesktopRegistrationKey $Plan.Scope $record.Path)) -cne (Get-DesktopRegistrationFingerprint $record)) { throw 'Restored values differ from the original record.' }
      } catch { $errors += $_.Exception.Message }
    }
    if ($errors.Count -gt 0) { throw "Repair failed; restoration requires attention. Backups: $backup. $failure $($errors -join '; ')" }
    throw "Repair stopped; removed records were restored. Backups: $backup. $failure"
  }
  return [pscustomobject]@{ Status = 'Repaired'; BackupDirectory = $backup }
}

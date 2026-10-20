# Read bounded metadata from the installed archive without executing the app.
function Get-DesktopPeVersion([string]$Executable) {
  return [Diagnostics.FileVersionInfo]::GetVersionInfo($Executable).ProductVersion
}

function Get-DesktopInstalledIdentity([string]$InstallDirectory, [string]$AppExecutable) {
  if ([IO.Path]::GetFileName($AppExecutable) -ne $AppExecutable -or $AppExecutable -match '[\\/:]') { throw 'Invalid desktop executable filename.' }
  $archive = Join-Path $InstallDirectory 'resources/app.asar'
  $archiveItem = Get-Item -LiteralPath $archive -Force -ErrorAction Stop
  if ($archiveItem.PSIsContainer -or ($archiveItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Desktop metadata archive must be an ordinary file.' }
  $stream = [IO.File]::OpenRead($archive)
  $reader = New-Object IO.BinaryReader($stream)
  try {
    if ($stream.Length -lt 16 -or $reader.ReadUInt32() -ne 4) { throw 'Invalid desktop ASAR size header.' }
    $headerSize = $reader.ReadUInt32()
    if ($headerSize -lt 8 -or $headerSize -gt 16777216 -or 8L + $headerSize -gt $stream.Length) { throw 'Invalid desktop ASAR header size.' }
    $pickleSize = $reader.ReadUInt32()
    $jsonSize = $reader.ReadUInt32()
    if ($pickleSize -ne $headerSize - 4 -or $jsonSize -eq 0 -or $jsonSize -gt $headerSize - 8) { throw 'Invalid desktop ASAR JSON header.' }
    $utf8 = New-Object Text.UTF8Encoding($false, $true)
    $headerBytes = $reader.ReadBytes([int]$jsonSize)
    if ($headerBytes.Length -ne $jsonSize) { throw 'Truncated desktop ASAR JSON header.' }
    $header = $utf8.GetString($headerBytes) | ConvertFrom-Json
    $documents = @()
    foreach ($parts in @(@('package.json'), @('lib', 'harness-version.json'))) {
      $entry = $header
      foreach ($part in $parts) {
        if ($null -ne $entry.link -or $entry.unpacked -or $null -eq $entry.files -or $null -eq $entry.files.PSObject.Properties[$part]) { throw 'Desktop ASAR version metadata is missing or indirect.' }
        $entry = $entry.files.PSObject.Properties[$part].Value
      }
      $offset = 0L
      $size = 0L
      if ($entry.unpacked -or $null -ne $entry.link -or $null -ne $entry.files -or
          -not [long]::TryParse([string]$entry.offset, [ref]$offset) -or
          -not [long]::TryParse([string]$entry.size, [ref]$size) -or $offset -lt 0 -or $size -le 0 -or $size -gt 1048576 -or
          $offset -gt $stream.Length - 8L - $headerSize - $size) { throw 'Invalid desktop ASAR version metadata extent.' }
      [void]$stream.Seek(8L + $headerSize + $offset, [IO.SeekOrigin]::Begin)
      $bytes = $reader.ReadBytes([int]$size)
      if ($bytes.Length -ne $size) { throw 'Truncated desktop ASAR version metadata.' }
      $documents += ($utf8.GetString($bytes) | ConvertFrom-Json)
    }
    $manifest, $identity = $documents
    $semver = '^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$'
    if ($manifest.name -cne '@deepseek-ai/dsh-desktop' -or $manifest.version -notmatch $semver -or
        $identity.version -notmatch $semver -or $manifest.version -cne $identity.desktopVersion) { throw 'Desktop package and Harness version metadata disagree.' }
    $productVersion = Get-DesktopPeVersion (Join-Path $InstallDirectory $AppExecutable)
    $peVersion = [regex]::Match([string]$productVersion, '^(\d+)\.(\d+)\.(\d+)\.(\d+)$')
    $desktopVersion = [regex]::Match($manifest.version, '^(\d+)\.(\d+)\.(\d+)')
    if (-not $peVersion.Success) { throw 'Desktop executable has no numeric Windows product version.' }
    for ($component = 1; $component -le 3; $component += 1) {
      if ($peVersion.Groups[$component].Value -ne $desktopVersion.Groups[$component].Value) { throw 'Desktop executable and archive versions disagree.' }
    }
    return [pscustomobject]@{ Name = $manifest.name; Version = $manifest.version; CoreVersion = $identity.version; ProductVersion = $productVersion }
  } finally { $reader.Dispose() }
}

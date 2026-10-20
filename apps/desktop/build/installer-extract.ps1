[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Extractor,
  [Parameter(Mandatory = $true)][string]$Archive,
  [Parameter(Mandatory = $true)][string]$Destination,
  [Parameter(Mandatory = $true)][string]$DiagnosticDirectory
)
$ErrorActionPreference = 'Stop'

function Invoke-DesktopExtractorProcess([string]$Extractor, [string]$Archive, [string]$Destination, [string]$LogPath) {
  $PSNativeCommandUseErrorActionPreference = $false
  & $Extractor x -y -bd -bsp0 -bb0 -sccUTF-8 ("-o{0}" -f $Destination) -- $Archive 2>&1 |
    Out-File -LiteralPath $LogPath -Encoding Unicode -Append -ErrorAction Stop
  if ($null -eq $LASTEXITCODE) { throw 'The extractor did not report an exit code.' }
  return $LASTEXITCODE
}

function Invoke-DesktopArchiveExtraction {
  param([string]$Extractor, [string]$Archive, [string]$Destination, [string]$DiagnosticDirectory)
  try {
    # These paths are installer-owned. Refuse links and nonempty staging rather
    # than extracting on top of anything supplied by an earlier attempt.
    foreach ($itemPath in @($Extractor, $Archive, $Destination, $DiagnosticDirectory)) {
      if (-not [System.IO.Path]::IsPathRooted($itemPath) -or $itemPath.StartsWith('\\') -or $itemPath -match '^[a-zA-Z]:[^\\/]') { throw 'Extraction requires fully qualified local paths.' }
      $item = Get-Item -LiteralPath $itemPath -Force -ErrorAction Stop
      while ($null -ne $item) {
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Extraction paths cannot traverse reparse points.' }
        if ($item.PSIsContainer) { $item = $item.Parent } else { $item = $item.Directory }
      }
    }
    if (-not [System.IO.File]::Exists($Extractor) -or -not [System.IO.File]::Exists($Archive)) { throw 'The pinned extractor or application archive is missing.' }
    if (-not [System.IO.Directory]::Exists($Destination) -or -not [System.IO.Directory]::Exists($DiagnosticDirectory)) { throw 'Extraction staging and diagnostic directories must exist.' }
    $staging = [System.IO.Path]::GetFullPath($Destination).TrimEnd([char[]]@('\', '/'))
    $logRoot = [System.IO.Path]::GetFullPath($DiagnosticDirectory).TrimEnd([char[]]@('\', '/'))
    if ($staging -eq [System.IO.Path]::GetPathRoot($staging).TrimEnd([char[]]@('\', '/'))) { throw 'Extraction staging cannot be a filesystem root.' }
    if ($logRoot -eq $staging -or $logRoot.StartsWith($staging + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Extraction diagnostics must remain outside staging.' }
    if (@(Get-ChildItem -LiteralPath $Destination -Force -ErrorAction Stop).Count -ne 0) { throw 'Extraction staging must be empty.' }
    $logPath = Join-Path $DiagnosticDirectory 'extraction.log'
    if (Test-Path -LiteralPath $logPath) {
      $existingLog = Get-Item -LiteralPath $logPath -Force -ErrorAction Stop
      if ($existingLog.PSIsContainer -or ($existingLog.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Extraction diagnostics must be an ordinary file.' }
    }
    # Detect unusable logging before running an extractor that can write files.
    Set-Content -LiteralPath $logPath -Value 'Starting package extraction.' -Encoding Unicode -ErrorAction Stop
    $code = Invoke-DesktopExtractorProcess $Extractor $Archive $Destination $logPath
    if ($null -eq $code -or $code -ne 0) { throw ("7-Zip extraction failed with exit code {0}." -f $code) }
    return 0
  } catch {
    [Console]::Error.WriteLine('Package extraction stopped: ' + $_.Exception.Message)
    return 44
  }
}
if ($MyInvocation.InvocationName -ne '.') {
  exit (Invoke-DesktopArchiveExtraction -Extractor $Extractor -Archive $Archive -Destination $Destination -DiagnosticDirectory $DiagnosticDirectory)
}

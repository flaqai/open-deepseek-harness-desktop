[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Path,

  [Parameter(Mandatory = $true)]
  [string]$ReadyPath,

  [Parameter(Mandatory = $true)]
  [ValidateRange(1, 1800)]
  [int]$Seconds,

  [string]$ReleasePath = ''
)

$ErrorActionPreference = 'Stop'
$stream = [System.IO.File]::Open(
  $Path,
  [System.IO.FileMode]::Open,
  [System.IO.FileAccess]::Read,
  # NSIS atomic replacement needs DELETE access for Rename. Permit ordinary
  # readers (including image/scanner reads) while still denying write/delete.
  [System.IO.FileShare]::Read
)
try {
  [System.IO.File]::WriteAllText($ReadyPath, 'ready')
  if ([string]::IsNullOrWhiteSpace($ReleasePath)) {
    Start-Sleep -Seconds $Seconds
  } else {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while (-not (Test-Path -LiteralPath $ReleasePath) -and (Get-Date) -lt $deadline) {
      Start-Sleep -Milliseconds 100
    }
    if (-not (Test-Path -LiteralPath $ReleasePath)) { throw 'Persistent lock fixture exceeded its release deadline.' }
  }
} finally {
  $stream.Dispose()
}

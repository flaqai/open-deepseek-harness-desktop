[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Path,

  [Parameter(Mandatory = $true)]
  [string]$ReadyPath,

  [Parameter(Mandatory = $true)]
  [ValidateRange(1, 120)]
  [int]$Seconds
)

$ErrorActionPreference = 'Stop'
$stream = [System.IO.File]::Open(
  $Path,
  [System.IO.FileMode]::Open,
  [System.IO.FileAccess]::Read,
  [System.IO.FileShare]::None
)
try {
  [System.IO.File]::WriteAllText($ReadyPath, 'ready')
  Start-Sleep -Seconds $Seconds
} finally {
  $stream.Dispose()
}

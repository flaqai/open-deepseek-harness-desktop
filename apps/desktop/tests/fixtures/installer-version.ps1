param([string]$InstallDirectory, [string]$ProductVersion = '0.2.1.0')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../build/installer-version.ps1')
function Get-DesktopPeVersion([string]$Executable) { return $ProductVersion }
Get-DesktopInstalledIdentity -InstallDirectory $InstallDirectory -AppExecutable 'Desktop.exe' | ConvertTo-Json -Compress

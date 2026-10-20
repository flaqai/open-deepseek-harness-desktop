param(
  [Parameter(Mandatory = $true)][string]$Scenario,
  [Parameter(Mandatory = $true)][string]$FixtureDirectory,
  [string]$RealExtractor
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../build/installer-extract.ps1') -Extractor 'unused' -Archive 'unused' -Destination 'unused' -DiagnosticDirectory 'unused'
$extractor = Join-Path $FixtureDirectory '7za.exe'
$archive = Join-Path $FixtureDirectory 'app.7z'
$destination = Join-Path $FixtureDirectory 'staging'
$diagnostics = Join-Path $FixtureDirectory 'diagnostics'
[System.IO.File]::WriteAllText($extractor, 'fixture')
[System.IO.File]::WriteAllText($archive, 'fixture')
[void][System.IO.Directory]::CreateDirectory($destination)
[void][System.IO.Directory]::CreateDirectory($diagnostics)
$script:calls = 0
if ([string]::IsNullOrWhiteSpace($RealExtractor)) {
  function Invoke-DesktopExtractorProcess($Extractor, $Archive, $Destination, $LogPath) {
    $script:calls += 1
    if ($Scenario -eq 'start-failure') { throw 'Native extractor start failed fixture' }
    if ($Scenario -eq 'nonzero') { return 2 }
    return 0
  }
}
else {
  $extractor = $RealExtractor
  [System.IO.File]::Delete($archive)
  $inputFile = Join-Path $FixtureDirectory 'hello.txt'
  [System.IO.File]::WriteAllText($inputFile, 'verified extraction fixture')
  & $extractor a -t7z -bd -bsp0 -- $archive $inputFile | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Native fixture archive creation failed.' }
  if ($Scenario -eq 'native-corrupt') { [System.IO.File]::WriteAllText($archive, 'invalid archive') }
}
switch ($Scenario) {
  'missing-archive' { [System.IO.File]::Delete($archive) }
  'staging-not-empty' { [System.IO.File]::WriteAllText((Join-Path $destination 'old-file'), 'old') }
  'relative-path' { $archive = 'app.7z' }
  'reparse-path' {
    $link = Join-Path $FixtureDirectory 'linked-diagnostics'
    $linkKind = if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) { 'Junction' } else { 'SymbolicLink' }
    [void](New-Item -ItemType $linkKind -Path $link -Target $diagnostics)
    $diagnostics = $link
  }
  'root-destination' { $destination = [System.IO.Path]::GetPathRoot($FixtureDirectory) }
  'log-failure' { [void][System.IO.Directory]::CreateDirectory((Join-Path $diagnostics 'extraction.log')) }
  'log-inside-staging' { $diagnostics = $destination }
}
try {
  $code = Invoke-DesktopArchiveExtraction -Extractor $extractor -Archive $archive -Destination $destination -DiagnosticDirectory $diagnostics
  $extractedText = $null
  $extractedFile = Join-Path $destination 'hello.txt'
  if (Test-Path -LiteralPath $extractedFile) { $extractedText = [System.IO.File]::ReadAllText($extractedFile) }
  [ordered]@{ exitCode = $code; calls = $script:calls; extractedText = $extractedText } | ConvertTo-Json -Compress
}
finally {
  if ($Scenario -eq 'reparse-path') { Remove-Item -LiteralPath $diagnostics -Force }
}

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-legacy-uninstall-probe.ps1')
$oldGitHub = $env:GITHUB_ACTIONS
try {
  $env:GITHUB_ACTIONS = 'false'
  $refused = $false
  try { Assert-LegacyProbeHost } catch { $refused = $_.Exception.Message -like '*disposable GitHub-hosted Windows*' }
  if (-not $refused) { throw 'Legacy probe did not refuse a non-disposable host.' }
} finally { $env:GITHUB_ACTIONS = $oldGitHub }
$arguments = Get-LegacyUninstallArguments -Directory 'C:\private test\中文'
if ($arguments -cne '/S /KEEP_APP_DATA /allusers --updated _?=C:\private test\中文') { throw 'Direct uninstall must preserve the exact unquoted final NSIS directory tail.' }
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('legacy-readonly-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot -ErrorAction Stop | Out-Null
try {
  $installation = Join-Path $testRoot 'installed'
  $parts = [Collections.Generic.List[string]]::new()
  $remaining = 267 - $installation.Length - 1
  while ($remaining -gt 100) { $parts.Add(('d' * 40)); $remaining -= 41 }
  if ($remaining -lt 1) { throw 'Synthetic test root is too long.' }
  $parts.Add(('f' * $remaining))
  $file = Join-Path $installation ([string]::Join([IO.Path]::DirectorySeparatorChar, $parts))
  [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($file))
  [IO.File]::WriteAllText($file, 'synthetic private contents')
  $beforeHash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
  $available = Get-LegacyExclusiveOpenEvidence -Directory $installation -OwnerRoot $testRoot
  if ($available.status -ne 'present' -or $available.attempted -ne 1 -or $available.failures -ne 0) { throw 'Read-only exclusive probe did not inspect the synthetic long file.' }
  $holder = [IO.File]::Open($file, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  try {
    $locked = Get-LegacyExclusiveOpenEvidence -Directory $installation -OwnerRoot $testRoot
    if ($locked.failures -ne 1) { throw 'Exclusive probe did not record the fixture lock.' }
  } finally { $holder.Dispose() }
  $after = Get-LegacyExclusiveOpenEvidence -Directory $installation -OwnerRoot $testRoot
  if ($after.failures -ne 0 -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $beforeHash) { throw 'Read-only probe retained a file handle or changed file contents.' }
  $encoded = @($available, $locked, $after) | ConvertTo-Json -Depth 4
  if ($encoded.Contains($testRoot) -or $encoded.Contains('synthetic private contents')) { throw 'Probe evidence leaked a path or contents.' }
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = (Get-Process -Id $PID).Path
  $start.UseShellExecute = $false
  foreach ($argument in @('-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'exit 7')) { $start.ArgumentList.Add($argument) }
  $result = Invoke-LegacyProbeProcess -Start $start -Milliseconds 10000
  if ($result.outcome -ne 'exited' -or $result.exitCode -ne 7 -or $result.elapsedMilliseconds -lt 0) { throw 'Probe discarded a real nonzero process exit.' }
} finally { Remove-Item -LiteralPath $testRoot -Recurse -Force }
Write-Host 'Legacy counterfactual host refusal, raw NSIS arguments, read-only lock probes, privacy and process-exit checks passed.'

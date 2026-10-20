$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot 'windows-qualification-host.ps1'
$shell = (Get-Process -Id $PID).Path
$start = [Diagnostics.ProcessStartInfo]::new()
$start.FileName = $shell
$start.UseShellExecute = $false
$start.RedirectStandardOutput = $true
$start.RedirectStandardError = $true
foreach ($argument in @('-NoLogo', '-NoProfile', '-NonInteractive', '-File', $scriptPath, '-Privilege', 'standard')) {
  $start.ArgumentList.Add($argument)
}
$start.Environment['GITHUB_ACTIONS'] = 'false'
$start.Environment['RUNNER_ENVIRONMENT'] = 'self-hosted'
$child = [Diagnostics.Process]::Start($start)
try {
  $stdout = $child.StandardOutput.ReadToEndAsync()
  $stderr = $child.StandardError.ReadToEndAsync()
  if (-not $child.WaitForExit(10000)) {
    $child.Kill($true)
    $child.WaitForExit()
    throw 'Host refusal test did not settle.'
  }
  $output = $stdout.GetAwaiter().GetResult() + $stderr.GetAwaiter().GetResult()
  if ($child.ExitCode -eq 0 -or $output -notmatch 'restricted to disposable GitHub-hosted') {
    throw "Non-disposable host was not rejected before account operations: $output"
  }
} finally { $child.Dispose() }
Write-Host 'Native qualification refuses non-disposable hosts before touching system accounts.'

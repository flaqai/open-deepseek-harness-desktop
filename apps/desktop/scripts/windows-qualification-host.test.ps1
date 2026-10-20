$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot 'windows-qualification-host.ps1'
# Exercise the actual account-add caller without creating accounts on the test host.
$tokens = $null
$parseErrors = $null
$tree = [Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'Qualification host failed syntax parsing.' }
$addCalls = @($tree.FindAll({ param($node)
  $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Add-LocalGroupMember'
}, $true))
if ($addCalls.Count -ne 1) { throw 'Expected one local group membership call.' }
$user = [pscustomobject]@{ Name = 'synthetic-user'; SID = 'synthetic-sid-not-a-LocalPrincipal' }
$script:capturedMember = $null
function Add-LocalGroupMember {
  param([string] $SID, [object] $Member)
  if ($SID -ne 'S-1-5-32-545') { throw 'Qualification account must join only the standard Users group.' }
  $script:capturedMember = $Member
}
& ([scriptblock]::Create($addCalls[0].Extent.Text))
if (-not [object]::ReferenceEquals($user, $script:capturedMember)) {
  throw 'Group membership must retain the LocalUser object, not pass its SID as a LocalPrincipal.'
}
Remove-Item Function:\Add-LocalGroupMember
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

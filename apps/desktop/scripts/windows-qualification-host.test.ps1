$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot 'windows-qualification-host.ps1'
# Exercise the actual account-add caller without creating accounts on the test host.
$tokens = $null
$parseErrors = $null
$tree = [Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'Qualification host failed syntax parsing.' }
$argumentHelper = @($tree.FindAll({ param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'New-DesktopStandardLaunchArguments'
}, $true))
if ($argumentHelper.Count -ne 1) { throw 'Expected one bounded credential-launch argument builder.' }
. ([scriptblock]::Create($argumentHelper[0].Extent.Text))
$launcherArguments = @(New-DesktopStandardLaunchArguments -Shell 'C:\Program Files\PowerShell\7\pwsh.exe' -ChildScript 'D:\private test\child.ps1')
if (($launcherArguments -join ' ') -ne '-NoLogo -NoProfile -NonInteractive -File "D:\private test\child.ps1"') {
  throw 'Credential launch must use a short quoted File argument, not encode the script or settings.'
}
$limitRejected = $false
try { $null = New-DesktopStandardLaunchArguments -Shell 'pwsh.exe' -ChildScript ('C:\' + ('a' * 1050) + '\child.ps1') } catch {
  if ($_.Exception.Message -notmatch 'CreateProcessWithLogonW command-line limit') { throw }
  $limitRejected = $true
}
if (-not $limitRejected) { throw 'Credential launcher accepted a command exceeding the documented 1024 character limit.' }
$childAssignments = @($tree.FindAll({ param($node)
  $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -eq '$command'
}, $true))
if ($childAssignments.Count -ne 1) { throw 'Expected one private child script.' }
. ([scriptblock]::Create($childAssignments[0].Extent.Text))
$childTokens = $null
$childErrors = $null
$null = [Management.Automation.Language.Parser]::ParseInput($command, [ref]$childTokens, [ref]$childErrors)
if ($childErrors.Count -ne 0 -or -not $command.Contains("Join-Path `$PSScriptRoot 'settings.json'")) {
  throw 'Private child must parse and load settings from its private directory.'
}
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

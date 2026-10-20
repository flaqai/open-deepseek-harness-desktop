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
$childTree = [Management.Automation.Language.Parser]::ParseInput($command, [ref]$childTokens, [ref]$childErrors)
if ($childErrors.Count -ne 0 -or -not $command.Contains("Join-Path `$PSScriptRoot 'settings.json'")) {
  throw 'Private child must parse and load settings from its private directory.'
}
$profileHelpers = @($childTree.FindAll({ param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -in @('Get-DesktopStandardProfileDirectory', 'Get-DesktopStandardKnownFolder', 'Initialize-DesktopStandardKnownFolders')
}, $true))
if ($profileHelpers.Count -ne 3) { throw 'Expected token-profile lookup and known-folder initialization in the child.' }
foreach ($helper in $profileHelpers) { . ([scriptblock]::Create($helper.Extent.Text)) }
$knownFolderCalls = @($profileHelpers[1].FindAll({ param($node)
  $node -is [Management.Automation.Language.InvokeMemberExpressionAst] -and $node.Member.Extent.Text -eq 'GetFolderPath'
}, $true))
if ($knownFolderCalls.Count -ne 1 -or $knownFolderCalls[0].Arguments[1].Extent.Text -ne '[Environment+SpecialFolderOption]::Create') {
  throw 'New-user known folders must use the native Create option, not existence-only lookup.'
}
$profileTestRoot = Join-Path ([IO.Path]::GetTempPath()) ('dsh-profile-' + [Guid]::NewGuid().ToString('N'))
$script:profileDirectory = Join-Path $profileTestRoot 'new-user'
[void][IO.Directory]::CreateDirectory($script:profileDirectory)
$profileEnvironment = @{}
foreach ($name in @('USERPROFILE', 'HOME', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA')) {
  $profileEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
try {
  $script:profileHiveLoaded = $true
  $script:knownFolderBehavior = 'create'
  function Get-ItemProperty {
    param([string] $LiteralPath, [string] $Name, [string] $ErrorAction)
    if ($LiteralPath -ne 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\S-1-5-21-synthetic' -or $Name -ne 'ProfileImagePath') {
      throw 'Profile lookup must use the actual token SID, not a user name or administrator environment.'
    }
    return [pscustomobject]@{ ProfileImagePath = $script:profileDirectory }
  }
  function Test-Path {
    param([string] $LiteralPath, [string] $PathType)
    if ($LiteralPath -eq 'Registry::HKEY_USERS\S-1-5-21-synthetic') { return $script:profileHiveLoaded }
    $parameters = @{ LiteralPath = $LiteralPath }
    if ($PathType) { $parameters.PathType = $PathType }
    return Microsoft.PowerShell.Management\Test-Path @parameters
  }
  function Get-DesktopStandardKnownFolder {
    param([Environment+SpecialFolder] $Folder)
    if ($env:USERPROFILE -ne $script:profileDirectory) { throw 'Known-folder lookup must follow restoration of the verified token profile.' }
    if ($script:knownFolderBehavior -eq 'empty') { return '' }
    if ($script:knownFolderBehavior -eq 'escape') { return $profileTestRoot }
    $suffix = if ($Folder -eq 'ApplicationData') { 'Roaming' } else { 'Local' }
    return [IO.Directory]::CreateDirectory((Join-Path $script:profileDirectory "AppData/$suffix")).FullName
  }
  $verifiedProfile = Get-DesktopStandardProfileDirectory -Sid 'S-1-5-21-synthetic'
  foreach ($name in $profileEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
  Initialize-DesktopStandardKnownFolders -ProfileDirectory $verifiedProfile
  if ($env:USERPROFILE -ne $script:profileDirectory -or
      -not (Microsoft.PowerShell.Management\Test-Path -LiteralPath $env:APPDATA -PathType Container) -or
      -not (Microsoft.PowerShell.Management\Test-Path -LiteralPath $env:LOCALAPPDATA -PathType Container)) {
    throw 'Fresh-user profile initialization did not create both known directories after environment clearing.'
  }
  foreach ($behavior in @('empty', 'escape')) {
    $script:knownFolderBehavior = $behavior
    $rejected = $false
    try { Initialize-DesktopStandardKnownFolders -ProfileDirectory $verifiedProfile } catch {
      if ($_.Exception.Message -notmatch 'inside its SID profile') { throw }
      $rejected = $true
    }
    if (-not $rejected) { throw 'Unknown or administrator known-folder paths must be rejected.' }
  }
  $script:profileHiveLoaded = $false
  $rejected = $false
  try { $null = Get-DesktopStandardProfileDirectory -Sid 'S-1-5-21-synthetic' } catch {
    if ($_.Exception.Message -notmatch 'SID profile hive was not loaded') { throw }
    $rejected = $true
  }
  if (-not $rejected) { throw 'An unloaded token profile must not be manufactured from parent environment values.' }
} finally {
  foreach ($name in $profileEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $profileEnvironment[$name], 'Process') }
  Remove-Item Function:\Get-ItemProperty, Function:\Test-Path, Function:\Get-DesktopStandardKnownFolder
  Remove-Item -LiteralPath $profileTestRoot -Recurse -Force
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
$exportHelper = @($tree.FindAll({ param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Export-NativeQualificationRecords'
}, $true))
. ([scriptblock]::Create($exportHelper[0].Extent.Text))
$exportRoot = Join-Path ([IO.Path]::GetTempPath()) ('dsh-export-' + [Guid]::NewGuid().ToString('N'))
try {
  [void][IO.Directory]::CreateDirectory((Join-Path $exportRoot 'desktop-smoke-owned'))
  [IO.File]::WriteAllText((Join-Path $exportRoot 'desktop-smoke-owned/main-installer-diagnostics.json'), '{"schema":"open-dsh/main-installer-diagnostics/v1"}')
  [IO.File]::WriteAllText((Join-Path $exportRoot 'desktop-smoke-owned/installer.log'), 'private raw content')
  & { param($repository, $Root) Export-NativeQualificationRecords -Root $Root } $exportRoot $exportRoot
  $exported = @(Get-ChildItem -LiteralPath (Join-Path $exportRoot '.artifacts/windows-smoke-evidence/native-qualification') -File)
  if ($exported.Count -ne 1 -or $exported[0].Name -ne 'main-installer-diagnostics.json') { throw 'Only the bounded structured main-installer report may be exported, not raw logs.' }
} finally { Remove-Item -LiteralPath $exportRoot -Recurse -Force }
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

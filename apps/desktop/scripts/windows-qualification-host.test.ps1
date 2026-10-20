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
$profileOnlyGate = @($childTree.FindAll({ param($node)
  $node -is [Management.Automation.Language.IfStatementAst] -and $node.Clauses[0].Item1.Extent.Text -eq '$settings.profileOnly'
}, $true))
if ($profileOnlyGate.Count -ne 1 -or $profileOnlyGate[0].Clauses[0].Item2.Statements.Count -ne 1 -or
    $profileOnlyGate[0].Clauses[0].Item2.Statements[0].Extent.Text -ne 'exit 0' -or
    $profileOnlyGate[0].Extent.StartOffset -lt $command.IndexOf('Initialize-DesktopStandardKnownFolders -ProfileDirectory $profileDirectory') -or
    $profileOnlyGate[0].Extent.StartOffset -gt $command.IndexOf('& $settings.node $settings.entry package windows-x64')) {
  throw 'Profile-only mode must exit after all real identity/environment/folder checks and before product smoke.'
}
$profileHelpers = @($childTree.FindAll({ param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -in @('Get-DesktopStandardProfileDirectory', 'Get-DesktopStandardKnownFolder', 'Initialize-DesktopStandardKnownFolders', 'Initialize-DesktopStandardInterop', 'Open-DesktopStandardIdentity', 'ConvertFrom-DesktopNativeEnvironment', 'Get-DesktopStandardEnvironment', 'Set-DesktopStandardChildEnvironment', 'Get-DesktopProfilePathStatus', 'Get-DesktopLocalProfileDiagnostics')
}, $true))
if ($profileHelpers.Count -ne 10) { throw 'Expected token-profile lookup, native environment, known-folder initialization and closed diagnostics in the child.' }
foreach ($helper in $profileHelpers) { . ([scriptblock]::Create($helper.Extent.Text)) }
$knownFolderHelper = @($profileHelpers | Where-Object { $_.Name -eq 'Get-DesktopStandardKnownFolder' })[0]
$knownFolderCalls = @($knownFolderHelper.FindAll({ param($node)
  $node -is [Management.Automation.Language.InvokeMemberExpressionAst] -and $node.Member.Extent.Text -eq 'SHGetKnownFolderPath'
}, $true))
if ($knownFolderCalls.Count -ne 1 -or $knownFolderCalls[0].Arguments[1].Extent.Text -ne '$Flags' -or
    $knownFolderCalls[0].Arguments[2].Extent.Text -ne '$token' -or
    @($knownFolderHelper.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq 'Flags' })[0].DefaultValue.Extent.Text -ne '0x8000' -or
    -not $knownFolderHelper.Extent.Text.Contains('$token = if ($UseProcessUser) { [IntPtr]::Zero } else { $identity.AccessToken.DangerousGetHandle() }')) {
  throw 'Known folders must use KF_FLAG_CREATE and the explicit current-user token without an environment fallback.'
}
$interopHelper = @($profileHelpers | Where-Object { $_.Name -eq 'Initialize-DesktopStandardInterop' })[0]
$interopDeclaration = @($interopHelper.FindAll({ param($node)
  $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Add-Type'
}, $true))
& ([scriptblock]::Create($interopDeclaration[0].Extent.Text))
if ([DshQualificationKnownFolders].GetMethod('SHGetKnownFolderPath').GetParameters()[2].ParameterType -ne [IntPtr]) { throw 'Known-folder native token must retain its pointer-sized type.' }
$script:explicitIdentityOpened = $false
function Open-DesktopStandardIdentity {
  $script:explicitIdentityOpened = $true
  throw [UnauthorizedAccessException]::new('Synthetic token acquisition denial.')
}
try {
  $nullTokenProbe = Get-DesktopStandardKnownFolder -Folder LocalApplicationData -Flags 0x4000 -UseProcessUser
  if ($script:explicitIdentityOpened -or $nullTokenProbe.FailurePhase -eq 'open-token') { throw 'NULL current-user diagnostics must not acquire an explicit identity first.' }
  $explicitTokenProbe = Get-DesktopStandardKnownFolder -Folder LocalApplicationData -Flags 0x4000
  if (-not $script:explicitIdentityOpened -or $explicitTokenProbe.FailurePhase -ne 'open-token' -or $explicitTokenProbe.ExceptionKind -ne 'access-denied') { throw 'Token acquisition denial must remain distinct from a native API HRESULT.' }
} finally {
  $identityHelper = @($profileHelpers | Where-Object { $_.Name -eq 'Open-DesktopStandardIdentity' })[0]
  . ([scriptblock]::Create($identityHelper.Extent.Text))
}
$nativeEnvironmentHelper = @($profileHelpers | Where-Object { $_.Name -eq 'Get-DesktopStandardEnvironment' })[0]
$nativeEnvironmentCall = @($nativeEnvironmentHelper.FindAll({ param($node)
  $node -is [Management.Automation.Language.InvokeMemberExpressionAst] -and $node.Member.Extent.Text -eq 'CreateEnvironmentBlock'
}, $true))
if ($nativeEnvironmentCall.Count -ne 1 -or $nativeEnvironmentCall[0].Arguments[2].Extent.Text -ne '$false') { throw 'Native environment must not inherit the administrator parent environment.' }
$block = [Runtime.InteropServices.Marshal]::StringToHGlobalUni("SystemDrive=X:`0USERPROFILE=X:\Users\synthetic`0USERNAME=synthetic`0=C:=hidden-drive-entry`0NATIVE_USER_SETTING=restored`0`0")
$nativeFixture = $null
try { $nativeFixture = ConvertFrom-DesktopNativeEnvironment -Block $block } finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($block) }
if ($nativeFixture.SystemDrive -ne 'X:' -or $nativeFixture.NATIVE_USER_SETTING -ne 'restored' -or $nativeFixture.ContainsKey('=C:')) { throw 'Native environment parsing must retain user/system settings without invalid drive-entry keys.' }
$processEnvironment = [Environment]::GetEnvironmentVariables('Process')
try {
  [Environment]::SetEnvironmentVariable('QUALIFICATION_PARENT_ADMIN_SECRET', 'must-not-inherit', 'Process')
  Set-DesktopStandardChildEnvironment -NativeEnvironment $nativeFixture -Overrides ([pscustomobject]@{ RUNNER_TEMP = 'private-ci-root'; TEMP = 'private-ci-root' })
  if ($env:SystemDrive -ne 'X:') { throw 'Child environment lost its native SystemDrive setting.' }
  if ($env:NATIVE_USER_SETTING -ne 'restored') { throw 'Child environment lost its native user settings.' }
  if ($env:USERPROFILE -ne 'X:\Users\synthetic') { throw 'Child environment lost its native user profile.' }
  if ($env:TEMP -ne 'private-ci-root') { throw 'Child environment lost its private CI overrides.' }
  if ([Environment]::GetEnvironmentVariable('QUALIFICATION_PARENT_ADMIN_SECRET', 'Process') -ne $null) { throw 'Child environment retained parent-only credentials.' }
} finally {
  foreach ($name in @([Environment]::GetEnvironmentVariables('Process').Keys)) { [Environment]::SetEnvironmentVariable($name, [System.Management.Automation.Language.NullString]::Value, 'Process') }
  foreach ($name in $processEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $processEnvironment[$name], 'Process') }
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
  $script:readOnlyFolderCalls = [Collections.Generic.List[object]]::new()
  $script:outsideProfileProbed = $false
  function Get-ItemProperty {
    param([string] $LiteralPath, [string] $Name, [string] $ErrorAction)
    if ($LiteralPath -eq 'Registry::HKEY_USERS\S-1-5-21-synthetic\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders' -and $Name -eq 'Local AppData') {
      return [pscustomobject]@{ 'Local AppData' = (Join-Path $script:profileDirectory 'AppData/Local') }
    }
    if ($LiteralPath -ne 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\S-1-5-21-synthetic' -or $Name -ne 'ProfileImagePath') {
      throw 'Profile lookup must use the actual token SID, not a user name or administrator environment.'
    }
    return [pscustomobject]@{ ProfileImagePath = $script:profileDirectory }
  }
  function Test-Path {
    param([string] $LiteralPath, [string] $PathType)
    if ($LiteralPath -eq 'Registry::HKEY_USERS\S-1-5-21-synthetic') { return $script:profileHiveLoaded }
    if ($LiteralPath -eq (Join-Path $profileTestRoot 'administrator/Local')) {
      $script:outsideProfileProbed = $true
      throw [UnauthorizedAccessException]::new('No outside-profile filesystem probe is allowed.')
    }
    $parameters = @{ LiteralPath = $LiteralPath }
    if ($PathType) { $parameters.PathType = $PathType }
    return Microsoft.PowerShell.Management\Test-Path @parameters
  }
  function Get-DesktopStandardKnownFolder {
    param([Environment+SpecialFolder] $Folder, [uint32] $Flags = 0x8000, [switch] $UseProcessUser)
    if ($env:USERPROFILE -ne $script:profileDirectory) { throw 'Known-folder lookup must follow restoration of the verified token profile.' }
    if ($Flags -eq 0x4000) {
      $script:readOnlyFolderCalls.Add([pscustomobject]@{ Flags = $Flags; UseProcessUser = [bool]$UseProcessUser })
      if ($script:knownFolderBehavior -eq 'local-api-failed' -and -not $UseProcessUser) { return [pscustomobject]@{ Path = ''; HResult = -2147024891; FailurePhase = 'native-result'; ExceptionKind = 'none' } }
      return [pscustomobject]@{ Path = (Join-Path $script:profileDirectory 'AppData/Local'); HResult = 0; FailurePhase = 'none'; ExceptionKind = 'none' }
    }
    if ($script:knownFolderBehavior -eq 'empty') { return [pscustomobject]@{ Path = ''; HResult = 0 } }
    if ($script:knownFolderBehavior -eq 'escape') { return [pscustomobject]@{ Path = (Join-Path $profileTestRoot 'administrator/Local'); HResult = 0 } }
    if ($script:knownFolderBehavior -eq 'local-api-failed' -and $Folder -eq 'LocalApplicationData') { return [pscustomobject]@{ Path = ''; HResult = -2147024891; FailurePhase = 'native-result'; ExceptionKind = 'none' } }
    if ($script:knownFolderBehavior -eq 'local-missing' -and $Folder -eq 'LocalApplicationData') { return [pscustomobject]@{ Path = (Join-Path $script:profileDirectory 'AppData/MissingLocal'); HResult = 0 } }
    $suffix = if ($Folder -eq 'ApplicationData') { 'Roaming' } else { 'Local' }
    return [pscustomobject]@{ Path = [IO.Directory]::CreateDirectory((Join-Path $script:profileDirectory "AppData/$suffix")).FullName; HResult = 0 }
  }
  function Get-Acl {
    param([string] $LiteralPath, [string] $ErrorAction)
    if ($LiteralPath -ne (Join-Path $script:profileDirectory 'AppData/Local')) { throw 'ACL inspection must remain inside the verified profile.' }
    $acl = [pscustomobject]@{}
    $acl | Add-Member ScriptMethod GetOwner { param($Type) return [pscustomobject]@{ Value = 'S-1-5-21-synthetic' } }
    return $acl
  }
  $verifiedProfile = Get-DesktopStandardProfileDirectory -Sid 'S-1-5-21-synthetic'
  foreach ($name in $profileEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, [System.Management.Automation.Language.NullString]::Value, 'Process') }
  $nativeUserEnvironment = @{ LOCALAPPDATA = (Join-Path $script:profileDirectory 'AppData/Local') }
  Initialize-DesktopStandardKnownFolders -ProfileDirectory $verifiedProfile -DiagnosticDirectory $profileTestRoot -Sid 'S-1-5-21-synthetic' -NativeEnvironment $nativeUserEnvironment
  if ($env:USERPROFILE -ne $script:profileDirectory -or
      -not (Microsoft.PowerShell.Management\Test-Path -LiteralPath $env:APPDATA -PathType Container) -or
      -not (Microsoft.PowerShell.Management\Test-Path -LiteralPath $env:LOCALAPPDATA -PathType Container)) {
    throw 'Fresh-user profile initialization did not create both known directories after environment clearing.'
  }
  foreach ($behavior in @('empty', 'escape', 'local-api-failed', 'local-missing')) {
    $script:knownFolderBehavior = $behavior
    $rejected = $false
    try { Initialize-DesktopStandardKnownFolders -ProfileDirectory $verifiedProfile -DiagnosticDirectory $profileTestRoot -Sid 'S-1-5-21-synthetic' -NativeEnvironment $nativeUserEnvironment } catch {
      if ($_.Exception.Message -notmatch 'known folder validation failed:') { throw }
      if ($_.Exception.Message.Contains($profileTestRoot)) { throw 'Known-folder failure must not publish full profile paths.' }
      $rejected = $true
    }
    if (-not $rejected) { throw 'Unknown or administrator known-folder paths must be rejected.' }
    $diagnosticText = Get-Content -LiteralPath (Join-Path $profileTestRoot 'qualification-profile.json') -Raw
    if ($diagnosticText.Contains($profileTestRoot)) { throw 'Closed folder diagnostics must not expose full native or registry paths.' }
    $diagnostic = $diagnosticText | ConvertFrom-Json
    $lastCheck = $diagnostic.folders[-1]
    if ($behavior -eq 'empty' -and -not $lastCheck.pathEmpty) { throw 'Empty result must remain distinct in closed diagnostics.' }
    if ($behavior -eq 'escape' -and (-not $lastCheck.underOtherProfile -or $script:outsideProfileProbed -or $null -ne $lastCheck.exists)) { throw 'Wrong-user result must remain distinct without touching its inaccessible filesystem path.' }
    if ($behavior -eq 'local-api-failed') {
      if ($lastCheck.hResult -ne -2147024891 -or $lastCheck.folder -ne 'LocalApplicationData' -or $diagnostic.folders.Count -ne 2) { throw 'Local API failure must retain its HRESULT after Roaming succeeded.' }
      if (-not $diagnostic.localDiagnostics.registryLocalAppData.isWithinProfile -or -not $diagnostic.localDiagnostics.nativeLocalAppData.isWithinProfile -or
          $diagnostic.localDiagnostics.explicitReadOnly.hResult -ne -2147024891 -or $diagnostic.localDiagnostics.explicitReadOnly.failurePhase -ne 'native-result' -or $diagnostic.localDiagnostics.currentReadOnly.hResult -ne 0 -or
          -not $diagnostic.localDiagnostics.directoryAccess.ownerSidMatch -or -not $diagnostic.localDiagnostics.directoryAccess.ordinaryDirectory -or -not $diagnostic.localDiagnostics.directoryAccess.traversalReadable) { throw 'Local diagnostics must distinguish authoritative paths and ACL facts from explicit-token API denial.' }
    }
    if ($behavior -eq 'local-missing' -and ($lastCheck.pathEmpty -or -not $lastCheck.isWithinProfile -or $lastCheck.exists)) { throw 'Uncreated local directory must remain distinct from an empty or wrong-user result.' }
  }
  if ($script:readOnlyFolderCalls.Count -ne 4 -or @($script:readOnlyFolderCalls | Where-Object { $_.Flags -ne 0x4000 }).Count -ne 0) { throw 'Additional native diagnostics must be read-only, never create or redirect directories.' }
  $script:profileHiveLoaded = $false
  $rejected = $false
  try { $null = Get-DesktopStandardProfileDirectory -Sid 'S-1-5-21-synthetic' } catch {
    if ($_.Exception.Message -notmatch 'SID profile hive was not loaded') { throw }
    $rejected = $true
  }
  if (-not $rejected) { throw 'An unloaded token profile must not be manufactured from parent environment values.' }
} finally {
  foreach ($name in $profileEnvironment.Keys) {
    $value = if ($null -eq $profileEnvironment[$name]) { [System.Management.Automation.Language.NullString]::Value } else { $profileEnvironment[$name] }
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
  }
  Remove-Item Function:\Get-ItemProperty, Function:\Test-Path, Function:\Get-DesktopStandardKnownFolder, Function:\Get-Acl
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
  [IO.File]::WriteAllText((Join-Path $exportRoot 'desktop-smoke-owned/qualification-profile.json'), '{"schema":"open-dsh/standard-profile/v1","folders":[]}')
  [IO.File]::WriteAllText((Join-Path $exportRoot 'desktop-smoke-owned/installer.log'), 'private raw content')
  & { param($repository, $Root) Export-NativeQualificationRecords -Root $Root } $exportRoot $exportRoot
  $exported = @(Get-ChildItem -LiteralPath (Join-Path $exportRoot '.artifacts/windows-smoke-evidence/native-qualification') -File)
  if ($exported.Count -ne 2 -or @($exported | Where-Object { $_.Name -notin @('main-installer-diagnostics.json', 'qualification-profile.json') }).Count -ne 0) { throw 'Only the bounded structured main-installer and profile reports may be exported, not raw logs.' }
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

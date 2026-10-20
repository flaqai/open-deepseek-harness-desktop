[CmdletBinding()]
param([Parameter(Mandatory)] [ValidateSet('standard', 'administrator')] [string] $Privilege)

$ErrorActionPreference = 'Stop'
if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
  throw 'Account-changing qualification is restricted to disposable GitHub-hosted native Windows runners.'
}
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
$isAdministrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdministrator) { throw 'Qualification supervisor requires an already elevated disposable runner.' }
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$node = (Get-Command node -ErrorAction Stop).Source
$shell = (Get-Process -Id $PID).Path
$entry = Join-Path $PSScriptRoot 'desktop-smoke.mjs'
function New-DesktopStandardLaunchArguments {
  param([string] $Shell, [string] $ChildScript)
  if ($Shell -match '["\r\n]' -or $ChildScript -match '["\r\n]') { throw 'Invalid qualification launcher path.' }
  $arguments = @('-NoLogo', '-NoProfile', '-NonInteractive', '-File', ('"' + $ChildScript + '"'))
  # CreateProcessWithLogonW permits only 1024 command-line characters.
  # https://learn.microsoft.com/windows/win32/api/winbase/nf-winbase-createprocesswithlogonw
  if ((('"' + $Shell + '" ' + ($arguments -join ' ')).Length + 1) -gt 1024) {
    throw 'Qualification launcher exceeds the CreateProcessWithLogonW command-line limit.'
  }
  return $arguments
}
function Export-NativeQualificationRecords {
  param([string] $Root)
  $destination = Join-Path $repository '.artifacts/windows-smoke-evidence/native-qualification'
  New-Item -ItemType Directory -Path $destination -Force | Out-Null
  $recordRoots = @($Root)
  if (Test-Path -LiteralPath $Root) {
    $recordRoots += @(Get-ChildItem -LiteralPath $Root -Directory -Filter 'desktop-smoke-*' | ForEach-Object { $_.FullName })
  }
  foreach ($recordRoot in $recordRoots) {
    foreach ($record in @(Get-ChildItem -LiteralPath $recordRoot -File -ErrorAction SilentlyContinue | Where-Object {
      $_.Name -in @('qualification-token.json', 'qualification-profile.json', 'previous-release.json', 'persistent-lock-upgrade.jsonl', 'main-installer-diagnostics.json') -or $_.Name -match '^installer-gui-\d+\.jsonl?$'
    })) {
      if ($record.Length -gt 8388608) { throw 'Native qualification evidence exceeded 8 MiB.' }
      Copy-Item -LiteralPath $record.FullName -Destination (Join-Path $destination $record.Name) -Force
    }
  }
}
if ($Privilege -eq 'administrator') {
  [ordered]@{ schema = 'open-dsh/windows-token/v1'; requested = $Privilege; administrator = $isAdministrator; identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $env:RUNNER_TEMP 'qualification-token.json') -Encoding utf8
  try {
    & $node $entry package windows-x64
    $qualificationExit = $LASTEXITCODE
  } finally { Export-NativeQualificationRecords -Root $env:RUNNER_TEMP }
  exit $qualificationExit
}

$account = 'dshq' + [Guid]::NewGuid().ToString('N').Substring(0, 12)
$ownedRoot = Join-Path $env:RUNNER_TEMP ('standard-user-' + [Guid]::NewGuid().ToString('N'))
$created = $false
$child = $null
$passwordBytes = [byte[]]::new(32)
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($passwordBytes)
$password = ConvertTo-SecureString ('Dsh!9' + [Convert]::ToBase64String($passwordBytes)) -AsPlainText -Force
[Array]::Clear($passwordBytes, 0, $passwordBytes.Length)
try {
  New-Item -ItemType Directory -Path $ownedRoot -ErrorAction Stop | Out-Null
  $user = New-LocalUser -Name $account -Password $password -AccountNeverExpires -PasswordNeverExpires -Description 'Disposable package qualification only'
  $created = $true
  Add-LocalGroupMember -SID 'S-1-5-32-545' -Member $user
  # Only the newly allocated private evidence directory receives Modify permission.
  $acl = Get-Acl -LiteralPath $ownedRoot
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($ownerSid in @([Security.Principal.WindowsIdentity]::GetCurrent().User, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'), [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))) {
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($ownerSid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
  }
  $acl.SetAccessRule([Security.AccessControl.FileSystemAccessRule]::new($user.SID, 'Modify', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
  Set-Acl -LiteralPath $ownedRoot -AclObject $acl
  foreach ($relative in @('.artifacts/desktop-smoke', '.artifacts/windows-smoke-evidence')) {
    $destination = Join-Path $repository $relative
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    $destinationAcl = Get-Acl -LiteralPath $destination
    $destinationAcl.SetAccessRule([Security.AccessControl.FileSystemAccessRule]::new($user.SID, 'Modify', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
    Set-Acl -LiteralPath $destination -AclObject $destinationAcl
  }
  $settings = [ordered]@{}
  foreach ($name in @('PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'PSModulePath', 'ProgramFiles', 'ProgramFiles(x86)', 'GITHUB_ACTIONS', 'RUNNER_ENVIRONMENT', 'DSH_WINDOWS_INSTALLATION_MODE', 'DSH_WINDOWS_CHANGE_DIRECTORY', 'DSH_WINDOWS_INTERACTIVE', 'DSH_WINDOWS_GUI_AUTOMATION')) {
    $settings[$name] = [Environment]::GetEnvironmentVariable($name)
  }
  $settings.RUNNER_TEMP = $ownedRoot
  $settings.TEMP = $ownedRoot
  $settings.TMP = $ownedRoot
  if (-not [string]::IsNullOrWhiteSpace($env:DSH_WINDOWS_PREVIOUS_INSTALLER)) {
    $baseline = Join-Path $ownedRoot 'previous-installer.exe'
    Copy-Item -LiteralPath $env:DSH_WINDOWS_PREVIOUS_INSTALLER -Destination $baseline -ErrorAction Stop
    $settings.DSH_WINDOWS_PREVIOUS_INSTALLER = $baseline
  }
  $settings.GIT_CONFIG_COUNT = '1'
  $settings.GIT_CONFIG_KEY_0 = 'safe.directory'
  $settings.GIT_CONFIG_VALUE_0 = $repository
  $settingsPath = Join-Path $ownedRoot 'settings.json'
  [IO.File]::WriteAllText($settingsPath, ([ordered]@{ environment = $settings; node = $node; entry = $entry; userSid = $user.SID.Value } | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
  $childScript = Join-Path $ownedRoot 'child.ps1'
  $command = @'
$ErrorActionPreference = 'Stop'
function Get-DesktopStandardProfileDirectory([string] $Sid) {
  if (-not (Test-Path -LiteralPath "Registry::HKEY_USERS\$Sid")) { throw 'Standard-user SID profile hive was not loaded.' }
  $profileKey = "Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$Sid"
  $profile = [Environment]::ExpandEnvironmentVariables((Get-ItemProperty -LiteralPath $profileKey -Name ProfileImagePath -ErrorAction Stop).ProfileImagePath)
  if ([string]::IsNullOrWhiteSpace($profile) -or -not [IO.Path]::IsPathFullyQualified($profile)) { throw 'Standard-user SID has no absolute registered profile.' }
  $item = Get-Item -LiteralPath $profile -Force -ErrorAction Stop
  if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Standard-user SID profile is not an ordinary directory.' }
  return $item.FullName
}
function Initialize-DesktopStandardInterop {
  if (-not ('DshQualificationKnownFolders' -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class DshQualificationKnownFolders {
  [DllImport("shell32.dll", ExactSpelling = true)]
  public static extern int SHGetKnownFolderPath(ref Guid folder, uint flags, IntPtr token, out IntPtr path);
  [DllImport("userenv.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool CreateEnvironmentBlock(out IntPtr environment, IntPtr token, [MarshalAs(UnmanagedType.Bool)] bool inherit);
  [DllImport("userenv.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool DestroyEnvironmentBlock(IntPtr environment);
}
"@
  }
}
function Open-DesktopStandardIdentity {
  $access = [Security.Principal.TokenAccessLevels]([Security.Principal.TokenAccessLevels]::Query -bor [Security.Principal.TokenAccessLevels]::Duplicate -bor [Security.Principal.TokenAccessLevels]::Impersonate)
  return [Security.Principal.WindowsIdentity]::GetCurrent($access)
}
function ConvertFrom-DesktopNativeEnvironment([IntPtr] $Block) {
  $environment = @{}
  $offset = 0
  while ($offset -lt 1048576) {
    $item = [Runtime.InteropServices.Marshal]::PtrToStringUni([IntPtr]::Add($Block, $offset))
    if ([string]::IsNullOrEmpty($item)) { return $environment }
    $offset += ($item.Length + 1) * 2
    $separator = $item.IndexOf('=', 1)
    # Win32 drive-directory entries start with '=' and cannot be set by .NET.
    if ($separator -gt 0 -and -not $item.StartsWith('=')) { $environment[$item.Substring(0, $separator)] = $item.Substring($separator + 1) }
  }
  throw 'Native standard-user environment exceeded its bounded size.'
}
function Get-DesktopStandardEnvironment {
  Initialize-DesktopStandardInterop
  $identity = Open-DesktopStandardIdentity
  $block = [IntPtr]::Zero
  try {
    if (-not [DshQualificationKnownFolders]::CreateEnvironmentBlock([ref]$block, $identity.AccessToken.DangerousGetHandle(), $false)) {
      throw "Native standard-user environment creation failed (win32Error=$([Runtime.InteropServices.Marshal]::GetLastWin32Error()))."
    }
    return ConvertFrom-DesktopNativeEnvironment -Block $block
  } finally {
    try {
      if ($block -ne [IntPtr]::Zero -and -not [DshQualificationKnownFolders]::DestroyEnvironmentBlock($block)) { throw 'Native standard-user environment could not be released.' }
    } finally { $identity.Dispose() }
  }
}
function Set-DesktopStandardChildEnvironment([hashtable] $NativeEnvironment, [object] $Overrides) {
  foreach ($name in @([Environment]::GetEnvironmentVariables('Process').Keys)) { [Environment]::SetEnvironmentVariable($name, [System.Management.Automation.Language.NullString]::Value, 'Process') }
  foreach ($name in $NativeEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $NativeEnvironment[$name], 'Process') }
  foreach ($property in $Overrides.PSObject.Properties) {
    $value = if ($null -eq $property.Value) { [System.Management.Automation.Language.NullString]::Value } else { $property.Value }
    [Environment]::SetEnvironmentVariable($property.Name, $value, 'Process')
  }
}
function Get-DesktopStandardKnownFolder([Environment+SpecialFolder] $Folder) {
  # Preserve the native HRESULT; .NET substitutes a cleared environment on failure.
  Initialize-DesktopStandardInterop
  $folderId = switch ($Folder) {
    'ApplicationData' { [Guid]'3EB685DB-65F9-4CF6-A03A-E3EF65729F3D' }
    'LocalApplicationData' { [Guid]'F1B32785-6FBA-4FCF-9D55-7B8E7F157091' }
    default { throw 'Only per-user application data known folders are supported.' }
  }
  $identity = Open-DesktopStandardIdentity
  $pointer = [IntPtr]::Zero
  try {
    $result = [DshQualificationKnownFolders]::SHGetKnownFolderPath([ref]$folderId, 0x8000, $identity.AccessToken.DangerousGetHandle(), [ref]$pointer)
    $directory = if ($result -ne 0 -or $pointer -eq [IntPtr]::Zero) { '' } else { [Runtime.InteropServices.Marshal]::PtrToStringUni($pointer) }
    return [pscustomobject]@{ Path = $directory; HResult = $result }
  } finally {
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeCoTaskMem($pointer) }
    $identity.Dispose()
  }
}
function Initialize-DesktopStandardKnownFolders([string] $ProfileDirectory, [string] $DiagnosticDirectory) {
  $env:USERPROFILE = $ProfileDirectory
  $env:HOME = $ProfileDirectory
  $env:HOMEDRIVE = [IO.Path]::GetPathRoot($ProfileDirectory).TrimEnd('\')
  $env:HOMEPATH = $ProfileDirectory.Substring($env:HOMEDRIVE.Length)
  $prefix = $ProfileDirectory.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
  $profilesPrefix = [IO.Directory]::GetParent($ProfileDirectory).FullName.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
  $checks = @()
  foreach ($folder in @('ApplicationData', 'LocalApplicationData')) {
    try { $resolved = Get-DesktopStandardKnownFolder -Folder $folder } catch { $resolved = [pscustomobject]@{ Path = ''; HResult = $_.Exception.HResult } }
    $directory = $resolved.Path
    $absolute = -not [string]::IsNullOrWhiteSpace($directory) -and [IO.Path]::IsPathFullyQualified($directory)
    $withinProfile = $absolute -and $directory.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
    $exists = $absolute -and (Test-Path -LiteralPath $directory -PathType Container)
    $check = [ordered]@{ folder = $folder; hResult = $resolved.HResult; pathEmpty = [string]::IsNullOrWhiteSpace($directory); isAbsolute = $absolute; isWithinProfile = $withinProfile; exists = $exists; underOtherProfile = $absolute -and -not $withinProfile -and $directory.StartsWith($profilesPrefix, [StringComparison]::OrdinalIgnoreCase) }
    $checks += $check
    [ordered]@{ schema = 'open-dsh/standard-profile/v1'; folders = $checks } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $DiagnosticDirectory 'qualification-profile.json') -Encoding utf8
    if ($resolved.HResult -ne 0 -or -not $withinProfile -or -not $exists) { throw ('Standard-user known folder validation failed: ' + ($check | ConvertTo-Json -Compress)) }
    if ($folder -eq 'ApplicationData') { $env:APPDATA = $directory } else { $env:LOCALAPPDATA = $directory }
  }
}
$settings = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'settings.json') -Raw | ConvertFrom-Json
$env:TEMP = $PSScriptRoot
$env:TMP = $PSScriptRoot
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if ($identity.User.Value -ne $settings.userSid) { throw 'Standard-user token does not match the allocated qualification account.' }
$token = [Security.Principal.WindowsPrincipal]::new($identity)
$admin = $token.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($admin) { throw 'Standard-user qualification unexpectedly received administrator rights.' }
$profileDirectory = Get-DesktopStandardProfileDirectory -Sid $identity.User.Value
$nativeEnvironment = Get-DesktopStandardEnvironment
if (-not [string]::Equals($nativeEnvironment.USERPROFILE, $profileDirectory, [StringComparison]::OrdinalIgnoreCase)) { throw 'Native environment does not belong to the verified standard-user SID profile.' }
Set-DesktopStandardChildEnvironment -NativeEnvironment $nativeEnvironment -Overrides $settings.environment
Initialize-DesktopStandardKnownFolders -ProfileDirectory $profileDirectory -DiagnosticDirectory $PSScriptRoot
$identityParts = [Security.Principal.WindowsIdentity]::GetCurrent().Name.Split('\')
$env:USERDOMAIN = $identityParts[0]
$env:USERNAME = $identityParts[-1]
$env:COMPUTERNAME = [Environment]::MachineName
[ordered]@{ schema = 'open-dsh/windows-token/v1'; requested = 'standard'; administrator = $admin; identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'qualification-token.json') -Encoding utf8
& $settings.node $settings.entry package windows-x64
exit $LASTEXITCODE
'@
  [IO.File]::WriteAllText($childScript, $command, [Text.UTF8Encoding]::new($false))
  $launchArguments = New-DesktopStandardLaunchArguments -Shell $shell -ChildScript $childScript
  $credential = [PSCredential]::new("$env:COMPUTERNAME\$account", $password)
  try {
    $child = Start-Process -FilePath $shell -Credential $credential -LoadUserProfile -WorkingDirectory $repository `
      -ArgumentList $launchArguments -PassThru `
      -RedirectStandardOutput (Join-Path $ownedRoot 'qualification-stdout.log') -RedirectStandardError (Join-Path $ownedRoot 'qualification-stderr.log')
  } catch {
    $launchError = $_.Exception
    while ($null -ne $launchError.InnerException) { $launchError = $launchError.InnerException }
    $nativeCode = if ($launchError -is [ComponentModel.Win32Exception]) { $launchError.NativeErrorCode } else { $null }
    throw "Standard-user qualification launch failed (nativeError=$nativeCode, HRESULT=$($launchError.HResult), type=$($launchError.GetType().Name)); credentials and command line omitted."
  }
  if (-not $child.WaitForExit(3600000)) {
    throw "Standard-user qualification PID $($child.Id) has not settled; do not delete its account or interrupt atomic uninstall."
  }
  Get-Content -LiteralPath (Join-Path $ownedRoot 'qualification-stdout.log')
  Get-Content -LiteralPath (Join-Path $ownedRoot 'qualification-stderr.log')
  if ($child.ExitCode -ne 0) { throw "Standard-user package qualification failed with exit $($child.ExitCode). Evidence: $ownedRoot" }
  $tokenEvidence = Get-Content -LiteralPath (Join-Path $ownedRoot 'qualification-token.json') -Raw | ConvertFrom-Json
  if ($tokenEvidence.administrator -ne $false) { throw 'Missing independently recorded non-administrator token evidence.' }
} finally {
  $password.Dispose()
  # Upload only known structured qualification records, never raw data or credentials.
  Export-NativeQualificationRecords -Root $ownedRoot
  # A timed-out installer may still be restoring files. Runner disposal owns that case.
  if ($created -and ($null -eq $child -or $child.HasExited)) { Remove-LocalUser -Name $account -ErrorAction Stop }
}

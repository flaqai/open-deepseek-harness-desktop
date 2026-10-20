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
      $_.Name -in @('qualification-token.json', 'previous-release.json') -or $_.Name -match '^installer-gui-\d+\.json$'
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
  $encodedSettings = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($settings | ConvertTo-Json -Compress)))
  $quotedNode = $node.Replace("'", "''")
  $quotedEntry = $entry.Replace("'", "''")
  $quotedRoot = $ownedRoot.Replace("'", "''")
  $command = @"
`$ErrorActionPreference = 'Stop'
`$settings = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$encodedSettings')) | ConvertFrom-Json
foreach (`$name in @([Environment]::GetEnvironmentVariables('Process').Keys)) { [Environment]::SetEnvironmentVariable(`$name, `$null, 'Process') }
foreach (`$property in `$settings.PSObject.Properties) { [Environment]::SetEnvironmentVariable(`$property.Name, `$property.Value, 'Process') }
`$token = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
`$admin = `$token.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (`$admin) { throw 'Standard-user qualification unexpectedly received administrator rights.' }
`$env:APPDATA = [Environment]::GetFolderPath('ApplicationData')
`$env:LOCALAPPDATA = [Environment]::GetFolderPath('LocalApplicationData')
`$env:USERPROFILE = [Environment]::GetFolderPath('UserProfile')
`$env:HOME = `$env:USERPROFILE
`$env:HOMEDRIVE = [IO.Path]::GetPathRoot(`$env:USERPROFILE).TrimEnd('\')
`$env:HOMEPATH = `$env:USERPROFILE.Substring(`$env:HOMEDRIVE.Length)
`$identityParts = [Security.Principal.WindowsIdentity]::GetCurrent().Name.Split('\')
`$env:USERDOMAIN = `$identityParts[0]
`$env:USERNAME = `$identityParts[-1]
`$env:COMPUTERNAME = [Environment]::MachineName
if ([string]::IsNullOrWhiteSpace(`$env:APPDATA) -or [string]::IsNullOrWhiteSpace(`$env:USERPROFILE)) { throw 'Standard-user profile was not loaded.' }
[ordered]@{ schema = 'open-dsh/windows-token/v1'; requested = 'standard'; administrator = `$admin; identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name } | ConvertTo-Json | Set-Content -LiteralPath '$quotedRoot/qualification-token.json' -Encoding utf8
& '$quotedNode' '$quotedEntry' package windows-x64
exit `$LASTEXITCODE
"@
  $encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
  $credential = [PSCredential]::new("$env:COMPUTERNAME\$account", $password)
  $child = Start-Process -FilePath $shell -Credential $credential -LoadUserProfile -WorkingDirectory $repository `
    -ArgumentList @('-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', $encodedCommand) -PassThru `
    -RedirectStandardOutput (Join-Path $ownedRoot 'qualification-stdout.log') -RedirectStandardError (Join-Path $ownedRoot 'qualification-stderr.log')
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

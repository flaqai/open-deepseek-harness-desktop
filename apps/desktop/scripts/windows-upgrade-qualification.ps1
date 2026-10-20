# Optional previous-release qualification. Call only on a disposable Windows host.
function Get-DesktopInstalledVersion {
  param([string] $Directory)
  . (Join-Path $PSScriptRoot '../build/installer-version.ps1')
  $identity = Get-DesktopInstalledIdentity -InstallDirectory $Directory -AppExecutable 'Open DeepSeek Harness Desktop.exe'
  return $identity.Version
}

function Assert-DesktopRegisteredVersion {
  param([string] $InstalledVersion, [string] $ExpectedVersion, [object[]] $Registrations)
  if ($InstalledVersion -cne $ExpectedVersion) { throw "Expected installed desktop $ExpectedVersion, found package version $InstalledVersion." }
  if ($Registrations.Count -ne 1 -or $Registrations[0].version -cne $ExpectedVersion) {
    throw 'Installed desktop package and uninstall registration versions disagree.'
  }
}

function Test-DesktopUpgradeRegistration {
  param([string] $KeyName, [string] $DisplayName)
  # UUID v5 of ai.flaq.deepseek-harness in electron-builder's stable NSIS namespace.
  return $KeyName.Trim('{}') -eq '0361fe6e-270e-56a3-9f11-0d722f41d3b6' -or $DisplayName -eq 'Open DeepSeek Harness Desktop'
}

function Get-DesktopUpgradeRegistrations {
  $entries = @()
  foreach ($registryRoot in @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKCU:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
  )) {
    if (-not (Test-Path -LiteralPath $registryRoot)) { continue }
    foreach ($entry in @(Get-ChildItem -LiteralPath $registryRoot -ErrorAction Stop)) {
      $properties = Get-ItemProperty -LiteralPath $entry.PSPath -ErrorAction Stop
      if (Test-DesktopUpgradeRegistration -KeyName $entry.PSChildName -DisplayName $properties.DisplayName) {
        $entries += [ordered]@{
          key = $entry.PSPath
          version = $properties.DisplayVersion
          directory = $properties.InstallLocation
          uninstaller = $properties.UninstallString
        }
      }
    }
  }
  return $entries
}

function New-DesktopQualificationInstallerStart {
  param([string] $Installer, [string] $Directory, [string] $Mode = 'currentuser', [switch] $Interactive)
  $start = [System.Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $Installer
  $start.UseShellExecute = $false
  if (-not $Interactive) { $start.ArgumentList.Add('/S') }
  $start.ArgumentList.Add("/$Mode")
  $start.ArgumentList.Add('/ADDCLI=1')
  $start.ArgumentList.Add("/D=$Directory")
  return $start
}

function Invoke-DesktopQualificationInstaller {
  param([System.Diagnostics.ProcessStartInfo] $Start)
  $installerProcess = [System.Diagnostics.Process]::Start($Start)
  if ($env:DSH_WINDOWS_GUI_AUTOMATION -eq '1' -and $Start.ArgumentList -notcontains '/S') {
    . (Join-Path $PSScriptRoot 'windows-installer-ui-automation.ps1')
    return Invoke-DesktopWizardAutomation -Process $installerProcess -EvidenceDirectory $env:RUNNER_TEMP
  }
  if (-not $installerProcess.WaitForExit(900000)) {
    # Do not interrupt the old uninstaller's atomic recovery.
    throw "Qualification installer PID $($installerProcess.Id) is still running after 15 minutes; outcome is unknown. Do not reuse this host until it settles."
  }
  return $installerProcess.ExitCode
}

function Get-DesktopUpgradeState {
  param([string] $Directory)
  return [ordered]@{
    executable = (Get-FileHash -LiteralPath (Join-Path $Directory 'Open DeepSeek Harness Desktop.exe') -Algorithm SHA256).Hash
    uninstaller = (Get-FileHash -LiteralPath (Join-Path $Directory 'Uninstall Open DeepSeek Harness Desktop.exe') -Algorithm SHA256).Hash
    registrations = @(Get-DesktopUpgradeRegistrations)
  }
}

function Assert-DesktopUpgradeFailurePreservedState {
  param([int] $ExitCode, $Before, $After, [string] $Sentinel, [string] $ExpectedSentinel)
  if ($ExitCode -eq 0) { throw 'Persistent-lock upgrade incorrectly reported success.' }
  if ($Before.executable -ne $After.executable -or $Before.uninstaller -ne $After.uninstaller) {
    throw 'Persistent-lock upgrade did not preserve the previous application and uninstaller.'
  }
  if (($Before.registrations | ConvertTo-Json -Depth 5 -Compress) -ne ($After.registrations | ConvertTo-Json -Depth 5 -Compress)) {
    throw 'Failed upgrade changed the old uninstall registration or published the candidate version.'
  }
  if (-not (Test-Path -LiteralPath $Sentinel) -or (Get-Content -LiteralPath $Sentinel -Raw) -ne $ExpectedSentinel) {
    throw 'Failed upgrade did not preserve the qualification user-data sentinel.'
  }
}

function Start-DesktopUpgradeLock {
  param([string] $Executable, [string] $Directory, [int] $Seconds = 20, [switch] $Persistent)
  $fixture = [System.Diagnostics.ProcessStartInfo]::new()
  $fixture.FileName = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $fixture.UseShellExecute = $false
  foreach ($argument in @('-NoLogo', '-NoProfile', '-NonInteractive', '-File', (Join-Path $PSScriptRoot 'hold-file-lock.ps1'),
    '-Path', $Executable, '-ReadyPath', (Join-Path $Directory 'ready'), '-Seconds', "$Seconds")) {
    $fixture.ArgumentList.Add($argument)
  }
  if ($Persistent) {
    $fixture.ArgumentList.Add('-ReleasePath')
    $fixture.ArgumentList.Add((Join-Path $Directory 'release'))
  }
  $process = [System.Diagnostics.Process]::Start($fixture)
  $deadline = (Get-Date).AddSeconds(15)
  while (-not (Test-Path -LiteralPath (Join-Path $Directory 'ready')) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 100
    if ($process.HasExited) { throw "Upgrade lock fixture exited with $($process.ExitCode)." }
  }
  if (-not (Test-Path -LiteralPath (Join-Path $Directory 'ready'))) {
    $process.Kill($true)
    $process.WaitForExit()
    throw 'Upgrade lock fixture did not acquire the installed executable.'
  }
  return $process
}

function Stop-DesktopUpgradeLock {
  param([System.Diagnostics.Process] $Process, [string] $Directory)
  [System.IO.File]::WriteAllText((Join-Path $Directory 'release'), 'release')
  if (-not $Process.WaitForExit(5000)) {
    $Process.Kill($true)
    $Process.WaitForExit()
    throw 'Upgrade lock fixture required forced cleanup.'
  }
  if ($Process.ExitCode -ne 0) { throw "Upgrade lock fixture failed with $($Process.ExitCode)." }
}

function Assert-PreviousDesktopNativeEntry {
  param([string] $Executable, [string] $EvidenceRoot)
  $start = [System.Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $Executable
  $start.UseShellExecute = $false
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $start.ArgumentList.Add('--dsh-native-smoke')
  $start.ArgumentList.Add("--dsh-package-smoke-root=$(Join-Path $EvidenceRoot 'previous-native-entry')")
  $entry = [System.Diagnostics.Process]::Start($start)
  $stdout = $entry.StandardOutput.ReadToEndAsync()
  $stderr = $entry.StandardError.ReadToEndAsync()
  if (-not $entry.WaitForExit(30000)) {
    $entry.Kill($true)
    $entry.WaitForExit()
    throw 'Preserved previous-release native entry did not exit within 30 seconds.'
  }
  $output = $stdout.GetAwaiter().GetResult()
  $errorOutput = $stderr.GetAwaiter().GetResult()
  if ($entry.ExitCode -ne 0 -or $output -notmatch 'DSH_NATIVE_SMOKE_READY') {
    throw "Preserved previous-release native entry failed (exit $($entry.ExitCode)).`nstdout:`n$output`nstderr:`n$errorOutput"
  }
}

function Initialize-DesktopPreviousReleaseQualification {
  param([string] $Installer, [string] $Version, [string] $Directory,
    [System.Diagnostics.ProcessStartInfo] $CandidateStart, [string] $EvidenceRoot, [string] $Mode = 'currentuser')
  if (-not $IsWindows) { throw 'Previous-release installation requires a disposable native Windows host.' }
  $evidencePrefix = [System.IO.Path]::GetFullPath($EvidenceRoot).TrimEnd('\') + '\'
  if (-not [System.IO.Path]::GetFullPath($Directory).StartsWith($evidencePrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Previous-release installation must remain inside the qualification temporary directory.'
  }
  if (@(Get-DesktopUpgradeRegistrations).Count -ne 0) {
    throw 'Refusing previous-release qualification: an existing desktop installation is registered on this host.'
  }
  $userData = Join-Path $env:APPDATA 'open-deepseek-harness-desktop'
  if (Test-Path -LiteralPath $userData) {
    throw 'Refusing previous-release qualification: existing default desktop user data must not be touched.'
  }
  if ($Mode -eq 'allusers') {
    $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
      throw 'All-users qualification requires an already elevated disposable Windows session.'
    }
  }
  $oldStart = New-DesktopQualificationInstallerStart -Installer $Installer -Directory $Directory -Mode $Mode
  $oldExit = Invoke-DesktopQualificationInstaller -Start $oldStart
  if ($oldExit -ne 0) { throw "Previous-release installer exited with $oldExit." }
  $oldExecutable = Join-Path $Directory 'Open DeepSeek Harness Desktop.exe'
  $installedVersion = Get-DesktopInstalledVersion -Directory $Directory
  $before = Get-DesktopUpgradeState -Directory $Directory
  Assert-DesktopRegisteredVersion -InstalledVersion $installedVersion -ExpectedVersion $Version -Registrations @($before.registrations)
  New-Item -ItemType Directory -Path $userData -ErrorAction Stop | Out-Null
  $sentinel = Join-Path $userData 'issue31-qualification-data.txt'
  $sentinelText = [Guid]::NewGuid().ToString()
  [System.IO.File]::WriteAllText($sentinel, $sentinelText)
  $lockDirectory = Join-Path $EvidenceRoot 'persistent-lock'
  New-Item -ItemType Directory -Path $lockDirectory -ErrorAction Stop | Out-Null
  $locker = Start-DesktopUpgradeLock -Executable $oldExecutable -Directory $lockDirectory -Persistent -Seconds 1800
  try {
    $candidateExit = Invoke-DesktopQualificationInstaller -Start $CandidateStart
    if ($locker.HasExited) { throw 'Persistent-lock fixture ended before the failed installer settled.' }
  } finally {
    Stop-DesktopUpgradeLock -Process $locker -Directory $lockDirectory
  }
  $after = Get-DesktopUpgradeState -Directory $Directory
  Assert-DesktopUpgradeFailurePreservedState -ExitCode $candidateExit -Before $before -After $after -Sentinel $sentinel -ExpectedSentinel $sentinelText
  Assert-PreviousDesktopNativeEntry -Executable $oldExecutable -EvidenceRoot $EvidenceRoot
  [ordered]@{
    schema = 'open-dsh/windows-previous-release-qualification/v1'
    previousInstallerSha256 = (Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash
    previousVersion = $Version
    installationMode = $Mode
    persistentLockExitCode = $candidateExit
    previousStatePreserved = $true
    previousNativeEntryVerified = $true
    interactive = $CandidateStart.ArgumentList -notcontains '/S'
    guiObservation = 'not-verified'
  } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $EvidenceRoot 'previous-release.json') -Encoding utf8
  return [pscustomobject]@{ Sentinel = $sentinel; SentinelText = $sentinelText; PreviousDirectory = $Directory }
}

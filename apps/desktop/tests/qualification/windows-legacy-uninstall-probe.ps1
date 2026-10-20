[CmdletBinding()]
param([string] $BaselineInstaller, [string] $EvidenceDirectory)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../scripts/windows-upgrade-qualification.ps1')

function Assert-LegacyProbeHost {
  if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Legacy uninstall probe requires a disposable GitHub-hosted Windows runner.' }
  $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Legacy uninstall probe requires an already elevated runner.' }
}

function Get-LegacyUninstallArguments {
  param([string] $Directory)
  $null = New-DesktopQualificationInstallerStart -Installer 'validation-only.exe' -Directory $Directory -Mode allusers
  return '/S /KEEP_APP_DATA /allusers --updated _?=' + $Directory
}

function Get-LegacyExclusiveOpenEvidence {
  param([string] $Directory, [string] $OwnerRoot)
  $result = [ordered]@{ status = 'present'; attempted = 0; failures = 0; sharingViolations = 0; accessDenied = 0; pathTooLong = 0; otherFailures = 0 }
  $metadata = Get-DesktopInstallationPathMetadata -Directory $Directory -OwnerRoot $OwnerRoot
  if ($metadata.status -ne 'present') { $result.status = 'degraded'; return $result }
  if ($metadata.fileCountAtLeast260 -eq 0) { return $result }
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $visited = 0
  try {
    $pending = [Collections.Generic.Stack[IO.DirectoryInfo]]::new()
    $pending.Push([IO.DirectoryInfo]::new($Directory))
    while ($pending.Count -gt 0) {
      if ($visited -ge 200000 -or $watch.ElapsedMilliseconds -ge 5000) { $result.status = 'degraded'; return $result }
      $enumerator = $pending.Pop().EnumerateFileSystemInfos().GetEnumerator()
      try {
        while ($enumerator.MoveNext()) {
          if ($visited -ge 200000 -or $watch.ElapsedMilliseconds -ge 5000) { $result.status = 'degraded'; return $result }
          $visited++
          $entry = $enumerator.Current
          if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { $result.status = 'degraded'; continue }
          if (($entry.Attributes -band [IO.FileAttributes]::Directory) -ne 0) { $pending.Push([IO.DirectoryInfo]$entry); continue }
          if ($entry.FullName.Length -lt 260) { continue }
          if ($result.attempted -ge 64) { $result.status = 'degraded'; return $result }
          $result.attempted++
          $stream = $null
          try { $stream = [IO.File]::Open($entry.FullName, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None) } catch {
            $result.failures++
            $probeError = $_.Exception
            while ($null -ne $probeError.InnerException) { $probeError = $probeError.InnerException }
            switch ($probeError.HResult -band 65535) {
              32 { $result.sharingViolations++ }
              33 { $result.sharingViolations++ }
              5 { $result.accessDenied++ }
              206 { $result.pathTooLong++ }
              default { $result.otherFailures++ }
            }
          } finally { if ($null -ne $stream) { $stream.Dispose() } }
        }
      } finally { $enumerator.Dispose() }
    }
  } catch { $result.status = 'degraded' } finally { $watch.Stop() }
  return $result
}

function Get-LegacyOwnedState {
  param([string] $Directory)
  $app = Join-Path $Directory 'Open DeepSeek Harness Desktop.exe'
  $uninstaller = Join-Path $Directory 'Uninstall Open DeepSeek Harness Desktop.exe'
  $registrations = @(Get-DesktopUpgradeRegistrations)
  $registrationFacts = @($registrations | ForEach-Object { [ordered]@{ version = $_.version; directoryMatches = [string]::Equals($_.directory.TrimEnd('\'), $Directory, [StringComparison]::OrdinalIgnoreCase); uninstallerMatches = ([string]$_.uninstaller).Contains($uninstaller) } })
  return [ordered]@{
    executableSha256 = if ([IO.File]::Exists($app)) { (Get-FileHash -LiteralPath $app -Algorithm SHA256).Hash } else { $null }
    uninstallerSha256 = if ([IO.File]::Exists($uninstaller)) { (Get-FileHash -LiteralPath $uninstaller -Algorithm SHA256).Hash } else { $null }
    registration = $registrationFacts
  }
}

function Invoke-LegacyProbeProcess {
  param([Diagnostics.ProcessStartInfo] $Start, [int] $Milliseconds)
  $process = [Diagnostics.Process]::Start($Start)
  $watch = [Diagnostics.Stopwatch]::StartNew()
  try {
    if (-not $process.WaitForExit($Milliseconds)) { return [ordered]@{ outcome = 'unknown-still-running'; exitCode = $null; elapsedMilliseconds = $watch.ElapsedMilliseconds } }
    return [ordered]@{ outcome = 'exited'; exitCode = $process.ExitCode; elapsedMilliseconds = $watch.ElapsedMilliseconds }
  } finally { $watch.Stop(); if ($process.HasExited) { $process.Dispose() } }
}

function Invoke-LegacyUninstallProbe {
  Assert-LegacyProbeHost
  if (@(Get-DesktopUpgradeRegistrations).Count -ne 0) { throw 'Legacy probe refuses an existing desktop installation.' }
  if (Test-Path -LiteralPath (Join-Path $env:APPDATA 'open-deepseek-harness-desktop')) { throw 'Legacy probe refuses existing desktop user data.' }
  $expectedHash = 'CEFD5602187D36D6360A48B2560014CC5A01E61857F07954D5737B59702411E0'
  if ((Get-Item -LiteralPath $BaselineInstaller).Length -ne 455433576 -or (Get-FileHash -LiteralPath $BaselineInstaller -Algorithm SHA256).Hash -ne $expectedHash) { throw 'Legacy probe baseline differs from the pinned public alpha.2 asset.' }
  $owned = Join-Path $env:RUNNER_TEMP ('lu-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))
  New-Item -ItemType Directory -Path $owned -ErrorAction Stop | Out-Null
  $shortRoot = Join-Path $owned 's'
  $longRoot = Join-Path $owned 'Open DeepSeek Harness Desktop 安装测试 previous'
  if ($longRoot.Length -gt 75) { throw 'Runner temporary root is too long for the controlled 75-character comparison.' }
  $longRoot += 'x' * (75 - $longRoot.Length)
  $report = [ordered]@{ schema = 'open-dsh/legacy-uninstall-counterfactual/v1'; purpose = 'diagnostic-only-not-release-qualification'; status = 'incomplete'; intentionalFileLocks = $false; installerSha256 = $expectedHash; sameVolume = ([IO.Path]::GetPathRoot($shortRoot) -eq [IO.Path]::GetPathRoot($longRoot)); cases = @() }
  New-Item -ItemType Directory -Path $EvidenceDirectory -Force | Out-Null
  $expectedUninstallerHash = $null
  $phase = 'fresh-install-precondition'
  try {
    foreach ($case in @(@{ name = 'short'; directory = $shortRoot }, @{ name = 'original-length'; directory = $longRoot })) {
      $phase = 'fresh-install-precondition'
      if (@(Get-DesktopUpgradeRegistrations).Count -ne 0) { throw 'The previous probe installation remains registered; the next case cannot be a fresh independent installation.' }
      $entry = [ordered]@{ case = $case.name; installation = $null; paths = $null; exclusiveOpen = $null; uninstallerSha256 = $null; copiedUninstallerHashMatches = $null; uninstall = $null; preservation = $null }
      $report.cases += $entry
      $phase = 'baseline-install'
      $install = New-DesktopQualificationInstallerStart -Installer $BaselineInstaller -Directory $case.directory -Mode allusers
      $install.Arguments = $install.Arguments.Replace('/ADDCLI=1', '/ADDCLI=0')
      $entry.installation = Invoke-LegacyProbeProcess -Start $install -Milliseconds 600000
      if ($entry.installation.outcome -ne 'exited' -or $entry.installation.exitCode -ne 0) { throw 'A baseline install did not complete successfully; comparison is incomplete.' }
      $phase = 'installed-identity'
      $before = Get-LegacyOwnedState -Directory $case.directory
      if ($before.registration.Count -ne 1 -or $before.registration[0].version -ne '0.2.1-alpha.2' -or -not $before.registration[0].directoryMatches) { throw 'Baseline install did not establish the expected version and directory.' }
      $entry.paths = Get-DesktopInstallationPathMetadata -Directory $case.directory -OwnerRoot $owned
      $phase = 'readonly-exclusive-probes'
      $entry.exclusiveOpen = Get-LegacyExclusiveOpenEvidence -Directory $case.directory -OwnerRoot $owned
      $entry.uninstallerSha256 = $before.uninstallerSha256
      if ($null -eq $expectedUninstallerHash) { $expectedUninstallerHash = $before.uninstallerSha256 }
      if ($before.uninstallerSha256 -ne $expectedUninstallerHash) { throw 'The two cases do not have identical old uninstallers.' }
      $ownedProcesses = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
        -not [string]::IsNullOrEmpty($_.ExecutablePath) -and $_.ExecutablePath.StartsWith(($case.directory + '\'), [StringComparison]::OrdinalIgnoreCase)
      })
      $entry.ownedApplicationProcessCount = $ownedProcesses.Count
      if ($ownedProcesses.Count -ne 0) { throw 'Unexpected application processes exist; the no-lock counterfactual precondition is not established.' }
      $temporaryUninstaller = Join-Path $owned ('old-uninstaller-' + [Guid]::NewGuid().ToString('N') + '.exe')
      $phase = 'uninstaller-copy-identity'
      [IO.File]::Copy((Join-Path $case.directory 'Uninstall Open DeepSeek Harness Desktop.exe'), $temporaryUninstaller, $false)
      $entry.copiedUninstallerHashMatches = (Get-FileHash -LiteralPath $temporaryUninstaller -Algorithm SHA256).Hash -eq $expectedUninstallerHash
      if (-not $entry.copiedUninstallerHashMatches) { throw 'Copied old uninstaller failed the identity check.' }
      $start = [Diagnostics.ProcessStartInfo]::new()
      $start.FileName = $temporaryUninstaller
      $start.UseShellExecute = $false
      $start.Arguments = Get-LegacyUninstallArguments -Directory $case.directory
      $phase = 'direct-old-uninstall'
      $entry.uninstall = Invoke-LegacyProbeProcess -Start $start -Milliseconds 180000
      if ($entry.uninstall.outcome -ne 'exited') { throw 'Old uninstaller remains running; outcome unknown. It was not terminated. Dispose this runner without another probe.' }
      if ($entry.uninstall.exitCode -eq 2) {
        $phase = 'post-failure-preservation'
        $after = Get-LegacyOwnedState -Directory $case.directory
        $afterPaths = Get-DesktopInstallationPathMetadata -Directory $case.directory -OwnerRoot $owned
        $entry.preservation = [ordered]@{ scope = 'app-uninstaller-sha256-registration-file-count'; appUnchanged = $before.executableSha256 -eq $after.executableSha256; uninstallerUnchanged = $before.uninstallerSha256 -eq $after.uninstallerSha256; registrationUnchanged = ($before.registration | ConvertTo-Json -Compress) -eq ($after.registration | ConvertTo-Json -Compress); fileCountUnchanged = $entry.paths.status -eq 'present' -and $afterPaths.status -eq 'present' -and $entry.paths.totalFileCount -eq $afterPaths.totalFileCount }
      }
      if ($entry.uninstall.exitCode -eq 0) {
        $phase = 'post-success-removal'
        $entry.removal = [ordered]@{ applicationAbsent = -not [IO.File]::Exists((Join-Path $case.directory 'Open DeepSeek Harness Desktop.exe')); registrationAbsent = @(Get-DesktopUpgradeRegistrations).Count -eq 0 }
        if (-not $entry.removal.applicationAbsent -or -not $entry.removal.registrationAbsent) { throw 'Old uninstaller exit zero did not establish a fresh next-case state.' }
      }
    }
    $report.status = 'complete-diagnostic'
  } catch {
    $report.failureKind = $phase
    Write-Warning 'Legacy counterfactual did not complete; bounded structured evidence is retained, without paths or process arguments.'
    throw 'Legacy counterfactual incomplete; inspect the bounded structured report. No release qualification was performed.'
  } finally {
    $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $EvidenceDirectory 'counterfactual.json') -Encoding utf8
  }
}

if ($MyInvocation.InvocationName -ne '.') { Invoke-LegacyUninstallProbe }

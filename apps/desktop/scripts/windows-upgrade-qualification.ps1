# Optional previous-release qualification. Call only on a disposable Windows host.
function Get-DesktopQualificationInstallDirectories {
  param([string] $Root, [switch] $ChangeDirectory)
  # Fixed short siblings retain Unicode and spaces without adding an artificial
  # MAX_PATH failure to the immutable public alpha.2 upgrade fixture.
  # The wizard appends APP_FILENAME if absent; retain it in both siblings so
  # interactive and silent installation resolve to the identical expected root.
  $candidate = Join-Path $Root 'Open DeepSeek Harness Desktop 新'
  $previous = if ($ChangeDirectory) { Join-Path $Root 'Open DeepSeek Harness Desktop 旧' } else { $candidate }
  if ($ChangeDirectory -and $previous -eq $candidate) { throw 'Changed-directory qualification requires distinct siblings.' }
  return [pscustomobject]@{ Candidate = $candidate; Previous = $previous }
}

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
  param([string] $Installer, [string] $Directory, [ValidateSet('currentuser', 'allusers')] [string] $Mode = 'currentuser', [switch] $Interactive)
  if ($Directory -notmatch '^[A-Za-z]:\\' -or $Directory.Length -le 3 -or $Directory -match '["\x00-\x1f<>|?*]' -or
      $Directory.Substring(2) -match '[:/]' -or @($Directory.Split('\') | Where-Object { $_ -in @('.', '..') }).Count -ne 0) {
    throw 'NSIS qualification requires an absolute local Windows installation directory without quotes or control characters.'
  }
  $start = [System.Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $Installer
  $start.UseShellExecute = $false
  $switches = if ($Interactive) { '' } else { '/S ' }
  # NSIS /D is the final, unquoted command-line tail, including spaces.
  # ArgumentList would quote this token and NSIS would retain the closing quote.
  $start.Arguments = "$switches/$($Mode.ToLowerInvariant()) /ADDCLI=1 /D=$Directory"
  return $start
}

function Invoke-DesktopQualificationInstaller {
  param([System.Diagnostics.ProcessStartInfo] $Start)
  $installerProcess = [System.Diagnostics.Process]::Start($Start)
  if ($env:DSH_WINDOWS_GUI_AUTOMATION -eq '1' -and -not $Start.Arguments.StartsWith('/S ', [StringComparison]::Ordinal)) {
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
  if ($ExitCode -ne 2) { throw "Persistent-lock upgrade must reach atomic cleanup failure exit 2, found $ExitCode." }
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

function Get-DesktopUpgradeDiagnosticDirectories {
  param([string] $Root)
  return @(Get-ChildItem -LiteralPath $Root -Directory -Filter '*.dsh-install' -ErrorAction Stop | ForEach-Object { $_.FullName })
}

function Get-DesktopInstallationPathMetadata {
  param([string] $Directory, [string] $OwnerRoot, [ValidateRange(1, 2000000)] [int] $MaximumEntries = 200000,
    [ValidateRange(1, 30000)] [int] $MaximumMilliseconds = 5000)
  $metadata = [ordered]@{ status = 'present'; rootLength = 0; maximumFilePathLength = 0; fileCountAtLeast260 = 0; totalFileCount = 0; visitedEntries = 0; reparsePointsSkipped = 0; reason = $null }
  $watch = [Diagnostics.Stopwatch]::StartNew()
  try {
    $owned = [IO.Path]::GetFullPath($OwnerRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $root = [IO.Path]::GetFullPath($Directory)
    $metadata.rootLength = $root.Length
    if (-not $root.StartsWith(($owned + [IO.Path]::DirectorySeparatorChar), [StringComparison]::OrdinalIgnoreCase)) { throw 'unowned-root' }
    $ancestor = [IO.DirectoryInfo]::new($root)
    while (-not [string]::Equals($ancestor.FullName.TrimEnd([IO.Path]::DirectorySeparatorChar), $owned, [StringComparison]::OrdinalIgnoreCase)) {
      if (-not $ancestor.Exists -or ($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'unsafe-root' }
      $ancestor = $ancestor.Parent
      if ($null -eq $ancestor) { throw 'unsafe-root' }
    }
    if (($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'unsafe-root' }
    $directories = [Collections.Generic.Stack[IO.DirectoryInfo]]::new()
    $directories.Push([IO.DirectoryInfo]::new($root))
    while ($directories.Count -ne 0) {
      if ($metadata.visitedEntries -ge $MaximumEntries -or $watch.ElapsedMilliseconds -ge $MaximumMilliseconds) {
        $metadata.status = 'degraded'; $metadata.reason = 'scan-budget-exhausted'; return $metadata
      }
      $enumerator = $directories.Pop().EnumerateFileSystemInfos().GetEnumerator()
      try {
        while ($enumerator.MoveNext()) {
          if ($metadata.visitedEntries -ge $MaximumEntries -or $watch.ElapsedMilliseconds -ge $MaximumMilliseconds) {
            $metadata.status = 'degraded'; $metadata.reason = 'scan-budget-exhausted'; return $metadata
          }
          $metadata.visitedEntries++
          $entry = $enumerator.Current
          if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            $metadata.reparsePointsSkipped++; $metadata.status = 'degraded'; $metadata.reason = 'reparse-points-skipped'; continue
          }
          if (($entry.Attributes -band [IO.FileAttributes]::Directory) -ne 0) { $directories.Push([IO.DirectoryInfo]$entry); continue }
          $length = $entry.FullName.Length
          $metadata.totalFileCount++
          if ($length -gt $metadata.maximumFilePathLength) { $metadata.maximumFilePathLength = $length }
          if ($length -ge 260) { $metadata.fileCountAtLeast260++ }
        }
      } finally { $enumerator.Dispose() }
    }
  } catch {
    $metadata.status = 'degraded'
    $metadata.reason = if ($_.Exception.Message -in @('unowned-root', 'unsafe-root')) { $_.Exception.Message } else { 'metadata-read-failed' }
  } finally { $watch.Stop() }
  return $metadata
}

function Get-DesktopShortLockMetadata {
  param([System.Diagnostics.Process] $Process)
  $metadata = [ordered]@{ status = 'not-applicable'; observedAtUtc = [DateTime]::UtcNow.ToString('o'); startTimeUtc = $null; hasExited = $null; exitCode = $null; exitTimeUtc = $null }
  if ($null -eq $Process) { return $metadata }
  try {
    $Process.Refresh()
    $metadata.status = 'present'
    $metadata.hasExited = $Process.HasExited
    if ($metadata.hasExited) {
      $metadata.exitCode = $Process.ExitCode
      $metadata.exitTimeUtc = $Process.ExitTime.ToUniversalTime().ToString('o')
    }
    $metadata.startTimeUtc = $Process.StartTime.ToUniversalTime().ToString('o')
  } catch { $metadata.status = 'unavailable' }
  return $metadata
}

function Save-DesktopMainInstallerDiagnostics {
  param([string] $Root, [string[]] $PreviousDirectories, [bool] $SnapshotAvailable,
    $OldInstallationMetadata = $null, [System.Diagnostics.Process] $ShortLocker = $null, $ShortLockBeforeMain = $null)
  $report = [ordered]@{ schema = 'open-dsh/main-installer-diagnostics/v1'; status = 'present'; directories = @() }
  $report.oldInstallation = $OldInstallationMetadata
  $report.shortLockBeforeMain = $ShortLockBeforeMain
  $report.shortLock = Get-DesktopShortLockMetadata -Process $ShortLocker
  try {
    $evidenceDirectory = Get-Item -LiteralPath $env:RUNNER_TEMP -Force -ErrorAction Stop
    $temporaryDirectory = Get-Item -LiteralPath $Root -Force -ErrorAction Stop
    if (-not [IO.Path]::IsPathFullyQualified($Root) -or
        -not [string]::Equals($Root, $env:TEMP, [StringComparison]::OrdinalIgnoreCase) -or
        -not $temporaryDirectory.PSIsContainer -or -not $evidenceDirectory.PSIsContainer -or
        $evidenceDirectory.Name -cnotmatch '^s-[A-Za-z0-9]{6}$' -or
        -not [string]::Equals($temporaryDirectory.FullName, $evidenceDirectory.Parent.FullName, [StringComparison]::OrdinalIgnoreCase) -or
        ($temporaryDirectory.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
        ($evidenceDirectory.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      Write-Warning 'Installer diagnostic collection rejected an unowned temporary directory.' -WarningAction Continue
      return
    }
    $report.temporaryRootLength = $temporaryDirectory.FullName.Length
    $report.evidenceRootLength = $evidenceDirectory.FullName.Length
    if (-not $SnapshotAvailable) { throw 'The pre-install directory snapshot was unavailable.' }
    $newDirectories = @(Get-DesktopUpgradeDiagnosticDirectories -Root $Root | Where-Object { $PreviousDirectories -notcontains $_ } | Sort-Object)
    if ($newDirectories.Count -gt 8) { $report.status = 'degraded' }
    foreach ($directoryPath in @($newDirectories | Select-Object -First 8)) {
      $directory = Get-Item -LiteralPath $directoryPath -Force -ErrorAction Stop
      if (($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { $report.status = 'degraded'; continue }
      $captured = [ordered]@{ directory = $directory.Name; files = @() }
      foreach ($name in @('installer.log', 'upgrade.jsonl')) {
        $log = Join-Path $directory.FullName $name
        if (-not (Test-Path -LiteralPath $log)) { continue }
        $file = Get-Item -LiteralPath $log -Force -ErrorAction Stop
        if ($file.PSIsContainer -or $file.Length -gt 65536 -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
          $report.status = 'degraded'
          $captured.files += [ordered]@{ name = $name; status = 'rejected' }
          continue
        }
        $encoding = if ($name -eq 'installer.log') { [Text.Encoding]::Unicode } else { [Text.Encoding]::UTF8 }
        $lines = @([IO.File]::ReadAllLines($file.FullName, $encoding))
        $events = @()
        if ($lines.Count -gt 256) { $report.status = 'degraded' }
        foreach ($line in @($lines | Select-Object -First 256)) {
          if ([string]::IsNullOrWhiteSpace($line)) { continue }
          if ($name -eq 'installer.log') {
            $phase = [regex]::Match($line, '^(process-check|process-inspection-stopped|uninstall-start|uninstall-result|uninstall-invalid-registration|extract-start|copy-refused|extract-complete|copy-failed|copy-verified|extract-failed|installer-init|uninstall-stopped)(?:[ =]|$)')
            if (-not $phase.Success) { continue }
            $event = [ordered]@{ stage = $phase.Groups[1].Value }
            $result = [regex]::Match($line, '(?:^uninstall-result=|(?:^| )result=)(-?\d+)(?: |$)')
            if ($result.Success) { $event.result = [int]$result.Groups[1].Value }
          } else {
            $raw = $line | ConvertFrom-Json
            if ($raw.stage -notin @('uninstall-start', 'uninstaller-copy-failed', 'temporary-launch-failed', 'uninstall-launch-failed', 'uninstall-result', 'old-uninstaller-removed', 'uninstall-complete', 'uninstall-failed', 'uninstall-invalid-state')) { continue }
            $event = [ordered]@{ stage = $raw.stage }
            foreach ($field in @('attempt', 'exitCode', 'errorCode')) {
              $number = 0
              if ($null -ne $raw.PSObject.Properties[$field] -and [int]::TryParse([string]$raw.$field, [ref]$number)) { $event[$field] = $number }
            }
            if ($raw.mode -in @('/currentuser', '/allusers')) { $event.mode = $raw.mode }
            if ($raw.disposition -in @('installation-stopped', 'installation-stopped; old-version-restoration-not-independently-verified')) { $event.disposition = $raw.disposition }
            if ($raw.stage -eq 'uninstall-invalid-state') {
              $event.errorKind = switch -Regex ([string]$raw.error) {
                'previous application remains' { 'previous-application-remains'; break }
                'previous runtime files remain' { 'previous-runtime-remains'; break }
                'registered uninstaller|registered installation' { 'uninstaller-registration-invalid'; break }
                'does not exist|Could not find' { 'required-file-missing'; break }
                'integrity mismatch' { 'temporary-uninstaller-integrity'; break }
                default { 'other-validation-error' }
              }
            }
          }
          $events += $event
        }
        $captured.files += [ordered]@{ name = $name; status = 'present'; length = $file.Length; events = $events }
      }
      $report.directories += $captured
    }
  } catch {
    $report.status = 'unavailable'
  }
  try {
    $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $Root 'main-installer-diagnostics.json') -Encoding utf8 -ErrorAction Stop
  } catch {
    Write-Warning 'Installer diagnostics could not be saved; the installation outcome is unchanged.' -WarningAction Continue
  }
}

function Assert-DesktopAtomicCleanupBudget {
  param([string] $Root, [string[]] $PreviousDirectories, [string] $InstallDirectory, [string] $EvidenceRoot)
  $newDirectories = @(Get-DesktopUpgradeDiagnosticDirectories -Root $Root | Where-Object { $PreviousDirectories -notcontains $_ })
  $logs = @($newDirectories | ForEach-Object {
    $directory = Get-Item -LiteralPath $_ -Force -ErrorAction Stop
    if (($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Atomic cleanup retry evidence traverses a reparse point.' }
    $log = Join-Path $directory.FullName 'upgrade.jsonl'
    if (Test-Path -LiteralPath $log) { Get-Item -LiteralPath $log -Force -ErrorAction Stop }
  })
  if ($logs.Count -ne 1 -or $logs[0].PSIsContainer -or $logs[0].Length -gt 131072 -or
      ($logs[0].Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'Atomic cleanup retry evidence must contain exactly one bounded new upgrade log.'
  }
  Copy-Item -LiteralPath $logs[0].FullName -Destination (Join-Path $EvidenceRoot 'persistent-lock-upgrade.jsonl') -ErrorAction Stop
  $records = @(Get-Content -LiteralPath $logs[0].FullName -Encoding UTF8 | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object { $_ | ConvertFrom-Json })
  $starts = @($records | Where-Object { $_.stage -eq 'uninstall-start' })
  $results = @($records | Where-Object { $_.stage -eq 'uninstall-result' })
  $failures = @($records | Where-Object { $_.stage -eq 'uninstall-failed' })
  if ($starts.Count -ne 1 -or -not [string]::Equals([IO.Path]::GetFullPath($starts[0].installDirectory), [IO.Path]::GetFullPath($InstallDirectory), [StringComparison]::OrdinalIgnoreCase) -or
      $results.Count -ne 12 -or $failures.Count -ne 1 -or $records[-1].stage -ne 'uninstall-failed' -or
      $failures[0].attempt -ne 12 -or $failures[0].exitCode -ne 2 -or
      @($records | Where-Object { $_.stage -in @('uninstall-invalid-state', 'uninstall-launch-failed', 'uninstall-complete') }).Count -ne 0) {
    throw 'Atomic cleanup retry evidence did not verify this old installation exhausted twelve exit-2 attempts.'
  }
  for ($attempt = 1; $attempt -le 12; $attempt++) {
    if ($results[$attempt - 1].attempt -ne $attempt -or $results[$attempt - 1].exitCode -ne 2) {
      throw 'Atomic cleanup retry evidence has an unexpected attempt sequence or exit code.'
    }
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

function Start-DesktopNativeEntryProcess {
  param([System.Diagnostics.ProcessStartInfo] $Start)
  return [System.Diagnostics.Process]::Start($Start)
}

function Assert-PreviousDesktopNativeEntry {
  param([string] $Executable, [string] $EvidenceRoot)
  $nativeRoot = Join-Path $EvidenceRoot ('previous-native-entry-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $nativeRoot -ErrorAction Stop | Out-Null
  $start = [System.Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $Executable
  $start.UseShellExecute = $false
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $start.ArgumentList.Add('--dsh-native-smoke')
  $start.ArgumentList.Add("--dsh-package-smoke-root=$nativeRoot")
  $entry = Start-DesktopNativeEntryProcess -Start $start
  try {
    $stdout = $entry.StandardOutput.ReadToEndAsync()
    $stderr = $entry.StandardError.ReadToEndAsync()
    if (-not $entry.WaitForExit(30000)) {
      # This owned probe exits before loading the host; it is not an uninstaller.
      $entry.Kill($true)
      $entry.WaitForExit()
      throw 'Preserved previous-release native entry did not exit within 30 seconds.'
    }
    $output = $stdout.GetAwaiter().GetResult()
    $errorOutput = $stderr.GetAwaiter().GetResult()
    if ($entry.ExitCode -ne 0 -or $output -notmatch 'DSH_NATIVE_SMOKE_READY') {
      throw "Preserved previous-release native entry failed (exit $($entry.ExitCode)).`nstdout:`n$output`nstderr:`n$errorOutput"
    }
  } finally { $entry.Dispose() }
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
  $previousDiagnosticDirectories = @(Get-DesktopUpgradeDiagnosticDirectories -Root $env:TEMP)
  $locker = Start-DesktopUpgradeLock -Executable $oldExecutable -Directory $lockDirectory -Persistent -Seconds 1800
  try {
    $candidateExit = Invoke-DesktopQualificationInstaller -Start $CandidateStart
    if ($locker.HasExited) { throw 'Persistent-lock fixture ended before the failed installer settled.' }
  } finally {
    Stop-DesktopUpgradeLock -Process $locker -Directory $lockDirectory
  }
  $evidencePath = Join-Path $EvidenceRoot 'previous-release.json'
  $evidence = [ordered]@{
    schema = 'open-dsh/windows-previous-release-qualification/v1'
    previousInstallerSha256 = (Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash
    previousVersion = $Version
    installationMode = $Mode
    previousInstallation = Get-DesktopInstallationPathMetadata -Directory $Directory -OwnerRoot $EvidenceRoot
    persistentLockExitCode = $candidateExit
    previousStatePreserved = $null
    previousNativeEntryVerified = $false
    oldUninstallBudgetVerified = $false
    interactive = -not $CandidateStart.Arguments.StartsWith('/S ', [StringComparison]::Ordinal)
    guiObservation = 'not-verified'
  }
  $evidence | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $evidencePath -Encoding utf8
  Assert-DesktopAtomicCleanupBudget -Root $env:TEMP -PreviousDirectories $previousDiagnosticDirectories -InstallDirectory $Directory -EvidenceRoot $EvidenceRoot
  $evidence.oldUninstallBudgetVerified = $true
  $evidence | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $evidencePath -Encoding utf8
  $after = Get-DesktopUpgradeState -Directory $Directory
  Assert-DesktopUpgradeFailurePreservedState -ExitCode $candidateExit -Before $before -After $after -Sentinel $sentinel -ExpectedSentinel $sentinelText
  $evidence.previousStatePreserved = $true
  $evidence | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $evidencePath -Encoding utf8
  Assert-PreviousDesktopNativeEntry -Executable $oldExecutable -EvidenceRoot $EvidenceRoot
  $evidence.previousNativeEntryVerified = $true
  $evidence | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $evidencePath -Encoding utf8
  return [pscustomobject]@{ Sentinel = $sentinel; SentinelText = $sentinelText; PreviousDirectory = $Directory }
}

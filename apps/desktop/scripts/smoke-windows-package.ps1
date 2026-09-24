$ErrorActionPreference = 'Stop'

function Assert-HarnessStartupHealthy([string] $LogText) {
  # Only terminal supervisor errors fail qualification; plugin stderr and
  # recoverable diagnostic-mode transitions are not terminal failures.
  if ($LogText -match '(?m)^\[[^\r\n]+\] \[desktop-supervisor\] \[error\] (Harness process owner (?:failed|could not start)[^\r\n]*|Harness process range did not become idle[^\r\n]*|Harness startup failed after[^\r\n]*)') {
    throw "Installed Harness startup failed: $($Matches[1])"
  }
}

. (Join-Path $PSScriptRoot 'windows-smoke-journal.ps1')
$smokeJournalPath = Join-Path $env:RUNNER_TEMP 'DeepSeek-Harness-smoke-status.json'
Initialize-SmokeJournal -Path $smokeJournalPath

try {
Start-SmokePhase -Name 'package-contract'
$installer = (Resolve-Path (Join-Path $PSScriptRoot '../../../.artifacts/desktop-windows/DeepSeek-Harness-windows-x64.exe')).Path
$installRoot = Join-Path $env:RUNNER_TEMP 'Open DeepSeek Harness Desktop 安装测试'
$dshHome = Join-Path $env:RUNNER_TEMP 'DeepSeek Harness Home'
$desktopAppDataRoot = Join-Path $env:RUNNER_TEMP 'DeepSeek Harness AppData'
$desktopDataRoot = Join-Path $desktopAppDataRoot 'open-deepseek-harness-desktop'
$harnessLog = Join-Path $desktopDataRoot 'logs/harness.log'
$desktopEntryLog = Join-Path $desktopAppDataRoot 'desktop-entry.log'
$cliDirectory = Join-Path $installRoot 'resources/cli-bin'
$originalUserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$processGuardDiagnostic = Join-Path $env:TEMP 'DeepSeek-Harness-process-guard.log'
Remove-Item -LiteralPath $processGuardDiagnostic -Force -ErrorAction SilentlyContinue
$similarRoot = "$installRoot-old"

Start-SmokePhase -Name 'install'
$installStart = [System.Diagnostics.ProcessStartInfo]::new()
$installStart.FileName = $installer
$installStart.UseShellExecute = $false
$installStart.ArgumentList.Add('/S')
$installStart.ArgumentList.Add('/currentuser')
$installStart.ArgumentList.Add('/ADDCLI=1')
$installStart.ArgumentList.Add("/D=$installRoot")
$install = [System.Diagnostics.Process]::Start($installStart)
$installDeadline = (Get-Date).AddMinutes(15)
$nextInstallProgress = (Get-Date).AddSeconds(30)
while (-not $install.HasExited -and (Get-Date) -lt $installDeadline) {
  Start-Sleep -Milliseconds 500
  $install.Refresh()
  if ((Get-Date) -ge $nextInstallProgress) {
    $installedExecutable = Test-Path (Join-Path $installRoot 'Open DeepSeek Harness Desktop.exe')
    $installedHarness = Test-Path (Join-Path $installRoot 'resources/harness/lib/bin.js')
    $elapsed = [Math]::Round(((Get-Date) - $install.StartTime).TotalSeconds)
    Write-Host "Installer still running after ${elapsed}s (executable=$installedExecutable, harness=$installedHarness)."
    $nextInstallProgress = (Get-Date).AddSeconds(30)
  }
}
if (-not $install.HasExited) {
  $install.Kill($true)
  $install.WaitForExit()
  throw 'Windows installer did not exit within 15 minutes'
}
if ($install.ExitCode -ne 0) {
  throw "Windows installer exited with $($install.ExitCode)"
}

# Keep an unrelated executable alive in another prefix-similar sibling. The
# precise guard must neither report nor terminate it.
New-Item -ItemType Directory -Path $similarRoot -Force | Out-Null
$decoyExecutable = Join-Path $similarRoot 'unrelated-process.exe'
Copy-Item -LiteralPath (Join-Path $env:WINDIR 'System32\ping.exe') -Destination $decoyExecutable -Force
$decoyStart = [System.Diagnostics.ProcessStartInfo]::new()
$decoyStart.FileName = $decoyExecutable
$decoyStart.UseShellExecute = $false
$decoyStart.ArgumentList.Add('-t')
$decoyStart.ArgumentList.Add('127.0.0.1')
$decoy = [System.Diagnostics.Process]::Start($decoyStart)

$required = @(
  (Join-Path $installRoot 'Open DeepSeek Harness Desktop.exe'),
  (Join-Path $installRoot 'resources/harness/lib/bin.js'),
  (Join-Path $installRoot 'resources/harness/node_modules'),
  (Join-Path $installRoot 'resources/runtime/win32-x64/node.exe'),
  (Join-Path $installRoot 'resources/runtime/win32-x64/pnpm.cmd'),
  (Join-Path $installRoot 'resources/runtime/win32-x64/node_modules/pnpm/bin/pnpm.mjs'),
  (Join-Path $installRoot 'resources/cli/desktop-cli.mjs'),
  (Join-Path $cliDirectory 'dsh.cmd'),
  (Join-Path $cliDirectory 'manage-path.ps1'),
  (Join-Path $installRoot 'resources/bundled-plugins/manifest.json'),
  (Join-Path $installRoot 'resources/prebuilt-profile.tar'),
  (Join-Path $installRoot 'resources/prebuilt-profile.tar.sha256')
)
foreach ($path in $required) {
  if (-not (Test-Path $path)) { throw "Installed package is missing $path" }
}
# The installed application verifies and deploys this archive before reporting
# Harness readiness. Keep this split-job smoke independent of source build output.
$registeredUserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$registeredEntries = @($registeredUserPath.Split(';') | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
if (-not ($registeredEntries | Where-Object { [string]::Equals($_.TrimEnd('\', '/'), $cliDirectory.TrimEnd('\', '/'), [StringComparison]::OrdinalIgnoreCase) })) {
  throw "Silent installer did not register the exact desktop CLI directory: $cliDirectory"
}
$cliRegistration = Get-ItemProperty -Path 'HKCU:\Software\FLAQ.AI\DeepSeek Harness' -ErrorAction Stop
if ($cliRegistration.CliPathRegistered -ne 1 -or
    -not [string]::Equals($cliRegistration.CliPathDirectory, $cliDirectory, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Silent installer and Settings do not share the expected CLI registration marker.'
}

Start-SmokePhase -Name 'native-entry'
$env:DSH_HOME = $dshHome
Remove-Item -LiteralPath $desktopAppDataRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $desktopAppDataRoot -Force | Out-Null
Remove-Item -LiteralPath $harnessLog -Force -ErrorAction SilentlyContinue
$nativeSmokeRoot = Join-Path $env:RUNNER_TEMP 'DeepSeek Harness Native Smoke AppData'
Remove-Item -LiteralPath $nativeSmokeRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $nativeSmokeRoot -Force | Out-Null
$nativeSmokeStart = [System.Diagnostics.ProcessStartInfo]::new()
$nativeSmokeStart.FileName = Join-Path $installRoot 'Open DeepSeek Harness Desktop.exe'
$nativeSmokeStart.UseShellExecute = $false
$nativeSmokeStart.RedirectStandardOutput = $true
$nativeSmokeStart.RedirectStandardError = $true
$nativeSmokeStart.ArgumentList.Add('--dsh-native-smoke')
$nativeSmokeStart.ArgumentList.Add("--dsh-package-smoke-root=$nativeSmokeRoot")
$nativeSmoke = [System.Diagnostics.Process]::Start($nativeSmokeStart)
$nativeSmokeStdout = $nativeSmoke.StandardOutput.ReadToEndAsync()
$nativeSmokeStderr = $nativeSmoke.StandardError.ReadToEndAsync()
if (-not $nativeSmoke.WaitForExit(30000)) {
  $nativeSmoke.Kill($true)
  $nativeSmoke.WaitForExit()
  throw "Installed Electron entry smoke did not exit within 30 seconds.`nstdout:`n$($nativeSmokeStdout.GetAwaiter().GetResult())`nstderr:`n$($nativeSmokeStderr.GetAwaiter().GetResult())"
}
$nativeSmokeOutput = $nativeSmokeStdout.GetAwaiter().GetResult()
$nativeSmokeError = $nativeSmokeStderr.GetAwaiter().GetResult()
if ($nativeSmoke.ExitCode -ne 0 -or $nativeSmokeOutput -notmatch 'DSH_NATIVE_SMOKE_READY') {
  throw "Installed Electron entry smoke failed with $($nativeSmoke.ExitCode).`nstdout:`n$nativeSmokeOutput`nstderr:`n$nativeSmokeError"
}
Write-Host "Installed Electron entry smoke passed.`n$nativeSmokeOutput"
Start-SmokePhase -Name 'first-start'
$appStart = [System.Diagnostics.ProcessStartInfo]::new()
$appStart.FileName = Join-Path $installRoot 'Open DeepSeek Harness Desktop.exe'
$appStart.UseShellExecute = $false
$appStart.RedirectStandardOutput = $true
$appStart.RedirectStandardError = $true
$appStart.Environment['ELECTRON_ENABLE_LOGGING'] = '1'
$appStart.ArgumentList.Add("--dsh-package-smoke-root=$desktopAppDataRoot")
$app = [System.Diagnostics.Process]::Start($appStart)
$appStdout = $app.StandardOutput.ReadToEndAsync()
$appStderr = $app.StandardError.ReadToEndAsync()
$orphanStart = [System.Diagnostics.ProcessStartInfo]::new()
$orphanStart.FileName = Join-Path $installRoot 'resources/runtime/win32-x64/node.exe'
$orphanStart.UseShellExecute = $false
$orphanStart.ArgumentList.Add('-e')
$orphanStart.ArgumentList.Add('setInterval(() => {}, 1000)')
$orphanNode = [System.Diagnostics.Process]::Start($orphanStart)
$deadline = (Get-Date).AddSeconds(480)
$nextStartupProgress = (Get-Date).AddSeconds(30)
$ready = $false
try {
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    $app.Refresh()
    if ($app.HasExited) {
      $entryLog = if (Test-Path -LiteralPath $desktopEntryLog) { Get-Content -LiteralPath $desktopEntryLog -Raw } else { 'No desktop-entry.log was created.' }
      throw "Installed application exited before Harness readiness with $($app.ExitCode).`n$entryLog`nstdout:`n$($appStdout.GetAwaiter().GetResult())`nstderr:`n$($appStderr.GetAwaiter().GetResult())"
    }
    $logExists = Test-Path -LiteralPath $harnessLog
    $startupLog = if ($logExists) { Get-Content -LiteralPath $harnessLog -Raw } else { '' }
    Assert-HarnessStartupHealthy $startupLog
    if ($startupLog -match '(?m)^\[[^\r\n]+\] \[harness-stdout\] \[info\] dsh web: http://127\.0\.0\.1:\d+(?:/[^\r\n]*)?\r?$') {
      $ready = $true
      break
    }
    if ((Get-Date) -ge $nextStartupProgress) {
      $profileCreated = Test-Path (Join-Path $dshHome 'profiles/web/package.json')
      Write-Host "Waiting for first packaged startup (log=$logExists, profile=$profileCreated)."
      $nextStartupProgress = (Get-Date).AddSeconds(30)
    }
  }
  if (-not $ready) {
    if (-not $app.HasExited) {
      $app.Kill($true)
      $app.WaitForExit()
    }
    $tail = if (-not (Test-Path -LiteralPath $harnessLog)) { 'No harness.log was created.' } else { (Get-Content -LiteralPath $harnessLog -Tail 80) -join "`n" }
    $entryLog = if (Test-Path -LiteralPath $desktopEntryLog) { Get-Content -LiteralPath $desktopEntryLog -Raw } else { 'No desktop-entry.log was created.' }
    throw "Installed application did not reach Harness readiness within 480 seconds.`n$tail`n$entryLog`nstdout:`n$($appStdout.GetAwaiter().GetResult())`nstderr:`n$($appStderr.GetAwaiter().GetResult())"
  }
  # This fresh CI-only home contains no user credentials. Preserve first-boot
  # evidence before the restart clears the log.
  Write-Host "First installed startup log:`n$((Get-Content -LiteralPath $harnessLog -Tail 200) -join "`n")"
  Start-SmokePhase -Name 'process-guard'
  $guardScript = Join-Path $PSScriptRoot '../build/installer-process-guard.ps1'
  $guardOutput = & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $guardScript -Action inspect -InstallDirectory $installRoot -AppExecutable 'Open DeepSeek Harness Desktop.exe' -ExcludeProcessId $PID 2>&1
  $guardExitCode = $LASTEXITCODE
  Write-Host "Pre-upgrade process guard (exit $guardExitCode):`n$($guardOutput -join "`n")"
  if ($guardExitCode -ne 10) { throw "Process guard did not detect the running packaged application (exit $guardExitCode)" }
  $stopOutput = & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $guardScript -Action stop -InstallDirectory $installRoot -AppExecutable 'Open DeepSeek Harness Desktop.exe' -ExcludeProcessId $PID 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Process guard failed to close packaged processes:`n$($stopOutput -join "`n")" }
  if (-not $app.WaitForExit(30000)) { throw 'Process guard did not close the installed desktop application' }
  if (-not $orphanNode.WaitForExit(30000)) { throw 'Process guard did not close the installation-owned orphan Node process' }
  $decoy.Refresh()
  if ($decoy.HasExited) { throw 'Process guard incorrectly closed an unrelated process from a prefix-similar directory' }

  # Reproduce the user-visible upgrade failure without launching the installed
  # app. An external process briefly holds the top-level executable, just as a
  # virus scanner or indexer can after reboot. The installer's bounded recovery
  # must wait for release and complete the same-directory atomic upgrade.
  Start-SmokePhase -Name 'upgrade'
  $lockedExecutable = Join-Path $installRoot 'Open DeepSeek Harness Desktop.exe'
  $lockReady = Join-Path $env:RUNNER_TEMP 'dsh-upgrade-lock-ready.txt'
  Remove-Item -LiteralPath $lockReady -Force -ErrorAction SilentlyContinue
  $lockStart = [System.Diagnostics.ProcessStartInfo]::new()
  $lockStart.FileName = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
  $lockStart.UseShellExecute = $false
  $lockStart.ArgumentList.Add('-NoLogo')
  $lockStart.ArgumentList.Add('-NoProfile')
  $lockStart.ArgumentList.Add('-NonInteractive')
  $lockStart.ArgumentList.Add('-File')
  $lockStart.ArgumentList.Add((Join-Path $PSScriptRoot 'hold-file-lock.ps1'))
  $lockStart.ArgumentList.Add('-Path')
  $lockStart.ArgumentList.Add($lockedExecutable)
  $lockStart.ArgumentList.Add('-ReadyPath')
  $lockStart.ArgumentList.Add($lockReady)
  $lockStart.ArgumentList.Add('-Seconds')
  $lockStart.ArgumentList.Add('20')
  $fileLocker = [System.Diagnostics.Process]::Start($lockStart)
  $lockDeadline = (Get-Date).AddSeconds(15)
  while (-not (Test-Path -LiteralPath $lockReady) -and (Get-Date) -lt $lockDeadline) {
    Start-Sleep -Milliseconds 100
    $fileLocker.Refresh()
    if ($fileLocker.HasExited) { throw "Upgrade lock fixture exited with $($fileLocker.ExitCode)" }
  }
  if (-not (Test-Path -LiteralPath $lockReady)) { throw 'Upgrade lock fixture did not acquire the installed executable' }

  $upgrade = [System.Diagnostics.Process]::Start($installStart)
  if (-not $upgrade.WaitForExit(900000)) {
    $upgrade.Kill($true)
    throw 'Same-directory Windows upgrade did not exit within 15 minutes'
  }
  if ($upgrade.ExitCode -ne 0) { throw "Same-directory Windows upgrade exited with $($upgrade.ExitCode)" }
  if (-not $fileLocker.WaitForExit(30000)) {
    $fileLocker.Kill($true)
    throw 'Upgrade lock fixture did not release the installed executable'
  }
  if (-not (Test-Path -LiteralPath $lockedExecutable)) { throw 'Same-directory Windows upgrade did not restore the application executable' }
  $decoy.Refresh()
  if ($decoy.HasExited) { throw 'Same-directory Windows upgrade closed the prefix-similar decoy process' }

  Start-SmokePhase -Name 'restart'
  Remove-Item -LiteralPath $harnessLog -Force -ErrorAction SilentlyContinue
  $app = [System.Diagnostics.Process]::Start($appStart)
  $appStdout = $app.StandardOutput.ReadToEndAsync()
  $appStderr = $app.StandardError.ReadToEndAsync()
  $deadline = (Get-Date).AddSeconds(300)
  $ready = $false
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    $app.Refresh()
    if ($app.HasExited) { throw "Restarted application exited before Harness readiness with $($app.ExitCode)" }
    $startupLog = if (Test-Path -LiteralPath $harnessLog) { Get-Content -LiteralPath $harnessLog -Raw } else { '' }
    Assert-HarnessStartupHealthy $startupLog
    if ($startupLog -match '(?m)^\[[^\r\n]+\] \[harness-stdout\] \[info\] dsh web: http://127\.0\.0\.1:\d+(?:/[^\r\n]*)?\r?$') {
      $ready = $true
      break
    }
  }
  if (-not $ready) { throw 'Restarted Windows application did not reach Harness readiness within 300 seconds' }
  Write-Host "Restarted installed startup log:`n$((Get-Content -LiteralPath $harnessLog -Tail 200) -join "`n")"
} finally {
  if (-not $app.HasExited) {
    $null = $app.CloseMainWindow()
    if (-not $app.WaitForExit(10000)) { Stop-Process -Id $app.Id -Force }
  }
  if (-not $orphanNode.HasExited) { Stop-Process -Id $orphanNode.Id -Force }
  if (-not $decoy.HasExited) { Stop-Process -Id $decoy.Id -Force }
}

Start-SmokePhase -Name 'cli'
$cliStart = [System.Diagnostics.ProcessStartInfo]::new()
$cliStart.FileName = Join-Path $cliDirectory 'dsh.cmd'
$cliStart.UseShellExecute = $false
$cliStart.RedirectStandardOutput = $true
$cliStart.RedirectStandardError = $true
# The packaged command resolves its setup record through %APPDATA%, just as a
# normal terminal launched by the same Windows user would. Keep that lookup in
# the same private AppData root used by the installed desktop smoke above.
$cliStart.Environment['APPDATA'] = $desktopAppDataRoot
$cliStart.ArgumentList.Add('--help')
$cli = [System.Diagnostics.Process]::Start($cliStart)
if (-not $cli.WaitForExit(30000)) {
  $cli.Kill($true)
  throw 'Installed desktop dsh command did not exit within 30 seconds'
}
$cliOutput = "$($cli.StandardOutput.ReadToEnd())`n$($cli.StandardError.ReadToEnd())"
if ($cli.ExitCode -ne 0) {
  throw "Installed desktop dsh command exited with $($cli.ExitCode).`n$cliOutput"
}
if ($cliOutput -notmatch '(?i)deepseek|dsh|usage') {
  throw "Installed desktop dsh command did not print recognizable help.`n$cliOutput"
}

Start-SmokePhase -Name 'plugins'
$profileDirectory = Join-Path $dshHome 'profiles/web'
$profileManifestPath = Join-Path $profileDirectory 'package.json'
$profileLockPath = Join-Path $profileDirectory 'pnpm-lock.yaml'
if (-not (Test-Path $profileManifestPath)) { throw "Bundled plugin seed did not create $profileManifestPath" }
if (-not (Test-Path $profileLockPath)) { throw "Bundled plugin seed did not create $profileLockPath" }
$profileManifest = Get-Content $profileManifestPath -Raw | ConvertFrom-Json
$quarantinePath = Join-Path $dshHome 'quarantine/profile-plugins.json'
if (Test-Path -LiteralPath $quarantinePath) {
  Write-Host "Installed smoke quarantine evidence:`n$(Get-Content -LiteralPath $quarantinePath -Raw)"
}
$bundledManifestPath = Join-Path $installRoot 'resources/bundled-plugins/manifest.json'
$bundledManifest = Get-Content $bundledManifestPath -Raw | ConvertFrom-Json
$bundledPlugins = @($bundledManifest.plugins)
foreach ($packageName in @(
  'dshmarket', '@xmanrui/dsh-im',
  'dsh-pocket', 'dsh-better-sidebar', 'dsh-whale-widget'
)) {
  if ($bundledPlugins.PackageName -notcontains $packageName) {
    throw "Bundled plugin manifest is missing required preset $packageName"
  }
}
if ($bundledPlugins.PackageName -contains 'dsh-skill-picker') {
  throw 'Retired dsh-skill-picker must not be bundled'
}
foreach ($onlineOnlyPackage in @(
  '@deepseek-ai/dsh-subagent-codex', '@deepseek-ai/dsh-subagent-claude-code'
)) {
  if ($bundledPlugins.PackageName -contains $onlineOnlyPackage) {
    throw "Online-only external tool connector must not be bundled: $onlineOnlyPackage"
  }
  if ($null -ne $profileManifest.dependencies.PSObject.Properties[$onlineOnlyPackage]) {
    throw "Online-only external tool connector was installed without user action: $onlineOnlyPackage"
  }
}
foreach ($plugin in @($bundledPlugins | Where-Object { $_.InstallPolicy -eq 'startup' })) {
  if ($null -eq $profileManifest.dependencies.PSObject.Properties[$plugin.PackageName]) {
    throw "Bundled plugin dependency $($plugin.PackageName) is absent from $profileManifestPath"
  }
  if ($profileManifest.dsh.profile.bundles -notcontains $plugin.PackageName) {
    throw "Bundled plugin $($plugin.PackageName) is absent from the Web profile bundle list"
  }
  $markerPath = Join-Path $dshHome "bundled-plugins/$($plugin.SeedId).seeded.json"
  if (-not (Test-Path $markerPath)) { throw "Bundled plugin seed marker is missing: $markerPath" }
  $marker = Get-Content $markerPath -Raw | ConvertFrom-Json
  if ($marker.schema -ne 4 `
    -or $marker.packageName -ne $plugin.PackageName `
    -or $marker.handledBundledVersion -ne $plugin.Version `
    -or $marker.installedVersion -ne $plugin.Version `
    -or $marker.state -ne 'installed') {
    throw "Bundled plugin seed marker has unexpected package metadata: $markerPath"
  }
  $installedManifestPath = Join-Path $profileDirectory "node_modules/$($plugin.PackageName)/package.json"
  if (-not (Test-Path $installedManifestPath)) {
    throw "Bundled plugin package metadata is missing: $installedManifestPath"
  }
  $installedManifest = Get-Content $installedManifestPath -Raw | ConvertFrom-Json
  if ($installedManifest.name -ne $plugin.PackageName -or $installedManifest.version -ne $marker.installedVersion) {
    throw "Bundled plugin marker does not match the installed package: $markerPath"
  }
}
foreach ($plugin in @($bundledPlugins | Where-Object { $_.InstallPolicy -eq 'manual' })) {
  $archivePath = Join-Path $installRoot "resources/bundled-plugins/$($plugin.Archive)"
  if (-not (Test-Path $archivePath)) { throw "Manual bundled plugin archive is missing: $archivePath" }
  $markerPath = Join-Path $dshHome "bundled-plugins/$($plugin.SeedId).seeded.json"
  if ($null -ne $profileManifest.dependencies.PSObject.Properties[$plugin.PackageName]) {
    throw "Manual bundled plugin $($plugin.PackageName) was installed without user action"
  }
  if (Test-Path $markerPath) { throw "Manual bundled plugin marker exists before user action: $markerPath" }
}
$bundledFailure = (Test-Path -LiteralPath $harnessLog) -and ((Get-Content -LiteralPath $harnessLog -Raw) -match '(?m)^\[bundled-plugin\]')
if ($bundledFailure) {
  throw "Bundled plugin failure was written to $harnessLog"
}

Start-SmokePhase -Name 'uninstall'
$uninstaller = Join-Path $installRoot 'Uninstall Open DeepSeek Harness Desktop.exe'
if (-not (Test-Path $uninstaller)) { throw "Installed package is missing $uninstaller" }
$uninstallStart = [System.Diagnostics.ProcessStartInfo]::new()
$uninstallStart.FileName = $uninstaller
$uninstallStart.UseShellExecute = $false
$uninstallStart.ArgumentList.Add('/S')
$uninstall = [System.Diagnostics.Process]::Start($uninstallStart)
if (-not $uninstall.WaitForExit(180000)) {
  $uninstall.Kill($true)
  throw 'Windows uninstaller did not exit within 3 minutes'
}
if ($uninstall.ExitCode -ne 0) { throw "Windows uninstaller exited with $($uninstall.ExitCode)" }

# Electron Builder's installed uninstaller copies itself to a temporary Un_A
# process. The launcher can exit before that child finishes removing files and
# running customUnInit, so validate observable uninstall state instead of the
# launcher PID alone.
$uninstallDeadline = (Get-Date).AddMinutes(2)
do {
  $restoredUserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $remainingRegistration = Get-ItemProperty -Path 'HKCU:\Software\FLAQ.AI\DeepSeek Harness' -ErrorAction SilentlyContinue
  $pathRestored = $restoredUserPath -eq $originalUserPath
  $registrationRemoved = $null -eq $remainingRegistration.CliPathRegistered -and $null -eq $remainingRegistration.CliPathDirectory
  $installationRemoved = -not (Test-Path -LiteralPath $installRoot)
  if ($pathRestored -and $registrationRemoved -and $installationRemoved) { break }
  Start-Sleep -Milliseconds 250
} while ((Get-Date) -lt $uninstallDeadline)

if (-not $pathRestored -or -not $registrationRemoved -or -not $installationRemoved) {
  $uninstallProcesses = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -like 'Un_*.exe' -or
    (-not [string]::IsNullOrEmpty($_.ExecutablePath) -and $_.ExecutablePath.StartsWith($installRoot, [StringComparison]::OrdinalIgnoreCase))
  } | ForEach-Object { "PID $($_.ProcessId) $($_.Name) $($_.ExecutablePath)" })
  throw "Windows uninstaller did not finish restoring owned state within 2 minutes.`nBefore PATH: $originalUserPath`nAfter PATH: $restoredUserPath`nRegistration removed: $registrationRemoved`nInstallation removed: $installationRemoved`nRemaining processes:`n$($uninstallProcesses -join "`n")"
}

Write-Host 'Installed and upgraded the Windows package, precisely cleaned owned processes without touching a prefix-similar decoy, reached Harness readiness, seeded startup plugins, ran desktop dsh, kept external tools online-only, and restored PATH on uninstall.'
Complete-SmokeJournal -Outcome 'passed'
} catch {
  Complete-SmokeJournal -Outcome 'failed'
  throw
}

$ErrorActionPreference = 'Stop'

$installer = (Resolve-Path (Join-Path $PSScriptRoot '../../../.artifacts/desktop-windows/DeepSeek-Harness-windows-x64.exe')).Path
$installRoot = Join-Path $env:RUNNER_TEMP 'DeepSeek Harness 安装测试'
$dshHome = Join-Path $env:RUNNER_TEMP 'DeepSeek Harness Home'
$desktopDataRoot = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'open-deepseek-harness-desktop'
$harnessLog = Join-Path $desktopDataRoot 'logs/harness.log'
$unpackedResources = Join-Path $PSScriptRoot '../../../.artifacts/desktop-windows/win-unpacked/resources'
$cliDirectory = Join-Path $installRoot 'resources/cli-bin'
$originalUserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$processGuardDiagnostic = Join-Path $env:TEMP 'DeepSeek-Harness-process-guard.log'
Remove-Item -LiteralPath $processGuardDiagnostic -Force -ErrorAction SilentlyContinue
$similarRoot = "$installRoot-old"

foreach ($path in @(
  (Join-Path $unpackedResources 'harness/lib/bin.js'),
  (Join-Path $unpackedResources 'harness/node_modules'),
  (Join-Path $unpackedResources 'runtime/win32-x64/node.exe'),
  (Join-Path $unpackedResources 'runtime/win32-x64/pnpm.cmd'),
  (Join-Path $unpackedResources 'runtime/win32-x64/node_modules/pnpm/bin/pnpm.mjs'),
  (Join-Path $unpackedResources 'cli/desktop-cli.mjs'),
  (Join-Path $unpackedResources 'cli-bin/dsh.cmd'),
  (Join-Path $unpackedResources 'cli-bin/manage-path.ps1'),
  (Join-Path $unpackedResources 'bundled-plugins/manifest.json')
)) {
  if (-not (Test-Path $path)) { throw "Unpacked package is missing $path" }
}

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
    $installedExecutable = Test-Path (Join-Path $installRoot 'DeepSeek Harness.exe')
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
  (Join-Path $installRoot 'DeepSeek Harness.exe'),
  (Join-Path $installRoot 'resources/harness/lib/bin.js'),
  (Join-Path $installRoot 'resources/harness/node_modules'),
  (Join-Path $installRoot 'resources/runtime/win32-x64/node.exe'),
  (Join-Path $installRoot 'resources/runtime/win32-x64/pnpm.cmd'),
  (Join-Path $installRoot 'resources/runtime/win32-x64/node_modules/pnpm/bin/pnpm.mjs'),
  (Join-Path $installRoot 'resources/cli/desktop-cli.mjs'),
  (Join-Path $cliDirectory 'dsh.cmd'),
  (Join-Path $cliDirectory 'manage-path.ps1'),
  (Join-Path $installRoot 'resources/bundled-plugins/manifest.json')
)
foreach ($path in $required) {
  if (-not (Test-Path $path)) { throw "Installed package is missing $path" }
}
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

$env:DSH_HOME = $dshHome
Remove-Item -LiteralPath $harnessLog -Force -ErrorAction SilentlyContinue
$appStart = [System.Diagnostics.ProcessStartInfo]::new()
$appStart.FileName = Join-Path $installRoot 'DeepSeek Harness.exe'
$appStart.UseShellExecute = $false
$app = [System.Diagnostics.Process]::Start($appStart)
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
    if ($app.HasExited) { throw "Installed application exited before Harness readiness with $($app.ExitCode)" }
    $logExists = Test-Path -LiteralPath $harnessLog
    if ($logExists -and (Get-Content -LiteralPath $harnessLog -Raw) -match '(?m)^dsh web: http://127\.0\.0\.1:\d+(?:/[^\r\n]*)?\r?$') {
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
    $tail = if (-not (Test-Path -LiteralPath $harnessLog)) { 'No harness.log was created.' } else { (Get-Content -LiteralPath $harnessLog -Tail 80) -join "`n" }
    throw "Installed application did not reach Harness readiness within 480 seconds.`n$tail"
  }
  # This fresh CI-only home contains no user credentials. Preserve first-boot
  # evidence before the restart clears the log.
  Write-Host "First installed startup log:`n$((Get-Content -LiteralPath $harnessLog -Tail 200) -join "`n")"
  $guardScript = Join-Path $PSScriptRoot '../build/installer-process-guard.ps1'
  $guardOutput = & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $guardScript -Action inspect -InstallDirectory $installRoot -AppExecutable 'DeepSeek Harness.exe' -ExcludeProcessId $PID 2>&1
  $guardExitCode = $LASTEXITCODE
  Write-Host "Pre-upgrade process guard (exit $guardExitCode):`n$($guardOutput -join "`n")"
  if ($guardExitCode -ne 10) { throw "Process guard did not detect the running packaged application (exit $guardExitCode)" }
  $stopOutput = & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $guardScript -Action stop -InstallDirectory $installRoot -AppExecutable 'DeepSeek Harness.exe' -ExcludeProcessId $PID 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Process guard failed to close packaged processes:`n$($stopOutput -join "`n")" }
  if (-not $app.WaitForExit(30000)) { throw 'Process guard did not close the installed desktop application' }
  if (-not $orphanNode.WaitForExit(30000)) { throw 'Process guard did not close the installation-owned orphan Node process' }
  $decoy.Refresh()
  if ($decoy.HasExited) { throw 'Process guard incorrectly closed an unrelated process from a prefix-similar directory' }

  # Reproduce the user-visible upgrade failure without launching the installed
  # app. An external process briefly holds the top-level executable, just as a
  # virus scanner or indexer can after reboot. The installer's bounded recovery
  # must wait for release and complete the same-directory atomic upgrade.
  $lockedExecutable = Join-Path $installRoot 'DeepSeek Harness.exe'
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

  Remove-Item -LiteralPath $harnessLog -Force -ErrorAction SilentlyContinue
  $app = [System.Diagnostics.Process]::Start($appStart)
  $deadline = (Get-Date).AddSeconds(300)
  $ready = $false
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    $app.Refresh()
    if ($app.HasExited) { throw "Restarted application exited before Harness readiness with $($app.ExitCode)" }
    if ((Test-Path -LiteralPath $harnessLog) -and ((Get-Content -LiteralPath $harnessLog -Raw) -match '(?m)^dsh web: http://127\.0\.0\.1:\d+(?:/[^\r\n]*)?\r?$')) {
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

$cliStart = [System.Diagnostics.ProcessStartInfo]::new()
$cliStart.FileName = Join-Path $cliDirectory 'dsh.cmd'
$cliStart.UseShellExecute = $false
$cliStart.RedirectStandardOutput = $true
$cliStart.RedirectStandardError = $true
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
  'dshmarket', '@xmanrui/dsh-im', 'dsh-skill-picker',
  'dsh-pocket', 'dsh-better-sidebar'
)) {
  if ($bundledPlugins.PackageName -notcontains $packageName) {
    throw "Bundled plugin manifest is missing required preset $packageName"
  }
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
  if ($marker.packageName -ne $plugin.PackageName -or $marker.version -ne $plugin.Version) {
    throw "Bundled plugin seed marker has unexpected package metadata: $markerPath"
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

$uninstaller = Join-Path $installRoot 'Uninstall DeepSeek Harness.exe'
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

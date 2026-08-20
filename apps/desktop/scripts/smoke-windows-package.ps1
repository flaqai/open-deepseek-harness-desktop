$ErrorActionPreference = 'Stop'

$installer = (Resolve-Path (Join-Path $PSScriptRoot '../../../.artifacts/desktop-windows/DeepSeek-Harness-windows-x64.exe')).Path
$installRoot = Join-Path $env:RUNNER_TEMP 'DeepSeek Harness 安装测试'
$appData = Join-Path $env:RUNNER_TEMP 'DeepSeek Harness AppData'
$dshHome = Join-Path $env:RUNNER_TEMP 'DeepSeek Harness Home'
$unpackedResources = Join-Path $PSScriptRoot '../../../.artifacts/desktop-windows/win-unpacked/resources'

foreach ($path in @(
  (Join-Path $unpackedResources 'harness/lib/bin.js'),
  (Join-Path $unpackedResources 'harness/node_modules'),
  (Join-Path $unpackedResources 'runtime/win32-x64/node.exe'),
  (Join-Path $unpackedResources 'runtime/win32-x64/pnpm.cmd'),
  (Join-Path $unpackedResources 'runtime/win32-x64/node_modules/pnpm/bin/pnpm.mjs'),
  (Join-Path $unpackedResources 'bundled-plugins/manifest.json')
)) {
  if (-not (Test-Path $path)) { throw "Unpacked package is missing $path" }
}

$installStart = [System.Diagnostics.ProcessStartInfo]::new()
$installStart.FileName = $installer
$installStart.UseShellExecute = $false
$installStart.ArgumentList.Add('/S')
$installStart.ArgumentList.Add('/currentuser')
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

$required = @(
  (Join-Path $installRoot 'DeepSeek Harness.exe'),
  (Join-Path $installRoot 'resources/harness/lib/bin.js'),
  (Join-Path $installRoot 'resources/harness/node_modules'),
  (Join-Path $installRoot 'resources/runtime/win32-x64/node.exe'),
  (Join-Path $installRoot 'resources/runtime/win32-x64/pnpm.cmd'),
  (Join-Path $installRoot 'resources/runtime/win32-x64/node_modules/pnpm/bin/pnpm.mjs'),
  (Join-Path $installRoot 'resources/bundled-plugins/manifest.json')
)
foreach ($path in $required) {
  if (-not (Test-Path $path)) { throw "Installed package is missing $path" }
}

$env:APPDATA = $appData
$env:DSH_HOME = $dshHome
$appStart = [System.Diagnostics.ProcessStartInfo]::new()
$appStart.FileName = Join-Path $installRoot 'DeepSeek Harness.exe'
$appStart.UseShellExecute = $false
$appStart.ArgumentList.Add("--user-data-dir=$appData")
$app = [System.Diagnostics.Process]::Start($appStart)
$deadline = (Get-Date).AddSeconds(180)
$ready = $false
try {
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    $app.Refresh()
    if ($app.HasExited) { throw "Installed application exited before Harness readiness with $($app.ExitCode)" }
    $log = Get-ChildItem -Path $appData -Filter harness.log -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $log -and (Get-Content $log.FullName -Raw) -match '(?m)^dsh web: http://127\.0\.0\.1:\d+$') {
      $ready = $true
      break
    }
  }
  if (-not $ready) {
    $diagnostic = Get-ChildItem -Path $appData -Filter harness.log -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    $tail = if ($null -eq $diagnostic) { 'No harness.log was created.' } else { (Get-Content $diagnostic.FullName -Tail 80) -join "`n" }
    throw "Installed application did not reach Harness readiness within 180 seconds.`n$tail"
  }
} finally {
  if (-not $app.HasExited) {
    $null = $app.CloseMainWindow()
    if (-not $app.WaitForExit(10000)) { Stop-Process -Id $app.Id -Force }
  }
}

$profileDirectory = Join-Path $dshHome 'profiles/web'
$profileManifestPath = Join-Path $profileDirectory 'package.json'
$profileLockPath = Join-Path $profileDirectory 'pnpm-lock.yaml'
if (-not (Test-Path $profileManifestPath)) { throw "Bundled plugin seed did not create $profileManifestPath" }
if (-not (Test-Path $profileLockPath)) { throw "Bundled plugin seed did not create $profileLockPath" }
$profileManifest = Get-Content $profileManifestPath -Raw | ConvertFrom-Json
$bundledManifestPath = Join-Path $installRoot 'resources/bundled-plugins/manifest.json'
$bundledManifest = Get-Content $bundledManifestPath -Raw | ConvertFrom-Json
$bundledPlugins = @($bundledManifest.plugins)
foreach ($packageName in @('dshmarket', '@xmanrui/dsh-im', 'dsh-skill-picker')) {
  if ($bundledPlugins.PackageName -notcontains $packageName) {
    throw "Bundled plugin manifest is missing required preset $packageName"
  }
}
foreach ($plugin in $bundledPlugins) {
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
$bundledFailure = Get-ChildItem -Path $appData -Filter harness.log -File -Recurse -ErrorAction SilentlyContinue |
  Where-Object { (Get-Content $_.FullName -Raw) -match '(?m)^\[bundled-plugin\]' } |
  Select-Object -First 1
if ($null -ne $bundledFailure) {
  throw "Bundled plugin failure was written to $($bundledFailure.FullName)"
}

Write-Host 'Installed Windows package reached Harness readiness with all bundled plugins seeded.'

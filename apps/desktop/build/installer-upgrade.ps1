[CmdletBinding()]
param(
  [string]$InstallDirectory,
  [string]$UninstallerPath,
  [string]$UninstallerName,
  [string]$AppExecutable,
  [string]$UninstallArguments,
  [string]$TemporaryDirectory,
  [string]$DiagnosticDirectory
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'installer-removal.ps1') -InstallDirectory $InstallDirectory -UninstallerName $UninstallerName -DiagnosticDirectory $DiagnosticDirectory

function Get-DesktopLegacyCliState([string]$InstallDirectory) {
  if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { return $null }
  $registration = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\FLAQ.AI\DeepSeek Harness')
  $environment = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')
  try {
    $values = @{}
    foreach ($name in @('CliPathRegistered', 'CliPathDirectory')) {
      if ($null -ne $registration -and $registration.GetValueNames() -contains $name) {
        $values[$name] = @{ Value = $registration.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames); Kind = $registration.GetValueKind($name) }
      }
    }
    $present = $null -ne $environment -and $environment.GetValueNames() -contains 'Path'
    $path = if ($present) { [string]$environment.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } else { '' }
    $legacyPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ($null -eq $legacyPath) { $legacyPath = '' }
    $target = if ($values.ContainsKey('CliPathDirectory')) { [string]$values.CliPathDirectory.Value } else { Join-Path $InstallDirectory 'resources\cli-bin' }
    $remaining = @($legacyPath.Split(';') | Where-Object { -not [string]::Equals($_.Trim().Trim('"').TrimEnd('\', '/'), $target.Trim().Trim('"').TrimEnd('\', '/'), [StringComparison]::OrdinalIgnoreCase) }) -join ';'
    return @{ Values = $values; PathPresent = $present; Path = $path; RemovedPath = $remaining; PathKind = $(if ($present) { $environment.GetValueKind('Path') } else { [Microsoft.Win32.RegistryValueKind]::ExpandString }) }
  } finally {
    if ($null -ne $registration) { $registration.Dispose() }
    if ($null -ne $environment) { $environment.Dispose() }
  }
}

function Restore-DesktopLegacyCliState($State) {
  if ($null -eq $State) { return }
  $environment = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
  $registration = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\FLAQ.AI\DeepSeek Harness')
  try {
    $current = [string]$environment.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    $currentPresent = $environment.GetValueNames() -contains 'Path'
    # Restore only the exact change made by the legacy helper, never concurrent PATH edits.
    if ($current -cne $State.Path -and $current -cne $State.RemovedPath) { throw 'CLI PATH changed concurrently; automatic restoration refused.' }
    if ($currentPresent -and $State.PathPresent -and $environment.GetValueKind('Path') -ne $State.PathKind) { throw 'CLI PATH type changed concurrently; automatic restoration refused.' }
    foreach ($name in @('CliPathRegistered', 'CliPathDirectory')) {
      $present = $registration.GetValueNames() -contains $name
      if ($present) {
        if (-not $State.Values.ContainsKey($name) -or $registration.GetValue($name) -cne $State.Values[$name].Value -or $registration.GetValueKind($name) -ne $State.Values[$name].Kind) { throw 'CLI registration changed concurrently; automatic restoration refused.' }
      }
    }
    if ($current -cne $State.Path -or $currentPresent -ne $State.PathPresent) {
      if ($State.PathPresent) { $environment.SetValue('Path', $State.Path, $State.PathKind) }
      else { $environment.DeleteValue('Path', $false) }
    }
    foreach ($name in @('CliPathRegistered', 'CliPathDirectory')) {
      if ($registration.GetValueNames() -notcontains $name -and $State.Values.ContainsKey($name)) {
        $registration.SetValue($name, $State.Values[$name].Value, $State.Values[$name].Kind)
      }
    }
    [DshRemovalNative]::BroadcastEnvironmentChange()
  } finally { $environment.Dispose(); $registration.Dispose() }
}

function Get-DesktopUpgradeDirectory([string]$Directory, [switch]$AllowMissing) {
  if ([string]::IsNullOrWhiteSpace($Directory) -or -not [System.IO.Path]::IsPathRooted($Directory)) { throw 'An absolute directory is required.' }
  if ($Directory.StartsWith('\\') -or $Directory -match '^[a-zA-Z]:[^\\/]') { throw 'A local, fully qualified directory is required.' }
  $full = [System.IO.Path]::GetFullPath($Directory).TrimEnd([char[]]@('\', '/'))
  $drive = [System.IO.Path]::GetPathRoot($full).TrimEnd([char[]]@('\', '/'))
  if ($full -eq $drive) { throw 'A filesystem root is not an installation directory.' }
  if (-not $AllowMissing -and -not (Test-Path -LiteralPath $full -PathType Container)) { throw 'The installation directory does not exist.' }
  $ancestor = $full
  while (-not [string]::IsNullOrEmpty($ancestor)) {
    if (Test-Path -LiteralPath $ancestor) {
      $item = Get-Item -LiteralPath $ancestor -Force -ErrorAction Stop
      if (-not $item.PSIsContainer) { throw 'The installation directory is not a directory.' }
      if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'An installation path traverses a reparse point.' }
    }
    $ancestor = [System.IO.Path]::GetDirectoryName($ancestor)
  }
  return $full
}

function Write-DesktopUpgradeEvent([string]$Directory, [string]$Stage, [hashtable]$Fields) {
  $record = [ordered]@{ time = [DateTime]::UtcNow.ToString('o'); stage = $Stage }
  foreach ($key in $Fields.Keys) { $record[$key] = $Fields[$key] }
  Add-Content -LiteralPath (Join-Path $Directory 'upgrade.jsonl') -Value ($record | ConvertTo-Json -Compress) -Encoding UTF8 -ErrorAction Stop
}

function Invoke-DesktopUninstallerProcess([string]$Executable, [string]$Arguments, [string]$WorkingDirectory) {
  $process = $null
  try {
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $Executable
    $info.Arguments = $Arguments
    $info.WorkingDirectory = $WorkingDirectory
    $info.UseShellExecute = $false
    if ($null -ne $script:desktopRemovalBridge) {
      $info.EnvironmentVariables['DSH_REMOVAL_BRIDGE_ROOT'] = $script:desktopRemovalBridge.Root
      $info.EnvironmentVariables['DSH_REMOVAL_BRIDGE_QUARANTINE'] = $script:desktopRemovalBridge.Quarantine
    }
    $process = [System.Diagnostics.Process]::Start($info)
  } catch {
    return @{ launched = $false; errorCode = $_.Exception.HResult }
  }
  try {
    # Do not terminate an uninstaller in the middle of atomic removal or restoration.
    $process.WaitForExit()
    return @{ launched = $true; exitCode = $process.ExitCode }
  } finally { $process.Dispose() }
}

function Wait-DesktopUpgradeRetry { Start-Sleep -Seconds 5 }

function Get-DesktopUninstallerHash([string]$FilePath) {
  $stream = $null
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  try {
    $stream = [System.IO.File]::OpenRead($FilePath)
    return [System.BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '')
  } finally {
    if ($null -ne $stream) { $stream.Dispose() }
    $algorithm.Dispose()
  }
}

function Invoke-DesktopOldUninstallCore {
  param([string]$InstallDirectory, [string]$UninstallerPath, [string]$UninstallerName,
    [string]$AppExecutable, [string]$UninstallArguments, [string]$TemporaryDirectory, [string]$DiagnosticDirectory)
  $temporaryUninstaller = $null
  $diagnostics = $null
  $transaction = $null
  $committed = $false
  $cliState = $null
  try {
    $install = Get-DesktopUpgradeDirectory $InstallDirectory
    $temporary = Get-DesktopUpgradeDirectory $TemporaryDirectory
    $diagnosticRoot = Get-DesktopUpgradeDirectory $DiagnosticDirectory -AllowMissing
    foreach ($external in @($temporary, $diagnosticRoot)) {
      if ([string]::Equals($external, $install, [StringComparison]::OrdinalIgnoreCase) -or
        $external.StartsWith($install + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Temporary uninstall files and diagnostics must remain outside the old installation.'
      }
    }
    [void][System.IO.Directory]::CreateDirectory($diagnosticRoot)
    $diagnostics = Get-DesktopUpgradeDirectory $diagnosticRoot
    foreach ($name in @($UninstallerName, $AppExecutable)) {
      if ([string]::IsNullOrWhiteSpace($name) -or [System.IO.Path]::GetFileName($name) -ne $name -or $name -match '[\\/:]' -or -not $name.EndsWith('.exe', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid installation executable name.' }
    }
    if (-not [System.IO.Path]::IsPathRooted($UninstallerPath)) { throw 'The registered uninstaller path is not absolute.' }
    $registered = [System.IO.Path]::GetFullPath($UninstallerPath)
    $expected = Join-Path $install $UninstallerName
    if (-not [string]::Equals($registered, $expected, [StringComparison]::OrdinalIgnoreCase)) { throw 'The registered uninstaller does not belong to the registered installation.' }
    $binary = Get-Item -LiteralPath $registered -Force -ErrorAction Stop
    if ($binary.PSIsContainer -or ($binary.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'The registered uninstaller is not an ordinary file.' }
    $uninstallerHash = Get-DesktopUninstallerHash $registered
    if ($UninstallArguments -match '["\r\n]') { throw 'Unsafe uninstaller arguments.' }
    $words = @($UninstallArguments.Trim() -split '\s+')
    if (@($words | Where-Object { $_ -notin @('/currentuser', '/allusers', '--updated', '--keep-shortcuts') }).Count -ne 0 -or
      @($words | Where-Object { $_ -in @('/currentuser', '/allusers') }).Count -ne 1 -or
      @($words | Where-Object { $_ -eq '--updated' }).Count -ne 1 -or
      @($words | Select-Object -Unique).Count -ne $words.Count) { throw 'Unsupported or destructive uninstaller arguments.' }
    $mode = @($words | Where-Object { $_ -in @('/currentuser', '/allusers') })[0]
    Write-DesktopUpgradeEvent $diagnostics 'uninstall-start' @{ installDirectory = $install; uninstaller = $registered; mode = $mode; failedFile = 'unknown' }
    $temporaryUninstaller = Join-Path $temporary ('desktop-old-uninstaller-' + [guid]::NewGuid().ToString('N') + '.exe')
    $copyAvailable = $true
    try {
      [System.IO.File]::Copy($registered, $temporaryUninstaller, $false)
      if ($uninstallerHash -ne (Get-DesktopUninstallerHash $temporaryUninstaller)) { throw 'Temporary uninstaller integrity mismatch.' }
    } catch {
      $copyAvailable = $false
      Write-DesktopUpgradeEvent $diagnostics 'uninstaller-copy-failed' @{ errorCode = $_.Exception.HResult }
    }
    $arguments = '/S /KEEP_APP_DATA ' + $UninstallArguments.Trim() + ' _?=' + $install
    $selectedUninstaller = if ($copyAvailable) { $temporaryUninstaller } else { $registered }
    for ($attempt = 1; $attempt -le 12; $attempt += 1) {
      if ($null -eq $transaction) {
        try {
          $transaction = Start-DesktopRemovalTransaction -InstallDirectory $install -UninstallerName $UninstallerName -DiagnosticDirectory $diagnostics
        } catch {
          if ($_.Exception.Data['RemovalStage'] -ne 'stage') { throw }
          Write-DesktopUpgradeEvent $diagnostics 'uninstall-files-stage-failed' @{ attempt = $attempt; error = $_.Exception.Message; disposition = 'files-restored; legacy-not-started' }
          if ($attempt -eq 12) { return 2 }
          Wait-DesktopUpgradeRetry
          continue
        }
        $cliState = Get-DesktopLegacyCliState $install
        $script:desktopRemovalBridge = $transaction
        Write-DesktopUpgradeEvent $diagnostics 'uninstall-files-staged' @{ quarantine = $transaction.Quarantine; disposition = 'recoverable-until-legacy-success' }
      }
      $outcome = Invoke-DesktopUninstallerProcess $selectedUninstaller $arguments $temporary
      if (-not $outcome.launched -and $selectedUninstaller -ne $registered) {
        Write-DesktopUpgradeEvent $diagnostics 'temporary-launch-failed' @{ attempt = $attempt; errorCode = $outcome.errorCode }
        $selectedUninstaller = $registered
        $outcome = Invoke-DesktopUninstallerProcess $selectedUninstaller $arguments $temporary
      }
      if (-not $outcome.launched) {
        Write-DesktopUpgradeEvent $diagnostics 'uninstall-launch-failed' @{ attempt = $attempt; errorCode = $outcome.errorCode; failedFile = 'unknown'; disposition = 'installation-stopped' }
        return 3
      }
      $code = [int]$outcome.exitCode
      Write-DesktopUpgradeEvent $diagnostics 'uninstall-result' @{ attempt = $attempt; exitCode = $code; failedFile = 'unknown' }
      if ($code -eq 0) {
        if (Test-Path -LiteralPath (Join-Path $install $AppExecutable)) { throw 'The uninstaller reported success but the previous application remains.' }
        $resources = Join-Path $install 'resources'
        if (Test-Path -LiteralPath $resources) {
          if (@(Get-ChildItem -LiteralPath $resources -Force -ErrorAction Stop).Count -ne 0) { throw 'The uninstaller reported success but previous runtime files remain.' }
        }
        # In-place NSIS uninstall leaves its running executable behind. After
        # process exit, remove only the unchanged, initially validated binary.
        if (Test-Path -LiteralPath $registered) {
          $cleanupRoot = Get-DesktopUpgradeDirectory $install
          if (-not [string]::Equals((Join-Path $cleanupRoot $UninstallerName), $registered, [StringComparison]::OrdinalIgnoreCase)) { throw 'The old uninstaller location changed during cleanup.' }
          $remainingBinary = Get-Item -LiteralPath $registered -Force -ErrorAction Stop
          if ($remainingBinary.PSIsContainer -or ($remainingBinary.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'The remaining old uninstaller is not an ordinary file.' }
          if ((Get-DesktopUninstallerHash $registered) -ne $uninstallerHash) { throw 'The remaining old uninstaller changed during uninstall.' }
          [System.IO.File]::Delete($registered)
          if (Test-Path -LiteralPath $registered) { throw 'The remaining old uninstaller could not be removed.' }
          Write-DesktopUpgradeEvent $diagnostics 'old-uninstaller-removed' @{ uninstaller = $registered }
        }
        $cleanup = Complete-DesktopRemovalTransaction -Transaction $transaction
        $committed = $true
        Write-DesktopUpgradeEvent $diagnostics 'uninstall-complete' @{ exitCode = 0; cleanupWarning = $cleanup.Warning }
        return 0
      }
      if ($code -ne 2 -or $attempt -eq 12) {
        Write-DesktopUpgradeEvent $diagnostics 'uninstall-failed' @{ attempt = $attempt; exitCode = $code; failedFile = 'unknown'; disposition = 'installation-stopped; old-version-restoration-not-independently-verified' }
        return $code
      }
      Wait-DesktopUpgradeRetry
    }
    throw 'Uninstall attempt budget ended without a result.'
  } catch {
    $failure = $_.Exception
    if ($null -ne $diagnostics) {
      try { Write-DesktopUpgradeEvent $diagnostics 'uninstall-invalid-state' @{ error = $failure.Message; errorCode = $failure.HResult; disposition = 'installation-stopped' } }
      catch { [Console]::Error.WriteLine('Upgrade diagnostic log could not be written: ' + $_.Exception.Message) }
    }
    [Console]::Error.WriteLine('Old-version uninstall stopped: ' + $failure.Message)
    return 3
  } finally {
    $script:desktopRemovalBridge = $null
    if ($null -ne $transaction -and -not $committed) {
      try {
        Undo-DesktopRemovalTransaction -Transaction $transaction
        Restore-DesktopLegacyCliState $cliState
        Write-DesktopUpgradeEvent $diagnostics 'uninstall-files-restored' @{ disposition = 'files-restored; legacy-metadata-not-independently-verified' }
      } catch {
        [Console]::Error.WriteLine('Old installation restoration requires attention: ' + $_.Exception.Message + '; quarantine: ' + $transaction.Quarantine)
        throw
      }
    }
    if ($null -ne $temporaryUninstaller -and [System.IO.File]::Exists($temporaryUninstaller)) {
      try { [System.IO.File]::Delete($temporaryUninstaller) } catch { [Console]::Error.WriteLine('Temporary uninstaller cleanup failed: ' + $_.Exception.Message) }
    }
  }
}

function Invoke-DesktopOldUninstall {
  param([string]$InstallDirectory, [string]$UninstallerPath, [string]$UninstallerName,
    [string]$AppExecutable, [string]$UninstallArguments, [string]$TemporaryDirectory, [string]$DiagnosticDirectory)
  try {
    $result = Invoke-DesktopOldUninstallCore @PSBoundParameters
    return $result
  }
  catch {
    [Console]::Error.WriteLine('Old-version uninstall recovery stopped: ' + $_.Exception.Message)
    return 3
  }
}

if ($MyInvocation.InvocationName -ne '.') {
  $result = Invoke-DesktopOldUninstall -InstallDirectory $InstallDirectory -UninstallerPath $UninstallerPath -UninstallerName $UninstallerName -AppExecutable $AppExecutable -UninstallArguments $UninstallArguments -TemporaryDirectory $TemporaryDirectory -DiagnosticDirectory $DiagnosticDirectory
  [Console]::WriteLine('Old-version uninstall result: ' + $result + '; diagnostics: ' + $DiagnosticDirectory)
  exit $result
}

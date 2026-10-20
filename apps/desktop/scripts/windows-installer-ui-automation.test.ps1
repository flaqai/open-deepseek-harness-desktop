param([switch] $ModalFixture)
$ErrorActionPreference = 'Stop'
if ($ModalFixture) {
  if (-not $IsWindows) { throw 'Synthetic modal fixture requires native Windows.' }
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DesktopWizardFixtureButtonId {
  [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] public static extern IntPtr SetId(IntPtr window, int index, IntPtr value);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr window);
}
'@
  $form = [Windows.Forms.Form]::new()
  $form.Text = 'Synthetic NSIS modal regression'
  $button = [Windows.Forms.Button]::new()
  $button.Name = '1'
  $button.Text = '&Install'
  $button.Dock = [Windows.Forms.DockStyle]::Fill
  $button.Add_Click({
    [void][Windows.Forms.MessageBox]::Show('Synthetic modal barrier', 'Synthetic NSIS modal', [Windows.Forms.MessageBoxButtons]::OK)
    $form.Close()
  })
  $form.Controls.Add($button)
  [void][DesktopWizardFixtureButtonId]::SetId($button.Handle, -12, [IntPtr]::new(1))
  if ([DesktopWizardFixtureButtonId]::GetDlgCtrlID($button.Handle) -ne 1) { throw 'Synthetic Install button did not expose the real NSIS native control id.' }
  try { [void]$form.ShowDialog() } finally { $form.Dispose() }
  exit 0
}
. (Join-Path $PSScriptRoot 'windows-installer-ui-automation.ps1')
foreach ($name in @('Next >', '&Install', 'Finish', '下一步 >', '安装', '完成')) {
  if ((Get-DesktopWizardAction $name '1' $true 'Button') -ne 'advance') { throw "Expected wizard advance for $name" }
}
foreach ($name in @('Cancel', 'Retry', 'Delete everything', '安装其他软件')) {
  if ($null -ne (Get-DesktopWizardAction $name '1' $true 'Button')) { throw "Unexpected click for $name" }
}
if ($null -ne (Get-DesktopWizardAction 'Install' '1' $false 'Button')) { throw 'Disabled button accepted.' }
if ($null -ne (Get-DesktopWizardAction 'Install' '2' $true 'Button')) { throw 'Unrecognized button id accepted.' }
if ($null -ne (Get-DesktopWizardAction 'Install' '1' $true 'Text')) { throw 'Non-button accepted.' }
if ((Get-DesktopWizardAction 'Run Open DeepSeek Harness Desktop' '' $true 'CheckBox') -ne 'clear-launch') { throw 'Launch checkbox not recognized.' }
if ($IsWindows) {
  # Resolve the native window station before the expensive package build.
  # A capability probe does not observe or accept any installer wizard.
  $windowStation = Initialize-DesktopWizardAutomation
  if ([string]::IsNullOrWhiteSpace($windowStation) -or $windowStation.StartsWith('unavailable:')) {
    throw 'Native Win32 window station is unavailable.'
  }
  Write-Host 'Native Win32 window station is available; installer GUI acceptance remains separate.'
  $fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('dsh-win32-modal-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $fixtureRoot -ErrorAction Stop | Out-Null
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = (Get-Process -Id $PID).Path
  $start.UseShellExecute = $false
  foreach ($argument in @('-NoLogo', '-NoProfile', '-STA', '-File', $PSCommandPath, '-ModalFixture')) { $start.ArgumentList.Add($argument) }
  $fixture = [Diagnostics.Process]::Start($start)
  try {
    $fixtureExit = Invoke-DesktopWizardAutomation -Process $fixture -EvidenceDirectory $fixtureRoot -TimeoutSeconds 30
    if ($fixtureExit -ne 0) { throw 'Synthetic native modal fixture failed.' }
    $journalPath = Join-Path $fixtureRoot "installer-gui-$($fixture.Id).jsonl"
    $events = @(Get-Content -LiteralPath $journalPath | ForEach-Object { $_ | ConvertFrom-Json })
    $observerStart = @($events | Where-Object { $_.state -eq 'observer-started' })
    if ($observerStart.Count -ne 1 -or $observerStart[0].apartment -ne 'MTA' -or $observerStart[0].backend -ne 'win32') { throw 'Native discovery did not run on its dedicated Win32 MTA observer.' }
    $observed = @($events | Where-Object { $_.state -eq 'observed' })
    if ($observed.Count -eq 0 -or @($observed | Where-Object { $_.windowProcessId -ne $fixture.Id -or $_.windowHandle -eq 0 }).Count -ne 0) {
      throw 'Native discovery did not restrict real HWND ownership to the fixture process.'
    }
    $startEvent = @($events | Where-Object { $_.action -eq 'advance' -and $_.state -eq 'invoke-started' })
    $completeEvent = @($events | Where-Object { $_.action -eq 'advance' -and $_.state -eq 'invoke-completed' })
    $acknowledged = @($events | Where-Object { $_.action -eq 'acknowledge' -and $_.state -eq 'invoke-completed' })
    if ($startEvent.Count -ne 1 -or $completeEvent.Count -ne 1 -or $acknowledged.Count -ne 1) {
      throw 'Native modal fixture must observe and settle both Install and modal OK invocations.'
    }
    if (@($events | Where-Object { $_.state -eq 'invoke-unsettled' }).Count -ne 0) { throw 'Native modal fixture left an invocation running.' }
    Write-Host 'Synthetic native modal was observed and acknowledged while Install invocation ran; both workers settled.'
  } catch {
    # This fixture contains only synthetic labels; retain bounded observations
    # before its private directory is removed, including on preflight failure.
    $fixtureJournal = Join-Path $fixtureRoot "installer-gui-$($fixture.Id).jsonl"
    if (Test-Path -LiteralPath $fixtureJournal) {
      try {
        $fixtureDetails = [IO.File]::ReadAllText($fixtureJournal)
        Write-Host ('Synthetic modal observations: ' + $fixtureDetails.Substring(0, [Math]::Min(32768, $fixtureDetails.Length)))
      } catch { Write-Warning 'Synthetic modal observations could not be read; original qualification failure is unchanged.' }
    }
    throw
  } finally {
    # This is a synthetic test-owned form, never an installer or old uninstaller.
    if (-not $fixture.HasExited) { $fixture.Kill($true); $fixture.WaitForExit() }
    $fixture.Dispose()
    Remove-Item -LiteralPath $fixtureRoot -Recurse -Force
  }
}
Write-Host 'NSIS GUI action allowlist behavior passed; native UI observation is separately required.'

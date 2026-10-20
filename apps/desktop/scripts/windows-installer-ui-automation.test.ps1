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
  $button.Text = '&Next >'
  $button.Dock = [Windows.Forms.DockStyle]::Fill
  $header = [Windows.Forms.Label]::new()
  $header.Text = 'Choose install location'
  $header.Height = 40
  $header.Dock = [Windows.Forms.DockStyle]::Top
  $script:fixtureStage = 'next'
  $button.Add_Click({
    if ($script:fixtureStage -eq 'next') {
      $script:fixtureStage = 'install'
      $header.Text = 'Command-line integration'
      $button.Text = '&Install'
      # Keep the first WM_COMMAND pending while the same HWND advances to another page.
      while ($script:fixtureStage -ne 'done' -and -not $form.IsDisposed) {
        [Windows.Forms.Application]::DoEvents()
        [Threading.Thread]::Sleep(10)
      }
    } elseif ($script:fixtureStage -eq 'install') {
      $script:fixtureStage = 'modal'
      [void][Windows.Forms.MessageBox]::Show('Synthetic modal barrier', 'Synthetic NSIS modal', [Windows.Forms.MessageBoxButtons]::OK)
      $script:fixtureStage = 'done'
      $form.Close()
    }
  })
  $form.Controls.Add($button)
  $form.Controls.Add($header)
  [void][DesktopWizardFixtureButtonId]::SetId($button.Handle, -12, [IntPtr]::new(1))
  if ([DesktopWizardFixtureButtonId]::GetDlgCtrlID($button.Handle) -ne 1) { throw 'Synthetic Install button did not expose the real NSIS native control id.' }
  [void][DesktopWizardFixtureButtonId]::SetId($header.Handle, -12, [IntPtr]::new(1037))
  if ([DesktopWizardFixtureButtonId]::GetDlgCtrlID($header.Handle) -ne 1037) { throw 'Synthetic wizard header did not expose its real native control id.' }
  try { [void]$form.ShowDialog() } finally { $form.Dispose() }
  exit 0
}
. (Join-Path $PSScriptRoot 'windows-installer-ui-automation.ps1')
$pageDialog = [pscustomobject]@{ Id = 0; ClassName = '#32770'; Handle = [IntPtr]::new(20); Name = ''; ReadError = $null }
$pageHeader = [pscustomobject]@{ Id = 1037; ClassName = 'Static'; Handle = [IntPtr]::new(21); Name = 'Choose install location'; ReadError = $null }
$pageProgress = [pscustomobject]@{ Id = 1024; ClassName = 'Static'; Handle = [IntPtr]::new(22); Name = '1%'; ReadError = $null }
$pageButton = [pscustomobject]@{ Id = 1; ClassName = 'Button'; Handle = [IntPtr]::new(23); Name = '&Next >'; ReadError = $null }
$pageControls = @($pageDialog, $pageHeader, $pageProgress, $pageButton)
$firstPage = Get-DesktopWizardPageIdentity ([IntPtr]::new(10)) $pageControls
$pageProgress.Name = '99%'
$pageButton.Name = '&Install'
if ((Get-DesktopWizardPageIdentity ([IntPtr]::new(10)) $pageControls) -ne $firstPage) { throw 'Progress or button-label changes must not authorize another click on the same page.' }
$pageHeader.Name = 'Command-line integration'
if ((Get-DesktopWizardPageIdentity ([IntPtr]::new(10)) $pageControls) -eq $firstPage) { throw 'A newly observed wizard header must identify another page.' }
$pageHeader.Name = 'Choose install location'
$pageDialog.Handle = [IntPtr]::new(24)
if ((Get-DesktopWizardPageIdentity ([IntPtr]::new(10)) $pageControls) -eq $firstPage) { throw 'A replacement visible child dialog must identify another page.' }
# Compile the actual backend on every platform and exercise its pure classifier.
# No Win32 API is called by these portable cases.
$tokens = $null
$parseErrors = $null
$tree = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'windows-installer-ui-automation.ps1'), [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'Native GUI helper did not parse.' }
$nativeSource = $tree.Find({ param($node)
  $node -is [Management.Automation.Language.StringConstantExpressionAst] -and $node.Value.Contains('public static class DesktopWizardWin32')
}, $true)
if ($null -eq $nativeSource) { throw 'Native GUI backend source was not found.' }
Add-Type -TypeDefinition $nativeSource.Value
foreach ($className in @('Button', 'button', 'BUTTON', 'WindowsForms10.Button.app.0.1cdbad8_r3_ad1', 'windowsforms10.button.app.synthetic')) {
  if ([DesktopWizardWin32]::ControlTypeFor($className, 0) -ne 'Button') { throw "Native push button class was not recognized: $className" }
  if ([DesktopWizardWin32]::ControlTypeFor($className, 3) -ne 'CheckBox') { throw "Native checkbox class was not recognized: $className" }
  if ([DesktopWizardWin32]::ControlTypeFor($className, 7) -ne 'Text') { throw 'Group box was incorrectly classified as an actionable button.' }
}
if ([DesktopWizardWin32]::ControlTypeFor('Static', 0) -ne 'Text') { throw 'Unrelated native class was classified as a button.' }
if ([DesktopWizardWin32]::ActivationMessageFor('Button') -ne 0x111 -or [DesktopWizardWin32]::ActivationMessageFor('CheckBox') -ne 0xF5) { throw 'Push buttons must use WM_COMMAND while checkboxes retain BM_CLICK.' }
if ([DesktopWizardWin32]::ClickNotificationFor(1).ToUInt64() -ne 1 -or [DesktopWizardWin32]::ClickNotificationFor(65535).ToUInt64() -ne 65535) { throw 'BN_CLICKED must occupy HIWORD zero and preserve the actual LOWORD id.' }
foreach ($invalidId in @(-1, 65536)) {
  $rejected = $false
  try { [void][DesktopWizardWin32]::ClickNotificationFor($invalidId) } catch { $rejected = $true }
  if (-not $rejected) { throw 'WM_COMMAND must not truncate an out-of-range control id.' }
}
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
    if ($startEvent.Count -ne 2 -or $completeEvent.Count -ne 2 -or $acknowledged.Count -ne 1) {
      throw 'Native modal fixture must observe and settle Next, reused-HWND Install, and modal OK invocations.'
    }
    if ($startEvent[0].handle -ne $startEvent[1].handle -or $startEvent[0].pageIdentity -eq $startEvent[1].pageIdentity) { throw 'Native fixture did not exercise a reused button HWND on a newly observed wizard page.' }
    if (@($events | Where-Object { $_.state -eq 'invoke-started' -and $_.activation -ne 'WM_COMMAND/BN_CLICKED' }).Count -ne 0) { throw 'Native fixture must exercise real parent button notifications, not BM_CLICK.' }
    $nextCompletion = @($events | Where-Object { $_.label -eq '&Next >' -and $_.state -eq 'invoke-completed' })
    if ($nextCompletion.Count -ne 1 -or [DateTime]::Parse($nextCompletion[0].timeUtc) -lt [DateTime]::Parse($startEvent[1].timeUtc)) { throw 'Next did not remain pending until after the reused Install button was invoked.' }
    if (@($events | Where-Object { $_.state -eq 'invoke-unsettled' }).Count -ne 0) { throw 'Native modal fixture left an invocation running.' }
    Write-Host 'Synthetic nested wizard and modal completed; all three button workers settled.'
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

param([switch] $ModalFixture)
$ErrorActionPreference = 'Stop'
if ($ModalFixture) {
  if (-not $IsWindows) { throw 'Synthetic modal fixture requires native Windows.' }
  Add-Type -AssemblyName System.Windows.Forms
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
  # The real loader and desktop provider must work before the expensive package build.
  # Reading RootElement does not observe or accept any installer wizard.
  $desktopRoot = Initialize-DesktopWizardAutomation
  if ($desktopRoot -isnot [Windows.Automation.AutomationElement]) {
    throw 'UIAutomation root did not expose a native automation element.'
  }
  Write-Host 'Native UIAutomation assemblies and desktop root are available; installer GUI acceptance remains separate.'
  $fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('dsh-uia-modal-' + [Guid]::NewGuid().ToString('N'))
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
    $startEvent = @($events | Where-Object { $_.action -eq 'advance' -and $_.state -eq 'invoke-started' })
    $completeEvent = @($events | Where-Object { $_.action -eq 'advance' -and $_.state -eq 'invoke-completed' })
    $acknowledged = @($events | Where-Object { $_.action -eq 'acknowledge' -and $_.state -eq 'invoke-completed' })
    if ($startEvent.Count -ne 1 -or $completeEvent.Count -ne 1 -or $acknowledged.Count -ne 1) {
      throw 'Native modal fixture must observe and settle both Install and modal OK invocations.'
    }
    if (@($events | Where-Object { $_.state -eq 'invoke-unsettled' }).Count -ne 0) { throw 'Native modal fixture left an invocation running.' }
    Write-Host 'Synthetic native modal was observed and acknowledged while Install invocation ran; both workers settled.'
  } finally {
    # This is a synthetic test-owned form, never an installer or old uninstaller.
    if (-not $fixture.HasExited) { $fixture.Kill($true); $fixture.WaitForExit() }
    $fixture.Dispose()
    Remove-Item -LiteralPath $fixtureRoot -Recurse -Force
  }
}
Write-Host 'NSIS GUI action allowlist behavior passed; native UI observation is separately required.'

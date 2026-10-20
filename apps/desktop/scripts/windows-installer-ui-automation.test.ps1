$ErrorActionPreference = 'Stop'
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
}
Write-Host 'NSIS GUI action allowlist behavior passed; native UI observation is separately required.'

# Native NSIS wizard observation. Never treats process exit as GUI observation.
function Get-DesktopWizardAction {
  param([string] $Name, [string] $AutomationId, [bool] $Enabled, [string] $ControlType)
  if (-not $Enabled) { return $null }
  $label = ($Name -replace '&', '').Trim()
  if ($ControlType -eq 'CheckBox' -and $label -match '^(Run|Launch|运行|启动)') { return 'clear-launch' }
  if ($ControlType -ne 'Button') { return $null }
  if ($AutomationId -eq '1' -and $label -match '^(Next|Install|Finish|Close|下一步|安装|完成|关闭)(\s|[><(]|$)') { return 'advance' }
  if ($label -match '^(OK|确定|确定\(&O\))$') { return 'acknowledge' }
  return $null
}

function Invoke-DesktopWizardAutomation {
  param([System.Diagnostics.Process] $Process, [string] $EvidenceDirectory)
  if (-not $IsWindows) { throw 'NSIS wizard automation requires native Windows.' }
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  $records = [Collections.Generic.List[object]]::new()
  $deadline = (Get-Date).AddMinutes(15)
  $lastAction = ''
  $observedWindows = 0
  $advanced = 0
  $log = Join-Path $EvidenceDirectory "installer-gui-$($Process.Id).json"
  try {
    while (-not $Process.HasExited -and (Get-Date) -lt $deadline) {
      # Only this exact installer PID: never click another application or UAC prompt.
      $condition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty, $Process.Id)
      $windows = [Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children, $condition)
      foreach ($window in $windows) {
        if ($window.Current.IsOffscreen) { continue }
        $observedWindows++
        $controls = $window.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)
        $snapshot = @($controls | ForEach-Object {
          [ordered]@{ name = $_.Current.Name; id = $_.Current.AutomationId; type = $_.Current.ControlType.ProgrammaticName; enabled = $_.Current.IsEnabled }
        })
        $state = $snapshot | ConvertTo-Json -Depth 4 -Compress
        if ($state -eq $lastAction) { continue }
        if ($records.Count -ge 4096) { throw 'NSIS GUI observation exceeded its bounded evidence budget.' }
        $lastAction = $state
        $records.Add([ordered]@{ timeUtc = [DateTime]::UtcNow.ToString('o'); pid = $Process.Id; window = $window.Current.Name; controls = $snapshot })
        foreach ($control in $controls) {
          $action = Get-DesktopWizardAction -Name $control.Current.Name -AutomationId $control.Current.AutomationId -Enabled $control.Current.IsEnabled -ControlType ($control.Current.ControlType.ProgrammaticName -replace '^ControlType\.', '')
          if ($action -eq 'clear-launch') {
            $toggle = $control.GetCurrentPattern([Windows.Automation.TogglePattern]::Pattern)
            if ($toggle.Current.ToggleState -eq [Windows.Automation.ToggleState]::On) { $toggle.Toggle() }
          }
        }
        foreach ($control in $controls) {
          $action = Get-DesktopWizardAction -Name $control.Current.Name -AutomationId $control.Current.AutomationId -Enabled $control.Current.IsEnabled -ControlType ($control.Current.ControlType.ProgrammaticName -replace '^ControlType\.', '')
          if ($action -in @('advance', 'acknowledge')) {
            $records.Add([ordered]@{ timeUtc = [DateTime]::UtcNow.ToString('o'); pid = $Process.Id; action = $action; label = $control.Current.Name; id = $control.Current.AutomationId })
            $control.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
            if ($action -eq 'advance') { $advanced++ }
            break
          }
        }
      }
      Start-Sleep -Milliseconds 200
      $Process.Refresh()
    }
    if (-not $Process.HasExited) { throw "Installer PID $($Process.Id) remains running; GUI outcome unknown. Atomic uninstall was not interrupted." }
    if ($observedWindows -eq 0 -or $advanced -eq 0) { throw 'No actionable NSIS wizard was observed. Process exit is not interactive acceptance.' }
    return $Process.ExitCode
  } finally {
    [ordered]@{ schema = 'open-dsh/nsis-gui-observation/v1'; pid = $Process.Id; observedWindows = $observedWindows; advances = $advanced; records = @($records.ToArray()) } |
      ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $log -Encoding utf8
  }
}

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

function Initialize-DesktopWizardAutomation {
  if (-not $IsWindows) { throw 'NSIS wizard automation requires native Windows.' }
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  if (-not ('DesktopWizardInvokeWorker' -as [type])) {
    # Invoke can remain inside a provider until its modal dialog is dismissed.
    # The observer must remain free to discover and acknowledge that same-PID dialog.
    Add-Type -TypeDefinition @'
using System;
using System.Reflection;
using System.Threading;
public sealed class DesktopWizardInvokeWorker {
  readonly Thread thread;
  readonly object control;
  readonly object pattern;
  public volatile bool Completed;
  public string Error;
  public DesktopWizardInvokeWorker(object control, object pattern) {
    this.control = control;
    this.pattern = pattern;
    thread = new Thread(Run);
    thread.IsBackground = true;
    thread.SetApartmentState(ApartmentState.MTA);
    thread.Start();
  }
  void Run() {
    try {
      object provider = control.GetType().GetMethod("GetCurrentPattern").Invoke(control, new object[] { pattern });
      provider.GetType().GetMethod("Invoke", Type.EmptyTypes).Invoke(provider, null);
    } catch (Exception error) {
      while (error is TargetInvocationException && error.InnerException != null) error = error.InnerException;
      Error = error.GetType().Name + ": " + error.Message;
    } finally { Completed = true; }
  }
  public bool Join(int milliseconds) { return thread.Join(milliseconds); }
}
'@
  }
  $desktopRoot = [Windows.Automation.AutomationElement]::RootElement
  if ($null -eq $desktopRoot -or $null -eq $desktopRoot.Current.ControlType) {
    throw 'Native UIAutomation desktop root is unavailable; interactive qualification cannot proceed.'
  }
  return $desktopRoot
}

function Invoke-DesktopWizardAutomation {
  param([System.Diagnostics.Process] $Process, [string] $EvidenceDirectory, [ValidateRange(1, 900)] [int] $TimeoutSeconds = 900)
  $desktopRoot = Initialize-DesktopWizardAutomation
  $records = [Collections.Generic.List[object]]::new()
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastAction = ''
  $observedWindows = 0
  $advanced = 0
  $pendingInvocations = [Collections.Generic.List[object]]::new()
  $log = Join-Path $EvidenceDirectory "installer-gui-$($Process.Id).json"
  $incrementalLog = Join-Path $EvidenceDirectory "installer-gui-$($Process.Id).jsonl"
  function Write-WizardObservation {
    param($Record)
    $records.Add($Record)
    [IO.File]::AppendAllText($incrementalLog, (($Record | ConvertTo-Json -Depth 6 -Compress) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
  }
  try {
    while (-not $Process.HasExited -and (Get-Date) -lt $deadline) {
      foreach ($invocation in $pendingInvocations) {
        if (-not $invocation.Settled -and $invocation.Worker.Completed) {
          if (-not $invocation.Worker.Join(1000)) { throw 'Completed UIAutomation worker did not settle.' }
          $invocation.Settled = $true
          Write-WizardObservation ([ordered]@{ timeUtc = [DateTime]::UtcNow.ToString('o'); pid = $Process.Id; action = $invocation.Action; state = 'invoke-completed'; label = $invocation.Label; error = $invocation.Worker.Error })
          if ($null -ne $invocation.Worker.Error) { throw "Native UIAutomation invocation failed: $($invocation.Worker.Error)" }
          if ($invocation.Action -eq 'advance') { $advanced++ }
        }
      }
      # Only this exact installer PID: never click another application or UAC prompt.
      $condition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty, $Process.Id)
      $windows = $desktopRoot.FindAll([Windows.Automation.TreeScope]::Children, $condition)
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
        Write-WizardObservation ([ordered]@{ timeUtc = [DateTime]::UtcNow.ToString('o'); pid = $Process.Id; window = $window.Current.Name; state = 'observed'; controls = $snapshot })
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
            $controlKey = $control.GetRuntimeId() -join ','
            if (@($pendingInvocations | Where-Object { -not $_.Settled -and $_.Key -eq $controlKey }).Count -ne 0) { continue }
            if (@($pendingInvocations | Where-Object { -not $_.Settled }).Count -ge 16) { throw 'Native UIAutomation exceeded its pending invocation budget.' }
            $controlName = $control.Current.Name
            Write-WizardObservation ([ordered]@{ timeUtc = [DateTime]::UtcNow.ToString('o'); pid = $Process.Id; action = $action; state = 'invoke-started'; label = $controlName; id = $control.Current.AutomationId })
            $worker = [DesktopWizardInvokeWorker]::new($control, [Windows.Automation.InvokePattern]::Pattern)
            $pendingInvocations.Add([pscustomobject]@{ Worker = $worker; Key = $controlKey; Action = $action; Label = $controlName; Settled = $false })
            break
          }
        }
      }
      Start-Sleep -Milliseconds 200
      $Process.Refresh()
    }
    if (-not $Process.HasExited) { throw "Installer PID $($Process.Id) remains running; GUI outcome unknown. Atomic uninstall was not interrupted." }
    foreach ($invocation in $pendingInvocations) {
      if ($invocation.Settled) { continue }
      if (-not $invocation.Worker.Join(5000)) { throw 'Installer exited but a UIAutomation provider remains blocked; GUI outcome unknown.' }
      $invocation.Settled = $true
      Write-WizardObservation ([ordered]@{ timeUtc = [DateTime]::UtcNow.ToString('o'); pid = $Process.Id; action = $invocation.Action; state = 'invoke-completed'; label = $invocation.Label; error = $invocation.Worker.Error })
      if ($null -ne $invocation.Worker.Error) { throw "Native UIAutomation invocation failed: $($invocation.Worker.Error)" }
      if ($invocation.Action -eq 'advance') { $advanced++ }
    }
    if ($observedWindows -eq 0 -or $advanced -eq 0) { throw 'No actionable NSIS wizard was observed. Process exit is not interactive acceptance.' }
    return $Process.ExitCode
  } finally {
    foreach ($invocation in $pendingInvocations) {
      if (-not $invocation.Settled) {
        Write-WizardObservation ([ordered]@{ timeUtc = [DateTime]::UtcNow.ToString('o'); pid = $Process.Id; action = $invocation.Action; state = 'invoke-unsettled'; label = $invocation.Label })
      }
    }
    [ordered]@{ schema = 'open-dsh/nsis-gui-observation/v1'; pid = $Process.Id; observedWindows = $observedWindows; advances = $advanced; records = @($records.ToArray()) } |
      ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $log -Encoding utf8
  }
}

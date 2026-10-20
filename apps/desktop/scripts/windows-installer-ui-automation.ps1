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
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
public static class DesktopWizardNativeWindows {
  delegate bool EnumWindowCallback(IntPtr window, IntPtr state);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowCallback callback, IntPtr state);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern IntPtr GetProcessWindowStation();
  [DllImport("user32.dll")] static extern IntPtr GetThreadDesktop(uint thread);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)] static extern bool GetUserObjectInformationW(IntPtr handle, int index, StringBuilder value, uint bytes, out uint required);
  static string ObjectName(IntPtr handle) {
    var value = new StringBuilder(256);
    uint required;
    return GetUserObjectInformationW(handle, 2, value, (uint)(value.Capacity * 2), out required)
      ? value.ToString() : "unavailable:win32=" + Marshal.GetLastWin32Error();
  }
  public static string WindowStation() { return ObjectName(GetProcessWindowStation()); }
  public static string Desktop() { return ObjectName(GetThreadDesktop(GetCurrentThreadId())); }
  public static IntPtr[] ForProcess(int process) {
    var windows = new List<IntPtr>();
    EnumWindowCallback callback = delegate(IntPtr window, IntPtr state) {
      uint owner;
      GetWindowThreadProcessId(window, out owner);
      if (owner == process && IsWindowVisible(window)) windows.Add(window);
      return true;
    };
    if (!EnumWindows(callback, IntPtr.Zero)) throw new InvalidOperationException("Cannot enumerate native top-level windows.");
    GC.KeepAlive(callback);
    return windows.ToArray();
  }
}
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
  # All UIAutomation discovery and provider access stays on an MTA observer thread.
  $automationScript = (Get-Command Invoke-DesktopWizardAutomationCore).ScriptBlock.File
  $runspace = [System.Management.Automation.Runspaces.RunspaceFactory]::CreateRunspace()
  $runspace.ApartmentState = [Threading.ApartmentState]::MTA
  $runspace.ThreadOptions = [Management.Automation.Runspaces.PSThreadOptions]::ReuseThread
  $observer = [powershell]::Create()
  try {
    $runspace.Open()
    $observer.Runspace = $runspace
    [void]$observer.AddScript('param($Script, $Process, $Evidence, $Budget) $ErrorActionPreference = "Stop"; . $Script; Invoke-DesktopWizardAutomationCore -Process $Process -EvidenceDirectory $Evidence -TimeoutSeconds $Budget').AddArgument($automationScript).AddArgument($Process).AddArgument($EvidenceDirectory).AddArgument($TimeoutSeconds)
    $result = $observer.Invoke()
    if ($observer.HadErrors) { throw $observer.Streams.Error[0].Exception }
    if ($result.Count -ne 1) { throw 'Native UIAutomation observer did not return one installer exit result.' }
    return [int]$result[0]
  } finally {
    $observer.Dispose()
    $runspace.Dispose()
  }
}

function Invoke-DesktopWizardAutomationCore {
  param([System.Diagnostics.Process] $Process, [string] $EvidenceDirectory, [ValidateRange(1, 900)] [int] $TimeoutSeconds = 900)
  $null = Initialize-DesktopWizardAutomation
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
    Write-WizardObservation ([ordered]@{ timeUtc = [DateTime]::UtcNow.ToString('o'); pid = $Process.Id; state = 'observer-started'; apartment = [Threading.Thread]::CurrentThread.GetApartmentState().ToString(); observerSession = [Diagnostics.Process]::GetCurrentProcess().SessionId; installerSession = $Process.SessionId; windowStation = [DesktopWizardNativeWindows]::WindowStation(); desktop = [DesktopWizardNativeWindows]::Desktop() })
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
      # EnumWindows filters native HWND ownership before querying any UIAutomation provider.
      # Desktop-wide FindAll also visits unrelated hung providers despite a PID condition.
      foreach ($windowHandle in [DesktopWizardNativeWindows]::ForProcess($Process.Id)) {
        try {
        $window = [Windows.Automation.AutomationElement]::FromHandle($windowHandle)
        if ($window.Current.ProcessId -ne $Process.Id) { throw 'Native window ownership changed before observation.' }
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
        Write-WizardObservation ([ordered]@{ timeUtc = [DateTime]::UtcNow.ToString('o'); pid = $Process.Id; windowProcessId = $window.Current.ProcessId; windowHandle = $windowHandle.ToInt64(); window = $window.Current.Name; state = 'observed'; controls = $snapshot })
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
        } catch [Windows.Automation.ElementNotAvailableException] {
          # An observed wizard or modal may disappear immediately after its button runs.
          Write-WizardObservation ([ordered]@{ timeUtc = [DateTime]::UtcNow.ToString('o'); pid = $Process.Id; windowHandle = $windowHandle.ToInt64(); state = 'window-closed-during-observation' })
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

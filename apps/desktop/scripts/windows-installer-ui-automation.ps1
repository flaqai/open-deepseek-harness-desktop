# Native NSIS GUI qualification; no accessibility provider or desktop-wide UI query.
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

function Get-DesktopWizardPageIdentity {
  param([IntPtr] $WindowHandle, [object[]] $Controls)
  # NSIS reuses the Next HWND while replacing the visible child dialog and header.
  # Progress text, byte counts, checkbox state and arbitrary captions are not a new page.
  $pages = @($Controls | Where-Object { $_.Id -eq 0 -and $_.ClassName -eq '#32770' -and $null -eq $_.ReadError } | ForEach-Object { $_.Handle.ToInt64() })
  $headers = @($Controls | Where-Object { $_.Id -eq 1037 -and $null -eq $_.ReadError } | ForEach-Object { $_.Name })
  return ([ordered]@{ window = $WindowHandle.ToInt64(); pages = $pages; headers = $headers } | ConvertTo-Json -Depth 3 -Compress)
}

function Initialize-DesktopWizardAutomation {
  if (-not $IsWindows) { throw 'NSIS wizard automation requires native Windows.' }
  if (-not ('DesktopWizardWin32' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
public sealed class DesktopWizardControl {
  public IntPtr Handle;
  public int ProcessId, Id, Checked;
  public string Name, ClassName, ControlType, ReadError;
  public bool Enabled;
}
public static class DesktopWizardWin32 {
  public static string ControlTypeFor(string className, int style) {
    bool button = string.Equals(className, "Button", StringComparison.OrdinalIgnoreCase) || className.StartsWith("WindowsForms10.BUTTON", StringComparison.OrdinalIgnoreCase);
    return button ? ((style == 2 || style == 3 || style == 5 || style == 6) ? "CheckBox" : ((style == 0 || style == 1 || style == 11) ? "Button" : "Text")) : "Text";
  }
  delegate bool EnumCallback(IntPtr window, IntPtr state);
  [StructLayout(LayoutKind.Sequential)] struct Point { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] struct Message { public IntPtr Hwnd; public uint Msg; public UIntPtr WParam; public IntPtr LParam; public uint Time; public Point Point; public uint Private; }
  [DllImport("user32.dll", SetLastError = true)] static extern bool EnumWindows(EnumCallback callback, IntPtr state);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumCallback callback, IntPtr state);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr window);
  [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr window);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr window, StringBuilder value, int capacity);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtrW(IntPtr window, int index);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "SendMessageTimeoutW")]
  static extern IntPtr SendText(IntPtr window, uint message, UIntPtr wParam, StringBuilder text, uint flags, uint timeout, out UIntPtr result);
  [DllImport("user32.dll", SetLastError = true, EntryPoint = "SendMessageTimeoutW")]
  static extern IntPtr SendValue(IntPtr window, uint message, UIntPtr wParam, IntPtr value, uint flags, uint timeout, out UIntPtr result);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window, uint flags);
  [DllImport("user32.dll")] static extern IntPtr SetActiveWindow(IntPtr window);
  [DllImport("user32.dll", SetLastError = true)] static extern bool AttachThreadInput(uint first, uint second, bool attach);
  [DllImport("user32.dll")] static extern bool PeekMessage(out Message message, IntPtr window, uint first, uint last, uint remove);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern IntPtr GetProcessWindowStation();
  [DllImport("user32.dll")] static extern IntPtr GetThreadDesktop(uint thread);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool GetUserObjectInformationW(IntPtr handle, int index, StringBuilder value, uint bytes, out uint required);
  public static string WindowStation() { return ObjectName(GetProcessWindowStation()); }
  public static string Desktop() { return ObjectName(GetThreadDesktop(GetCurrentThreadId())); }
  static string ObjectName(IntPtr handle) {
    var value = new StringBuilder(256); uint required;
    return GetUserObjectInformationW(handle, 2, value, 512, out required) ? value.ToString() : "unavailable:win32=" + Marshal.GetLastWin32Error();
  }
  public static IntPtr[] Windows(int process) {
    var result = new List<IntPtr>();
    EnumCallback callback = delegate(IntPtr window, IntPtr state) {
      uint owner; GetWindowThreadProcessId(window, out owner);
      if (owner == process && IsWindowVisible(window)) result.Add(window);
      return true;
    };
    if (!EnumWindows(callback, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
    GC.KeepAlive(callback); return result.ToArray();
  }
  public static DesktopWizardControl[] Controls(IntPtr parent, int process) {
    var result = new List<DesktopWizardControl>();
    EnumCallback callback = delegate(IntPtr window, IntPtr state) {
      uint owner; GetWindowThreadProcessId(window, out owner);
      if (owner == process && IsWindowVisible(window)) result.Add(Read(window, process));
      return true;
    };
    EnumChildWindows(parent, callback, IntPtr.Zero);
    GC.KeepAlive(callback); return result.ToArray();
  }
  public static DesktopWizardControl Read(IntPtr window, int process) {
    uint owner; GetWindowThreadProcessId(window, out owner);
    var value = new DesktopWizardControl { Handle = window, ProcessId = (int)owner, Checked = -1 };
    if (owner != process) { value.Name = ""; value.ControlType = "Text"; value.ReadError = "Native HWND ownership changed."; return value; }
    value.Id = GetDlgCtrlID(window); value.Enabled = IsWindowEnabled(window);
    var className = new StringBuilder(256); GetClassNameW(window, className, 256); value.ClassName = className.ToString();
    int style = (int)(GetWindowLongPtrW(window, -16).ToInt64() & 15);
    value.ControlType = ControlTypeFor(value.ClassName, style);
    var text = new StringBuilder(4096); UIntPtr response;
    // WM_GETTEXT is system-marshalled. A busy control is recorded but never activated.
    if (SendText(window, 13, new UIntPtr(4096), text, 2, 1000, out response) == IntPtr.Zero) {
      value.ReadError = "WM_GETTEXT unavailable:win32=" + Marshal.GetLastWin32Error(); value.Name = ""; return value;
    }
    value.Name = text.ToString();
    if (value.ControlType == "CheckBox") {
      if (SendValue(window, 0xF0, UIntPtr.Zero, IntPtr.Zero, 2, 1000, out response) == IntPtr.Zero) value.ReadError = "BM_GETCHECK unavailable:win32=" + Marshal.GetLastWin32Error();
      else value.Checked = (int)response.ToUInt64();
    }
    return value;
  }
  public static void Click(DesktopWizardControl expected, uint timeout) {
    var actual = Read(expected.Handle, expected.ProcessId);
    if (actual.ReadError != null || !actual.Enabled || actual.Id != expected.Id || actual.Name != expected.Name || actual.ControlType != expected.ControlType || (actual.ControlType == "CheckBox" && actual.Checked != expected.Checked))
      throw new InvalidOperationException("Observed button changed before activation.");
    uint owner; uint target = GetWindowThreadProcessId(actual.Handle, out owner); uint caller = GetCurrentThreadId();
    if (target == 0 || owner != expected.ProcessId) throw new InvalidOperationException("Observed button owner changed before activation.");
    Message message; PeekMessage(out message, IntPtr.Zero, 0, 0, 0);
    bool attached = caller != target && AttachThreadInput(caller, target, true);
    if (caller != target && !attached) throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot activate the owned installer dialog input queue.");
    try { SetActiveWindow(GetAncestor(actual.Handle, 2)); }
    finally { if (attached && !AttachThreadInput(caller, target, false)) throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot detach installer input queues."); }
    UIntPtr result;
    // The worker may enter a modal loop; the observer remains free to acknowledge it.
    if (SendValue(actual.Handle, 0xF5, UIntPtr.Zero, IntPtr.Zero, 1, timeout, out result) == IntPtr.Zero)
      throw new Win32Exception(Marshal.GetLastWin32Error(), "Owned button activation failed or timed out; outcome unknown.");
    if (actual.ControlType == "CheckBox") {
      var after = Read(actual.Handle, expected.ProcessId);
      if (after.ReadError != null || after.Checked != 0) throw new InvalidOperationException("Launch checkbox was not confirmed unchecked.");
    }
  }
}
public sealed class DesktopWizardInvokeWorker {
  readonly Thread thread;
  readonly DesktopWizardControl control;
  readonly uint timeout;
  public volatile bool Completed;
  public string Error;
  public DesktopWizardInvokeWorker(DesktopWizardControl control, uint timeout) {
    this.control = control; this.timeout = timeout;
    thread = new Thread(Run); thread.IsBackground = true; thread.SetApartmentState(ApartmentState.MTA); thread.Start();
  }
  void Run() { try { DesktopWizardWin32.Click(control, timeout); } catch (Exception error) { Error = error.GetType().Name + ": " + error.Message; } finally { Completed = true; } }
  public bool Join(int milliseconds) { return thread.Join(milliseconds); }
}
'@
  }
  return [DesktopWizardWin32]::WindowStation()
}

function Invoke-DesktopWizardAutomation {
  param([System.Diagnostics.Process] $Process, [string] $EvidenceDirectory, [ValidateRange(1, 900)] [int] $TimeoutSeconds = 900)
  $automationScript = (Get-Command Invoke-DesktopWizardAutomationCore).ScriptBlock.File
  $runspace = [System.Management.Automation.Runspaces.RunspaceFactory]::CreateRunspace()
  $runspace.ApartmentState = [Threading.ApartmentState]::MTA
  $runspace.ThreadOptions = [Management.Automation.Runspaces.PSThreadOptions]::ReuseThread
  $observer = [powershell]::Create()
  try {
    $runspace.Open(); $observer.Runspace = $runspace
    [void]$observer.AddScript('param($Script, $Process, $Evidence, $Budget) $ErrorActionPreference = "Stop"; . $Script; Invoke-DesktopWizardAutomationCore -Process $Process -EvidenceDirectory $Evidence -TimeoutSeconds $Budget').AddArgument($automationScript).AddArgument($Process).AddArgument($EvidenceDirectory).AddArgument($TimeoutSeconds)
    $result = $observer.Invoke()
    if ($observer.HadErrors) { throw $observer.Streams.Error[0].Exception }
    if ($result.Count -ne 1) { throw 'Native Win32 observer did not return one installer exit result.' }
    return [int]$result[0]
  } finally { $observer.Dispose(); $runspace.Dispose() }
}

function Invoke-DesktopWizardAutomationCore {
  param([System.Diagnostics.Process] $Process, [string] $EvidenceDirectory, [ValidateRange(1, 900)] [int] $TimeoutSeconds = 900)
  $null = Initialize-DesktopWizardAutomation
  $records = [Collections.Generic.List[object]]::new()
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $pending = [Collections.Generic.List[object]]::new()
  $observation = @{ Windows = 0; Advances = 0; States = @{} }
  $log = Join-Path $EvidenceDirectory "installer-gui-$($Process.Id).json"
  $incrementalLog = Join-Path $EvidenceDirectory "installer-gui-$($Process.Id).jsonl"
  function Write-WizardObservation {
    param($Record)
    $records.Add($Record)
    [IO.File]::AppendAllText($incrementalLog, (($Record | ConvertTo-Json -Depth 6 -Compress) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
  }
  function Complete-WizardInvocations {
    param([bool] $RequireSettled)
    foreach ($invocation in $pending) {
      if ($invocation.Settled) { continue }
      if (-not $invocation.Worker.Completed -and -not $RequireSettled) { continue }
      if (-not $invocation.Worker.Join(5000)) { throw 'Native button worker remains blocked; GUI outcome unknown.' }
      $invocation.Settled = $true
      Write-WizardObservation ([ordered]@{ timeUtc = [DateTime]::UtcNow.ToString('o'); pid = $Process.Id; action = $invocation.Action; state = 'invoke-completed'; label = $invocation.Label; handle = $invocation.Handle.ToInt64(); pageIdentity = $invocation.PageIdentity; error = $invocation.Worker.Error })
      if ($null -ne $invocation.Worker.Error) { throw "Native button activation failed: $($invocation.Worker.Error)" }
      if ($invocation.Action -eq 'advance') { $observation.Advances++ }
    }
  }
  try {
    Write-WizardObservation ([ordered]@{ timeUtc = [DateTime]::UtcNow.ToString('o'); pid = $Process.Id; state = 'observer-started'; backend = 'win32'; apartment = [Threading.Thread]::CurrentThread.GetApartmentState().ToString(); observerSession = [Diagnostics.Process]::GetCurrentProcess().SessionId; installerSession = $Process.SessionId; windowStation = [DesktopWizardWin32]::WindowStation(); desktop = [DesktopWizardWin32]::Desktop() })
    while (-not $Process.HasExited -and (Get-Date) -lt $deadline) {
      Complete-WizardInvocations $false
      foreach ($windowHandle in [DesktopWizardWin32]::Windows($Process.Id)) {
        $window = [DesktopWizardWin32]::Read($windowHandle, $Process.Id)
        if ($window.ProcessId -ne $Process.Id) {
          Write-WizardObservation ([ordered]@{ timeUtc = [DateTime]::UtcNow.ToString('o'); pid = $Process.Id; windowHandle = $windowHandle.ToInt64(); windowProcessId = $window.ProcessId; state = 'window-owner-changed' })
          continue
        }
        $controls = [DesktopWizardWin32]::Controls($windowHandle, $Process.Id)
        $pageIdentity = Get-DesktopWizardPageIdentity -WindowHandle $windowHandle -Controls $controls
        $snapshot = @($controls | ForEach-Object { [ordered]@{ name = $_.Name; id = $_.Id; type = $_.ControlType; className = $_.ClassName; enabled = $_.Enabled; handle = $_.Handle.ToInt64(); readError = $_.ReadError; checked = $_.Checked } })
        $state = $snapshot | ConvertTo-Json -Depth 4 -Compress
        $key = $windowHandle.ToInt64().ToString()
        if ($observation.States[$key] -eq $state) { continue }
        if ($records.Count -ge 4096) { throw 'Native GUI observation exceeded its bounded evidence budget.' }
        $observation.States[$key] = $state; $observation.Windows++
        Write-WizardObservation ([ordered]@{ timeUtc = [DateTime]::UtcNow.ToString('o'); pid = $Process.Id; windowProcessId = $window.ProcessId; windowHandle = $windowHandle.ToInt64(); window = $window.Name; windowReadError = $window.ReadError; pageIdentity = $pageIdentity; state = 'observed'; controls = $snapshot })
        # Clear the launch option before activating Finish, regardless of native child order.
        foreach ($control in @($controls | Sort-Object { if ($_.ControlType -eq 'CheckBox') { 0 } else { 1 } })) {
          if ($null -ne $control.ReadError) { continue }
          $action = Get-DesktopWizardAction -Name $control.Name -AutomationId $control.Id.ToString() -Enabled $control.Enabled -ControlType $control.ControlType
          if ($null -eq $action -or ($action -eq 'clear-launch' -and $control.Checked -ne 1)) { continue }
          if (@($pending | Where-Object { $_.Handle -eq $control.Handle -and $_.PageIdentity -eq $pageIdentity }).Count -ne 0) { continue }
          if (@($pending | Where-Object { -not $_.Settled }).Count -ge 16) { throw 'Native GUI exceeded its pending invocation budget.' }
          Write-WizardObservation ([ordered]@{ timeUtc = [DateTime]::UtcNow.ToString('o'); pid = $Process.Id; action = $action; state = 'invoke-started'; label = $control.Name; id = $control.Id; handle = $control.Handle.ToInt64(); pageIdentity = $pageIdentity })
          $remaining = [uint32][Math]::Max(1, [Math]::Ceiling(($deadline - (Get-Date)).TotalMilliseconds))
          $worker = [DesktopWizardInvokeWorker]::new($control, $remaining)
          $pending.Add([pscustomobject]@{ Worker = $worker; Action = $action; Label = $control.Name; Handle = $control.Handle; PageIdentity = $pageIdentity; Settled = $false })
          break
        }
      }
      Start-Sleep -Milliseconds 200; $Process.Refresh()
    }
    if (-not $Process.HasExited) { throw "Installer PID $($Process.Id) remains running; GUI outcome unknown. Atomic uninstall was not interrupted." }
    Complete-WizardInvocations $true
    if ($observation.Windows -eq 0 -or $observation.Advances -eq 0) { throw 'No actionable native wizard was observed. Process exit is not interactive acceptance.' }
    return $Process.ExitCode
  } finally {
    foreach ($invocation in $pending) {
      if (-not $invocation.Settled) { Write-WizardObservation ([ordered]@{ timeUtc = [DateTime]::UtcNow.ToString('o'); pid = $Process.Id; action = $invocation.Action; state = 'invoke-unsettled'; label = $invocation.Label; handle = $invocation.Handle.ToInt64(); pageIdentity = $invocation.PageIdentity }) }
    }
    [ordered]@{ schema = 'open-dsh/nsis-gui-observation/v1'; backend = 'win32'; pid = $Process.Id; observedWindows = $observation.Windows; advances = $observation.Advances; records = @($records.ToArray()) } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $log -Encoding utf8
  }
}

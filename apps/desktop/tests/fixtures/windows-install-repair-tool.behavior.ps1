$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../../../tools/windows-install-repair/repair.ps1')
$root = Join-Path ([IO.Path]::GetTempPath()) ('odsh-repair-wrapper-' + [guid]::NewGuid().ToString('N'))

function Assert-DesktopRepairEnvironment([string]$RepairScope) {
  if ($script:EnvironmentFailure) { throw 'Simulated missing elevation or unsupported environment' }
}
function Get-DesktopRegistrationPlan([string]$Scope) {
  $script:ObservedScope = $Scope
  if ($script:InspectionFailure) { throw 'Simulated unsafe registration' }
  return [pscustomobject]@{ Scope = $Scope; Status = $script:PlanStatus; InstallDirectory = 'F:\安装 空格\Open DSH' }
}
function Confirm-DesktopRegistrationRepair($Plan, [string]$OutputRoot) { return $script:Consent }
function Invoke-DesktopRegistrationRepair($Plan, [string]$OutputRoot, [switch]$Confirmed) {
  if (-not $Confirmed) { throw 'Missing explicit confirmation' }
  $script:Mutations++
  if ($script:MutationFailure) { throw 'Simulated repair failure; backups retained' }
  return [pscustomobject]@{ Status = $script:RepairStatus; BackupDirectory = (Join-Path $OutputRoot 'backup') }
}
function Run-Case([string]$Name, [scriptblock]$Arrange, [int]$ExitCode, [int]$Mutations, [switch]$InspectOnly, [string]$Scope = 'CurrentUser') {
  $script:EnvironmentFailure = $false
  $script:InspectionFailure = $false
  $script:PlanStatus = 'Orphaned'
  $script:RepairStatus = 'Repaired'
  $script:Consent = $true
  $script:Mutations = 0
  $script:MutationFailure = $false
  $script:ObservedScope = $null
  & $Arrange
  $directory = Join-Path $root $Name
  $code = Invoke-DesktopRepairTool -RepairScope $Scope -OutputRoot $directory -InspectOnly:$InspectOnly
  if ($code -ne $ExitCode -or $script:Mutations -ne $Mutations) { throw "Unexpected repair effects: $Name code=$code mutations=$script:Mutations" }
  $report = [IO.File]::ReadAllText((Join-Path $directory 'repair-result.json')) | ConvertFrom-Json
  if ($report.scope -ne $Scope) { throw "Wrong report scope: $Name" }
  if ($ExitCode -ne 0 -and $report.status -ne 'stopped') { throw "Failure is not visible: $Name" }
  if (-not $script:EnvironmentFailure -and $script:ObservedScope -ne $Scope) { throw "Wrong inspected scope: $Name" }
  Write-Host "PASS $Name"
}

try {
  Run-Case 'already-missing' { $script:PlanStatus = 'Missing' } 0 0
  Run-Case 'live-installation-refused' { $script:PlanStatus = 'Present' } 1 0
  Run-Case 'inspect-orphan-read-only' {} 0 0 -InspectOnly
  Run-Case 'cancel-preserves-registration' { $script:Consent = $false } 0 0
  Run-Case 'confirmed-current-user' {} 0 1
  Run-Case 'confirmed-all-users' {} 0 1 -Scope AllUsers
  Run-Case 'environment-refused-before-inspection' { $script:EnvironmentFailure = $true } 1 0
  Run-Case 'unsafe-registration-refused' { $script:InspectionFailure = $true } 1 0
  Run-Case 'repair-failure-visible' { $script:MutationFailure = $true } 1 1
  Run-Case 'unknown-plan-refused' { $script:PlanStatus = 'Unknown' } 1 0
  Run-Case 'unknown-outcome-visible' { $script:RepairStatus = 'Unknown' } 1 1
} finally {
  if ([IO.Directory]::Exists($root)) { Remove-Item -LiteralPath $root -Recurse -Force }
}

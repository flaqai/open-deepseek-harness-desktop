/** Optional packaged-desktop routing for allowlisted bundled plugin installs. */

import type {
  PluginInstallId,
  PluginInstallRequest,
  PluginInstallSnapshot,
} from '@deepseek-ai/dsh-host-plugin-inventory/types'

interface DesktopBundledPluginsBridge {
  startInstall(request: PluginInstallRequest): Promise<
    | { readonly handled: false }
    | { readonly handled: true; readonly snapshot: PluginInstallSnapshot }
  >
  startDeferred?(request: PluginInstallRequest): Promise<
    | { readonly handled: false }
    | { readonly handled: true; readonly snapshot?: DesktopBundledPluginInstallSnapshot }
  >
  getInstall(installId: string): Promise<PluginInstallSnapshot>
}

/** Coarse packaged-install milestones exposed by the desktop host. */
export interface DesktopBundledPluginInstallSnapshot extends PluginInstallSnapshot {
  readonly stage: 'verifying' | 'extracting' | 'configuring'
  readonly progress: number
}

interface DesktopShellBridge {
  openLog?(): Promise<unknown>
  restart?(): Promise<unknown>
}

/** Closed identifiers for desktop-owned offline diagnostic exercises. */
export type DiagnosticLabScenarioId =
  | 'host-shadow-compatible'
  | 'host-shadow-incompatible'
  | 'orphaned-bundle'
  | 'quarantine-removal-residue'
  | 'client-module-unavailable'
  | 'loader-package-name-mismatch'
  | 'startup-operation-timeout'
  | 'loader-dependency-unavailable'
  | 'settings-invalid'
  | 'module-resolution-missing'
  | 'patch-invalid'
  | 'loader-duplicate'
  | 'loader-lifecycle-failure'
  | 'build-script-blocked'
  | 'interrupted-repair'

/** Reviewed data environments accepted by the desktop host. */
export type DiagnosticLabTarget = 'isolated' | 'active-profile'

/** One immutable scenario descriptor projected by the desktop catalog. */
export interface DiagnosticLabScenario {
  readonly id: DiagnosticLabScenarioId
  readonly title: string
  readonly description: string
  readonly expectedCode: string
  readonly targets: readonly DiagnosticLabTarget[]
}

/** One retained scenario outcome. */
export interface DiagnosticLabScenarioResult {
  readonly scenarioId: DiagnosticLabScenarioId
  readonly phase: 'passed' | 'failed' | 'cancelled'
  readonly expectedCode: string
  readonly actualCode?: string
  readonly repaired: boolean
  readonly retained: boolean
  readonly disposition?: 'repaired' | 'quarantined' | 'retained'
  readonly durationMs: number
  readonly diagnostic?: string
}

/** Renderer-safe progress and terminal state for one diagnostic run. */
export interface DiagnosticLabRunSnapshot {
  readonly schema: 2
  readonly runId: string
  readonly target: DiagnosticLabTarget
  readonly scenarioIds: readonly DiagnosticLabScenarioId[]
  readonly phase: 'queued' | 'running' | 'active' | 'restoring' | 'restored' | 'failed' | 'cancelled'
  readonly currentScenarioId?: DiagnosticLabScenarioId
  readonly currentStep?: 'baseline' | 'inject' | 'detect' | 'repair' | 'verify' | 'retain'
  readonly completedSteps: number
  readonly totalSteps: number
  readonly recovery: 'clean' | 'pending' | 'retained' | 'recovering' | 'failed'
  readonly startedAt: string
  readonly finishedAt?: string
  readonly results: readonly DiagnosticLabScenarioResult[]
  readonly diagnostic?: string
}

/** Restricted selection sent to the desktop diagnostic runner. */
export interface DiagnosticLabStartRequest {
  readonly scenarioIds: readonly DiagnosticLabScenarioId[]
  readonly target: DiagnosticLabTarget
}

interface DesktopDiagnosticLabBridge {
  catalog(): Promise<readonly DiagnosticLabScenario[]>
  current(): Promise<DiagnosticLabRunSnapshot | undefined>
  start(request: DiagnosticLabStartRequest): Promise<DiagnosticLabRunSnapshot>
  getRun(runId: string): Promise<DiagnosticLabRunSnapshot>
  cancel(runId: string): Promise<DiagnosticLabRunSnapshot>
  restoreAll(runId: string): Promise<DiagnosticLabRunSnapshot>
  exportReport(runId: string): Promise<string>
  onStatus(callback: (snapshot: DiagnosticLabRunSnapshot) => void): () => void
}

function readDesktopDiagnosticLabBridge(): DesktopDiagnosticLabBridge | undefined {
  const desktop = (globalThis as typeof globalThis & { deepSeekHarnessDesktop?: unknown }).deepSeekHarnessDesktop
  if (desktop === null || typeof desktop !== 'object') return undefined
  const lab = (desktop as { diagnosticLab?: unknown }).diagnosticLab
  if (lab === null || typeof lab !== 'object') return undefined
  const candidate = lab as Partial<DesktopDiagnosticLabBridge>
  if (typeof candidate.catalog !== 'function'
    || typeof candidate.current !== 'function'
    || typeof candidate.start !== 'function'
    || typeof candidate.getRun !== 'function'
    || typeof candidate.cancel !== 'function'
    || typeof candidate.restoreAll !== 'function'
    || typeof candidate.exportReport !== 'function'
    || typeof candidate.onStatus !== 'function') return undefined
  return candidate as DesktopDiagnosticLabBridge
}

/**
 * Report whether Electron exposed the restricted Diagnostics Lab capability.
 * @returns True in source and packaged desktop windows with the matching preload bridge.
 */
export function desktopDiagnosticLabAvailable(): boolean {
  return readDesktopDiagnosticLabBridge() !== undefined
}

/**
 * Read the reviewed desktop scenario catalog.
 * @returns The immutable scenarios supplied by the desktop host.
 */
export async function listDesktopDiagnosticLabScenarios(): Promise<readonly DiagnosticLabScenario[]> {
  const bridge = readDesktopDiagnosticLabBridge()
  if (bridge === undefined) throw new Error('desktop diagnostic lab bridge is unavailable')
  return bridge.catalog()
}

/**
 * Recover the latest desktop-owned run after Harness reloads the renderer.
 * @returns The active or latest run, or undefined before the first exercise.
 */
export async function getCurrentDesktopDiagnosticLabRun(): Promise<DiagnosticLabRunSnapshot | undefined> {
  const bridge = readDesktopDiagnosticLabBridge()
  if (bridge === undefined) throw new Error('desktop diagnostic lab bridge is unavailable')
  return bridge.current()
}

/**
 * Start one restricted desktop diagnostic run.
 * @param request - Closed scenario and target selection.
 * @returns Initial desktop-owned run state.
 */
export async function startDesktopDiagnosticLab(request: DiagnosticLabStartRequest): Promise<DiagnosticLabRunSnapshot> {
  const bridge = readDesktopDiagnosticLabBridge()
  if (bridge === undefined) throw new Error('desktop diagnostic lab bridge is unavailable')
  return bridge.start(request)
}

/**
 * Poll one desktop diagnostic run.
 * @param runId - Opaque run id returned by the desktop host.
 * @returns Latest run state.
 */
export async function getDesktopDiagnosticLabRun(runId: string): Promise<DiagnosticLabRunSnapshot> {
  const bridge = readDesktopDiagnosticLabBridge()
  if (bridge === undefined) throw new Error('desktop diagnostic lab bridge is unavailable')
  return bridge.getRun(runId)
}

/**
 * Cancel one desktop diagnostic run at its next safe boundary.
 * @param runId - Opaque run id returned by the desktop host.
 * @returns State observed when cancellation was requested.
 */
export async function cancelDesktopDiagnosticLabRun(runId: string): Promise<DiagnosticLabRunSnapshot> {
  const bridge = readDesktopDiagnosticLabBridge()
  if (bridge === undefined) throw new Error('desktop diagnostic lab bridge is unavailable')
  return bridge.cancel(runId)
}

/**
 * Restore every file and dependency retained by a completed desktop exercise.
 * @param runId - Opaque run id returned by the desktop host.
 * @returns Restored run state retained for reporting.
 */
export async function restoreAllDesktopDiagnosticLabRun(runId: string): Promise<DiagnosticLabRunSnapshot> {
  const bridge = readDesktopDiagnosticLabBridge()
  if (bridge === undefined) throw new Error('desktop diagnostic lab bridge is unavailable')
  return bridge.restoreAll(runId)
}

/**
 * Export one redacted desktop diagnostic report.
 * @param runId - Opaque run id returned by the desktop host.
 * @returns Structured JSON report text.
 */
export async function exportDesktopDiagnosticLabRun(runId: string): Promise<string> {
  const bridge = readDesktopDiagnosticLabBridge()
  if (bridge === undefined) throw new Error('desktop diagnostic lab bridge is unavailable')
  return bridge.exportReport(runId)
}

/**
 * Subscribe to desktop-owned diagnostic progress.
 * @param callback - Consumer for immutable snapshots.
 * @returns Idempotent listener disposer.
 */
export function subscribeDesktopDiagnosticLab(callback: (snapshot: DiagnosticLabRunSnapshot) => void): () => void {
  const bridge = readDesktopDiagnosticLabBridge()
  return bridge === undefined ? () => {} : bridge.onStatus(callback)
}

function readDesktopBundledPluginsBridge(): DesktopBundledPluginsBridge | undefined {
  const desktop = (globalThis as typeof globalThis & { deepSeekHarnessDesktop?: unknown }).deepSeekHarnessDesktop
  if (desktop === null || typeof desktop !== 'object') return undefined
  const bundledPlugins = (desktop as { bundledPlugins?: unknown }).bundledPlugins
  if (bundledPlugins === null || typeof bundledPlugins !== 'object') return undefined
  const candidate = bundledPlugins as Partial<DesktopBundledPluginsBridge>
  if (typeof candidate.startInstall !== 'function' || typeof candidate.getInstall !== 'function') return undefined
  return candidate as DesktopBundledPluginsBridge
}

function readDesktopShellBridge(): DesktopShellBridge | undefined {
  const desktop = (globalThis as typeof globalThis & { deepSeekHarnessDesktop?: unknown }).deepSeekHarnessDesktop
  if (desktop === null || typeof desktop !== 'object') return undefined
  const shell = (desktop as { shell?: unknown }).shell
  return shell !== null && typeof shell === 'object' ? shell : undefined
}

/**
 * Start an allowlisted deferred packaged-plugin job without falling back to Host Remote.
 * @param request - Structured profile and package spec selected by a trusted client flow.
 * @returns The initial desktop-owned job, or undefined when the bridge does not own it.
 */
export async function startDeferredPluginInstall(
  request: PluginInstallRequest,
): Promise<DesktopBundledPluginInstallSnapshot | undefined> {
  const bridge = readDesktopBundledPluginsBridge()
  if (bridge?.startDeferred === undefined) return undefined
  const result = await bridge.startDeferred(request)
  return result.handled ? result.snapshot : undefined
}

/**
 * Poll one desktop-owned deferred installation.
 * @param installId - Stable id returned by the desktop bridge.
 * @returns The current desktop-owned installation snapshot.
 */
export async function getDeferredPluginInstall(
  installId: PluginInstallId,
): Promise<DesktopBundledPluginInstallSnapshot> {
  const bridge = readDesktopBundledPluginsBridge()
  if (bridge === undefined) throw new Error('desktop bundled plugin bridge is unavailable')
  return bridge.getInstall(String(installId)) as Promise<DesktopBundledPluginInstallSnapshot>
}

/**
 * Reveal the existing desktop Harness log without exposing a filesystem primitive.
 * @returns Whether the trusted desktop shell bridge handled the request.
 */
export async function openDesktopHarnessLog(): Promise<boolean> {
  const bridge = readDesktopShellBridge()
  if (bridge?.openLog === undefined) return false
  await bridge.openLog()
  return true
}

/**
 * Ask the trusted desktop host to relaunch the application.
 * @returns Whether the trusted desktop shell bridge handled the request.
 */
export async function restartDesktopApplication(): Promise<boolean> {
  const bridge = readDesktopShellBridge()
  if (bridge?.restart === undefined) return false
  await bridge.restart()
  return true
}

/**
 * Prefer an exact packaged archive when main owns the request; otherwise use Host Remote.
 * @param request - Structured profile and package spec selected by the user.
 * @param fallback - Guarded Host Remote installer for requests outside the desktop allowlist.
 * @returns The desktop-owned or Host-owned installation snapshot.
 */
export async function startPluginInstall(
  request: PluginInstallRequest,
  fallback: (request: PluginInstallRequest) => Promise<PluginInstallSnapshot>,
): Promise<PluginInstallSnapshot> {
  const bridge = readDesktopBundledPluginsBridge()
  if (bridge !== undefined) {
    const result = await bridge.startInstall(request)
    if (result.handled) return result.snapshot
  }
  return fallback(request)
}

/**
 * Poll desktop-owned ids through Electron and ordinary ids through Host Remote.
 * @param installId - Stable id returned by the selected installation owner.
 * @param fallback - Guarded Host Remote poller for non-desktop ids.
 * @returns The current installation snapshot.
 */
export async function getPluginInstall(
  installId: PluginInstallId,
  fallback: (installId: PluginInstallId) => Promise<PluginInstallSnapshot>,
): Promise<PluginInstallSnapshot> {
  if (String(installId).startsWith('desktop-bundled:')) {
    const bridge = readDesktopBundledPluginsBridge()
    if (bridge === undefined) throw new Error('desktop bundled plugin bridge is unavailable')
    return bridge.getInstall(String(installId))
  }
  return fallback(installId)
}

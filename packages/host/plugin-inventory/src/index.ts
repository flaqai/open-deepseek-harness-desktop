/** Host plugin inventory and controlled profile-plugin installation. */

import { randomUUID } from 'node:crypto'
import { extname } from 'node:path'
import z from '@deepseek-ai/schemastery'
import type { Context, FiberState } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import {
  clearLastProfileRepairReport,
  clearQuarantinedProfilePlugin,
  classifyProfileDiagnostic,
  inspectProfileImmutableAgentInputMutation,
  inspectProfileLegacySessionApi,
  profileDiagnosticRuleCatalog,
  listQuarantinedProfilePlugins,
  reconcileRestoredQuarantinedProfilePlugins,
  readLastProfileRepairReport,
  readProfileDiagnosticReport,
  uninstallQuarantinedProfilePlugin,
  type ProfileDependencyConflict,
  type ProfileRepairReport,
  type QuarantinedProfilePlugin,
  type ProfileDiagnostic,
  type ProfileDiagnosticReport,
} from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-agent-presets'
import * as ToolSubagent from '@deepseek-ai/dsh-tool-subagent'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import type {
  AgentPresetPluginGroup,
  PluginEntryId,
  PluginDoctorId,
  PluginDoctorRequest,
  PluginDoctorSnapshot,
  PluginBuildApprovalRequest,
  PluginDiagnosticBuildApprovalRequest,
  PluginClientLoadFailureRequest,
  PluginClientLoadRecoveryResult,
  PluginDiagnosticExport,
  PluginFiberPhase,
  PluginInventoryEntry,
  PluginInventorySnapshot,
  PluginInstallId,
  PluginInstallRequest,
  PluginInstallSnapshot,
  PluginQuarantineRequest,
  PluginRepairNoticeRequest,
  PluginUninstallRequest,
  ExternalToolsSnapshot,
  ExternalToolId,
  ExternalToolToggleRequest,
} from './types.ts'

export type * from './types.ts'

/** Brand an existing Loader-tree entry id at the owning boundary. */
function pluginEntryId(value: string): PluginEntryId {
  return value as PluginEntryId
}

/** Runtime mirror: FiberState is a cross-package const enum. */
const FIBER_STATE = {
  PENDING: 0 as FiberState.PENDING,
  LOADING: 1 as FiberState.LOADING,
  ACTIVE: 2 as FiberState.ACTIVE,
  FAILED: 3 as FiberState.FAILED,
  DISPOSED: 4 as FiberState.DISPOSED,
  UNLOADING: 5 as FiberState.UNLOADING,
} as const

/** Complete public projection of Cordis Fiber states. */
const FIBER_PHASE = {
  [FIBER_STATE.PENDING]: 'pending',
  [FIBER_STATE.LOADING]: 'loading',
  [FIBER_STATE.ACTIVE]: 'active',
  [FIBER_STATE.FAILED]: 'failed',
  [FIBER_STATE.DISPOSED]: null,
  [FIBER_STATE.UNLOADING]: 'unloading',
} as const satisfies Record<FiberState, PluginFiberPhase>

/** Default cap for each collected package-manager stream. */
export const DEFAULT_INSTALL_OUTPUT_MAX_BYTES = 64 * 1024

/** Default grace before a cancelled installer process is killed. */
export const DEFAULT_INSTALL_TERMINATION_GRACE_MS = 3_000

/** Profile plugin-installer resource policy. */
export interface Config {
  /** Maximum retained bytes for each installer output stream. */
  installOutputMaxBytes?: number
  /** Process-tree termination grace used during Host teardown. */
  installTerminationGraceMs?: number
  /** Profile whose dependency health is projected to clients. */
  profile?: string
}

/** Mutable job record kept behind immutable Remote snapshots. */
interface InstallJob {
  snapshot: PluginInstallSnapshot
  target: string
  steps: readonly {
    readonly args: readonly string[]
    readonly acceptedExitCodes?: readonly number[]
  }[]
  quarantineId?: string
}

const CLIENT_LOADER_ENTRY_ID = /^[A-Za-z0-9._~-]{1,128}$/u
const CLIENT_MODULE_REQUEST = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)(?:\/[a-z0-9._~/-]+)?$/iu

/** Mutable doctor process retained until the client finishes polling it. */
interface DoctorJob {
  snapshot: PluginDoctorSnapshot
  target: string
  repair: boolean
}

/** Brand one generated installation id. */
function pluginInstallId(value: string): PluginInstallId {
  return value as PluginInstallId
}

/** Brand one generated dependency-doctor id. */
function pluginDoctorId(value: string): PluginDoctorId {
  return value as PluginDoctorId
}

/** npm registry package specifier accepted by the installer Remote. */
const REGISTRY_PACKAGE_SPEC = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)(?:@[a-z0-9][a-z0-9._+~-]*)?$/iu
const REGISTRY_PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/iu
const QUARANTINE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const REPAIR_REPORT_PREFIX = 'dsh: profile dependency health '

/** Product-specific tool bindings kept out of the generic preset package. */
const EXTERNAL_TOOL_CONFIGS = {
  codex: {
    provider: 'codex',
    toolName: 'subagent_codex',
    usageHint: 'Codex is connected through the subagent_codex tool. When the user asks to use Codex or asks for work to be done in Codex, call subagent_codex instead of searching for or invoking a Codex CLI through shell tools.',
    backgroundMode: 'one-shot',
    maxDepth: 'provider-managed',
  },
  'claude-code': {
    provider: 'claude-code',
    toolName: 'subagent_claude_code',
    usageHint: 'Claude Code is connected through the subagent_claude_code tool. When the user asks to use Claude Code or asks for work to be done in Claude Code, call subagent_claude_code instead of searching for or invoking a Claude CLI through shell tools.',
    backgroundMode: 'one-shot',
    maxDepth: 'provider-managed',
  },
} as const satisfies Record<ExternalToolId, ToolSubagent.Config>

/** Reject paths, URLs, flags, and shell text at the Host wire boundary. */
function validateInstallRequest(request: PluginInstallRequest): void {
  validateProfile(request.profile)
  if (!REGISTRY_PACKAGE_SPEC.test(request.packageSpec)) {
    throw new TypeError(`pluginInventory: invalid registry package spec ${JSON.stringify(request.packageSpec)}`)
  }
}

function validateProfile(profile: string): void {
  if (profile === '' || profile === '.' || profile === '..'
    || profile === 'node_modules' || profile.includes('/') || profile.includes('\\')) {
    throw new TypeError(`pluginInventory: invalid profile ${JSON.stringify(profile)}`)
  }
}

function validateUninstallRequest(request: PluginUninstallRequest): void {
  validateProfile(request.profile)
  if (!REGISTRY_PACKAGE_NAME.test(request.packageName)) {
    throw new TypeError(`pluginInventory: invalid registry package name ${JSON.stringify(request.packageName)}`)
  }
}

function validateQuarantineId(quarantineId: string): void {
  if (!QUARANTINE_ID.test(quarantineId)) {
    throw new TypeError(`pluginInventory: invalid quarantine id ${JSON.stringify(quarantineId)}`)
  }
}

function retryPackageSpec(record: QuarantinedProfilePlugin): string {
  if (!REGISTRY_PACKAGE_NAME.test(record.packageName)) {
    throw new TypeError(`pluginInventory: invalid quarantined package name ${JSON.stringify(record.packageName)}`)
  }
  if (record.packageSpec === '' || /[\0\r\n]/u.test(record.packageSpec)) {
    throw new TypeError('pluginInventory: invalid quarantined package spec')
  }
  return record.packageSpec
}

function projectConflict(conflict: ProfileDependencyConflict) {
  return {
    rootPackage: conflict.rootPackage,
    dependencyChain: conflict.dependencyChain,
    dependency: conflict.dependency,
    declaredRange: conflict.declaredRange,
    declaredIn: conflict.declaredIn,
    hostVersion: conflict.hostVersion,
    compatible: conflict.compatible,
  }
}

function projectQuarantine(record: QuarantinedProfilePlugin) {
  return {
    quarantineId: record.quarantineId,
    profile: record.profile,
    packageName: record.packageName,
    packageSpec: record.packageSpec,
    ...(record.installedVersion === undefined ? {} : { installedVersion: record.installedVersion }),
    quarantinedAt: record.quarantinedAt,
    reason: record.reason,
    ...(record.hostCompatibility === undefined
      ? {}
      : {
        hostCompatibility: {
          hostVersion: record.hostCompatibility.hostVersion,
          supportedHostVersions: record.hostCompatibility.supportedHostVersions,
          ...(record.hostCompatibility.recommendedHostVersion === undefined
            ? {}
            : { recommendedHostVersion: record.hostCompatibility.recommendedHostVersion }),
          ...(record.hostCompatibility.previewTag === undefined
            ? {}
            : { previewTag: record.hostCompatibility.previewTag }),
        },
      }),
    ...(record.buildApprovalKey === undefined ? {} : { buildApprovalKey: record.buildApprovalKey }),
    conflicts: record.conflicts.map(projectConflict),
  }
}

function readCurrentDiagnostics(profile: string): ProfileDiagnosticReport | undefined {
  try {
    return readProfileDiagnosticReport(profile)
  } catch (error) {
    return {
      schema: 'dsh/profile-diagnostic/v2',
      profile,
      generatedAt: new Date().toISOString(),
      status: 'issues',
      issues: [classifyProfileDiagnostic({
        source: 'config',
        phase: 'preflight',
        value: error,
      })],
    }
  }
}

function liveLoaderDiagnostic(entry: {
  readonly id: string
  readonly options: { readonly name: string }
  readonly fiber?: { readonly state: FiberState; readonly inject: Record<string, unknown>; readonly ctx: Context }
}): ProfileDiagnostic | undefined {
  if (entry.fiber?.state !== FIBER_STATE.FAILED && entry.fiber?.state !== FIBER_STATE.PENDING) return undefined
  const attribution = { entryId: entry.id, moduleName: entry.options.name }
  if (entry.fiber.state === FIBER_STATE.PENDING) {
    const missing = Object.keys(entry.fiber.inject).filter(service => entry.fiber?.ctx.get(service) === undefined)
    return classifyProfileDiagnostic({
      source: 'loader',
      phase: 'activate',
      attribution,
      value: `${entry.options.name}: pending (waiting for services: ${missing.join(', ') || 'unknown'})`,
    })
  }
  return classifyProfileDiagnostic({
    source: 'loader',
    phase: 'activate',
    attribution,
    value: `${entry.options.name}: activation failed`,
  })
}

/** Remove local filesystem paths from one core doctor report. */
function projectDoctorReport(report: ProfileRepairReport) {
  return {
    schema: report.schema,
    diagnosticSchema: report.diagnosticSchema ?? 'dsh/profile-diagnostic/v2' as const,
    profile: report.profile,
    status: report.status,
    conflicts: report.conflicts.map(projectConflict),
    orphanedBundles: (report.orphanedBundles ?? []).map(bundle => ({
      profile: bundle.profile,
      packageName: bundle.packageName,
      bundleIndex: bundle.bundleIndex,
      ...(bundle.installedVersion === undefined ? {} : { installedVersion: bundle.installedVersion }),
    })),
    quarantined: report.quarantined.map(projectQuarantine),
    issues: report.issues ?? [],
    ...(report.diagnostic === undefined ? {} : { diagnostic: report.diagnostic }),
  }
}

function parseRepairReport(diagnostic: string): ProfileRepairReport | undefined {
  try {
    const value = JSON.parse(diagnostic.trim()) as Partial<ProfileRepairReport>
    if (value.schema === 'dsh/profile-dependency-repair/v1') return value as ProfileRepairReport
  } catch {
    // Install and update commands mix the structured one-line report with pnpm output below.
  }
  for (const line of diagnostic.split('\n')) {
    const offset = line.indexOf(REPAIR_REPORT_PREFIX)
    if (offset < 0) continue
    try {
      const value = JSON.parse(line.slice(offset + REPAIR_REPORT_PREFIX.length)) as Partial<ProfileRepairReport>
      if (value.schema === 'dsh/profile-dependency-repair/v1') {
        return value as ProfileRepairReport
      }
    } catch {
      // A third-party package-manager line can contain the prefix; only complete product JSON is authoritative.
    }
  }
}

/**
 * Reconstruct the current dsh launcher without forwarding unrelated Node
 * debugging flags. Source runs retain only their active TypeScript import
 * hook; built runs execute the JavaScript entry directly.
 */
function dshLauncherArgv(): readonly string[] {
  const entry = process.argv[1]
  if (entry === undefined || entry === '') throw new Error('pluginInventory: dsh launcher entry is unavailable')
  if (extname(entry) !== '.ts') return [process.execPath, entry]

  for (let index = 0; index < process.execArgv.length; index += 1) {
    const argument = process.execArgv[index]
    if (argument === undefined) continue
    if (argument.startsWith('--import=')) return [process.execPath, argument, entry]
    const importTarget = process.execArgv[index + 1]
    if (argument === '--import' && importTarget !== undefined) {
      return [process.execPath, argument, importTarget, entry]
    }
  }
  throw new Error('pluginInventory: TypeScript launcher has no active --import hook')
}

/**
 * Preserve the desktop-selected Profile and package manager across the
 * subprocess service's intentional `DSH_*` environment scrub. Other ambient
 * Harness variables stay excluded: plugin maintenance only needs these
 * host-owned paths, and forwarding the whole namespace would weaken the
 * subprocess boundary.
 */
function profileCommandEnvironment(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const forwarded: NodeJS.ProcessEnv = {}
  if (environment.DSH_HOME !== undefined && environment.DSH_HOME.trim() !== '') {
    forwarded.DSH_HOME = environment.DSH_HOME
  }
  if (environment.DSH_PNPM_BIN !== undefined && environment.DSH_PNPM_BIN.trim() !== '') {
    forwarded.DSH_PNPM_BIN = environment.DSH_PNPM_BIN
  }
  if (environment.DSH_DESKTOP_MUTATION_OWNER_PID !== undefined) {
    forwarded.DSH_DESKTOP_MUTATION_OWNER_PID = environment.DSH_DESKTOP_MUTATION_OWNER_PID
  }
  for (const name of ['DSH_DESKTOP_APPLICATION_VERSION', 'DSH_DESKTOP_PNPM_VERSION'] as const) {
    if (environment[name] !== undefined) forwarded[name] = environment[name]
  }
  if (environment.DSH_DESKTOP_BUNDLED_PLUGINS_DIR !== undefined
    && environment.DSH_DESKTOP_BUNDLED_PLUGINS_DIR.trim() !== '') {
    forwarded.DSH_DESKTOP_BUNDLED_PLUGINS_DIR = environment.DSH_DESKTOP_BUNDLED_PLUGINS_DIR
  }
  for (const name of [
    'DSH_DESKTOP_PACKAGE_PROXY_URL', 'DSH_DESKTOP_DOWNLOAD_NETWORK_FILE', 'npm_config_registry',
  ] as const) {
    const value = environment[name]
    if (value !== undefined && value.trim() !== '') forwarded[name] = value
  }
  return forwarded
}

/** Remote-only service exposing Loader inventory and controlled profile installation. */
export class PluginInventoryGateway extends TypertRemoteService {
  static inject = ['loader', 'subprocess']
  static Config: z<Config> = z.object({
    installOutputMaxBytes: z.natural().min(1).default(DEFAULT_INSTALL_OUTPUT_MAX_BYTES),
    installTerminationGraceMs: z.natural().min(1).default(DEFAULT_INSTALL_TERMINATION_GRACE_MS),
    profile: z.string().default('web'),
  })

  private readonly jobs = new Map<PluginInstallId, InstallJob>()
  private readonly doctorJobs = new Map<PluginDoctorId, DoctorJob>()
  private readonly activeTargets = new Map<string, PluginInstallId>()
  private readonly clientLoadRecoveries = new Map<string, Promise<PluginClientLoadRecoveryResult>>()
  private readonly outputMaxBytes: number
  private readonly terminationGraceMs: number
  private readonly profile: string

  constructor(ctx: Context, config: Config) {
    super(ctx, 'pluginInventory')
    this.outputMaxBytes = config.installOutputMaxBytes ?? DEFAULT_INSTALL_OUTPUT_MAX_BYTES
    this.terminationGraceMs = config.installTerminationGraceMs ?? DEFAULT_INSTALL_TERMINATION_GRACE_MS
    this.profile = config.profile ?? 'web'
    validateProfile(this.profile)
    ctx.inject(['agentPresets'], (presetCtx) => {
      const dispose = presetCtx.agentPresets.registerExternalToolProjector((agent, tool) => {
        const fiber = agent.ctx.plugin(ToolSubagent, EXTERNAL_TOOL_CONFIGS[tool])
        return () => fiber.dispose()
      })
      presetCtx.effect(() => dispose, 'pluginInventory.externalToolProjector()')
    })
  }

  /**
   * Read the Loader directly on every call. Cordis's internal plugin/status
   * events already maintain Entry.fiber and Fiber.state, so a second cache
   * would only add another lifecycle truth to keep synchronized.
   *
   * When an agent-preset roster is composed, the snapshot also carries each
   * preset's composition rows, because those rows — not the Loader's own
   * entries — are where a deployment that mounts the roster runs its
   * model-facing plugins.
   * @returns Current non-group Loader entries in Loader order, with per-preset
   * compositions when a roster is composed.
   */
  @Remote('list')
  async list(): Promise<PluginInventorySnapshot> {
    const entries: PluginInventoryEntry[] = []
    const liveIssues: ProfileDiagnostic[] = []
    const activePackageNames = new Set<string>()
    for (const entry of this.ctx.loader.entries()) {
      if (entry.fiber?.state === FIBER_STATE.ACTIVE) activePackageNames.add(entry.options.name)
      if (entry.options.group) continue
      entries.push({
        entryId: pluginEntryId(entry.id),
        moduleName: entry.options.name,
        enabled: !entry.disabled,
        fiberPhase: entry.fiber === undefined ? null : FIBER_PHASE[entry.fiber.state],
      })
      const liveIssue = liveLoaderDiagnostic(entry)
      if (liveIssue !== undefined) liveIssues.push(liveIssue)
    }
    reconcileRestoredQuarantinedProfilePlugins(
      { binName: 'dsh', profile: this.profile },
      activePackageNames,
    )
    const lastRepair = readLastProfileRepairReport(this.profile)
    const currentDiagnostics = readCurrentDiagnostics(this.profile)
    const issues = [
      ...(currentDiagnostics?.issues ?? []),
      ...inspectProfileLegacySessionApi({ binName: 'dsh', profile: this.profile }),
      ...inspectProfileImmutableAgentInputMutation({ binName: 'dsh', profile: this.profile }),
    ]
    for (const issue of liveIssues) {
      if (issues.some(candidate => candidate.code === issue.code
        && candidate.attribution?.entryId === issue.attribution?.entryId)) continue
      issues.push(issue)
    }
    const presets = this.ctx.get('agentPresets')
    const agentPresets: AgentPresetPluginGroup[] | undefined = presets === undefined
      ? undefined
      : (await presets.compositionInventory()).map(composition => ({
        ...composition,
        rows: composition.rows.map(({ fiberState, ...row }) => ({
          ...row,
          fiberPhase: fiberState === undefined ? null : FIBER_PHASE[fiberState],
        })),
      }))
    return {
      entries,
      ...(agentPresets === undefined ? {} : { agentPresets }),
      dependencyHealth: {
        lastRepair: lastRepair === undefined || lastRepair.status === 'healthy' || lastRepair.status === 'repaired'
          ? null
          : {
            status: lastRepair.status,
            conflicts: lastRepair.conflicts.map(projectConflict),
            issues: lastRepair.issues ?? issues,
            ...(lastRepair.diagnostic === undefined ? {} : { diagnostic: lastRepair.diagnostic }),
          },
        quarantined: listQuarantinedProfilePlugins()
          .filter(record => record.profile === this.profile)
          .map(projectQuarantine),
        issues,
        diagnosticMode: currentDiagnostics?.diagnosticMode ?? currentDiagnostics?.safeMode ?? null,
      },
    }
  }

  /**
   * Read Host connections projected into complete Agent Presets.
   * @returns fixed-provider enablement for later turns.
   */
  @Remote('externalTools')
  async externalTools(): Promise<ExternalToolsSnapshot> {
    const presets = this.ctx.get('agentPresets')
    if (presets === undefined) return { scope: 'complete-presets', codex: false, claudeCode: false }
    return await presets.externalToolsState()
  }

  /**
   * Toggle one supported provider at the next safe Agent boundary.
   * @param request - fixed product id and desired later-turn visibility.
   * @returns updated managed-preset state.
   */
  @Remote('setExternalTool')
  async setExternalTool(request: ExternalToolToggleRequest): Promise<ExternalToolsSnapshot> {
    const tool: unknown = request.tool
    if (tool !== 'codex' && tool !== 'claude-code') {
      throw new TypeError(`pluginInventory: unsupported external tool ${JSON.stringify(tool)}`)
    }
    const presets = this.ctx.get('agentPresets')
    if (presets === undefined) throw new Error('pluginInventory: agent preset roster is unavailable')
    return await presets.setExternalTool(tool, request.enabled)
  }

  /**
   * Dismiss the retained repair notification without changing plugin state.
   * @param request - exposed profile identity.
   * @returns true when a notification was removed.
   */
  @Remote('dismissDependencyHealth')
  dismissDependencyHealth(request: PluginRepairNoticeRequest): boolean {
    validateProfile(request.profile)
    if (request.profile !== this.profile) throw new TypeError('pluginInventory: profile is not exposed by this host')
    return clearLastProfileRepairReport(request.profile)
  }

  /**
   * Quarantine one directly configured Profile bundle after the browser kernel proves a
   * module-table invariant failure, then request a bounded Host restart. The request is
   * intentionally narrower than the ordinary installer: the caller cannot supply a path,
   * package specifier, command, or arbitrary diagnostic text.
   * @param request - parsed client Loader attribution and closed failure code.
   * @returns durable quarantine outcome and whether the launcher accepted a restart request.
   */
  @Remote('recoverClientLoadFailure')
  async recoverClientLoadFailure(
    request: PluginClientLoadFailureRequest,
  ): Promise<PluginClientLoadRecoveryResult> {
    const code: unknown = request.code
    if (code !== 'client-module-unavailable'
      || !REGISTRY_PACKAGE_NAME.test(request.packageName)
      || !CLIENT_LOADER_ENTRY_ID.test(request.entryId)
      || !CLIENT_MODULE_REQUEST.test(request.requestedModule)) {
      throw new TypeError('pluginInventory: invalid client Loader recovery request')
    }
    const target = `client-load\0${this.profile}\0${request.packageName}`
    const current = this.clientLoadRecoveries.get(target)
    if (current !== undefined) return current
    const recovery = this.runClientLoadRecovery(target, request)
    this.clientLoadRecoveries.set(target, recovery)
    try {
      return await recovery
    } finally {
      if (this.clientLoadRecoveries.get(target) === recovery) this.clientLoadRecoveries.delete(target)
    }
  }

  /**
   * Remove one quarantined plugin after it has left the active profile.
   * @param request - opaque durable quarantine id.
   * @returns true when the plugin and record were removed.
   */
  @Remote('uninstallQuarantine')
  uninstallQuarantine(request: PluginQuarantineRequest): boolean {
    validateQuarantineId(request.quarantineId)
    const record = this.expectQuarantine(request.quarantineId)
    if (record.profile !== this.profile) throw new TypeError('pluginInventory: quarantine belongs to another profile')
    return uninstallQuarantinedProfilePlugin(request.quarantineId)
  }

  /**
   * Reinstall the exact package version retained by one quarantine record.
   * @param request - opaque durable quarantine id.
   * @returns initial running state, or the existing matching running state.
   */
  @Remote('startQuarantineRetry')
  startQuarantineRetry(request: PluginQuarantineRequest): PluginInstallSnapshot {
    validateQuarantineId(request.quarantineId)
    const record = this.expectQuarantine(request.quarantineId)
    if (record.profile !== this.profile) throw new TypeError('pluginInventory: quarantine belongs to another profile')
    const packageSpec = retryPackageSpec(record)
    const target = `quarantine\0${record.profile}\0${request.quarantineId}`
    const activeId = this.activeTargets.get(target)
    if (activeId !== undefined) return this.expectJob(activeId).snapshot

    const installId = pluginInstallId(randomUUID())
    const snapshot: PluginInstallSnapshot = {
      installId,
      profile: record.profile,
      packageSpec,
      command: `dsh plugin --profile ${record.profile} doctor --retry ${request.quarantineId}`,
      phase: 'running',
    }
    const job: InstallJob = {
      snapshot,
      target,
      steps: [{ args: ['doctor', '--retry', request.quarantineId] }],
      quarantineId: request.quarantineId,
    }
    this.jobs.set(installId, job)
    this.activeTargets.set(target, installId)
    void this.runInstall(job)
    return snapshot
  }

  /**
   * Approve one retained exact build key and retry only its quarantined plugin.
   * @param request - Quarantine selected after a separate user confirmation.
   * @returns Initial running state, or the existing mutation for this quarantine.
   */
  @Remote('approveQuarantineBuild')
  approveQuarantineBuild(request: PluginBuildApprovalRequest): PluginInstallSnapshot {
    validateQuarantineId(request.quarantineId)
    const record = this.expectQuarantine(request.quarantineId)
    if (record.profile !== this.profile) throw new TypeError('pluginInventory: quarantine belongs to another profile')
    if (record.reason !== 'build-script-blocked' || record.buildApprovalKey === undefined) {
      throw new TypeError('pluginInventory: quarantine has no exact blocked build key')
    }
    const packageSpec = retryPackageSpec(record)
    const target = `quarantine\0${record.profile}\0${request.quarantineId}`
    const activeId = this.activeTargets.get(target)
    if (activeId !== undefined) return this.expectJob(activeId).snapshot

    const installId = pluginInstallId(randomUUID())
    const snapshot: PluginInstallSnapshot = {
      installId,
      profile: record.profile,
      packageSpec,
      command: `dsh plugin --profile ${record.profile} approve retained build and retry ${record.packageName}`,
      phase: 'running',
    }
    const job: InstallJob = {
      snapshot,
      target,
      steps: [
        { args: ['approve-build-key', record.buildApprovalKey], acceptedExitCodes: [0] },
        { args: ['doctor', '--retry', request.quarantineId] },
      ],
      quarantineId: request.quarantineId,
    }
    this.jobs.set(installId, job)
    this.activeTargets.set(target, installId)
    void this.runInstall(job)
    return snapshot
  }

  /**
   * Approve the exact build key retained by a failed install and retry its original package specifier.
   * @param request - Opaque diagnostic id selected after a separate user confirmation.
   * @returns Initial running state, or the existing matching approval operation.
   */
  @Remote('approveDiagnosticBuild')
  approveDiagnosticBuild(request: PluginDiagnosticBuildApprovalRequest): PluginInstallSnapshot {
    if (!QUARANTINE_ID.test(request.diagnosticId)) {
      throw new TypeError(`pluginInventory: invalid diagnostic id ${JSON.stringify(request.diagnosticId)}`)
    }
    const diagnostic = readProfileDiagnosticReport(this.profile)?.issues
      .find(issue => issue.diagnosticId === request.diagnosticId)
    const packageSpec = diagnostic?.attribution?.rootPackage
    if (diagnostic?.code !== 'pnpm.build-script-blocked'
      || diagnostic.buildApprovalKey === undefined
      || packageSpec === undefined
      || packageSpec === ''
      || packageSpec.length > 4096
      || /[\0\r\n]/u.test(packageSpec)) {
      throw new TypeError('pluginInventory: diagnostic has no approvable build operation')
    }
    const target = `diagnostic-build\0${this.profile}\0${request.diagnosticId}`
    const activeId = this.activeTargets.get(target)
    if (activeId !== undefined) return this.expectJob(activeId).snapshot

    const installId = pluginInstallId(randomUUID())
    const snapshot: PluginInstallSnapshot = {
      installId,
      profile: this.profile,
      packageSpec,
      command: `dsh plugin --profile ${this.profile} approve retained build and retry install`,
      phase: 'running',
    }
    const job: InstallJob = {
      snapshot,
      target,
      steps: [
        { args: ['approve-build-key', diagnostic.buildApprovalKey], acceptedExitCodes: [0] },
        { args: ['add', packageSpec] },
      ],
    }
    this.jobs.set(installId, job)
    this.activeTargets.set(target, installId)
    void this.runInstall(job)
    return snapshot
  }

  /**
   * Export the current redacted incident, runtime facts, quarantine state, and Loader summary.
   * @returns Portable JSON that intentionally excludes local paths, credentials, and raw configuration bodies.
  */
  @Remote('exportDiagnostics')
  async exportDiagnostics(): Promise<string> {
    const snapshot = await this.list()
    const report: PluginDiagnosticExport = {
      schema: 'dsh/profile-diagnostic-export/v1',
      diagnosticSchema: 'dsh/profile-diagnostic/v2',
      rulesVersion: 2,
      rules: profileDiagnosticRuleCatalog(),
      generatedAt: new Date().toISOString(),
      runtime: {
        platform: process.platform,
        architecture: process.arch,
        node: process.version,
      },
      profile: this.profile,
      diagnosticMode: snapshot.dependencyHealth.diagnosticMode,
      issues: snapshot.dependencyHealth.issues,
      quarantined: snapshot.dependencyHealth.quarantined,
      entries: snapshot.entries,
    }
    return `${JSON.stringify(report, undefined, 2)}\n`
  }

  /**
   * Start one structured `dsh plugin --profile … add …` invocation. Repeated
   * clicks on the same running target return that job instead of spawning a
   * concurrent package-manager writer.
   * @param request - validated profile and npm registry package specifier.
   * @returns initial running state, or the existing matching running state.
   */
  @Remote('startInstall')
  startInstall(request: PluginInstallRequest): PluginInstallSnapshot {
    validateInstallRequest(request)
    const target = `add\0${request.profile}\0${request.packageSpec}`
    const activeId = this.activeTargets.get(target)
    if (activeId !== undefined) return this.expectJob(activeId).snapshot

    const installId = pluginInstallId(randomUUID())
    const snapshot: PluginInstallSnapshot = {
      installId,
      profile: request.profile,
      packageSpec: request.packageSpec,
      command: `dsh plugin --profile ${request.profile} add ${request.packageSpec}`,
      phase: 'running',
    }
    const job: InstallJob = { snapshot, target, steps: [{ args: ['add', request.packageSpec] }] }
    this.jobs.set(installId, job)
    this.activeTargets.set(target, installId)
    void this.runInstall(job)
    return snapshot
  }

  /**
   * Start one guarded profile package removal through the product CLI.
   * @param request - Validated profile and package identity to remove.
   * @returns The new or already-running removal job snapshot.
   */
  @Remote('startUninstall')
  startUninstall(request: PluginUninstallRequest): PluginInstallSnapshot {
    validateUninstallRequest(request)
    const target = `remove\0${request.profile}\0${request.packageName}`
    const activeId = this.activeTargets.get(target)
    if (activeId !== undefined) return this.expectJob(activeId).snapshot

    const installId = pluginInstallId(randomUUID())
    const snapshot: PluginInstallSnapshot = {
      installId,
      profile: request.profile,
      packageSpec: request.packageName,
      command: `dsh plugin --profile ${request.profile} remove ${request.packageName}`,
      phase: 'running',
    }
    const job: InstallJob = { snapshot, target, steps: [{ args: ['remove', request.packageName] }] }
    this.jobs.set(installId, job)
    this.activeTargets.set(target, installId)
    void this.runInstall(job)
    return snapshot
  }

  /**
   * Start a read-only dependency check or the guarded core repair policy.
   * @param request - exposed profile and requested mutation mode.
   * @returns initial running state, or the matching operation already in progress.
   */
  @Remote('startDependencyDoctor')
  startDependencyDoctor(request: PluginDoctorRequest): PluginDoctorSnapshot {
    validateProfile(request.profile)
    if (request.profile !== this.profile) throw new TypeError('pluginInventory: profile is not exposed by this host')
    const target = `doctor\0${request.profile}\0${request.repair ? 'repair' : 'inspect'}`
    const existing = [...this.doctorJobs.values()].find(job => job.target === target && job.snapshot.phase === 'running')
    if (existing !== undefined) return existing.snapshot

    const doctorId = pluginDoctorId(randomUUID())
    const snapshot: PluginDoctorSnapshot = {
      doctorId,
      profile: request.profile,
      command: `dsh plugin --profile ${request.profile} doctor${request.repair ? ' --repair' : ''}`,
      phase: 'running',
    }
    const job = { snapshot, target, repair: request.repair }
    this.doctorJobs.set(doctorId, job)
    void this.runDoctor(job)
    return snapshot
  }

  /**
   * Read one dependency-doctor operation without consuming its result.
   * @param doctorId - id returned by {@link startDependencyDoctor}.
   * @returns latest immutable doctor state.
   */
  @Remote('getDependencyDoctor')
  getDependencyDoctor(doctorId: PluginDoctorId): PluginDoctorSnapshot {
    const job = this.doctorJobs.get(doctorId)
    if (job === undefined) throw new Error(`pluginInventory: unknown doctor ${doctorId}`)
    return job.snapshot
  }

  /**
   * Read one installation without extending its lifetime or consuming output.
   * @param installId - id returned by {@link startInstall}.
   * @returns latest immutable installation state.
   */
  @Remote('getInstall')
  getInstall(installId: PluginInstallId): PluginInstallSnapshot {
    return this.expectJob(installId).snapshot
  }

  /** Resolve one known job or fail loud for stale and fabricated ids. */
  private expectJob(installId: PluginInstallId): InstallJob {
    const job = this.jobs.get(installId)
    if (job === undefined) throw new Error(`pluginInventory: unknown install ${installId}`)
    return job
  }

  /** Resolve one durable quarantine record or reject a stale client selection. */
  private expectQuarantine(quarantineId: string): QuarantinedProfilePlugin {
    const record = listQuarantinedProfilePlugins().find(candidate => candidate.quarantineId === quarantineId)
    if (record === undefined) throw new Error(`pluginInventory: unknown quarantine ${quarantineId}`)
    return record
  }

  /** Run the product CLI through the managed subprocess capability. */
  private async runInstall(job: InstallJob): Promise<void> {
    try {
      const launcher = dshLauncherArgv()
      const outputs: string[] = []
      let exitCode: number | null = 1
      const environment = profileCommandEnvironment()
      const staged = environment.DSH_DESKTOP_MUTATION_OWNER_PID !== undefined
      const steps: InstallJob['steps'] = staged && job.steps.length > 1
        ? [{ args: ['batch', JSON.stringify(job.steps)] }] : job.steps
      for (const [index, step] of steps.entries()) {
        const handle = this.ctx.subprocess.spawn({
          argv: [
            ...launcher,
            'plugin', '--profile', job.snapshot.profile, ...step.args,
          ],
          cwd: process.cwd(),
          env: environment,
          stdio: {
            stdin: 'ignore',
            stdout: { maxBytes: this.outputMaxBytes },
            stderr: { maxBytes: this.outputMaxBytes },
          },
          graceMs: this.terminationGraceMs,
        })
        const outcome = await handle.done
        exitCode = outcome.exitCode
        const stdout = handle.collected.stdout?.readFrom(0).text.trim() ?? ''
        const stderr = handle.collected.stderr?.readFrom(0).text.trim() ?? ''
        outputs.push(...[stdout, stderr].filter(value => value !== ''))
        const accepted = step.acceptedExitCodes ?? (index + 1 < steps.length ? [0] : undefined)
        if (accepted !== undefined && !accepted.includes(exitCode ?? -1)) break
      }
      const diagnostic = outputs.join('\n')
      const repair = parseRepairReport(diagnostic)
      const repairSucceeded = repair?.status === 'repaired' && exitCode === 10
        || repair?.status === 'quarantined' && exitCode === 11
        || repair?.status === 'healthy' && exitCode === 0
      const phase = exitCode !== 0 && !repairSucceeded
        ? 'failed'
        : repair?.status === 'quarantined'
          ? 'quarantined'
          : repair?.status === 'repaired'
            ? 'repaired'
            : 'succeeded'
      job.snapshot = {
        ...job.snapshot,
        phase,
        exitCode,
        ...(diagnostic !== '' && (exitCode !== 0 || repair !== undefined) ? { diagnostic } : {}),
      }
      if (!staged && job.quarantineId !== undefined && (phase === 'succeeded' || phase === 'repaired')) {
        clearQuarantinedProfilePlugin(job.quarantineId)
      }
    } catch (error) {
      job.snapshot = {
        ...job.snapshot,
        phase: 'failed',
        diagnostic: error instanceof Error ? error.message : String(error),
      }
    } finally {
      this.activeTargets.delete(job.target)
    }
  }

  /** Run the product-owned quarantine command and restart only after its record is durable. */
  private async runClientLoadRecovery(
    target: string,
    request: PluginClientLoadFailureRequest,
  ): Promise<PluginClientLoadRecoveryResult> {
    const installId = pluginInstallId(randomUUID())
    const snapshot: PluginInstallSnapshot = {
      installId,
      profile: this.profile,
      packageSpec: request.packageName,
      command: `dsh plugin --profile ${this.profile} doctor --quarantine-client-module ${request.packageName}`,
      phase: 'running',
    }
    const job: InstallJob = {
      snapshot,
      target,
      steps: [{
        args: [
          'doctor', '--quarantine-client-module',
          request.packageName, request.entryId, request.requestedModule,
        ],
      }],
    }
    this.jobs.set(installId, job)
    this.activeTargets.set(target, installId)
    await this.runInstall(job)
    if (job.snapshot.phase !== 'quarantined') {
      return { packageName: request.packageName, status: 'failed', restartScheduled: false }
    }
    if (process.env.DSH_DESKTOP_MUTATION_OWNER_PID !== undefined) {
      return { packageName: request.packageName, status: 'quarantined', restartScheduled: true }
    }
    const exit = this.ctx.get('appExit') as ((code: number) => void) | undefined
    if (exit === undefined) {
      return { packageName: request.packageName, status: 'quarantined', restartScheduled: false }
    }
    setTimeout(() => { exit(0) }, 150)
    return { packageName: request.packageName, status: 'quarantined', restartScheduled: true }
  }

  /** Run the built-in doctor through the same managed subprocess boundary as plugin mutations. */
  private async runDoctor(job: DoctorJob): Promise<void> {
    try {
      const launcher = dshLauncherArgv()
      const handle = this.ctx.subprocess.spawn({
        argv: [
          ...launcher,
          'plugin', '--profile', job.snapshot.profile, 'doctor',
          ...(job.repair ? ['--repair'] : []),
        ],
        cwd: process.cwd(),
        env: profileCommandEnvironment(),
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: this.outputMaxBytes },
          stderr: { maxBytes: this.outputMaxBytes },
        },
        graceMs: this.terminationGraceMs,
      })
      const outcome = await handle.done
      const stdout = handle.collected.stdout?.readFrom(0).text.trim() ?? ''
      const stderr = handle.collected.stderr?.readFrom(0).text.trim() ?? ''
      const diagnostic = [stdout, stderr].filter(value => value !== '').join('\n')
      const report = parseRepairReport(stdout) ?? parseRepairReport(stderr)
      const expectedExit = outcome.exitCode === 0
        || (!job.repair && outcome.exitCode === 2)
        || (job.repair && (outcome.exitCode === 10 || outcome.exitCode === 11))
      const phase = report === undefined || !expectedExit
        ? 'failed'
        : report.status === 'healthy'
          ? 'healthy'
          : !job.repair
            ? 'issues'
            : report.status
      job.snapshot = {
        ...job.snapshot,
        phase,
        exitCode: outcome.exitCode,
        ...(report === undefined ? {} : { report: projectDoctorReport(report) }),
        ...(diagnostic === '' || phase !== 'failed' ? {} : { diagnostic }),
      }
    } catch (error) {
      job.snapshot = {
        ...job.snapshot,
        phase: 'failed',
        diagnostic: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

export default PluginInventoryGateway

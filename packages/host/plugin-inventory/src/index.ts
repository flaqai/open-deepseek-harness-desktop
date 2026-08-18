/** Host plugin inventory and controlled profile-plugin installation. */

import { extname } from 'node:path'
import z from '@deepseek-ai/schemastery'
import type { Context, FiberState } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-subprocess'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import type {
  PluginEntryId,
  PluginFiberPhase,
  PluginInventoryEntry,
  PluginInventorySnapshot,
  PluginInstallId,
  PluginInstallRequest,
  PluginInstallSnapshot,
  PluginUninstallRequest,
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
}

/** Mutable job record kept behind immutable Remote snapshots. */
interface InstallJob {
  snapshot: PluginInstallSnapshot
  target: string
  operation: 'add' | 'remove'
}

/** Brand one generated installation id. */
function pluginInstallId(value: string): PluginInstallId {
  return value as PluginInstallId
}

/** npm registry package specifier accepted by the installer Remote. */
const REGISTRY_PACKAGE_SPEC = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)(?:@[a-z0-9][a-z0-9._+~-]*)?$/iu
const REGISTRY_PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/iu

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

/** Remote-only service exposing Loader inventory and controlled profile installation. */
export class PluginInventoryGateway extends TypertRemoteService {
  static inject = ['loader', 'subprocess']
  static Config: z<Config> = z.object({
    installOutputMaxBytes: z.natural().min(1).default(DEFAULT_INSTALL_OUTPUT_MAX_BYTES),
    installTerminationGraceMs: z.natural().min(1).default(DEFAULT_INSTALL_TERMINATION_GRACE_MS),
  })

  private readonly jobs = new Map<PluginInstallId, InstallJob>()
  private readonly activeTargets = new Map<string, PluginInstallId>()
  private readonly outputMaxBytes: number
  private readonly terminationGraceMs: number

  constructor(ctx: Context, config: Config) {
    super(ctx, 'pluginInventory')
    this.outputMaxBytes = config.installOutputMaxBytes ?? DEFAULT_INSTALL_OUTPUT_MAX_BYTES
    this.terminationGraceMs = config.installTerminationGraceMs ?? DEFAULT_INSTALL_TERMINATION_GRACE_MS
  }

  /**
   * Read the Loader directly on every call. Cordis's internal plugin/status
   * events already maintain Entry.fiber and Fiber.state, so a second cache
   * would only add another lifecycle truth to keep synchronized.
   * @returns Current non-group Loader entries in Loader order.
   */
  @Remote('list')
  list(): PluginInventorySnapshot {
    const entries: PluginInventoryEntry[] = []
    for (const entry of this.ctx.loader.entries()) {
      if (entry.options.group) continue
      entries.push({
        entryId: pluginEntryId(entry.id),
        moduleName: entry.options.name,
        enabled: !entry.disabled,
        fiberPhase: entry.fiber === undefined ? null : FIBER_PHASE[entry.fiber.state],
      })
    }
    return { entries }
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

    const installId = pluginInstallId(crypto.randomUUID())
    const snapshot: PluginInstallSnapshot = {
      installId,
      profile: request.profile,
      packageSpec: request.packageSpec,
      command: `dsh plugin --profile ${request.profile} add ${request.packageSpec}`,
      phase: 'running',
    }
    const job: InstallJob = { snapshot, target, operation: 'add' }
    this.jobs.set(installId, job)
    this.activeTargets.set(target, installId)
    void this.runInstall(job)
    return snapshot
  }

  /** Start one guarded profile package removal through the product CLI. */
  @Remote('startUninstall')
  startUninstall(request: PluginUninstallRequest): PluginInstallSnapshot {
    validateUninstallRequest(request)
    const target = `remove\0${request.profile}\0${request.packageName}`
    const activeId = this.activeTargets.get(target)
    if (activeId !== undefined) return this.expectJob(activeId).snapshot

    const installId = pluginInstallId(crypto.randomUUID())
    const snapshot: PluginInstallSnapshot = {
      installId,
      profile: request.profile,
      packageSpec: request.packageName,
      command: `dsh plugin --profile ${request.profile} remove ${request.packageName}`,
      phase: 'running',
    }
    const job: InstallJob = { snapshot, target, operation: 'remove' }
    this.jobs.set(installId, job)
    this.activeTargets.set(target, installId)
    void this.runInstall(job)
    return snapshot
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

  /** Run the product CLI through the managed subprocess capability. */
  private async runInstall(job: InstallJob): Promise<void> {
    try {
      const launcher = dshLauncherArgv()
      const handle = this.ctx.subprocess.spawn({
        argv: [
          ...launcher,
          'plugin', '--profile', job.snapshot.profile, job.operation, job.snapshot.packageSpec,
        ],
        cwd: process.cwd(),
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
      job.snapshot = {
        ...job.snapshot,
        phase: outcome.exitCode === 0 ? 'succeeded' : 'failed',
        exitCode: outcome.exitCode,
        ...(outcome.exitCode !== 0 && diagnostic !== '' ? { diagnostic } : {}),
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
}

export default PluginInventoryGateway

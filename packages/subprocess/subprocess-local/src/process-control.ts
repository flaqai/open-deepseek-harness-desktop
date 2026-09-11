/** Identity-fenced observation of legacy child processes owned by a desktop launch. */
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { createProcessInspector } from './process-inspector.ts'
import type { ProcessIdentity, ProcessInspector } from './process-inspector.ts'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { bindManagedProcess, prepareManagedProcessBinding, spawnSubprocess, validateSubprocessSpec } from './spawn.ts'
import { launchWindowsJob, probeWindowsJob } from './windows-job.ts'
import { launchLinuxScope, probeLinuxNative } from './linux-scope.ts'
import { targetEnvironment } from './runner-launch.ts'
import type { RunnerInvocation } from './runner-launch.ts'

/** A launched process retains its platform-managed range until explicitly collected. */
export interface DesktopManagedLaunch {
  readonly containment: 'windows-job' | 'linux-scope' | 'process-group' | 'process-tree-fallback'
  readonly handle: SubprocessHandle & { readonly rootPid?: number }
}

/** Launch through the runtime's native ownership implementation.
 * @param spec - Existing subprocess request, including explicit environment and cancellation.
 * @param runnerInvocation - Node executable and runtime runner entry, selected outside Electron.
 * @returns Streams and range completion, with the actual containment mode.
 */
export function launchDesktopManagedProcess(
  spec: SubprocessSpawnSpec & { readonly lifecycle?: 'task' | 'client' },
  runnerInvocation: RunnerInvocation,
): DesktopManagedLaunch {
  validateSubprocessSpec(spec)
  const internals = { runnerInvocation }
  const mode = process.platform === 'win32' && probeWindowsJob(internals)
    ? 'windows-job'
    : process.platform === 'linux' && probeLinuxNative(internals) ? 'linux-scope' : 'process-group'
  if (mode === 'process-group') return {
    containment: process.platform === 'win32' ? 'process-tree-fallback' : mode,
    handle: spawnSubprocess(spec),
  }
  const binding = prepareManagedProcessBinding({})
  const environment = targetEnvironment(spec)
  const launch = mode === 'windows-job'
    ? launchWindowsJob(spec, environment, {
      ...internals,
      ...(spec.lifecycle === 'client' ? { allowChildBreakaway: true } : {}),
    })
    : launchLinuxScope(spec, environment, internals)
  return { containment: mode, handle: bindManagedProcess(spec, launch, binding) }
}

/** A managed root and the identities observed beneath it, without command arguments. */
export interface ObservedProcessRecord {
  readonly id: string
  readonly label: string
  readonly identities: readonly ProcessIdentity[]
  readonly phase: 'running' | 'stopping' | 'failed' | 'stopped'
}

/** Minimal crash-recovery document; it never contains argv, cwd or environment values. */
export interface ObservedProcessRecoveryJournal {
  readonly schema: 'open-dsh-desktop/process-recovery/v2'
  readonly records: readonly {
    readonly id: string
    readonly label: string
    readonly root: ProcessIdentity
    readonly identities: readonly ProcessIdentity[]
  }[]
}

/** Desktop fallback observer; escaped descendants that were never observed are not contained. */
export class DesktopProcessObserver {
  private records = new Map<string, {
    id: string
    label: string
    root: ProcessIdentity
    identities: Map<string, ProcessIdentity>
    phase: ObservedProcessRecord['phase']
  }>()
  private closing = false
  private samplingError: unknown
  private timer: ReturnType<typeof setInterval> | undefined
  private stopping: Promise<void> | undefined
  private excluded = new Set<string>()

  constructor(private readonly inspector: ProcessInspector = createProcessInspector()) {}

  /** Register a just-spawned child; retain its descendants until confirmed stopped.
   * @param pid - PID supplied by the owner's spawn event, never by a renderer.
   * @param label - Non-sensitive task description.
   * @returns Opaque observation id.
   */
  register(pid: number, label: string): string {
    if (this.closing) throw new Error('desktop: process registration is closed')
    const tree = this.inspector.snapshot().tree(pid)
    const root = tree.find(identity => identity.pid === pid)
    if (root === undefined) throw new Error('desktop: cannot establish process identity')
    const id = randomUUID()
    this.records.set(id, { id, label, root, identities: new Map(tree.map(identity => [this.key(identity), identity])), phase: 'running' })
    this.startSampling()
    return id
  }

  private key(identity: ProcessIdentity): string { return `${identity.pid}:${identity.started}` }

  /** Permanently exclude exact identities from this observer's cleanup scope.
   * Descendants discovered beneath an excluded identity are excluded as well.
   * @param identities - Host-verified PID/start identities owned by another lifecycle.
   */
  excludeIdentities(identities: readonly ProcessIdentity[]): void {
    const snapshot = this.inspector.snapshot()
    for (const identity of identities) {
      if (!Number.isSafeInteger(identity.pid) || identity.pid <= 0
        || typeof identity.started !== 'string' || identity.started.length < 1 || identity.started.length > 128) {
        throw new TypeError('desktop: invalid excluded process identity')
      }
      if (!snapshot.alive(identity)) continue
      for (const child of snapshot.tree(identity.pid)) this.excluded.add(this.key(child))
      this.excluded.add(this.key(identity))
    }
    for (const record of this.records.values()) {
      for (const key of this.excluded) record.identities.delete(key)
      if (record.identities.size === 0) record.phase = 'stopped'
    }
  }

  private sample(): void {
    const snapshot = this.inspector.snapshot()
    for (const record of this.records.values()) {
      for (const identity of [...record.identities.values()]) {
        if (!snapshot.alive(identity)) continue
        for (const child of snapshot.tree(identity.pid)) {
          const key = this.key(child)
          if (!this.excluded.has(key)) record.identities.set(key, child)
        }
      }
      for (const [key, identity] of record.identities) {
        if (this.excluded.has(key) || !snapshot.alive(identity)) record.identities.delete(key)
      }
      if (record.identities.size === 0) record.phase = 'stopped'
    }
    this.samplingError = undefined
  }

  /** Read redaction-safe process observations.
   * @returns Current records without argv or environment.
   */
  list(): readonly ObservedProcessRecord[] {
    return [...this.records.values()].map(record => ({ ...record, identities: [...record.identities.values()] }))
  }

  /** Serialize only identity fences needed to recover descendants after an abnormal desktop exit.
   * @returns Minimal identity-fenced recovery document.
   */
  recoveryJournal(): ObservedProcessRecoveryJournal {
    return {
      schema: 'open-dsh-desktop/process-recovery/v2',
      records: [...this.records.values()].flatMap(record => record.identities.size === 0 ? [] : [{
        id: record.id, label: record.label, root: record.root, identities: [...record.identities.values()],
      }]),
    }
  }

  /** Adopt still-live identities from a strictly validated recovery journal.
   * @param value - Untrusted parsed recovery document.
   * @returns Number of still-live process records adopted.
   */
  restoreRecoveryJournal(value: unknown): number {
    if (value === null || typeof value !== 'object') throw new TypeError('desktop: invalid process recovery journal')
    const document = value as Partial<ObservedProcessRecoveryJournal>
    if (document.schema !== 'open-dsh-desktop/process-recovery/v2'
      || !Array.isArray(document.records) || document.records.length > 256) {
      throw new TypeError('desktop: invalid process recovery journal')
    }
    const snapshot = this.inspector.snapshot()
    let restored = 0
    for (const raw of document.records) {
      if (raw === null || typeof raw !== 'object') throw new TypeError('desktop: invalid process recovery record')
      const record = raw as { id?: unknown; label?: unknown; root?: unknown; identities?: unknown }
      if (typeof record.id !== 'string' || record.id.length < 1 || record.id.length > 128
        || typeof record.label !== 'string' || record.label.length < 1 || record.label.length > 128
        || record.root === null || typeof record.root !== 'object'
        || !Array.isArray(record.identities) || record.identities.length > 1_024) {
        throw new TypeError('desktop: invalid process recovery record')
      }
      const rawRoot = record.root as Partial<ProcessIdentity>
      if (!Number.isSafeInteger(rawRoot.pid) || (rawRoot.pid ?? 0) <= 0
        || typeof rawRoot.started !== 'string' || rawRoot.started.length < 1 || rawRoot.started.length > 128) {
        throw new TypeError('desktop: invalid recovered process root')
      }
      const root = { pid: rawRoot.pid as number, started: rawRoot.started }
      const identities = new Map<string, ProcessIdentity>()
      for (const rawIdentity of record.identities) {
        if (rawIdentity === null || typeof rawIdentity !== 'object') {
          throw new TypeError('desktop: invalid recovered process identity')
        }
        const identity = rawIdentity as Partial<ProcessIdentity>
        if (!Number.isSafeInteger(identity.pid) || (identity.pid ?? 0) <= 0
          || typeof identity.started !== 'string' || identity.started.length < 1 || identity.started.length > 128) {
          throw new TypeError('desktop: invalid recovered process identity')
        }
        const parsed = { pid: identity.pid as number, started: identity.started }
        const key = this.key(parsed)
        if (!this.excluded.has(key) && snapshot.alive(parsed)) identities.set(key, parsed)
      }
      if (identities.size === 0) continue
      this.records.set(record.id, { id: record.id, label: record.label, root, identities, phase: 'running' })
      restored += 1
    }
    if (restored > 0) this.startSampling()
    return restored
  }

  private startSampling(): void {
    this.timer ??= setInterval(() => {
      try { this.sample() } catch (error) { this.samplingError = error }
    }, 2_000)
    this.timer.unref()
  }

  /** Close admission and confirm all observed identities exit; failure permits another cleanup attempt.
   * @param graceMs - TERM interval before escalation.
   * @param forceMs - KILL verification interval.
   * @returns Completion only after the observed ranges are empty.
   */
  stopAll(graceMs = 10_000, forceMs = 5_000): Promise<void> {
    if (this.stopping !== undefined) return this.stopping
    this.closing = true
    clearInterval(this.timer)
    this.timer = undefined
    this.stopping = this.stop(graceMs, forceMs).finally(() => { this.stopping = undefined })
    return this.stopping
  }

  /** Stop one observed root by its opaque desktop-owned id without closing global admission.
   * @param id - Opaque id previously returned by register or restored from a trusted journal.
   * @param graceMs - TERM interval before force escalation.
   * @param forceMs - KILL verification interval.
   */
  async stopOne(id: string, graceMs = 10_000, forceMs = 5_000): Promise<void> {
    if (!this.records.has(id)) throw new Error('desktop: observed process id is unavailable')
    await this.stop(graceMs, forceMs, new Set([id]))
  }

  private async stop(graceMs: number, forceMs: number, selected?: ReadonlySet<string>): Promise<void> {
    try {
      for (const [signal, duration] of [['SIGTERM', graceMs], ['SIGKILL', forceMs]] as const) {
        const deadline = Date.now() + duration
        const signalled = new Set<string>()
        do {
          this.sample()
          const records = [...this.records.values()].filter(record => (
            record.identities.size > 0 && (selected === undefined || selected.has(record.id))
          ))
          if (records.length === 0 && this.samplingError === undefined) return
          for (const record of records) {
            record.phase = 'stopping'
            for (const identity of record.identities.values()) {
              const key = this.key(identity)
              if (signalled.has(key)) continue
              this.inspector.signalProcess(identity, signal)
              signalled.add(key)
            }
          }
          await delay(Math.min(100, Math.max(1, deadline - Date.now())))
        } while (Date.now() < deadline)
      }
      this.sample()
      if ([...this.records.values()].some(record => (
        record.identities.size > 0 && (selected === undefined || selected.has(record.id))
      ))) {
        throw new Error('desktop: observed child processes remain alive; restart is blocked')
      }
    } catch (error) {
      for (const record of this.records.values()) {
        if (record.identities.size > 0 && (selected === undefined || selected.has(record.id))) record.phase = 'failed'
      }
      throw error
    }
  }
}

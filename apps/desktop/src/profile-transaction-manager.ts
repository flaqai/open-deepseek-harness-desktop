/** Desktop ownership of a staged plugin activation after its producing CLI exits. */
import { lstat, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { inspectProfileMutationLock } from './menu-mutation-guard.ts'
import { setTimeout as delay } from 'node:timers/promises'

interface PendingTransaction {
  id: string
  producerPid: number
  phase: string
}

/** Activation failed, but the candidate and lease were restored and settled successfully. */
export class ProfileActivationRolledBackError extends Error {
  constructor(error: unknown) {
    super(error instanceof Error ? error.message : String(error), { cause: error })
    this.name = 'ProfileActivationRolledBackError'
  }
}

/** Narrow CLI and Harness operations used to activate a checked candidate. */
export interface ProfileTransactionManagerOptions {
  readonly home: string
  command(args: readonly string[], token?: string): Promise<void>
  stopHarness(): Promise<void>
  resumeHarness(): void
  onError(error: unknown): void
  onRollback(error: unknown): void
  onActivation(): void
  /** Persist startup completion only after the transaction commit and lease release. */
  onCommit?(): Promise<void>
  /** Reclaim a recognized interrupted first-start copy under a new lease; false uses normal rollback. */
  resumePreparation?(id: string): Promise<boolean>
  /** Record lock waiting and recovery without exposing plugin credentials. */
  log?(message: string): void
}

/** Loader identity of one optional entry that failed activation. */
export interface CandidateOptionalFailure {
  readonly id: string
  readonly name: string
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

/** Owns activation, readiness confirmation, rollback, and periodic handoff discovery. */
export class ProfileTransactionManager {
  readonly #options: ProfileTransactionManagerOptions
  #timer: NodeJS.Timeout | undefined
  #deadline: NodeJS.Timeout | undefined
  #operation: Promise<void> | undefined
  #checking: string | undefined
  #readinessPhase: 'awaiting-launch' | 'server' | 'renderer' | undefined
  #expectedPackages: ReadonlySet<string> = new Set()
  #disposed = false
  #restartWaiters = 0
  #settlement: { id: string; promise: Promise<boolean>; resolve(value: boolean): void; reject(error: unknown): void } | undefined

  constructor(options: ProfileTransactionManagerOptions) { this.#options = options }

  /** Whether an activated candidate still needs ordinary client and event-dispatch readiness. */
  get awaitingReadiness(): boolean { return this.#checking !== undefined }

  async #pending(): Promise<PendingTransaction | undefined> {
    let source: string
    const path = join(this.#options.home, 'plugin-transactions', 'web', 'pending.json')
    try {
      if (!(await lstat(path)).isFile()) throw new Error('desktop: unsafe plugin transaction journal')
      const child = relative(await realpath(this.#options.home), await realpath(path))
      if (isAbsolute(child) || child === '..' || child.startsWith(`..${sep}`)) throw new Error('desktop: plugin transaction journal escapes its home')
      source = await readFile(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
    const record = JSON.parse(source) as Partial<PendingTransaction> | null
    if (record === null || typeof record.id !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(record.id)
      || !Number.isSafeInteger(record.producerPid) || (record.producerPid ?? 0) <= 0 || typeof record.phase !== 'string') {
      throw new Error('desktop: invalid plugin transaction journal')
    }
    return record as PendingTransaction
  }

  /** Restore interrupted activation before startup can inspect or repair the active Profile. */
  async recoverBeforeStartup(): Promise<void> {
    const record = await this.#pending()
    if (record === undefined) return
    const lock = inspectProfileMutationLock(this.#options.home)
    if (lock.active || alive(record.producerPid)) return
    if (record.phase === 'preparing' && await this.#options.resumePreparation?.(record.id)) return
    await this.#options.command(['transaction', 'rollback', record.id])
  }

  /**
   * Wait up to 15 minutes for external mutations and recover abandoned journals before restart.
   * @param signal - Aborted by exit, directory switching, or deliberate candidate activation.
   */
  async waitForExternalWriters(signal: AbortSignal): Promise<void> {
    const deadline = AbortSignal.timeout(15 * 60_000)
    const waiting = AbortSignal.any([signal, deadline])
    this.#restartWaiters++
    let lastOwner: string | undefined
    try {
      while (true) {
        waiting.throwIfAborted()
        if (this.#disposed) throw new Error('desktop: plugin activation manager is disposed')
        if (this.#checking !== undefined) throw new Error('desktop: candidate Harness exited before transaction commit')
        if (this.#operation !== undefined) {
          await delay(1000, undefined, { signal: waiting })
          continue
        }
        const lock = inspectProfileMutationLock(this.#options.home)
        if (lock.state === 'malformed' || lock.state === 'unreadable') {
          throw new Error(`desktop: Profile writer lock is ${lock.state}; inspect Diagnostics before retrying`)
        }
        const record = await this.#pending()
        waiting.throwIfAborted()
        if (lock.active || (record !== undefined && alive(record.producerPid))) {
          if (lock.pid === process.pid && lock.workerActive !== true) {
            throw new Error('desktop: retained Desktop lease requires transaction recovery, not automatic restart')
          }
          const owner = `pid=${String(lock.pid ?? record?.producerPid)} worker=${String(lock.workerPid ?? 'none')}`
          if (lastOwner !== owner) this.#options.log?.(`Harness restart waiting for Profile writer ${owner}`)
          lastOwner = owner
          await delay(1000, undefined, { signal: waiting })
          continue
        }
        if (record !== undefined) {
          this.#options.log?.(`Recovering abandoned plugin transaction ${record.id} before Harness restart`)
          const recovery = this.#options.command(['transaction', 'rollback', record.id])
          this.#operation = recovery
          try { await recovery } finally { if (this.#operation === recovery) this.#operation = undefined }
          waiting.throwIfAborted()
          if (await this.#pending() !== undefined) throw new Error('desktop: plugin transaction recovery did not settle its journal')
          continue
        }
        this.#options.log?.('Profile writers settled; automatic Harness restart permitted')
        return
      }
    } catch (error) {
      if (deadline.aborted && !signal.aborted) throw new Error('desktop: Harness restart timed out after 15 minutes waiting for Profile writers', { cause: error })
      throw error
    } finally {
      this.#restartWaiters--
    }
  }

  /**
   * Settle a retained failed transaction before diagnostic mode starts another mutation.
   * @returns True when a retained journal or owned lease was released.
   */
  async settleForRecoveryMutation(): Promise<boolean> {
    if (this.#disposed) throw new Error('desktop: plugin activation manager is disposed')
    if (this.#operation !== undefined) throw new Error('desktop: plugin transaction settlement is still running')
    const record = await this.#pending()
    const id = this.#checking ?? record?.id
    if (id === undefined) return false
    if (record !== undefined && record.id !== id) {
      throw new Error('desktop: retained plugin transaction changed before recovery')
    }
    const lock = inspectProfileMutationLock(this.#options.home)
    let token: string | undefined
    if (lock.active) {
      if (lock.state !== 'live' || lock.pid !== process.pid || lock.workerActive === true) {
        throw new Error('desktop: retained plugin transaction is owned by another process')
      }
      token = id
    }
    await this.#options.stopHarness()
    if (record !== undefined) await this.#options.command(['transaction', 'rollback', id], token)
    if (token !== undefined) await this.#release(id)
    this.#checking = undefined
    this.#readinessPhase = undefined
    this.#clearDeadline()
    if (this.#settlement?.id === id) this.#settlement.resolve(false)
    return true
  }

  /** Observe new handoffs without spawning a CLI for unchanged state. */
  start(): void {
    if (this.#timer !== undefined || this.#disposed) return
    this.#timer = setInterval(() => {
      if (this.#restartWaiters > 0 || this.#operation !== undefined || this.#checking !== undefined) return
      this.#run(async () => {
        const record = await this.#pending()
        if (this.#disposed || record === undefined || alive(record.producerPid)) return
        const lock = inspectProfileMutationLock(this.#options.home)
        if (record.phase === 'preparing' && !lock.active) {
          await this.#options.command(['transaction', 'rollback', record.id])
          return
        }
        if (record.phase !== 'prepared') return
        if (lock.pid !== process.pid || lock.workerPid !== undefined) return
        await this.#activate(record.id, true)
      })
    }, 500)
    this.#timer.unref()
  }

  /**
   * Activate a desktop-prepared candidate under its existing lease.
   * @param id - Verified transaction ID returned by the owned CLI.
   * @param resume - False during initial startup, before the Harness supervisor exists.
   */
  async activatePrepared(id: string, resume: boolean, expectedPackages: readonly string[] = []): Promise<void> {
    if (this.#disposed || this.#operation !== undefined || this.#checking !== undefined) throw new Error('desktop: another plugin activation is active')
    const operation = (async () => {
      const record = await this.#pending()
      const lock = inspectProfileMutationLock(this.#options.home)
      if (record?.id !== id || record.phase !== 'prepared' || lock.pid !== process.pid || lock.workerPid !== undefined) {
        throw new Error('desktop: prepared plugin transaction is not owned by this desktop')
      }
      this.#expectedPackages = new Set(expectedPackages)
      const failure = await this.#activate(id, resume)
      if (failure !== undefined) throw new ProfileActivationRolledBackError(failure.error)
    })()
    this.#operation = operation
    try { await operation } finally { if (this.#operation === operation) this.#operation = undefined }
  }

  /** Roll back only when an optional activation failure belongs to this candidate's explicit targets. */
  optionalStartupFailures(failures: readonly CandidateOptionalFailure[]): void {
    if (this.#checking === undefined || this.#expectedPackages.size === 0) return
    const matched = failures.filter(failure => this.#expectedPackages.has(failure.name))
    if (matched.length === 0) return
    const detail = matched.map(failure => `${failure.id} (${failure.name})`).join(', ')
    this.failed(new Error(`desktop: candidate target did not activate: ${detail}`))
  }

  /**
   * Wait for normal readiness or rollback, not merely the install command exit.
   * @param id - Transaction activated by this manager.
   * @returns True after commit, false after a complete rollback.
   */
  waitForSettlement(id: string): Promise<boolean> {
    if (this.#settlement?.id !== id) return Promise.reject(new Error('desktop: plugin activation is not tracked'))
    return this.#settlement.promise
  }

  async #activate(id: string, resume: boolean): Promise<{ error: unknown } | undefined> {
    const deferred = Promise.withResolvers<boolean>()
    // Startup has no awaiting caller; the failure still reaches onError.
    void deferred.promise.catch(() => {})
    this.#settlement = { id, ...deferred }
    this.#options.onActivation()
    await this.#options.stopHarness()
    if (!this.#canContinue()) throw new Error('desktop: plugin activation was cancelled')
    try {
      await this.#options.command(['transaction', 'activate', id], id)
      this.#checking = id
      this.#readinessPhase = 'awaiting-launch'
      if (resume) {
        this.harnessStarting()
        this.#options.resumeHarness()
      }
    } catch (error) {
      await this.#rollback(id)
      this.#options.onRollback(error)
      return { error }
    }
    return undefined
  }

  #run(operation: () => Promise<void>): void {
    if (this.#disposed || this.#operation !== undefined) return
    const pending = operation().catch((error: unknown) => {
      if (this.#timer !== undefined) clearInterval(this.#timer)
      this.#timer = undefined
      this.#clearDeadline()
      this.#settlement?.reject(error)
      this.#options.onError(error)
    }).finally(() => {
      if (this.#operation === pending) this.#operation = undefined
    })
    this.#operation = pending
  }

  #canContinue(): boolean { return !this.#disposed }

  #clearDeadline(): void {
    if (this.#deadline !== undefined) clearTimeout(this.#deadline)
    this.#deadline = undefined
  }

  /** Start the cold-start budget only when Harness is actually being launched. */
  harnessStarting(): void {
    if (this.#checking === undefined || this.#readinessPhase !== 'awaiting-launch') return
    this.#readinessPhase = 'server'
    this.#deadline = setTimeout(() => {
      this.failed(new Error('desktop: plugin activation timed out waiting 180 seconds for the Harness server'))
    }, 180_000)
  }

  /** Give the renderer its own bounded window after the server publishes its URL. */
  serverReady(): void {
    if (this.#checking === undefined || this.#readinessPhase !== 'server') return
    this.#clearDeadline()
    this.#readinessPhase = 'renderer'
    this.#deadline = setTimeout(() => {
      this.failed(new Error('desktop: plugin activation timed out waiting 60 seconds for client and event-dispatch readiness'))
    }, 60_000)
  }

  async #release(id: string): Promise<void> {
    await this.#options.command(['snapshot', 'end-restore-lease'], id)
  }

  async #rollback(id: string): Promise<void> {
    this.#clearDeadline()
    await this.#options.stopHarness()
    await this.#options.command(['transaction', 'rollback', id], id)
    await this.#release(id)
    this.#checking = undefined
    this.#readinessPhase = undefined
    this.#expectedPackages = new Set()
    if (this.#settlement?.id === id) this.#settlement.resolve(false)
    if (!this.#disposed) this.#options.resumeHarness()
  }

  /** Commit a candidate only after both ordinary-Profile readiness markers arrive. */
  ready(): void {
    if (this.#operation !== undefined) { void this.#operation.then(() => { this.ready() }); return }
    const id = this.#checking
    if (id === undefined) return
    this.#clearDeadline()
    this.#run(async () => {
      await this.#options.command(['transaction', 'commit', id], id)
      await this.#release(id)
      this.#checking = undefined
      this.#readinessPhase = undefined
      this.#expectedPackages = new Set()
      await this.#options.onCommit?.()
      if (this.#settlement?.id === id) this.#settlement.resolve(true)
    })
  }

  /** Stop a failed candidate and restore its managed files and complete dependency directory. */
  failed(error: unknown = new Error('desktop: activated plugin Profile failed to start')): void {
    if (this.#operation !== undefined) { void this.#operation.then(() => { this.failed(error) }); return }
    const id = this.#checking
    if (id !== undefined) this.#run(async () => {
      await this.#rollback(id)
      this.#options.onRollback(error)
    })
  }

  /** Cancel discovery and wait for the supervisor-owned command to finish or be aborted. */
  async dispose(): Promise<void> {
    this.#disposed = true
    if (this.#timer !== undefined) clearInterval(this.#timer)
    this.#timer = undefined
    this.#clearDeadline()
    this.#settlement?.reject(new Error('desktop: plugin activation cancelled during shutdown'))
    await this.#operation
  }
}

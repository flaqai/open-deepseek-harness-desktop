/** Desktop ownership of candidate-backed Web Profile mutations. */

import { join } from 'node:path'
import {
  candidatePreparationUsesLease,
  parsePluginCommandJson,
  prepareDesktopCandidate,
} from '../candidate-preparation.ts'
import { inspectProfileMutationLock } from '../menu-mutation-guard.ts'
import {
  ProfileActivationRolledBackError,
  ProfileTransactionManager,
  type CandidateOptionalFailure,
} from '../profile-transaction-manager.ts'
import { activateOrDiscardRecoveryCandidate } from '../recovery-candidate.ts'

export class DesktopProfileMutationBusyError extends Error {
  constructor() {
    super('desktop: another plugin mutation is active')
    this.name = 'DesktopProfileMutationBusyError'
  }
}

export class DesktopProfileMutationRolledBackError extends Error {
  constructor(error: unknown) {
    super(error instanceof Error ? error.message : String(error), { cause: error })
    this.name = 'DesktopProfileMutationRolledBackError'
  }
}

export class DesktopProfileMutationRecoveryRequiredError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'DesktopProfileMutationRecoveryRequiredError'
  }
}

export class DesktopProfileMutationCancelledError extends Error {
  constructor() {
    super('desktop: plugin mutation cancelled during shutdown')
    this.name = 'DesktopProfileMutationCancelledError'
  }
}

export class DesktopProfileExternalWriterTimeoutError extends Error {
  constructor(error: unknown) {
    super(error instanceof Error ? error.message : 'desktop: Harness restart timed out after 15 minutes waiting for Profile writers', { cause: error })
    this.name = 'DesktopProfileExternalWriterTimeoutError'
  }
}

export type DesktopProfileWriteCommand =
  | { readonly kind: 'doctor-repair'; readonly operation: string; readonly timeoutMs: number }
  | { readonly kind: 'doctor-check'; readonly operation: string; readonly timeoutMs: number }
  | { readonly kind: 'approve-build'; readonly packageName: string; readonly operation: string; readonly timeoutMs: number }
  | { readonly kind: 'add'; readonly packageSpecs: readonly string[]; readonly exact?: boolean; readonly operation: string; readonly timeoutMs: number }
  | { readonly kind: 'remove'; readonly packageName: string; readonly operation: string; readonly timeoutMs: number }
  | { readonly kind: 'install-frozen-offline'; readonly operation: string; readonly timeoutMs: number }

export interface DesktopProfileMutationContext {
  /** The candidate home is valid only until the mutation callback settles. */
  readonly home: string
  /** Execute one bounded Profile write without exposing transaction or lease commands. */
  write(command: DesktopProfileWriteCommand): Promise<string>
}

export interface DesktopProfileMutationWork<T> {
  readonly operation: string
  readonly expectedPackages?: readonly string[]
  run(context: DesktopProfileMutationContext): Promise<T>
}

export type DesktopProfileMutationHarnessEvent =
  | { readonly type: 'starting' }
  | { readonly type: 'server-ready' }
  | { readonly type: 'normal-ready' }
  | { readonly type: 'diagnostic-ready' }
  | { readonly type: 'optional-startup-failures'; readonly failures: readonly CandidateOptionalFailure[] }
  | { readonly type: 'failed'; readonly error?: unknown }

export interface ProfileMutationCommandAdapter {
  run(
    environment: NodeJS.ProcessEnv,
    args: readonly string[],
    operation: string,
    timeoutMs: number,
    acceptedExitCodes?: readonly number[],
    allowDuringDisposal?: boolean,
  ): Promise<string>
}

export interface ProfileMutationHarnessAdapter {
  available(): boolean
  stop(): Promise<void>
  resume(): void
  suspendForRecovery(): Promise<void>
}

export interface DesktopProfileMutationOptions {
  readonly home: string
  readonly ownerPid: number
  readonly environment: NodeJS.ProcessEnv
  readonly commands: ProfileMutationCommandAdapter
  readonly harness: ProfileMutationHarnessAdapter
  readonly timeouts: {
    readonly preparationMs: number
    readonly profileCheckMs: number
    readonly snapshotMs: number
    readonly installMs: number
  }
  isFirstStart(): boolean
  canResumeFirstStart(candidateHome: string): Promise<boolean>
  onFirstStartCommit(): Promise<void>
  runSnapshot(args: readonly string[], timeoutMs: number, allowDuringDisposal?: boolean): Promise<unknown>
  cancelBootableSnapshot(): void
  restartBootableSnapshotWindow(reason: string): void
  onCandidatePreparation(startedAt: number): void
  onActivation(): void
  log(message: string): Promise<void> | void
  onRollback(error: unknown): void
  onRecoveryRequired(error: unknown, operation?: string): void
}

/**
 * Owns Desktop candidate preparation, mutation isolation, activation, readiness,
 * rollback, and recovery settlement behind one interface.
 */
export class DesktopProfileMutation {
  readonly #options: DesktopProfileMutationOptions
  readonly #transactions: ProfileTransactionManager
  #candidateId: string | undefined
  #managedActive = false
  #recoveryOwnsCandidate = false
  #recoveryBusy = false
  #rollbackFailed = false
  #disposed = false

  constructor(options: DesktopProfileMutationOptions) {
    this.#options = options
    this.#transactions = new ProfileTransactionManager({
      home: options.home,
      resumePreparation: id => this.#resumePreparation(id),
      command: (args, token) => this.#runTransactionCommand(args, token),
      stopHarness: () => options.harness.stop(),
      resumeHarness: () => { if (!options.isFirstStart()) options.harness.resume() },
      onCommit: () => options.onFirstStartCommit(),
      onActivation: () => {
        options.cancelBootableSnapshot()
        options.onActivation()
        void options.log('Desktop candidate activation requested; deliberately stopping Harness.')
      },
      log: (message) => { void options.log(message) },
      onRollback: (error) => { options.onRollback(error) },
      onError: (error) => {
        this.#rollbackFailed = true
        options.cancelBootableSnapshot()
        options.onRecoveryRequired(error)
      },
    })
  }

  get mutationHome(): string {
    return this.#options.environment.DSH_HOME ?? this.#options.home
  }

  get recoveryRequired(): boolean { return this.#rollbackFailed }

  get hasCandidate(): boolean { return this.#candidateId !== undefined }

  get hasRecoveryCandidate(): boolean {
    return this.#recoveryOwnsCandidate && this.#candidateId !== undefined
  }

  async recoverBeforeStartup(): Promise<void> {
    this.#assertAvailable()
    try {
      await this.#transactions.recoverBeforeStartup()
    } catch (error) {
      this.#rollbackFailed = true
      this.#options.onRecoveryRequired(error)
      throw error
    }
  }

  start(): void {
    this.#assertAvailable()
    this.#transactions.start()
  }

  beforeHarnessRestart(signal: AbortSignal): Promise<void> {
    this.#assertAvailable()
    return this.#transactions.waitForExternalWriters(signal).catch((error: unknown) => {
      if (error instanceof Error && error.message.includes('timed out after 15 minutes')) {
        throw new DesktopProfileExternalWriterTimeoutError(error)
      }
      throw error
    })
  }

  /** Prepare the shared startup candidate before any individual mutation step runs. */
  async prepareStartup(): Promise<void> {
    this.#assertAvailable()
    await this.#beginCandidate()
  }

  async applyAtStartup<T>(work: DesktopProfileMutationWork<T>): Promise<T> {
    this.#assertAvailable()
    if (this.#rollbackFailed) {
      throw new DesktopProfileMutationRecoveryRequiredError('desktop: bundled plugin startup stopped after rollback failure')
    }
    return this.#withSafety(work.operation, () => work.run(this.#context()))
  }

  async finishStartup(expectedPackages: readonly string[] = []): Promise<void> {
    this.#assertAvailable()
    if (this.#rollbackFailed) {
      await this.#discardCandidate()
      throw new DesktopProfileMutationRecoveryRequiredError('Profile transaction recovery did not complete.')
    }
    try {
      await this.#activateCandidate(false, expectedPackages)
    } catch (error) {
      try {
        await this.#discardCandidate()
      } catch (rollbackError) {
        this.#rollbackFailed = true
        throw new DesktopProfileMutationRecoveryRequiredError(
          'desktop: candidate startup rollback needs recovery',
          rollbackError,
        )
      }
      if (error instanceof ProfileActivationRolledBackError) throw new DesktopProfileMutationRolledBackError(error)
      throw error
    }
  }

  async abortStartup(): Promise<void> {
    this.#assertAvailable()
    await this.#discardCandidate()
  }

  async applyManaged<T>(work: DesktopProfileMutationWork<T>): Promise<T> {
    this.#assertAvailable()
    if (this.#managedActive || this.#candidateId !== undefined) throw new DesktopProfileMutationBusyError()
    this.#managedActive = true
    try {
      await this.#beginCandidate()
      const result = await work.run(this.#context())
      await this.#activateCandidate(true, work.expectedPackages ?? [])
      return result
    } catch (error) {
      try {
        await this.#discardCandidate()
      } catch (rollbackError) {
        this.#rollbackFailed = true
        throw new DesktopProfileMutationRecoveryRequiredError('desktop: managed plugin rollback needs recovery', rollbackError)
      }
      if (error instanceof ProfileActivationRolledBackError) throw new DesktopProfileMutationRolledBackError(error)
      throw error
    } finally {
      this.#managedActive = false
      this.#options.restartBootableSnapshotWindow(`${work.operation} settled`)
    }
  }

  async stageRecovery<T>(work: DesktopProfileMutationWork<T>): Promise<T> {
    this.#assertAvailable()
    if (this.#recoveryBusy || this.#managedActive || (this.#candidateId !== undefined && !this.#recoveryOwnsCandidate)) {
      throw new DesktopProfileMutationBusyError()
    }
    this.#recoveryBusy = true
    try {
      await this.#options.harness.suspendForRecovery()
      const settled = await this.#transactions.settleForRecoveryMutation()
      if (settled) {
        this.#clearCandidateEnvironment()
        this.#recoveryOwnsCandidate = false
        this.#rollbackFailed = false
        await this.#options.log('Recovery mode settled the retained plugin transaction before removal.')
      }
      if (!this.#options.harness.available()) return await work.run(this.#context())
      this.#recoveryOwnsCandidate = true
      return await this.#withSafety(work.operation, () => work.run(this.#context()))
    } finally {
      this.#recoveryBusy = false
    }
  }

  readRecovery<T>(activeHome: string, read: (home: string) => Promise<T>): Promise<T> {
    this.#assertAvailable()
    const home = this.#recoveryOwnsCandidate && this.#candidateId !== undefined ? this.mutationHome : activeHome
    return read(home)
  }

  async settleRecovery(decision: 'activate' | 'discard'): Promise<void> {
    this.#assertAvailable()
    if (!this.#recoveryOwnsCandidate) return
    if (this.#recoveryBusy) throw new DesktopProfileMutationBusyError()
    try {
      if (decision === 'discard') await this.#discardCandidate()
      else {
        await activateOrDiscardRecoveryCandidate({
          activate: () => this.#activateCandidate(false),
          discard: () => this.#discardCandidate(),
          onRollback: async () => { await this.#options.log('Recovery plugin candidate failed validation and was rolled back before retry.') },
        })
      }
    } finally {
      this.#recoveryOwnsCandidate = this.#candidateId !== undefined
    }
  }

  observeHarness(event: DesktopProfileMutationHarnessEvent): void {
    if (this.#disposed) return
    switch (event.type) {
      case 'starting': this.#transactions.harnessStarting(); return
      case 'server-ready': this.#transactions.serverReady(); return
      case 'normal-ready': this.#transactions.ready(); return
      case 'diagnostic-ready': this.#transactions.failed(); return
      case 'optional-startup-failures': this.#transactions.optionalStartupFailures(event.failures); return
      case 'failed': this.#transactions.failed(event.error); return
    }
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    await this.#transactions.dispose()
  }

  async #beginCandidate(): Promise<void> {
    if (this.#candidateId !== undefined) return
    this.#options.cancelBootableSnapshot()
    const startedAt = Date.now()
    this.#options.onCandidatePreparation(startedAt)
    await this.#options.log('Preparing plugin candidate: snapshot metadata and copy installed dependencies.')
    const id = await prepareDesktopCandidate({
      prepare: candidateId => this.#options.commands.run(
        {
          ...this.#options.environment,
          DSH_HOME: this.#options.home,
          DSH_DESKTOP_MUTATION_OWNER_PID: String(this.#options.ownerPid),
          ...(!this.#options.harness.available() ? { DSH_PLUGIN_SNAPSHOT_BATCH: '1' } : {}),
        },
        ['transaction', 'prepare', candidateId],
        'plugin-candidate-prepare',
        this.#options.timeouts.preparationMs,
      ),
      parse: output => parsePluginCommandJson(output) as { id?: unknown },
      cleanup: candidateId => this.#cleanupPreparation(candidateId),
      cleanupFailed: () => { this.#rollbackFailed = true },
    })
    await this.#options.log(`Plugin candidate prepared in ${Date.now() - startedAt}ms.`)
    this.#selectCandidate(id)
  }

  async #cleanupPreparation(id: string): Promise<void> {
    const environment = {
      ...this.#options.environment,
      DSH_HOME: this.#options.home,
      DSH_PLUGIN_SNAPSHOT_LEASE_TOKEN: undefined,
      DSH_PLUGIN_TRANSACTION_ORIGIN: undefined,
    }
    const output = await this.#options.commands.run(
      environment,
      ['transaction', 'status'],
      'plugin-candidate-status',
      15_000,
      [0],
      true,
    )
    const record = parsePluginCommandJson(output) as { id?: unknown; producerPid?: unknown; phase?: unknown } | null
    if (record === null) return
    const leased = candidatePreparationUsesLease(
      id,
      this.#options.ownerPid,
      record,
      inspectProfileMutationLock(this.#options.home),
    )
    await this.#options.commands.run(
      { ...environment, ...(leased ? { DSH_PLUGIN_SNAPSHOT_LEASE_TOKEN: id } : {}) },
      ['transaction', 'rollback', id],
      'plugin-candidate-abort',
      60_000,
      [0],
      true,
    )
    if (leased) {
      await this.#options.commands.run(
        { ...environment, DSH_PLUGIN_SNAPSHOT_LEASE_TOKEN: id },
        ['snapshot', 'end-restore-lease'],
        'plugin-candidate-release',
        15_000,
        [0],
        true,
      )
    }
    await this.#options.log('Interrupted plugin candidate preparation rolled back after worker exit.')
  }

  async #resumePreparation(id: string): Promise<boolean> {
    const candidateHome = join(this.#options.home, 'plugin-transactions', 'web', id, 'candidate')
    if (!await this.#options.canResumeFirstStart(candidateHome)) return false
    await this.#options.commands.run(
      {
        ...this.#options.environment,
        DSH_HOME: this.#options.home,
        DSH_DESKTOP_MUTATION_OWNER_PID: String(this.#options.ownerPid),
      },
      ['transaction', 'resume-preparation', id],
      'plugin-candidate-resume',
      15_000,
    )
    this.#selectCandidate(id)
    return true
  }

  #selectCandidate(id: string): void {
    this.#candidateId = id
    this.#options.environment.DSH_HOME = join(this.#options.home, 'plugin-transactions', 'web', id, 'candidate')
    this.#options.environment.DSH_PLUGIN_TRANSACTION_ORIGIN = this.#options.home
    this.#options.environment.DSH_PLUGIN_SNAPSHOT_LEASE_TOKEN = id
    this.#options.environment.DSH_PLUGIN_SNAPSHOT_LEASE_OWNER_PID = String(this.#options.ownerPid)
  }

  #clearCandidateEnvironment(): void {
    this.#candidateId = undefined
    this.#options.environment.DSH_HOME = this.#options.home
    delete this.#options.environment.DSH_PLUGIN_TRANSACTION_ORIGIN
    delete this.#options.environment.DSH_PLUGIN_SNAPSHOT_LEASE_TOKEN
    delete this.#options.environment.DSH_PLUGIN_SNAPSHOT_LEASE_OWNER_PID
  }

  #candidateEnvironment(id: string): NodeJS.ProcessEnv {
    return {
      ...this.#options.environment,
      DSH_HOME: this.#options.home,
      DSH_PLUGIN_TRANSACTION_ORIGIN: undefined,
      DSH_PLUGIN_SNAPSHOT_LEASE_TOKEN: id,
    }
  }

  async #discardCandidate(): Promise<void> {
    const id = this.#candidateId
    if (id === undefined) return
    const environment = this.#candidateEnvironment(id)
    await this.#options.commands.run(
      environment,
      ['transaction', 'rollback', id],
      'plugin-candidate-discard',
      60_000,
      [0],
      true,
    )
    await this.#options.commands.run(
      environment,
      ['snapshot', 'end-restore-lease'],
      'plugin-candidate-release',
      15_000,
      [0],
      true,
    )
    this.#clearCandidateEnvironment()
  }

  async #activateCandidate(resume: boolean, expectedPackages: readonly string[] = []): Promise<void> {
    const id = this.#candidateId
    if (id === undefined) return
    await this.#options.commands.run(
      this.#options.environment,
      ['doctor'],
      'plugin-candidate-check',
      this.#options.timeouts.profileCheckMs,
    )
    await this.#options.commands.run(
      this.#candidateEnvironment(id),
      ['transaction', 'ready', id],
      'plugin-candidate-ready',
      15_000,
    )
    this.#clearCandidateEnvironment()
    try {
      await this.#transactions.activatePrepared(id, resume, expectedPackages)
    } catch (error) {
      if (!(error instanceof ProfileActivationRolledBackError)) this.#candidateId = id
      throw error
    }
    if (resume && !await this.#transactions.waitForSettlement(id)) {
      throw new DesktopProfileMutationRolledBackError(
        new Error('desktop: plugin startup failed; the previous Profile was restored'),
      )
    }
  }

  async #withSafety<T>(operation: string, run: () => Promise<T>): Promise<T> {
    await this.#beginCandidate()
    let safetySnapshotId: string | undefined
    try {
      const safety = await this.#options.runSnapshot(
        ['create-safety'],
        this.#options.timeouts.snapshotMs,
      ) as { snapshotId: string }
      safetySnapshotId = safety.snapshotId
      try {
        return await run()
      } catch (operationError) {
        try {
          await this.#options.runSnapshot(['restore-files', safety.snapshotId], this.#options.timeouts.snapshotMs, true)
          await this.#options.commands.run(
            this.#options.environment,
            ['install', '--offline', '--frozen-lockfile'],
            `${operation}:rollback`,
            this.#options.timeouts.installMs,
            [0],
            true,
          )
          await this.#options.log(`Rolled back candidate mutation ${operation}.`)
        } catch (rollbackError) {
          this.#rollbackFailed = true
          safetySnapshotId = undefined
          const failure = new DesktopProfileMutationRecoveryRequiredError(
            `desktop: could not roll back startup mutation ${operation}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
            operationError,
          )
          this.#options.onRecoveryRequired(failure, operation)
          throw failure
        }
        throw operationError
      }
    } finally {
      try {
        if (safetySnapshotId !== undefined) {
          await this.#options.runSnapshot(['settle-safety', safetySnapshotId], this.#options.timeouts.snapshotMs, true)
        }
      } finally {
        if (this.#rollbackFailed) await this.#discardCandidate()
      }
    }
  }

  #context(): DesktopProfileMutationContext {
    const home = this.mutationHome
    return {
      home,
      write: command => this.#write(command),
    }
  }

  #write(command: DesktopProfileWriteCommand): Promise<string> {
    switch (command.kind) {
      case 'doctor-repair':
        return this.#options.commands.run(this.#options.environment, ['doctor', '--repair'], command.operation, command.timeoutMs, [0, 10, 11])
      case 'doctor-check':
        return this.#options.commands.run(this.#options.environment, ['doctor'], command.operation, command.timeoutMs)
      case 'approve-build':
        return this.#options.commands.run(this.#options.environment, ['approve-build', command.packageName], command.operation, command.timeoutMs)
      case 'add':
        return this.#options.commands.run(
          this.#options.environment,
          ['add', ...(command.exact === true ? ['--save-exact'] : []), ...command.packageSpecs],
          command.operation,
          command.timeoutMs,
        )
      case 'remove':
        return this.#options.commands.run(this.#options.environment, ['remove', command.packageName], command.operation, command.timeoutMs)
      case 'install-frozen-offline':
        return this.#options.commands.run(this.#options.environment, ['install', '--offline', '--frozen-lockfile'], command.operation, command.timeoutMs)
    }
  }

  #runTransactionCommand(args: readonly string[], token?: string): Promise<void> {
    const environment: NodeJS.ProcessEnv = {
      ...this.#options.environment,
      DSH_HOME: this.#options.home,
      DSH_PLUGIN_TRANSACTION_ORIGIN: undefined,
    }
    if (token !== undefined) environment.DSH_PLUGIN_SNAPSHOT_LEASE_TOKEN = token
    return this.#options.commands.run(environment, args, 'profile-transaction', 60_000).then(() => undefined)
  }

  #assertAvailable(): void {
    if (this.#disposed) throw new DesktopProfileMutationCancelledError()
  }
}

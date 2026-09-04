/** Desktop transaction coordinator for Profile plugin snapshot recovery. */

import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type PluginSnapshotKind = 'automatic' | 'manual' | 'bootable' | 'safety'

export interface PluginSnapshotSummary {
  readonly snapshotId: string
  readonly kind: PluginSnapshotKind
  readonly trigger: string
  readonly label?: string
  readonly createdAt: string
  readonly packages: readonly { readonly name: string; readonly source: string; readonly version?: string }[]
  readonly bundles: readonly string[]
  readonly offlineState: 'best-effort' | 'local-source-missing'
  readonly difference: {
    readonly added: readonly string[]
    readonly removed: readonly string[]
    readonly changed: readonly string[]
    readonly versionChanges: readonly {
      readonly name: string
      readonly currentVersion?: string
      readonly snapshotVersion?: string
      readonly direction: 'upgrade' | 'downgrade' | 'change'
    }[]
  }
}

export type PluginSnapshotRestorePhase =
  | 'restoring-files'
  | 'installing-offline'
  | 'installing-online'
  | 'checking'
  | 'restarting'
  | 'verifying-startup'
  | 'needs-network'
  | 'succeeded'
  | 'rolled-back'
  | 'failed'

export interface PluginSnapshotRestoreSnapshot {
  readonly operationId: string
  readonly snapshotId: string
  readonly phase: PluginSnapshotRestorePhase
  readonly message?: string
}

interface PluginSnapshotRecord {
  readonly snapshotId: string
  readonly kind: PluginSnapshotKind
}

export interface PluginSnapshotManagerOptions {
  listSnapshots(): Promise<readonly PluginSnapshotSummary[]>
  createSnapshot(kind: 'manual' | 'bootable' | 'safety', label?: string): Promise<PluginSnapshotRecord>
  removeSnapshot(snapshotId: string): Promise<void>
  restoreFiles(snapshotId: string): Promise<void>
  settleSafety(snapshotId: string): Promise<void>
  beginMutationLease(): Promise<void>
  endMutationLease(): Promise<void>
  suspendHarness(): Promise<void>
  resumeHarness(): void
  installProfile(offline: boolean): Promise<void>
  doctorHealthy(): Promise<boolean>
  onStatus(snapshot: PluginSnapshotRestoreSnapshot): void
  verificationTimeoutMs?: number
  journalPath?: string
}

const SNAPSHOT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const LABEL_MAX_LENGTH = 80

function assertSnapshotId(value: string): void {
  if (!SNAPSHOT_ID.test(value)) throw new TypeError('desktop: invalid plugin snapshot id')
}

function normalizeLabel(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const label = value.trim()
  if (label.length === 0 || label.length > LABEL_MAX_LENGTH || /[\0\r\n]/u.test(label)) {
    throw new TypeError('desktop: plugin snapshot label must contain 1 to 80 single-line characters')
  }
  return label
}

/** Owns one recovery operation without exposing paths or package specs to the renderer. */
export class PluginSnapshotManager {
  readonly #options: PluginSnapshotManagerOptions
  #operation: PluginSnapshotRestoreSnapshot | undefined
  #safetySnapshotId: string | undefined
  #verificationTimer: NodeJS.Timeout | undefined
  #readiness = new Set<'client' | 'event-dispatch'>()
  #rollingBack = false
  #leaseActive = false

  constructor(options: PluginSnapshotManagerOptions) {
    this.#options = options
  }

  /** Roll back an interrupted transaction before ordinary Harness startup. */
  async recoverPending(): Promise<void> {
    const path = this.#options.journalPath
    if (path === undefined) return
    let value: unknown
    try {
      value = JSON.parse(readFileSync(path, 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw new Error('desktop: plugin snapshot restore journal is unreadable', { cause: error })
    }
    if (value === null || typeof value !== 'object') throw new Error('desktop: invalid plugin snapshot restore journal')
    const journal = value as { schema?: unknown; operation?: unknown; safetySnapshotId?: unknown }
    if (journal.schema !== 'dsh/profile-plugin-snapshot-restore/v1') {
      throw new Error('desktop: invalid plugin snapshot restore journal schema')
    }
    if (journal.operation === null || typeof journal.operation !== 'object') {
      throw new Error('desktop: invalid plugin snapshot restore journal operation')
    }
    const operation = journal.operation as Partial<PluginSnapshotRestoreSnapshot>
    if (typeof operation.operationId !== 'string' || typeof operation.snapshotId !== 'string'
      || typeof operation.phase !== 'string'
      || ![
        'restoring-files', 'installing-offline', 'installing-online', 'checking', 'restarting',
        'verifying-startup', 'needs-network', 'succeeded', 'rolled-back', 'failed',
      ].includes(operation.phase)) throw new Error('desktop: invalid plugin snapshot restore journal operation')
    assertSnapshotId(operation.operationId)
    assertSnapshotId(operation.snapshotId)
    this.#operation = operation as PluginSnapshotRestoreSnapshot
    if (typeof journal.safetySnapshotId === 'string') {
      assertSnapshotId(journal.safetySnapshotId)
      this.#safetySnapshotId = journal.safetySnapshotId
    }
    if (TERMINAL_PHASES.has(this.#operation.phase)) return
    if (this.#safetySnapshotId === undefined) {
      this.#setPhase('failed', 'An interrupted restore had no recoverable safety point')
      return
    }
    await this.#beginLease()
    await this.#rollback('An interrupted plugin snapshot restore was rolled back during startup', 'rolled-back')
  }

  list(): Promise<readonly PluginSnapshotSummary[]> {
    return this.#options.listSnapshots()
  }

  create(label?: string): Promise<PluginSnapshotRecord> {
    return this.#options.createSnapshot('manual', normalizeLabel(label))
  }

  async remove(snapshotId: string): Promise<readonly PluginSnapshotSummary[]> {
    assertSnapshotId(snapshotId)
    await this.#options.removeSnapshot(snapshotId)
    return this.list()
  }

  current(operationId: string): PluginSnapshotRestoreSnapshot {
    if (this.#operation?.operationId !== operationId) throw new Error('desktop: plugin snapshot restore is unavailable')
    return this.#operation
  }

  startRestore(snapshotId: string, networkAllowed: boolean): PluginSnapshotRestoreSnapshot {
    assertSnapshotId(snapshotId)
    if (typeof networkAllowed !== 'boolean') throw new TypeError('desktop: invalid plugin snapshot network confirmation')
    if (this.#operation !== undefined && !['succeeded', 'rolled-back', 'needs-network', 'failed'].includes(this.#operation.phase)) {
      throw new Error('desktop: another plugin snapshot restore is already running')
    }
    const operation: PluginSnapshotRestoreSnapshot = {
      operationId: randomUUID(),
      snapshotId,
      phase: 'restoring-files',
    }
    this.#operation = operation
    this.#publish(operation)
    void this.#restore(networkAllowed)
    return operation
  }

  async markBootable(): Promise<void> {
    await this.#options.createSnapshot('bootable')
  }

  async reportReadiness(phase: 'client' | 'event-dispatch'): Promise<boolean> {
    if (this.#operation?.phase !== 'verifying-startup') return false
    this.#readiness.add(phase)
    if (this.#readiness.size !== 2) return false
    await this.#commitSuccessfulRestore()
    return true
  }

  async handleHarnessFailure(message: string): Promise<boolean> {
    if (this.#operation?.phase !== 'verifying-startup' || this.#rollingBack) return false
    await this.#rollback(`The selected snapshot did not start successfully: ${message}`, 'rolled-back')
    return true
  }

  #publish(snapshot: PluginSnapshotRestoreSnapshot): void {
    this.#operation = snapshot
    this.#persist()
    this.#options.onStatus(snapshot)
  }

  #persist(): void {
    const path = this.#options.journalPath
    if (path === undefined || this.#operation === undefined) return
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
    const content = `${JSON.stringify({
      schema: 'dsh/profile-plugin-snapshot-restore/v1',
      operation: this.#operation,
      ...(this.#safetySnapshotId === undefined ? {} : { safetySnapshotId: this.#safetySnapshotId }),
    }, undefined, 2)}\n`
    try {
      writeFileSync(temporary, content, { flag: 'wx', mode: 0o600 })
      renameSync(temporary, path)
      if (TERMINAL_PHASES.has(this.#operation.phase)) {
        const historyDirectory = join(dirname(path), 'restore-history')
        mkdirSync(historyDirectory, { recursive: true, mode: 0o700 })
        try {
          writeFileSync(join(historyDirectory, `${this.#operation.operationId}.json`), content, {
            flag: 'wx',
            mode: 0o600,
          })
        } catch (historyError) {
          if ((historyError as NodeJS.ErrnoException).code !== 'EEXIST') throw historyError
        }
      }
    } catch (error) {
      rmSync(temporary, { force: true })
      throw error
    }
  }

  #setPhase(phase: PluginSnapshotRestorePhase, message?: string): void {
    if (this.#operation === undefined) return
    this.#publish({ ...this.#operation, phase, ...(message === undefined ? {} : { message }) })
  }

  async #beginLease(): Promise<void> {
    if (this.#leaseActive) return
    await this.#options.beginMutationLease()
    this.#leaseActive = true
  }

  async #endLease(): Promise<void> {
    if (!this.#leaseActive) return
    await this.#options.endMutationLease()
    this.#leaseActive = false
  }

  async #restore(networkAllowed: boolean): Promise<void> {
    try {
      const selected = (await this.list()).find(snapshot => snapshot.snapshotId === this.#operation?.snapshotId)
      if (selected === undefined || selected.kind === 'safety') throw new Error('The selected plugin snapshot is unavailable')
      await this.#beginLease()
      await this.#options.suspendHarness()
      const safety = await this.#options.createSnapshot('safety')
      this.#safetySnapshotId = safety.snapshotId
      this.#persist()
      await this.#options.restoreFiles(selected.snapshotId)
      this.#setPhase('installing-offline')
      try {
        await this.#options.installProfile(true)
      } catch (offlineError) {
        if (!networkAllowed) {
          await this.#rollback(
            `Offline cache is incomplete: ${offlineError instanceof Error ? offlineError.message : String(offlineError)}`,
            'needs-network',
          )
          return
        }
        this.#setPhase('installing-online')
        await this.#options.installProfile(false)
      }
      this.#setPhase('checking')
      if (!await this.#options.doctorHealthy()) throw new Error('Profile Doctor still reports plugin dependency issues')
      this.#setPhase('restarting')
      this.#readiness.clear()
      this.#options.resumeHarness()
      this.#setPhase('verifying-startup')
      this.#verificationTimer = setTimeout(() => {
        void this.#rollback('The restored Profile did not reach desktop readiness in time', 'rolled-back')
      }, this.#options.verificationTimeoutMs ?? 45_000)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (this.#safetySnapshotId !== undefined) {
        await this.#rollback(message, 'rolled-back')
      } else {
        let leaseMessage = ''
        try {
          await this.#endLease()
        } catch (leaseError) {
          leaseMessage = `; lease release failed: ${leaseError instanceof Error ? leaseError.message : String(leaseError)}`
        }
        this.#setPhase('failed', `${message}${leaseMessage}`)
        this.#options.resumeHarness()
      }
    }
  }

  async #commitSuccessfulRestore(): Promise<void> {
    if (this.#operation?.phase !== 'verifying-startup') return
    if (this.#verificationTimer !== undefined) clearTimeout(this.#verificationTimer)
    this.#verificationTimer = undefined
    const safety = this.#safetySnapshotId
    this.#safetySnapshotId = undefined
    const cleanupErrors: string[] = []
    if (safety !== undefined) {
      try {
        await this.#options.settleSafety(safety)
      } catch (error) {
        cleanupErrors.push(`safety cleanup failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    try {
      await this.#endLease()
    } catch (error) {
      cleanupErrors.push(`lease release failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    this.#setPhase('succeeded', cleanupErrors.length === 0 ? undefined : cleanupErrors.join('; '))
  }

  async #rollback(message: string, phase: 'needs-network' | 'rolled-back'): Promise<void> {
    if (this.#rollingBack) return
    this.#rollingBack = true
    if (this.#verificationTimer !== undefined) clearTimeout(this.#verificationTimer)
    this.#verificationTimer = undefined
    try {
      await this.#options.suspendHarness()
      const safety = this.#safetySnapshotId
      if (safety === undefined) throw new Error('Restore safety point is unavailable')
      await this.#options.restoreFiles(safety)
      await this.#options.installProfile(true)
      await this.#options.settleSafety(safety)
      this.#safetySnapshotId = undefined
      await this.#endLease()
      this.#setPhase(phase, message)
      this.#options.resumeHarness()
    } catch (rollbackError) {
      let leaseError: unknown
      try {
        await this.#endLease()
      } catch (error) {
        leaseError = error
      }
      this.#setPhase(
        'failed',
        `${message}; rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
        + (leaseError === undefined
          ? ''
          : `; lease release failed: ${leaseError instanceof Error
            ? leaseError.message
            : typeof leaseError === 'string' ? leaseError : 'unknown error'}`),
      )
    } finally {
      this.#rollingBack = false
    }
  }
}

const TERMINAL_PHASES = new Set<PluginSnapshotRestorePhase>([
  'needs-network', 'succeeded', 'rolled-back', 'failed',
])

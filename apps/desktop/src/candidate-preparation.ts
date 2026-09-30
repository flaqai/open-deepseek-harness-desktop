/** Prepare one candidate and recover only the journal owned by that attempt. */
import { randomUUID } from 'node:crypto'
import { HarnessInvocationError } from './harness-invocation.ts'
import type { ProfileMutationLockStatus } from './menu-mutation-guard.ts'

/** Maximum lifetime of the shared dependency-copy step, independent of archive installation. */
export const CANDIDATE_PREPARATION_TIMEOUT_MS = 5 * 60_000
const PLUGIN_SNAPSHOT_JSON_MARKER = 'dsh:plugin-snapshot-json '

/** Parse the CLI's line-framed structured result without trusting adjacent diagnostics. */
export function parsePluginCommandJson(output: string): unknown {
  const line = output.split(/\r?\n/u).find(candidate => candidate.startsWith(PLUGIN_SNAPSHOT_JSON_MARKER))
  if (line === undefined) throw new Error('desktop: plugin command returned no structured result')
  return JSON.parse(line.slice(PLUGIN_SNAPSHOT_JSON_MARKER.length))
}

/** Validate journal ownership and return whether rollback must use the desktop lease. */
export function candidatePreparationUsesLease(
  id: string,
  ownerPid: number,
  record: { id?: unknown; producerPid?: unknown; phase?: unknown },
  lock: ProfileMutationLockStatus,
): boolean {
  if (record.id !== id || record.producerPid !== ownerPid || record.phase !== 'preparing') {
    throw new Error('desktop: refusing to discard a different or activated plugin transaction')
  }
  const workerExited = lock.workerPid === undefined || lock.workerActive === false
  const leased = lock.active && lock.state === 'live' && lock.pid === ownerPid && workerExited
    && lock.operationKind === 'desktop-mutation-lease'
  if (lock.active && !leased) throw new Error('desktop: plugin preparation worker exit is not confirmed')
  return leased
}

/** Shared preparation failures stop subsequent entries in the same startup batch. */
export class CandidatePreparationError extends Error {}

/**
 * Register an identity before launching preparation; cleanup requires confirmed process exit.
 * @param options - Owned commands and guarded cleanup supplied by the desktop lifecycle.
 * @returns The prepared transaction identity.
 */
export async function prepareDesktopCandidate(options: {
  prepare(id: string): Promise<string>
  cleanup(id: string): Promise<void>
  parse(output: string): { id?: unknown }
  cleanupFailed(error: unknown): void
}): Promise<string> {
  const id = randomUUID()
  let completed = false
  try {
    const output = await options.prepare(id)
    completed = true
    if (options.parse(output).id !== id) throw new Error('desktop: prepared transaction ID does not match its request')
    return id
  } catch (error) {
    // Managed invocations emit their typed error only after process-tree cleanup.
    // An unconfirmed shutdown replaces it with a plain Error and must retain the journal.
    if (completed || error instanceof HarnessInvocationError) {
      try { await options.cleanup(id) } catch (cleanupError) {
        options.cleanupFailed(cleanupError)
        throw new CandidatePreparationError('desktop: candidate preparation recovery failed; journal retained', { cause: cleanupError })
      }
    } else options.cleanupFailed(error)
    throw new CandidatePreparationError('desktop: candidate preparation failed; remaining startup mutations deferred', { cause: error })
  }
}

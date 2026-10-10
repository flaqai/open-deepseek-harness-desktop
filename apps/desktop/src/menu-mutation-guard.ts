/** Read the existing plugin mutation lease without acquiring or removing it. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface ProfileMutationLockStatus {
  readonly active: boolean
  readonly state: 'dead' | 'live' | 'malformed' | 'missing' | 'unreadable'
  readonly lockPath: string
  readonly pid?: number
  readonly workerPid?: number
  readonly workerActive?: boolean
  readonly parentPid?: number
  readonly operationKind?: string
  readonly createdAt?: string
}

/** Inspect a Profile lock without deleting, rewriting, or acquiring it. */
export function inspectProfileMutationLock(home: string, profile = 'web'): ProfileMutationLockStatus {
  if (!/^[A-Za-z0-9._~-]{1,64}$/u.test(profile)) throw new Error('desktop: invalid Profile lock identity')
  const lockPath = join(home, 'plugin-snapshots', 'v1', `.profile-plugin-mutation.${profile}.lock`)
  let source: string
  try { source = readFileSync(lockPath, 'utf8') } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT'
      ? { active: false, state: 'missing', lockPath }
      : { active: true, state: 'unreadable', lockPath }
  }
  let owner: unknown
  try { owner = JSON.parse(source) } catch { return { active: true, state: 'malformed', lockPath } }
  if (typeof owner !== 'object' || owner === null || !('pid' in owner)
    || typeof owner.pid !== 'number' || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) {
    return { active: true, state: 'malformed', lockPath }
  }
  const candidate = owner as {
    pid: number
    workerPid?: unknown
    token?: unknown
    parentPid?: unknown
    operationKind?: unknown
    createdAt?: unknown
  }
  if ((candidate.workerPid !== undefined && (typeof candidate.workerPid !== 'number'
    || !Number.isSafeInteger(candidate.workerPid) || candidate.workerPid <= 0))
    || (candidate.token !== undefined && typeof candidate.token !== 'string')
    || (candidate.operationKind !== undefined && typeof candidate.operationKind !== 'string')) {
    return { active: true, state: 'malformed', lockPath }
  }
  const metadata = {
    pid: candidate.pid,
    ...(typeof candidate.workerPid === 'number' ? { workerPid: candidate.workerPid } : {}),
    ...(typeof candidate.parentPid === 'number' && Number.isSafeInteger(candidate.parentPid)
      ? { parentPid: candidate.parentPid } : {}),
    ...(typeof candidate.operationKind === 'string'
      ? { operationKind: candidate.operationKind.slice(0, 80) } : {}),
    ...(typeof candidate.createdAt === 'string' ? { createdAt: candidate.createdAt.slice(0, 64) } : {}),
  }
  const processActive = (pid: number): boolean | undefined => {
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      return error instanceof Error && 'code' in error && error.code === 'ESRCH' ? false : undefined
    }
  }
  const ownerActive = processActive(candidate.pid)
  const workerActive = typeof candidate.workerPid === 'number' ? processActive(candidate.workerPid) : undefined
  const activity = { ...metadata, ...(workerActive === undefined ? {} : { workerActive }) }
  if (ownerActive === undefined || (candidate.workerPid !== undefined && workerActive === undefined)) {
    return { active: true, state: 'unreadable', lockPath, ...activity }
  }
  if (ownerActive || workerActive) return { active: true, state: 'live', lockPath, ...activity }
  return { active: false, state: 'dead', lockPath, ...activity }
}

/** Detect a live or unreadable Profile mutation lease. @param home - Active Harness home. @returns True when exit must wait. */
export function menuMutationActive(home: string): boolean {
  return inspectProfileMutationLock(home).active
}

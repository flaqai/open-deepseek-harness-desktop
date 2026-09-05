/** Read the existing plugin mutation lease without acquiring or removing it. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface ProfileMutationLockStatus {
  readonly active: boolean
  readonly state: 'dead' | 'live' | 'malformed' | 'missing' | 'unreadable'
  readonly lockPath: string
  readonly pid?: number
  readonly parentPid?: number
  readonly operationKind?: string
  readonly createdAt?: string
}

/** Inspect a Profile lock without deleting, rewriting, or acquiring it. */
export function inspectProfileMutationLock(home: string): ProfileMutationLockStatus {
  const lockPath = join(home, 'plugin-snapshots', 'v1', '.profile-plugin-mutation.web.lock')
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
    parentPid?: unknown
    operationKind?: unknown
    createdAt?: unknown
  }
  const metadata = {
    pid: candidate.pid,
    ...(typeof candidate.parentPid === 'number' && Number.isSafeInteger(candidate.parentPid)
      ? { parentPid: candidate.parentPid } : {}),
    ...(typeof candidate.operationKind === 'string'
      ? { operationKind: candidate.operationKind.slice(0, 80) } : {}),
    ...(typeof candidate.createdAt === 'string' ? { createdAt: candidate.createdAt.slice(0, 64) } : {}),
  }
  try {
    process.kill(candidate.pid, 0)
    return { active: true, state: 'live', lockPath, ...metadata }
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'ESRCH'
      ? { active: false, state: 'dead', lockPath, ...metadata }
      : { active: true, state: 'unreadable', lockPath, ...metadata }
  }
}

/** Detect a live or unreadable Profile mutation lease. @param home - Active Harness home. @returns True when exit must wait. */
export function menuMutationActive(home: string): boolean {
  return inspectProfileMutationLock(home).active
}

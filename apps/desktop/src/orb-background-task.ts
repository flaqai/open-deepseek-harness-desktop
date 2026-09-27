/** Restrict floating-chat background work to its own local standard Sessions. */

import { isAbsolute } from 'node:path'

/** Current Desktop authority; `home` is the canonical active DSH_HOME path. */
export interface OrbBackgroundAuthority {
  readonly home: string
  readonly mode: 'local' | 'nas'
}

/** Host Session operations; approval and user-question handling remain with the normal Host. */
export interface OrbBackgroundSessionDriver<Id extends string> {
  create(input: { readonly preset: 'standard'; readonly cwd?: string }, signal: AbortSignal): Promise<Id>
  enqueue(input: { readonly sessionId: Id; readonly task: string }, signal: AbortSignal): Promise<void>
  inspect(sessionId: Id): Promise<{
    readonly preset: string | undefined
    readonly origin?: 'subagent'
    readonly cwd?: string
    readonly running: boolean
  }>
  /** Cancel only the active turn; ordinary Session queued work is retained by the Host. */
  stop(sessionId: Id): Promise<void>
}

/** One caller-owned background Session shown without exposing other callers' work. */
export interface OrbBackgroundTask<Id extends string> {
  readonly sessionId: Id
  readonly task: string
  readonly cwd?: string
  readonly status: 'running' | 'idle'
}

/** Request to create new work or continue only a worker created by this caller. */
export interface OrbBackgroundSubmit<Id extends string> {
  readonly callerSessionId: Id
  readonly task: string
  readonly workerSessionId?: Id
  readonly cwd?: string
}

/** Session identity and whether a new standard Session was created. */
export interface OrbBackgroundReceipt<Id extends string> {
  readonly sessionId: Id
  readonly created: boolean
}

/** Restricted Host entry points; hiding the floating ball does not stop workers. */
export interface OrbBackgroundTasks<Id extends string> {
  submit(request: OrbBackgroundSubmit<Id>, signal?: AbortSignal): Promise<OrbBackgroundReceipt<Id>>
  list(callerSessionId: Id): Promise<readonly OrbBackgroundTask<Id>[]>
  stop(callerSessionId: Id, workerSessionId: Id): Promise<void>
  close(): Promise<void>
}

/** Dependencies supplied by the desktop's authenticated Session Controller. */
export interface OrbBackgroundOptions<Id extends string> {
  readonly home: string
  readonly authority: () => Promise<OrbBackgroundAuthority>
  /** True only for a live floating-chat Session owned by this DSH_HOME. */
  readonly ownsCaller: (sessionId: Id) => Promise<boolean>
  readonly sessions: OrbBackgroundSessionDriver<Id>
}

interface OwnedWorker {
  task: string
  cwd?: string
}

function requireTask(task: string): string {
  const trimmed = task.trim()
  if (trimmed.length === 0 || trimmed.length > 16_384) {
    throw new Error('orb background task: task must contain 1 to 16384 characters')
  }
  return trimmed
}

function requireCwd(cwd: string | undefined): void {
  if (cwd !== undefined && (!isAbsolute(cwd) || cwd.includes('\0'))) {
    throw new Error('orb background task: cwd must be an absolute local path')
  }
}

/**
 * Keep worker ownership in one Host instance and use only the existing standard
 * Session create, prompt, inspect, and stop paths. No approval listener is installed.
 * Worker ownership does not survive Host restart; persisted continuity needs a
 * separate durable caller/worker record before the UI may promise it.
 * @param options - Canonical home, authority and caller checks, and Host Session operations.
 * @returns a controller that must settle its requests before the host discards it.
 */
export function createOrbBackgroundTasks<Id extends string>(options: OrbBackgroundOptions<Id>): OrbBackgroundTasks<Id> {
  if (options.home === '' || !isAbsolute(options.home)) throw new Error('orb background task: invalid home')
  const byCaller = new Map<Id, Map<Id, OwnedWorker>>()
  const lifetime = new AbortController()
  const pending = new Set<Promise<unknown>>()
  let closed = false
  let closing: Promise<void> | undefined

  const track = <T>(run: () => Promise<T>): Promise<T> => {
    if (closed) return Promise.reject(new Error('orb background task: controller is closed'))
    const operation = Promise.resolve().then(run)
    pending.add(operation)
    void operation.then(() => { pending.delete(operation) }, () => { pending.delete(operation) })
    return operation
  }

  const requireCaller = async (callerId: Id, signal?: AbortSignal): Promise<void> => {
    signal?.throwIfAborted()
    const authority = await options.authority()
    if (authority.mode !== 'local' || authority.home !== options.home) {
      throw new Error('orb background task: unavailable outside the active local data directory')
    }
    if (!await options.ownsCaller(callerId)) {
      throw new Error('orb background task: caller is not an owned floating-chat Session')
    }
    signal?.throwIfAborted()
  }

  const ownedWorker = (callerId: Id, workerId: Id): OwnedWorker => {
    const worker = byCaller.get(callerId)?.get(workerId)
    if (worker === undefined || workerId === callerId) {
      throw new Error('orb background task: worker is not owned by this floating-chat Session')
    }
    return worker
  }

  const inspectWorker = async (workerId: Id): Promise<Awaited<ReturnType<typeof options.sessions.inspect>>> => {
    const inspected = await options.sessions.inspect(workerId)
    if (inspected.preset !== 'standard' || inspected.origin === 'subagent') {
      throw new Error('orb background task: worker is not a standard Session')
    }
    return inspected
  }

  return {
    submit(request, signal) {
      return track(async () => {
        const active = signal === undefined ? lifetime.signal : AbortSignal.any([signal, lifetime.signal])
        const task = requireTask(request.task)
        requireCwd(request.cwd)
        await requireCaller(request.callerSessionId, active)
        let sessionId: Id
        let created = false
        let worker: OwnedWorker
        if (request.workerSessionId === undefined) {
          sessionId = await options.sessions.create({ preset: 'standard', ...(request.cwd === undefined ? {} : { cwd: request.cwd }) }, active)
          if (sessionId === request.callerSessionId) throw new Error('orb background task: worker cannot be the caller Session')
          worker = { task, ...(request.cwd === undefined ? {} : { cwd: request.cwd }) }
          let workers = byCaller.get(request.callerSessionId)
          if (workers === undefined) {
            workers = new Map<Id, OwnedWorker>()
            byCaller.set(request.callerSessionId, workers)
          }
          workers.set(sessionId, worker)
          created = true
        } else {
          sessionId = request.workerSessionId
          worker = ownedWorker(request.callerSessionId, sessionId)
          const inspected = await inspectWorker(sessionId)
          if (request.cwd !== undefined && request.cwd !== (inspected.cwd ?? worker.cwd)) {
            throw new Error('orb background task: cwd differs from the existing worker Session')
          }
        }
        await requireCaller(request.callerSessionId, active)
        await options.sessions.enqueue({ sessionId, task }, active)
        worker.task = task
        return { sessionId, created }
      })
    },
    list(callerSessionId) {
      return track(async () => {
        await requireCaller(callerSessionId, lifetime.signal)
        const workers = byCaller.get(callerSessionId)
        if (workers === undefined) return []
        const tasks = await Promise.all([...workers].map(async ([sessionId, worker]) => {
          const inspected = await inspectWorker(sessionId)
          const cwd = inspected.cwd ?? worker.cwd
          return {
            sessionId,
            task: worker.task,
            ...(cwd === undefined ? {} : { cwd }),
            status: inspected.running ? 'running' as const : 'idle' as const,
          }
        }))
        await requireCaller(callerSessionId, lifetime.signal)
        return tasks
      })
    },
    stop(callerSessionId, workerSessionId) {
      return track(async () => {
        await requireCaller(callerSessionId, lifetime.signal)
        ownedWorker(callerSessionId, workerSessionId)
        await inspectWorker(workerSessionId)
        await requireCaller(callerSessionId, lifetime.signal)
        await options.sessions.stop(workerSessionId)
      })
    },
    close() {
      if (closing !== undefined) return closing
      closed = true
      lifetime.abort()
      closing = Promise.allSettled(pending).then(() => {})
      return closing
    },
  }
}

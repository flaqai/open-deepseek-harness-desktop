/** Host-owned background Sessions for the local Desktop Orb. */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionController, SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'

const SESSION_PATTERN = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const MAX_TASK_LENGTH = 16_384

/** Existing Host operations; the ordinary controller retains approval and question handling. */
export type OrbBackgroundSessionDriver = Pick<SessionController, 'create' | 'prompt' | 'inspect' | 'list' | 'cancel'>

/** A caller identity proved by the Host's Desktop Orb owner. */
export interface OrbBackgroundCallerOwner {
  ownsCaller(sessionId: SessionId): Promise<boolean>
}

/** One worker's durable identity, scoped to the active local data directory. */
export interface OrbBackgroundWorker {
  readonly sessionId: SessionId
  readonly cwd: string
  readonly running: boolean
}

/** Standard Session work submitted by its owning floating-chat Session. */
export interface OrbBackgroundRequest {
  readonly callerSessionId: SessionId
  readonly task: string
  readonly workerSessionId?: SessionId
  readonly cwd?: string
}

/** Host operations available only while this Desktop owns the local Host. */
export interface OrbBackgroundHostTasks {
  submit(request: OrbBackgroundRequest, signal?: AbortSignal): Promise<{ readonly sessionId: SessionId; readonly created: boolean }>
  list(callerSessionId: SessionId, signal?: AbortSignal): Promise<readonly OrbBackgroundWorker[]>
  stop(callerSessionId: SessionId, workerSessionId: SessionId, signal?: AbortSignal): Promise<void>
}

interface WorkerRecord {
  readonly version: 1
  readonly callerSessionId: SessionId
  readonly workerSessionId: SessionId
  readonly cwd: string
}

function requireSessionId(value: string): SessionId {
  if (!SESSION_PATTERN.test(value)) throw new Error('orb background: invalid Session identity')
  return SessionId(value)
}

function requireTask(value: string): string {
  const task = value.trim()
  if (task.length === 0 || task.length > MAX_TASK_LENGTH) {
    throw new Error('orb background: task must contain 1 to 16384 characters')
  }
  return task
}

function parseRecord(data: string, expectedId: SessionId): WorkerRecord {
  const value: unknown = JSON.parse(data)
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || !('version' in value) || value.version !== 1
    || !('callerSessionId' in value) || typeof value.callerSessionId !== 'string'
    || !('workerSessionId' in value) || typeof value.workerSessionId !== 'string'
    || !('cwd' in value) || typeof value.cwd !== 'string'
    || !isAbsolute(value.cwd) || value.cwd.includes('\0')
    || !SESSION_PATTERN.test(value.callerSessionId)
    || value.workerSessionId !== expectedId) {
    throw new Error('orb background: malformed worker ownership record')
  }
  return {
    version: 1,
    callerSessionId: SessionId(value.callerSessionId),
    workerSessionId: expectedId,
    cwd: value.cwd,
  }
}

/**
 * Create a local Host controller. The private record is written after Session
 * creation and before its first prompt, so a failed ownership write cannot run
 * untracked work. Records survive Host restart; hiding the Orb never stops work.
 * @param home - Canonical active local DSH_HOME.
 * @param owner - Host-owned floating-chat identity verifier.
 * @param sessions - Ordinary Host Session Controller methods.
 * @param local - Whether the current Host is still the local Desktop generation.
 * @returns background Session operations with no approval override.
 */
export function createDesktopOrbBackgroundTasks(
  home: string,
  owner: OrbBackgroundCallerOwner,
  sessions: OrbBackgroundSessionDriver,
  local: () => boolean,
): OrbBackgroundHostTasks {
  if (!isAbsolute(home) || resolve(home) !== home) throw new Error('orb background: expected canonical DSH_HOME')
  const directory = join(home, '.desktop-orb', 'background-workers-v1')

  const requireCaller = async (callerSessionId: SessionId, signal: AbortSignal): Promise<{ cwd: string }> => {
    signal.throwIfAborted()
    requireSessionId(callerSessionId)
    if (!local()) throw new Error('orb background: unavailable outside the local Desktop Host')
    if (!await owner.ownsCaller(callerSessionId)) throw new Error('orb background: caller is not the owned Orb Session')
    const caller = await sessions.inspect(callerSessionId, signal)
    if (caller.meta.agentPreset !== 'standard' || caller.meta.origin === 'subagent' || caller.meta.cwd === undefined) {
      throw new Error('orb background: caller is not an ordinary standard Session with a workspace')
    }
    signal.throwIfAborted()
    if (!local()) throw new Error('orb background: unavailable outside the local Desktop Host')
    return { cwd: caller.meta.cwd }
  }

  const readWorker = async (callerSessionId: SessionId, workerSessionId: SessionId, signal: AbortSignal): Promise<WorkerRecord> => {
    signal.throwIfAborted()
    requireSessionId(workerSessionId)
    if (workerSessionId === callerSessionId) throw new Error('orb background: worker is not owned by this caller')
    let data: string
    try { data = await readFile(join(directory, `${workerSessionId}.json`), 'utf8') }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new Error('orb background: worker is not owned by this caller')
      }
      throw error
    }
    const record = parseRecord(data, workerSessionId)
    if (record.callerSessionId !== callerSessionId) throw new Error('orb background: worker is not owned by this caller')
    const inspected = await sessions.inspect(workerSessionId, signal)
    if (inspected.meta.id !== workerSessionId || inspected.meta.agentPreset !== 'standard'
      || inspected.meta.origin === 'subagent' || inspected.meta.cwd !== record.cwd) {
      throw new Error('orb background: worker Session differs from its ownership record')
    }
    return record
  }

  return {
    async submit(request, suppliedSignal) {
      const signal = suppliedSignal ?? new AbortController().signal
      const task = requireTask(request.task)
      const caller = await requireCaller(request.callerSessionId, signal)
      const cwd = request.cwd ?? caller.cwd
      if (!isAbsolute(cwd) || cwd.includes('\0')) throw new Error('orb background: cwd must be an absolute local path')
      let sessionId: SessionId
      let created = false
      if (request.workerSessionId === undefined) {
        sessionId = SessionId(`session-${randomUUID()}`)
        const createdSession = await sessions.create({ sessionId, cwd, agentPreset: 'standard' })
        if (createdSession.sessionId !== sessionId || createdSession.agentPreset !== 'standard') {
          throw new Error('orb background: Host did not create the requested standard Session')
        }
        const inspected = await sessions.inspect(sessionId, signal)
        if (inspected.meta.id !== sessionId || inspected.meta.cwd !== cwd
          || inspected.meta.agentPreset !== 'standard' || inspected.meta.origin === 'subagent') {
          throw new Error('orb background: created Session does not match its identity')
        }
        await requireCaller(request.callerSessionId, signal)
        await mkdir(directory, { recursive: true, mode: 0o700 })
        const record: WorkerRecord = { version: 1, callerSessionId: request.callerSessionId, workerSessionId: sessionId, cwd }
        await writeFile(join(directory, `${sessionId}.json`), `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
        created = true
      } else {
        sessionId = request.workerSessionId
        const record = await readWorker(request.callerSessionId, sessionId, signal)
        if (cwd !== record.cwd) throw new Error('orb background: cwd differs from the worker Session')
      }
      await requireCaller(request.callerSessionId, signal)
      await sessions.prompt({
        requestId: randomUUID() as SessionRequestId,
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: task }],
      }, signal)
      return { sessionId, created }
    },
    async list(callerSessionId, suppliedSignal) {
      const signal = suppliedSignal ?? new AbortController().signal
      await requireCaller(callerSessionId, signal)
      let filenames: string[]
      try { filenames = await readdir(directory) }
      catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
        throw error
      }
      const rows = await sessions.list({}, signal)
      const workers: OrbBackgroundWorker[] = []
      for (const filename of filenames) {
        if (!filename.endsWith('.json')) continue
        const id = requireSessionId(filename.slice(0, -5))
        const data = await readFile(join(directory, filename), 'utf8')
        const record = parseRecord(data, id)
        if (record.callerSessionId !== callerSessionId) continue
        await readWorker(callerSessionId, id, signal)
        workers.push({ sessionId: id, cwd: record.cwd, running: rows.items.find(row => row.sessionId === id)?.running ?? false })
      }
      await requireCaller(callerSessionId, signal)
      return workers
    },
    async stop(callerSessionId, workerSessionId, suppliedSignal) {
      const signal = suppliedSignal ?? new AbortController().signal
      await requireCaller(callerSessionId, signal)
      await readWorker(callerSessionId, workerSessionId, signal)
      await requireCaller(callerSessionId, signal)
      await sessions.cancel({ sessionId: workerSessionId })
    },
  }
}

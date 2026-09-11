/** Load the Harness-owned process inspector from the selected runtime, not Electron's dependency tree. */
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Readable, Writable } from 'node:stream'

const PROCESS_RECOVERY_SCHEMA = 'open-dsh-desktop/process-recovery/v2'

function isProcessIdentity(value: unknown): value is { pid: number; started: string } {
  if (value === null || typeof value !== 'object') return false
  const identity = value as { pid?: unknown; started?: unknown }
  return Number.isSafeInteger(identity.pid) && (identity.pid as number) > 0
    && typeof identity.started === 'string' && identity.started.length > 0 && identity.started.length <= 128
}

function isCurrentProcessRecoveryJournal(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false
  const document = value as { schema?: unknown; records?: unknown }
  if (document.schema !== PROCESS_RECOVERY_SCHEMA
    || !Array.isArray(document.records) || document.records.length > 256) return false
  return document.records.every((value: unknown) => {
    if (value === null || typeof value !== 'object') return false
    const record = value as { id?: unknown; label?: unknown; root?: unknown; identities?: unknown }
    return typeof record.id === 'string' && record.id.length > 0 && record.id.length <= 128
      && typeof record.label === 'string' && record.label.length > 0 && record.label.length <= 128
      && isProcessIdentity(record.root)
      && Array.isArray(record.identities) && record.identities.length <= 1_024
      && record.identities.every(isProcessIdentity)
  })
}

/** Streams and owned-range completion from the selected Harness runtime. */
export interface DesktopManagedHandle {
  readonly rootPid?: number
  readonly stdin: Writable | undefined
  readonly stdout: Readable | undefined
  readonly stderr: Readable | undefined
  readonly done: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>
  readonly terminate: () => void
  waitForExit: (signal?: AbortSignal) => Promise<boolean>
}

/** Internal launch request; it is never accepted directly from a renderer. */
export interface DesktopManagedRequest {
  label: string
  lifecycle: 'task' | 'client'
  plugin?: string
  argv: readonly string[]
  cwd: string
  env: Record<string, string>
  stdio: { stdin: 'ignore' | 'pipe'; stdout: 'pipe'; stderr: 'pipe' }
  graceMs: number
  signal: AbortSignal
}

/** Minimal desktop view of the runtime's identity-fenced observer. */
export interface DesktopProcessObserver {
  register(pid: number, label: string): string
  preserve(identities: readonly { pid: number; started: string }[]): Promise<void>
  stopAll(graceMs?: number, forceMs?: number): Promise<void>
  stop(id: string): Promise<void>
  stopRecovered(id: string, label: string, identities: readonly { pid: number; started: string }[]): Promise<void>
  list(): readonly DesktopProcessSnapshot[]
  readonly launch: (request: DesktopManagedRequest) => { containment: string; handle: DesktopManagedHandle }
}

/** Renderer-safe process state. It deliberately excludes PID, argv, cwd and environment. */
export interface DesktopProcessSnapshot {
  readonly schema: 'open-dsh-desktop/managed-process/v1'
  readonly id: string
  readonly label: string
  readonly lifecycle: 'task' | 'client' | 'legacy-child'
  readonly plugin?: string
  readonly phase: 'running' | 'stopping' | 'failed'
  readonly startedAt: string
  readonly containment: string
  readonly stoppable: boolean
}

export const PROCESS_GUARDIAN_SOURCE = String.raw`
const { readFile, rm } = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const [entry, recoveryPath, persistentRuntimePath] = process.argv.slice(1);
let clean = false;
let running = false;
let ProcessObserver;
async function recover() {
  if (clean || running) return;
  running = true;
  try {
    const source = await readFile(recoveryPath, 'utf8');
    const observer = new ProcessObserver();
    observer.restoreRecoveryJournal(JSON.parse(source));
    try {
      const persistent = JSON.parse(await readFile(persistentRuntimePath, 'utf8'));
      if (persistent && persistent.schema === 'open-dsh-desktop/persistent-service-runtime/v1' && Array.isArray(persistent.records)) {
        const identities = persistent.records.flatMap(record => Array.isArray(record && record.identities) ? record.identities : []);
        observer.excludeIdentities(identities);
      }
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
    }
    await observer.stopAll();
    await rm(recoveryPath, { force: true });
  } catch (error) {
    if (!error || error.code !== 'ENOENT') process.stderr.write('desktop process guardian: ' + String(error) + '\n');
  } finally { process.exit(); }
}
process.on('message', message => {
  if (message && message.type === 'clean') { clean = true; process.exit(); }
});
process.on('disconnect', () => { void recover(); });
void import(pathToFileURL(entry).href).then(module => {
  ProcessObserver = module.DesktopProcessObserver;
  if (typeof ProcessObserver !== 'function') throw new Error('process observer export is unavailable');
  if (process.send) process.send({ type: 'ready' });
}).catch(error => { process.stderr.write('desktop process guardian: ' + String(error) + '\n'); process.exit(1); });
`

async function startProcessGuardian(
  nodeCommand: string,
  observerEntry: string,
  recoveryPath: string,
  persistentRuntimePath: string,
): Promise<() => Promise<void>> {
  const child = spawn(nodeCommand, ['-e', PROCESS_GUARDIAN_SOURCE, observerEntry, recoveryPath, persistentRuntimePath], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    windowsHide: true,
    detached: process.platform !== 'win32',
  })
  child.unref()
  child.channel?.unref()
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { reject(new Error('desktop: process guardian readiness timed out')) }, 5_000)
    const cleanup = (): void => { clearTimeout(timeout); child.off('error', failed); child.off('exit', exited); child.off('message', ready) }
    const failed = (error: Error): void => { cleanup(); reject(error) }
    const exited = (code: number | null): void => { cleanup(); reject(new Error(`desktop: process guardian exited before readiness (${String(code)})`)) }
    const ready = (message: unknown): void => {
      if (message === null || typeof message !== 'object' || (message as { type?: unknown }).type !== 'ready') return
      cleanup(); resolve()
    }
    child.once('error', failed)
    child.once('exit', exited)
    child.on('message', ready)
  })
  return async () => {
    if (child.exitCode !== null || child.signalCode !== null) return
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* already gone */ }; resolve() }, 2_000)
      child.once('exit', () => { clearTimeout(timeout); resolve() })
      try { child.send({ type: 'clean' }) } catch { clearTimeout(timeout); resolve() }
    })
  }
}

async function readPersistentRuntimeIdentities(path: string | undefined): Promise<readonly { pid: number; started: string }[]> {
  if (path === undefined) return []
  const source = await readFile(path, 'utf8').catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  })
  if (source === undefined) return []
  const value = JSON.parse(source) as unknown
  if (value === null || typeof value !== 'object'
    || (value as { schema?: unknown }).schema !== 'open-dsh-desktop/persistent-service-runtime/v1'
    || !Array.isArray((value as { records?: unknown }).records)) {
    throw new TypeError('desktop: invalid persistent service runtime state')
  }
  const records = (value as { records: unknown[] }).records
  if (records.length > 256) throw new TypeError('desktop: invalid persistent service runtime state')
  return records.flatMap((record) => {
    if (record === null || typeof record !== 'object' || !Array.isArray((record as { identities?: unknown }).identities)) {
      throw new TypeError('desktop: invalid persistent service runtime record')
    }
    return (record as { identities: { pid: number; started: string }[] }).identities
  })
}

/** Preserve one rejected process journal and remove it from startup admission.
 * @param path - Desktop-owned recovery journal path.
 */
export async function quarantineProcessRecoveryJournal(path: string): Promise<void> {
  const rejected = `${path}.rejected`
  await rm(rejected, { force: true })
  await rename(path, rejected).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  })
}

/** Read a current process journal or quarantine derived state that cannot prove ownership.
 * @param path - Desktop-owned recovery journal path.
 * @returns Parsed current journal, or undefined after absence or quarantine.
 */
export async function readProcessRecoveryJournal(path: string): Promise<unknown> {
  const source = await readFile(path, 'utf8').catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  })
  if (source === undefined) return undefined
  let value: unknown
  try {
    value = JSON.parse(source.charCodeAt(0) === 0xFEFF ? source.slice(1) : source) as unknown
  } catch (error) {
    await quarantineProcessRecoveryJournal(path)
    console.warn('desktop: quarantined unreadable process recovery journal', error)
    return undefined
  }
  if (!isCurrentProcessRecoveryJournal(value)) {
    await quarantineProcessRecoveryJournal(path)
    console.warn('desktop: quarantined legacy or invalid process recovery journal')
    return undefined
  }
  return value
}

/** Load the exact selected Harness runtime's observer.
 * @param harnessBin - Absolute CLI entry selected by the desktop launcher.
 * @returns Observer whose native dependencies resolve beside that runtime.
 */
export async function loadProcessObserver(
  harnessBin: string,
  nodeCommand: string,
  recoveryPath?: string,
  persistentRuntimePath?: string,
): Promise<DesktopProcessObserver> {
  const require = createRequire(harnessBin)
  const entry = require.resolve('@deepseek-ai/dsh-subprocess-local/process-control')
  const module = await import(pathToFileURL(entry).href) as {
    DesktopProcessObserver: new () => {
      register(pid: number, label: string): string
      list(): readonly { id: string; label: string; phase: 'running' | 'stopping' | 'failed' | 'stopped' }[]
      stopOne(id: string, graceMs?: number, forceMs?: number): Promise<void>
      stopAll(graceMs?: number, forceMs?: number): Promise<void>
      recoveryJournal(): unknown
      restoreRecoveryJournal(value: unknown): number
      excludeIdentities(identities: readonly { pid: number; started: string }[]): void
    }
    launchDesktopManagedProcess(
      request: DesktopManagedRequest,
      runner: [string, string],
    ): { containment: string; handle: DesktopManagedHandle }
  }
  if (recoveryPath !== undefined) {
    const document = await readProcessRecoveryJournal(recoveryPath)
    if (document !== undefined) {
      const recovery = new module.DesktopProcessObserver()
      let valid = true
      try {
        recovery.restoreRecoveryJournal(document)
      } catch (error) {
        valid = false
        await quarantineProcessRecoveryJournal(recoveryPath)
        console.warn('desktop: quarantined invalid process recovery journal', error)
      }
      if (valid) {
        recovery.excludeIdentities(await readPersistentRuntimeIdentities(persistentRuntimePath))
        await recovery.stopAll()
        await rm(recoveryPath, { force: true })
      }
    }
  }
  const closeGuardian = recoveryPath === undefined || persistentRuntimePath === undefined
    ? async (): Promise<void> => {}
    : await startProcessGuardian(nodeCommand, entry, recoveryPath, persistentRuntimePath)
  const observer = new module.DesktopProcessObserver()
  const runner: [string, string] = [nodeCommand, require.resolve('@deepseek-ai/dsh-subprocess-local/runner')]
  const handles = new Map<string, {
    handle: DesktopManagedHandle
    observerId: string
    snapshot: DesktopProcessSnapshot
  }>()
  let closing = false
  let journalFailure: unknown
  let journalWriting: Promise<void> | undefined
  const persist = (): Promise<void> => {
    if (recoveryPath === undefined) return Promise.resolve()
    if (journalWriting !== undefined) return journalWriting
    journalWriting = (async () => {
      const document = observer.recoveryJournal()
      await mkdir(dirname(recoveryPath), { recursive: true })
      const temporary = `${recoveryPath}.${process.pid}.tmp`
      await writeFile(temporary, `${JSON.stringify(document)}\n`, { mode: 0o600 })
      await rename(temporary, recoveryPath)
    })().catch((error: unknown) => { journalFailure = error; throw error }).finally(() => { journalWriting = undefined })
    return journalWriting
  }
  const journalTimer = recoveryPath === undefined ? undefined : setInterval(() => { void persist().catch(() => {}) }, 2_000)
  journalTimer?.unref()
  return {
    register: (pid, label) => {
      if (closing) throw new Error('desktop: process admission is closed')
      const id = observer.register(pid, label)
      void persist().catch(() => {})
      return id
    },
    preserve: async (identities) => {
      if (identities.length === 0) return
      observer.excludeIdentities(identities)
      await persist()
    },
    stopAll: async (graceMs = 10_000, forceMs = 5_000) => {
      closing = true
      clearInterval(journalTimer)
      // Let the native Job/scope owner prove its own range empty before the
      // fallback observer touches the runner identity. Signalling both in
      // parallel can kill the owner first and manufacture an uncertain result.
      const nativeOutcomes = await Promise.allSettled(
        [...handles.values()].map(async ({ handle }) => {
          handle.terminate()
          if (!await handle.waitForExit(AbortSignal.timeout(graceMs + forceMs))) {
            throw new Error('desktop: native process range remains active')
          }
          for (const [id, record] of handles) if (record.handle === handle) handles.delete(id)
        }),
      )
      const observerOutcome = await Promise.allSettled([observer.stopAll(graceMs, forceMs)])
      const failures = [...nativeOutcomes, ...observerOutcome]
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (journalFailure !== undefined) failures.push({ status: 'rejected', reason: journalFailure })
      if (failures.length > 0) throw new AggregateError(failures.map(result => result.reason as unknown), 'desktop: managed process cleanup failed')
      if (recoveryPath !== undefined) await rm(recoveryPath, { force: true })
      await closeGuardian()
    },
    stop: async (id) => {
      const native = handles.get(id)
      if (native === undefined) return observer.stopOne(id)
      native.snapshot = { ...native.snapshot, phase: 'stopping' }
      native.handle.terminate()
      if (!await native.handle.waitForExit(AbortSignal.timeout(15_000))) {
        native.snapshot = { ...native.snapshot, phase: 'failed' }
        throw new Error('desktop: managed process range remains active')
      }
      await observer.stopOne(native.observerId, 1, 1)
      handles.delete(id)
      await persist()
    },
    stopRecovered: async (id, label, identities) => {
      const root = identities[0]
      if (root === undefined) return
      const restored = observer.restoreRecoveryJournal({
        schema: PROCESS_RECOVERY_SCHEMA,
        records: [{ id, label, root, identities }],
      })
      if (restored === 0) return
      await observer.stopOne(id)
      await persist()
    },
    list: () => {
      const nativeObserverIds = new Set([...handles.values()].map(record => record.observerId))
      return [
        ...observer.list().flatMap(record => record.phase === 'stopped' || nativeObserverIds.has(record.id) ? [] : [{
          schema: 'open-dsh-desktop/managed-process/v1' as const,
          id: record.id,
          label: record.label,
          lifecycle: 'legacy-child' as const,
          phase: record.phase,
          startedAt: '',
          containment: 'identity-observer',
          stoppable: true,
        }]),
        ...[...handles.values()].map(record => record.snapshot),
      ]
    },
    launch: (request) => {
      if (closing) throw new Error('desktop: process admission is closed')
      const launched = module.launchDesktopManagedProcess(request, runner)
      if (launched.handle.rootPid === undefined) {
        launched.handle.terminate()
        throw new Error('desktop: managed launcher did not publish a recovery root')
      }
      let observerId: string
      try {
        observerId = observer.register(launched.handle.rootPid, request.label)
      } catch (error) {
        launched.handle.terminate()
        throw new Error('desktop: cannot establish managed process recovery identity', { cause: error })
      }
      const id = randomUUID()
      handles.set(id, {
        handle: launched.handle,
        observerId,
        snapshot: {
          schema: 'open-dsh-desktop/managed-process/v1', id, label: request.label,
          lifecycle: request.lifecycle, ...(request.plugin === undefined ? {} : { plugin: request.plugin }),
          phase: 'running', startedAt: new Date().toISOString(), containment: launched.containment,
          stoppable: request.lifecycle === 'task',
        },
      })
      void persist().catch(() => {})
      const released = async (): Promise<void> => {
        if (await launched.handle.waitForExit()) {
          await observer.stopOne(observerId, 1, 1)
          handles.delete(id)
          await persist()
        }
      }
      void launched.handle.done.then(released, released).catch(() => { /* Retain unconfirmed ranges for explicit shutdown retry. */ })
      return launched
    },
  }
}

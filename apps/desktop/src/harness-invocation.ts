/** Bounded, cancellable one-shot invocations of the bundled Harness CLI. */

import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { acceptsHarnessInvocationExit, type HarnessLaunch } from './launch.ts'

const DIAGNOSTIC_LIMIT = 4_000
const OUTPUT_LIMIT = 1024 * 1024
const TERMINATION_GRACE_MS = 1_000
const HARD_SETTLE_MS = 2_500

export type HarnessInvocationFailureReason = 'cancelled' | 'failed' | 'spawn' | 'timeout'

export interface HarnessInvocationOptions {
  readonly kind: string
  readonly timeoutMs: number
  readonly signal: AbortSignal
  readonly acceptedExitCodes?: readonly number[]
  readonly operationId?: string
}

export interface HarnessInvocationSnapshot {
  readonly operationId: string
  readonly kind: string
  readonly startedAt: number
  readonly deadlineAt: number
  readonly phase: 'running' | 'cancelling'
}

/** Failure raised by a one-shot Harness command, including hard timeouts and cancellation. */
export class HarnessInvocationError extends Error {
  readonly operationId: string
  readonly kind: string
  readonly reason: HarnessInvocationFailureReason
  readonly durationMs: number
  readonly timedOut: boolean

  constructor(options: {
    readonly operationId: string
    readonly kind: string
    readonly reason: HarnessInvocationFailureReason
    readonly durationMs: number
    readonly message: string
  }) {
    super(options.message)
    this.name = 'HarnessInvocationError'
    this.operationId = options.operationId
    this.kind = options.kind
    this.reason = options.reason
    this.durationMs = options.durationMs
    this.timedOut = options.reason === 'timeout'
  }
}

function windowsTaskkillPath(environment: NodeJS.ProcessEnv): string {
  return join(environment.SystemRoot ?? environment.WINDIR ?? 'C:\\Windows', 'System32', 'taskkill.exe')
}

/** Resolve the absolute Windows process-tree terminator and its literal arguments. */
export function windowsTaskkillInvocation(
  pid: number,
  force: boolean,
  environment: NodeJS.ProcessEnv,
): { readonly command: string; readonly args: readonly string[] } {
  return {
    command: windowsTaskkillPath(environment),
    args: ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])],
  }
}

async function terminateProcessTree(
  child: Pick<ChildProcess, 'kill' | 'pid'>,
  force: boolean,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  if (child.pid === undefined) return
  if (process.platform === 'win32') {
    const invocation = windowsTaskkillInvocation(child.pid, force, environment)
    await new Promise<void>((resolve) => {
      const killer = spawn(invocation.command, [...invocation.args], { stdio: 'ignore', windowsHide: true })
      killer.once('error', () => {
        try { child.kill(force ? 'SIGKILL' : 'SIGTERM') } catch { /* already gone */ }
        resolve()
      })
      killer.once('close', () => { resolve() })
    })
    return
  }
  try {
    process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM')
  } catch {
    try { child.kill(force ? 'SIGKILL' : 'SIGTERM') } catch { /* already gone */ }
  }
}

/** Execute one Harness CLI command without a shell and with a mandatory lifetime bound. */
export async function runHarnessInvocation(
  launch: HarnessLaunch,
  options: HarnessInvocationOptions,
): Promise<string> {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new TypeError('desktop: Harness invocation timeout must be positive')
  }
  if (options.kind.trim() === '') throw new TypeError('desktop: Harness invocation kind is required')
  const operationId = options.operationId ?? randomUUID()
  const startedAt = Date.now()
  const environment = { ...process.env, ...launch.environment }
  if (options.signal.aborted) {
    throw new HarnessInvocationError({
      operationId,
      kind: options.kind,
      reason: 'cancelled',
      durationMs: 0,
      message: `desktop: Harness invocation ${options.kind} was cancelled before launch`,
    })
  }
  return new Promise<string>((resolve, reject) => {
    const child = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    })
    const output: Buffer[] = []
    let outputBytes = 0
    let settled = false
    let failureReason: 'cancelled' | 'timeout' | undefined
    let forceKill: ReturnType<typeof setTimeout> | undefined
    let hardStop: ReturnType<typeof setTimeout> | undefined
    const fullOutput = (): string => Buffer.concat(output).toString('utf8')
    const diagnostic = (): string => fullOutput().slice(-DIAGNOSTIC_LIMIT)
    const finish = (operation: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (forceKill !== undefined) clearTimeout(forceKill)
      if (hardStop !== undefined) clearTimeout(hardStop)
      options.signal.removeEventListener('abort', cancel)
      operation()
    }
    const failure = (reason: HarnessInvocationFailureReason, detail: string): HarnessInvocationError =>
      new HarnessInvocationError({
        operationId,
        kind: options.kind,
        reason,
        durationMs: Date.now() - startedAt,
        message: `desktop: Harness invocation ${options.kind} ${detail}: ${diagnostic()}`,
      })
    const retainOutput = (chunk: Buffer): void => {
      output.push(chunk)
      outputBytes += chunk.length
      while (outputBytes > OUTPUT_LIMIT && output.length > 0) {
        const excess = outputBytes - OUTPUT_LIMIT
        const first = output[0]
        if (first === undefined) break
        if (first.length <= excess) {
          output.shift()
          outputBytes -= first.length
        } else {
          output[0] = first.subarray(excess)
          outputBytes -= excess
        }
      }
    }
    const requestStop = (reason: 'cancelled' | 'timeout'): void => {
      if (settled || failureReason !== undefined) return
      failureReason = reason
      void terminateProcessTree(child, false, environment)
      forceKill = setTimeout(() => { void terminateProcessTree(child, true, environment) }, TERMINATION_GRACE_MS)
      hardStop = setTimeout(() => {
        finish(() => { reject(failure(reason, reason === 'timeout'
          ? `timed out after ${options.timeoutMs}ms`
          : 'was cancelled')) })
      }, HARD_SETTLE_MS)
    }
    const cancel = (): void => { requestStop('cancelled') }
    child.stdout.on('data', retainOutput)
    child.stderr.on('data', retainOutput)
    options.signal.addEventListener('abort', cancel, { once: true })
    const timeout = setTimeout(() => { requestStop('timeout') }, options.timeoutMs)
    child.once('error', (error) => {
      finish(() => { reject(new HarnessInvocationError({
        operationId,
        kind: options.kind,
        reason: 'spawn',
        durationMs: Date.now() - startedAt,
        message: `desktop: Harness invocation ${options.kind} could not spawn: ${error.message}`,
      })) })
    })
    child.once('close', (code, signal) => {
      finish(() => {
        const value = fullOutput()
        if (failureReason !== undefined) reject(failure(
          failureReason,
          failureReason === 'timeout' ? `timed out after ${options.timeoutMs}ms` : 'was cancelled',
        ))
        else if (acceptsHarnessInvocationExit(
          code,
          signal,
          options.acceptedExitCodes ?? [0],
        )) resolve(value)
        else reject(new HarnessInvocationError({
          operationId,
          kind: options.kind,
          reason: 'failed',
          durationMs: Date.now() - startedAt,
          message: `desktop: Harness invocation ${options.kind} failed (${String(code)}, ${String(signal)}): ${value.slice(-DIAGNOSTIC_LIMIT)}`,
        }))
      })
    })
  })
}

/** Own every short-lived CLI child so quit and restart can settle them together. */
export class DesktopOperationSupervisor {
  readonly #active = new Map<string, {
    readonly controller: AbortController
    readonly promise: Promise<unknown>
    readonly cleanup: boolean
    snapshot: HarnessInvocationSnapshot
  }>()
  #phase: 'active' | 'disposed' | 'disposing' = 'active'

  list(): readonly HarnessInvocationSnapshot[] {
    return [...this.#active.values()].map(entry => entry.snapshot)
  }

  run(
    launch: HarnessLaunch,
    options: Omit<HarnessInvocationOptions, 'operationId' | 'signal'> & { readonly allowDuringDisposal?: boolean },
  ): Promise<string> {
    const operationId = randomUUID()
    const cleanup = options.allowDuringDisposal === true
    if (this.#phase === 'disposed' || (this.#phase === 'disposing' && !cleanup)) {
      return Promise.reject(new HarnessInvocationError({
        operationId,
        kind: options.kind,
        reason: 'cancelled',
        durationMs: 0,
        message: `desktop: Harness invocation ${options.kind} was cancelled because the desktop is shutting down`,
      }))
    }
    const controller = new AbortController()
    const startedAt = Date.now()
    const { allowDuringDisposal: _allowDuringDisposal, ...invocationOptions } = options
    const promise = runHarnessInvocation(launch, { ...invocationOptions, operationId, signal: controller.signal })
    const entry = {
      controller,
      promise,
      cleanup,
      snapshot: {
        operationId,
        kind: options.kind,
        startedAt,
        deadlineAt: startedAt + options.timeoutMs,
        phase: 'running' as const,
      },
    }
    this.#active.set(operationId, entry)
    void promise.finally(() => { this.#active.delete(operationId) }).catch(() => {})
    return promise
  }

  async dispose(): Promise<void> {
    if (this.#phase === 'disposed') return
    this.#phase = 'disposing'
    const deadline = Date.now() + 3_000
    for (;;) {
      const entries = [...this.#active.values()]
      for (const entry of entries) {
        if (entry.cleanup) continue
        entry.snapshot = { ...entry.snapshot, phase: 'cancelling' }
        entry.controller.abort()
      }
      if (entries.length === 0 || Date.now() >= deadline) break
      await Promise.race([
        Promise.allSettled(entries.map(entry => entry.promise)).then(() => undefined),
        new Promise<void>((resolve) => { setTimeout(resolve, Math.min(50, Math.max(1, deadline - Date.now()))) }),
      ])
    }
    this.#phase = 'disposed'
    for (const entry of this.#active.values()) {
      entry.snapshot = { ...entry.snapshot, phase: 'cancelling' }
      entry.controller.abort()
    }
  }
}

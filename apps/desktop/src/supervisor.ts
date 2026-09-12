/** Supervise the local Harness process for the lifetime of the desktop app. */

import { mkdirSync, createWriteStream, type WriteStream } from 'node:fs'
import { dirname } from 'node:path'
import { spawn } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { LineBuffer, parseHarnessReadyLine } from './readiness.ts'
import type { HarnessLaunch } from './launch.ts'
import type { DesktopProcessObserver } from './process-observer.ts'

const RESTART_BASE_DELAY_MS = 500
const RESTART_MAX_DELAY_MS = 15_000
const PRE_READY_EXIT_LIMIT = 3
const STOP_TIMEOUT_MS = 10_000
const DIAGNOSTIC_MODE_ELIGIBLE_MARKER = 'dsh: profile diagnostic mode eligible '

/** Observable lifecycle states for the desktop chrome. */
export type HarnessState = 'starting' | 'ready' | 'restarting' | 'failed' | 'stopped'

/** Bounded diagnostic emitted when Harness cannot reach readiness. */
export interface HarnessFailure {
  message: string
}

interface RunningHarness {
  readonly token: object
  readonly pid?: number
  readonly stdin: Writable | undefined
  readonly stdout: Readable
  readonly stderr: Readable
  readonly done: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null; error?: Error }>
  terminate(force: boolean): Promise<void>
  waitForExit(): Promise<boolean>
}

/** Dependencies and lifecycle callbacks for {@link HarnessSupervisor}. */
export interface HarnessSupervisorOptions {
  launch: HarnessLaunch
  logPath: string
  environment: NodeJS.ProcessEnv
  onReady(url: string): void
  onDiagnosticReady(url: string, failure: HarnessFailure): void
  onState(state: HarnessState): void
  onFailure(failure: HarnessFailure): void
  /** Native managed-range launcher selected from the Harness runtime. */
  managedRuntime?: DesktopProcessObserver
  /** Register the spawned root before it can be treated as ready. */
  onSpawn?(pid: number): void
  /** Start directly with the installation-owned diagnostic Profile. */
  initialDiagnosticMode?: boolean
  /** Primary reason retained if an explicitly selected diagnostic mode also fails. */
  initialDiagnosticReason?: string
  /** Windows-only process-tree cleanup; omitted on Unix hosts. */
  terminateProcessTree?(processId: number, force: boolean): Promise<void>
  /** Test override for the bounded graceful shutdown interval. */
  stopTimeoutMs?: number
}

/** Owns one restartable Harness child and its durable combined log. */
export class HarnessSupervisor {
  readonly #options: HarnessSupervisorOptions
  #child: RunningHarness | undefined
  #log: WriteStream | undefined
  #restartTimer: NodeJS.Timeout | undefined
  #restartCount = 0
  #preReadyExitCount = 0
  #failed = false
  #diagnosticMode = false
  #primaryStartupFailure: string | undefined
  #stopping = false

  constructor(options: HarnessSupervisorOptions) {
    this.#options = options
    this.#diagnosticMode = options.initialDiagnosticMode ?? false
    this.#primaryStartupFailure = options.initialDiagnosticReason
  }

  /** Whether readiness belongs to the installation-owned diagnostic Profile, not the active Profile. */
  get isDiagnosticMode(): boolean {
    return this.#diagnosticMode
  }

  #reportStartupFailure(message: string, logLine: string): void {
    const notify = (): void => {
      this.#options.onState('failed')
      this.#options.onFailure({ message })
    }
    if (this.#log === undefined) {
      notify()
      return
    }
    this.#log.write(logLine, () => { notify() })
  }

  /** Start the child process; repeated calls while it is running are ignored. */
  start(): void {
    if (this.#child !== undefined || this.#stopping || this.#failed) return
    mkdirSync(dirname(this.#options.logPath), { recursive: true })
    this.#log ??= createWriteStream(this.#options.logPath, { flags: 'a' })
    this.#options.onState(this.#diagnosticMode
      ? 'failed'
      : this.#restartCount === 0 ? 'starting' : 'restarting')

    const environment = {
      ...this.#options.environment,
      ...this.#options.launch.environment,
      ...(this.#diagnosticMode ? { DSH_PROFILE_DIAGNOSTIC_MODE: '1' } : {}),
    } as Record<string, string>
    let child: RunningHarness
    try {
      child = this.#spawn(environment)
    } catch (error) {
      this.#failed = true
      const failure = error instanceof Error ? error : new Error(String(error))
      const message = `Harness process owner could not start: ${failure.message}`
      this.#reportStartupFailure(message, `[desktop] ${message}\n`)
      return
    }
    this.#child = child
    let ready = false
    let spawnError: Error | undefined
    let diagnosticModeEligible = false
    const stdoutLines = new LineBuffer()
    const stderrLines = new LineBuffer()

    child.stdout.on('data', (chunk: Buffer) => {
      this.#log?.write(chunk)
      for (const line of stdoutLines.push(chunk.toString('utf8'))) {
        const url = parseHarnessReadyLine(line)
        if (url === undefined || ready) continue
        ready = true
        if (this.#diagnosticMode) {
          this.#options.onDiagnosticReady(url, {
            message: this.#primaryStartupFailure ?? 'The active Profile could not start.',
          })
        } else {
          this.#restartCount = 0
          this.#preReadyExitCount = 0
          this.#options.onState('ready')
          this.#options.onReady(url)
        }
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      this.#log?.write(chunk)
      for (const line of stderrLines.push(chunk.toString('utf8'))) {
        if (line.includes(DIAGNOSTIC_MODE_ELIGIBLE_MARKER)) diagnosticModeEligible = true
      }
    })
    void child.done.then(async ({ exitCode: code, signal, error }) => {
      spawnError = error
      if (error !== undefined) this.#log?.write(`[desktop] failed to start Harness: ${error.message}\n`)
      const rangeStopped = await child.waitForExit()
      if (!rangeStopped) {
        this.#failed = true
        const message = 'Harness process range did not become idle; automatic restart is blocked.'
        this.#reportStartupFailure(message, `[desktop] ${message}\n`)
        return
      }
      stdoutLines.flush()
      const stderrTail = stderrLines.flush()
      if (stderrTail?.includes(DIAGNOSTIC_MODE_ELIGIBLE_MARKER) === true) diagnosticModeEligible = true
      this.#log?.write(`[desktop] Harness exited code=${String(code)} signal=${String(signal)}\n`)
      if (this.#child?.token === child.token) this.#child = undefined
      if (this.#stopping) {
        this.#options.onState('stopped')
        return
      }
      if (!ready) {
        if (diagnosticModeEligible && !this.#diagnosticMode) {
          this.#primaryStartupFailure = spawnError === undefined
            ? `Harness exited before becoming ready (code ${String(code)}, signal ${String(signal)}).`
            : `Harness could not start: ${spawnError.message}`
          this.#diagnosticMode = true
          this.#log?.write('[desktop] Opening Diagnostics with the installation-owned diagnostic profile.\n')
          this.#options.onState('failed')
          this.#restartTimer = setTimeout(() => {
            this.#restartTimer = undefined
            this.start()
          }, 0)
          return
        }
        if (this.#diagnosticMode) {
          this.#failed = true
          const secondary = spawnError === undefined
            ? `diagnostic mode exited before becoming ready (code ${String(code)}, signal ${String(signal)})`
            : `diagnostic mode could not start: ${spawnError.message}`
          const message = `${this.#primaryStartupFailure ?? 'The active Profile could not start'} ${secondary}.`
          this.#reportStartupFailure(
            message,
            `[desktop] Harness startup failed after one normal and one diagnostic attempt: ${message}\n`,
          )
          return
        }
        this.#preReadyExitCount += 1
        if (this.#preReadyExitCount >= PRE_READY_EXIT_LIMIT) {
          this.#failed = true
          const message = spawnError === undefined
            ? `Harness exited before becoming ready (code ${String(code)}, signal ${String(signal)}).`
            : `Harness could not start: ${spawnError.message}`
          this.#reportStartupFailure(
            message,
            `[desktop] Harness startup failed after ${PRE_READY_EXIT_LIMIT} attempts: ${message}\n`,
          )
          return
        }
      }
      const delay = Math.min(RESTART_BASE_DELAY_MS * 2 ** this.#restartCount, RESTART_MAX_DELAY_MS)
      this.#restartCount += 1
      this.#options.onState('restarting')
      this.#restartTimer = setTimeout(() => {
        this.#restartTimer = undefined
        this.start()
      }, delay)
    }, (error: unknown) => {
      const failure = error instanceof Error ? error : new Error(String(error))
      return child.waitForExit().then((rangeStopped) => {
        if (this.#child?.token === child.token) this.#child = undefined
        this.#failed = true
        const message = rangeStopped
          ? `Harness process owner failed: ${failure.message}`
          : `Harness process owner failed and cleanup is unconfirmed: ${failure.message}`
        this.#reportStartupFailure(message, `[desktop] ${message}\n`)
      })
    })
  }

  #spawn(environment: Record<string, string>): RunningHarness {
    const token = {}
    if (this.#options.managedRuntime !== undefined) {
      const launched = this.#options.managedRuntime.launch({
        label: 'Harness',
        lifecycle: 'client',
        argv: [this.#options.launch.command, ...this.#options.launch.args],
        cwd: this.#options.launch.cwd ?? process.cwd(),
        env: environment,
        stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
        graceMs: 10_000,
        signal: new AbortController().signal,
      })
      const handle = launched.handle
      if (handle.stdout === undefined || handle.stderr === undefined) {
        handle.terminate()
        throw new Error('desktop: managed Harness launcher did not provide output pipes')
      }
      return {
        token, stdin: handle.stdin, stdout: handle.stdout, stderr: handle.stderr, done: handle.done,
        terminate: () => { handle.terminate(); return Promise.resolve() },
        waitForExit: () => handle.waitForExit(AbortSignal.timeout(15_000)),
      }
    }
    const processChild = spawn(this.#options.launch.command, this.#options.launch.args, {
      env: environment, cwd: this.#options.launch.cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    })
    processChild.once('spawn', () => {
      if (processChild.pid !== undefined) this.#options.onSpawn?.(processChild.pid)
    })
    const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null; error?: Error }>((resolve) => {
      let error: Error | undefined
      processChild.once('error', (value) => { error = value })
      processChild.once('close', (exitCode, signal) => { resolve({ exitCode, signal, ...(error === undefined ? {} : { error }) }) })
    })
    return {
      token, ...(processChild.pid === undefined ? {} : { pid: processChild.pid }),
      stdin: processChild.stdin, stdout: processChild.stdout, stderr: processChild.stderr, done,
      terminate: async (force) => {
        if (processChild.pid !== undefined && this.#options.terminateProcessTree !== undefined) {
          await this.#options.terminateProcessTree(processChild.pid, force)
        } else processChild.kill(force ? 'SIGKILL' : 'SIGTERM')
      },
      waitForExit: async () => {
        if (processChild.exitCode !== null || processChild.signalCode !== null) return true
        await done
        return true
      },
    }
  }

  /** Retry a startup that exhausted its pre-readiness attempts. */
  retry(): boolean {
    if (!this.#failed || this.#stopping) return false
    this.#failed = false
    this.#restartCount = 0
    this.#preReadyExitCount = 0
    this.#diagnosticMode = false
    this.#primaryStartupFailure = undefined
    this.start()
    return true
  }

  /** Stop automatic restarts and give the child a bounded graceful shutdown. */
  async stop(): Promise<void> {
    this.#stopping = true
    if (this.#restartTimer !== undefined) {
      clearTimeout(this.#restartTimer)
      this.#restartTimer = undefined
    }
    const child = this.#child
    if (child !== undefined) {
      await new Promise<void>((resolve, reject) => {
        let settled = false
        const finish = (error?: unknown): void => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          if (error === undefined) resolve()
          else reject(error instanceof Error ? error : new Error('desktop: Harness cleanup failed', { cause: error }))
        }
        const forceStop = async (): Promise<void> => {
          try {
            await child.terminate(true)
            if (!await child.waitForExit()) throw new Error('desktop: Harness process range remains active')
            finish()
          } catch (error) {
            this.#log?.write(`[desktop] failed to force-stop Harness process tree: ${error instanceof Error ? error.message : String(error)}\n`)
            finish(error)
          }
        }
        const timeout = setTimeout(() => { void forceStop() }, this.#options.stopTimeoutMs ?? STOP_TIMEOUT_MS)
        void child.done.then(async () => {
          if (await child.waitForExit()) finish()
        }, () => {})
        void child.terminate(false).catch((error: unknown) => {
          this.#log?.write(`[desktop] failed to request Harness process-tree shutdown: ${error instanceof Error ? error.message : String(error)}\n`)
        })
      })
    }
    this.#child = undefined
    this.#log?.end()
    this.#log = undefined
    this.#options.onState('stopped')
  }

  /** Resume a child after a deliberate bounded stop for desktop maintenance. */
  resume(): boolean {
    if (!this.#stopping || this.#child !== undefined) return false
    this.#stopping = false
    this.#failed = false
    this.#restartCount = 0
    this.#preReadyExitCount = 0
    this.#diagnosticMode = false
    this.#primaryStartupFailure = undefined
    this.start()
    return true
  }
}

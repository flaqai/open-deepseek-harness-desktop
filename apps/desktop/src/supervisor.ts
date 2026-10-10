/** Supervise the local Harness process for the lifetime of the desktop app. */

import { mkdirSync, mkdtempSync, lstatSync, openSync, closeSync, unlinkSync, createWriteStream, writeFileSync, renameSync, type WriteStream } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { LineBuffer, parseHarnessReadyLine } from './readiness.ts'
import type { HarnessLaunch } from './launch.ts'
import type { DesktopProcessObserver } from './process-observer.ts'
import { formatPersistentLogLine, TimestampedLogWriter } from './persistent-log.ts'

const RESTART_BASE_DELAY_MS = 500
const RESTART_MAX_DELAY_MS = 15_000
const PRE_READY_EXIT_LIMIT = 3
const STOP_TIMEOUT_MS = 10_000
const DIAGNOSTIC_MODE_ELIGIBLE_MARKER = 'dsh: profile diagnostic mode eligible '
const OPTIONAL_STARTUP_FAILURES_MARKER = 'dsh: optional startup failures '
const ONE_SHOT_ENVIRONMENT = new Set([
  'DSH_DESKTOP_MUTATION_OWNER_PID', 'DSH_PLUGIN_SNAPSHOT_LEASE_TOKEN',
  'DSH_PLUGIN_SNAPSHOT_LEASE_OWNER_PID', 'DSH_PLUGIN_SNAPSHOT_BATCH', 'DSH_PLUGIN_TRANSACTION_ORIGIN',
  'DSH_DESKTOP_WEB_GENERATION', 'DSH_DESKTOP_WEB_RESTART_OWNER',
  'DSH_DESKTOP_WEB_RESTART_STATE', 'DSH_DESKTOP_WEB_OWNER_GENERATION',
])

/** Observable lifecycle states for the desktop chrome. */
export type HarnessState = 'starting' | 'ready' | 'restarting' | 'failed' | 'stopped'

/** Bounded diagnostic emitted when Harness cannot reach readiness. */
export interface HarnessFailure {
  message: string
}

/** One optional Loader entry that did not activate during this Harness generation. */
export interface OptionalStartupFailure {
  readonly id: string
  readonly name: string
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
  /** Settle external Profile writers before an automatic restart; deliberate resume bypasses this check. */
  beforeRestart?(signal: AbortSignal): Promise<void>
  /** Report the settled optional-entry failures for candidate target validation. */
  onOptionalStartupFailures?(failures: readonly OptionalStartupFailure[]): void
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
  #restartCheck: AbortController | undefined
  #generation = 0
  #listenPort: string | undefined
  readonly #restartState: string
  readonly #restartDirectory: { dev: number; ino: number }

  constructor(options: HarnessSupervisorOptions) {
    this.#options = options
    mkdirSync(dirname(options.logPath), { recursive: true })
    this.#restartState = join(mkdtempSync(join(dirname(options.logPath), '.desktop-web-restart-')), 'state.json')
    this.#restartDirectory = lstatSync(dirname(this.#restartState))
    this.#diagnosticMode = options.initialDiagnosticMode ?? false
    this.#primaryStartupFailure = options.initialDiagnosticReason
  }

  /** Whether readiness belongs to the installation-owned diagnostic Profile, not the active Profile. */
  get isDiagnosticMode(): boolean {
    return this.#diagnosticMode
  }

  /** Private authority for the current local Host generation; never exposed to a renderer. */

  #reportStartupFailure(message: string, logMessage: string): void {
    try { this.#writeRestartState('failed') } catch (error) {
      this.#writeLog('error', `failed to record restart failure: ${error instanceof Error ? error.message : String(error)}`)
    }
    const notify = (): void => {
      this.#options.onState('failed')
      this.#options.onFailure({ message })
    }
    if (this.#log === undefined) {
      notify()
      return
    }
    this.#log.write(formatPersistentLogLine('desktop-supervisor', 'error', logMessage), () => { notify() })
  }

  #writeLog(level: string, message: string): void {
    this.#log?.write(formatPersistentLogLine('desktop-supervisor', level, message))
  }

  #writeRestartState(phase: 'starting' | 'ready' | 'failed' | 'stopped'): void {
    const directory = lstatSync(dirname(this.#restartState))
    if (!directory.isDirectory() || directory.isSymbolicLink() || directory.dev !== this.#restartDirectory.dev
      || directory.ino !== this.#restartDirectory.ino || (process.platform !== 'win32'
        && ((directory.mode & 0o777) !== 0o700 || directory.uid !== process.getuid?.()))) {
      throw new Error('desktop: restart coordination directory ownership changed')
    }
    const temporary = `${this.#restartState}.tmp`
    let descriptor: number | undefined
    let created = false
    try {
      descriptor = openSync(temporary, 'wx', 0o600)
      created = true
      writeFileSync(descriptor, JSON.stringify({ ownerPid: process.pid, generation: this.#generation, phase }))
      closeSync(descriptor)
      descriptor = undefined
      renameSync(temporary, this.#restartState)
    } finally {
      if (descriptor !== undefined) closeSync(descriptor)
      if (created) {
        try { unlinkSync(temporary) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      }
    }
  }

  #launchArgs(): string[] {
    const args = [...this.#options.launch.args]
    if (this.#listenPort === undefined || this.#diagnosticMode) return args
    let index = -1
    for (let i = 0; i < args.length; i++) if (args[i] === '--port' || args[i]?.startsWith('--port=')) index = i
    if (index !== -1) {
      if (args[index] === '--port=0') args[index] = `--port=${this.#listenPort}`
      else if (args[index] === '--port' && args[index + 1] === '0') args[index + 1] = this.#listenPort
    }
    return args
  }

  /** Start the child process; repeated calls while it is running are ignored. */
  start(): void {
    if (this.#child !== undefined || this.#stopping || this.#failed || this.#restartCheck !== undefined) return
    const generation = ++this.#generation
    try { this.#writeRestartState('starting') } catch (error) {
      this.#failed = true
      this.#reportStartupFailure('Harness restart coordination could not start.', `Restart coordination failed: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    mkdirSync(dirname(this.#options.logPath), { recursive: true })
    this.#log ??= createWriteStream(this.#options.logPath, { flags: 'a' })
    this.#options.onState(this.#diagnosticMode
      ? 'failed'
      : this.#restartCount === 0 ? 'starting' : 'restarting')

    // Resident plugins may spawn ordinary CLI commands, never inherit Desktop's one-shot authority.
    const environment = Object.fromEntries(Object.entries({
      ...this.#options.environment,
      ...this.#options.launch.environment,
      ...(this.#diagnosticMode ? { DSH_PROFILE_DIAGNOSTIC_MODE: '1' } : {}),
    }).filter(([key]) => !ONE_SHOT_ENVIRONMENT.has(key.toUpperCase()))) as Record<string, string>
    environment.DSH_DESKTOP_WEB_RESTART_OWNER = String(process.pid)
    environment.DSH_DESKTOP_WEB_RESTART_STATE = this.#restartState
    environment.DSH_DESKTOP_WEB_OWNER_GENERATION = String(generation)
    let child: RunningHarness
    try {
      child = this.#spawn(environment)
    } catch (error) {
      this.#failed = true
      const failure = error instanceof Error ? error : new Error(String(error))
      const message = `Harness process owner could not start: ${failure.message}`
      this.#reportStartupFailure(message, message)
      return
    }
    this.#child = child
    this.#writeLog('info', `Harness started pid=${String(child.pid ?? 'managed')} diagnosticMode=${String(this.#diagnosticMode)}`)
    let ready = false
    let spawnError: Error | undefined
    let diagnosticModeEligible = false
    const stdoutLines = new LineBuffer()
    const stderrLines = new LineBuffer()
    const stdoutLog = new TimestampedLogWriter((line) => { this.#log?.write(line) }, 'harness-stdout')
    const stderrLog = new TimestampedLogWriter((line) => { this.#log?.write(line) }, 'harness-stderr', 'error')

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutLog.write(chunk)
      for (const line of stdoutLines.push(chunk.toString('utf8'))) {
        const url = parseHarnessReadyLine(line)
        if (url === undefined || ready) continue
        ready = true
        if (this.#diagnosticMode) {
          this.#options.onDiagnosticReady(url, {
            message: this.#primaryStartupFailure ?? 'The active Profile could not start.',
          })
        } else {
          const port = new URL(url).port
          if (port !== '') this.#listenPort = port
          try { this.#writeRestartState('ready') } catch (error) {
            this.#failed = true
            this.#reportStartupFailure('Harness restart readiness could not be recorded.', `Restart readiness failed: ${error instanceof Error ? error.message : String(error)}`)
            void this.stop().catch((stopError: unknown) => { this.#writeLog('error', `Restart coordination cleanup failed: ${String(stopError)}`) })
            return
          }
          this.#restartCount = 0
          this.#preReadyExitCount = 0
          this.#options.onState('ready')
          this.#options.onReady(url)
        }
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrLog.write(chunk)
      for (const line of stderrLines.push(chunk.toString('utf8'))) {
        if (line.includes(DIAGNOSTIC_MODE_ELIGIBLE_MARKER)) diagnosticModeEligible = true
        const marker = line.indexOf(OPTIONAL_STARTUP_FAILURES_MARKER)
        if (marker !== -1) {
          try {
            const parsed: unknown = JSON.parse(line.slice(marker + OPTIONAL_STARTUP_FAILURES_MARKER.length))
            if (Array.isArray(parsed)) {
              const failures = parsed.filter((value): value is OptionalStartupFailure => (
                typeof value === 'object' && value !== null
                && typeof (value as { id?: unknown }).id === 'string'
                && typeof (value as { name?: unknown }).name === 'string'
              ))
              if (failures.length === parsed.length) this.#options.onOptionalStartupFailures?.(failures)
            }
          } catch {
            this.#writeLog('warn', 'Ignored malformed optional startup failure summary')
          }
        }
      }
    })
    void child.done.then(async ({ exitCode: code, signal, error }) => {
      spawnError = error
      if (error !== undefined) this.#writeLog('error', `failed to start Harness: ${error.message}`)
      stdoutLog.flush()
      stderrLog.flush()
      stdoutLines.flush()
      const stderrTail = stderrLines.flush()
      if (stderrTail?.includes(DIAGNOSTIC_MODE_ELIGIBLE_MARKER) === true) diagnosticModeEligible = true
      // Direct exit does not imply an empty Job/scope/group. In particular a
      // detached market helper can remain in a Linux scope while waiting for
      // the next generation. Retire only this owned range before admitting a
      // replacement; the native owner's bounded escalation and idle proof
      // remain authoritative. Deliberate stop already initiated termination.
      if (this.#options.managedRuntime !== undefined && !this.#stopping && generation === this.#generation) {
        await child.terminate(false)
      }
      const rangeStopped = await child.waitForExit()
      if (!rangeStopped) {
        this.#failed = true
        const message = 'Harness process range did not become idle; automatic restart is blocked.'
        this.#reportStartupFailure(message, message)
        return
      }
      this.#writeLog('info', `Harness exited code=${String(code)} signal=${String(signal)}`)
      if (this.#child?.token === child.token) {
        this.#child = undefined
      }
      if (generation !== this.#generation) return
      if (this.#stopping) {
        this.#options.onState('stopped')
        return
      }
      const restartCheck = new AbortController()
      this.#restartCheck = restartCheck
      try {
        this.#log?.write('[desktop] Unexpected Harness exit; checking Profile writers before restart.\n')
        await this.#options.beforeRestart?.(restartCheck.signal)
      } catch (error) {
        if (!restartCheck.signal.aborted && generation === this.#generation) {
          this.#failed = true
          const message = `Harness restart blocked: ${error instanceof Error ? error.message : String(error)}`
          this.#reportStartupFailure(message, `[desktop] ${message}\n`)
        }
        return
      } finally {
        if (this.#restartCheck === restartCheck) this.#restartCheck = undefined
      }
      if (restartCheck.signal.aborted || generation !== this.#generation) return
      if (!ready) {
        if (diagnosticModeEligible && !this.#diagnosticMode) {
          this.#primaryStartupFailure = spawnError === undefined
            ? `Harness exited before becoming ready (code ${String(code)}, signal ${String(signal)}).`
            : `Harness could not start: ${spawnError.message}`
          this.#diagnosticMode = true
          this.#writeLog('warn', 'Opening Diagnostics with the installation-owned diagnostic profile.')
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
            `Harness startup failed after one normal and one diagnostic attempt: ${message}`,
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
            `Harness startup failed after ${PRE_READY_EXIT_LIMIT} attempts: ${message}`,
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
    }).catch(async (error: unknown) => {
      const failure = error instanceof Error ? error : new Error(String(error))
      let rangeStopped = false
      let cleanupFailure = ''
      try {
        rangeStopped = await child.waitForExit()
      } catch (cleanupError) {
        cleanupFailure = `; cleanup observation failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`
      }
      if (rangeStopped && this.#child?.token === child.token) this.#child = undefined
      this.#failed = true
      const message = rangeStopped
        ? `Harness process owner failed: ${failure.message}`
        : `Harness process owner failed and cleanup is unconfirmed: ${failure.message}${cleanupFailure}`
      this.#reportStartupFailure(message, message)
    })
  }

  #spawn(environment: Record<string, string>): RunningHarness {
    const token = {}
    if (this.#options.managedRuntime !== undefined) {
      const launched = this.#options.managedRuntime.launch({
        label: 'Harness',
        lifecycle: 'client',
        argv: [this.#options.launch.command, ...this.#launchArgs()],
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
    const processChild = spawn(this.#options.launch.command, this.#launchArgs(), {
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
    this.#generation++
    let stateFailure: Error | undefined
    try { this.#writeRestartState('stopped') } catch (error) {
      stateFailure = error instanceof Error ? error : new Error(String(error))
      this.#writeLog('error', `failed to record restart stop: ${stateFailure.message}`)
    }
    this.#log?.write('[desktop] Deliberate Harness stop; cancelling automatic restart.\n')
    this.#restartCheck?.abort()
    this.#restartCheck = undefined
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
            this.#writeLog('error', `failed to force-stop Harness process tree: ${error instanceof Error ? error.message : String(error)}`)
            finish(error)
          }
        }
        const timeout = setTimeout(() => { void forceStop() }, this.#options.stopTimeoutMs ?? STOP_TIMEOUT_MS)
        const finishAfterExit = async (): Promise<void> => {
          if (!await child.waitForExit()) throw new Error('desktop: Harness process range remains active')
          finish()
        }
        void child.done.then(finishAfterExit, finishAfterExit).catch((error: unknown) => {
          this.#writeLog('error', `failed to observe Harness process range during stop: ${error instanceof Error ? error.message : String(error)}`)
          finish(error)
        })
        void child.terminate(false).catch((error: unknown) => {
          this.#writeLog('error', `failed to request Harness process-tree shutdown: ${error instanceof Error ? error.message : String(error)}`)
        })
      })
    }
    this.#child = undefined
    this.#log?.end()
    this.#log = undefined
    this.#options.onState('stopped')
    if (stateFailure !== undefined) throw stateFailure
  }

  /** Resume a child after a deliberate bounded stop for desktop maintenance. */
  resume(): boolean {
    if (!this.#stopping || this.#child !== undefined) return false
    this.#stopping = false
    this.#failed = false
    this.#restartCount = 0
    this.#preReadyExitCount = 0
    this.#diagnosticMode = false
    this.#listenPort = undefined
    this.#primaryStartupFailure = undefined
    this.start()
    return true
  }
}

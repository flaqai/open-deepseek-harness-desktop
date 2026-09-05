/** Supervise the local Harness process for the lifetime of the desktop app. */

import { mkdirSync, createWriteStream, type WriteStream } from 'node:fs'
import { dirname } from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { LineBuffer, parseHarnessReadyLine } from './readiness.ts'
import type { HarnessLaunch } from './launch.ts'

const RESTART_BASE_DELAY_MS = 500
const RESTART_MAX_DELAY_MS = 15_000
const PRE_READY_EXIT_LIMIT = 3
const STOP_TIMEOUT_MS = 5_000
const SAFE_MODE_ELIGIBLE_MARKER = 'dsh: profile safe mode eligible '

/** Observable lifecycle states for the desktop chrome. */
export type HarnessState = 'starting' | 'ready' | 'restarting' | 'failed' | 'stopped'

/** Bounded diagnostic emitted when Harness cannot reach readiness. */
export interface HarnessFailure {
  message: string
}

/** Dependencies and lifecycle callbacks for {@link HarnessSupervisor}. */
export interface HarnessSupervisorOptions {
  launch: HarnessLaunch
  logPath: string
  environment: NodeJS.ProcessEnv
  onReady(url: string): void
  onState(state: HarnessState): void
  onFailure(failure: HarnessFailure): void
  /** Start directly with the installation-owned diagnostic Profile. */
  initialSafeMode?: boolean
  /** Primary reason retained if an explicitly selected safe mode also fails. */
  initialSafeModeReason?: string
  /** Windows-only process-tree cleanup; omitted on Unix hosts. */
  terminateProcessTree?(processId: number, force: boolean): Promise<void>
  /** Test override for the bounded graceful shutdown interval. */
  stopTimeoutMs?: number
}

/** Owns one restartable Harness child and its durable combined log. */
export class HarnessSupervisor {
  readonly #options: HarnessSupervisorOptions
  #child: ChildProcessWithoutNullStreams | undefined
  #log: WriteStream | undefined
  #restartTimer: NodeJS.Timeout | undefined
  #restartCount = 0
  #preReadyExitCount = 0
  #failed = false
  #safeMode = false
  #primaryStartupFailure: string | undefined
  #stopping = false

  constructor(options: HarnessSupervisorOptions) {
    this.#options = options
    this.#safeMode = options.initialSafeMode ?? false
    this.#primaryStartupFailure = options.initialSafeModeReason
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
    this.#options.onState(this.#restartCount === 0 ? 'starting' : 'restarting')

    const child = spawn(this.#options.launch.command, this.#options.launch.args, {
      env: {
        ...this.#options.environment,
        ...this.#options.launch.environment,
        ...(this.#safeMode ? { DSH_PROFILE_SAFE_MODE: '1' } : {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.#child = child
    let ready = false
    let spawnError: Error | undefined
    let safeModeEligible = false
    const stdoutLines = new LineBuffer()
    const stderrLines = new LineBuffer()

    child.stdout.on('data', (chunk: Buffer) => {
      this.#log?.write(chunk)
      for (const line of stdoutLines.push(chunk.toString('utf8'))) {
        const url = parseHarnessReadyLine(line)
        if (url === undefined || ready) continue
        ready = true
        this.#restartCount = 0
        this.#preReadyExitCount = 0
        this.#options.onState('ready')
        this.#options.onReady(url)
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      this.#log?.write(chunk)
      for (const line of stderrLines.push(chunk.toString('utf8'))) {
        if (line.includes(SAFE_MODE_ELIGIBLE_MARKER)) safeModeEligible = true
      }
    })
    child.on('error', (error) => {
      spawnError = error
      this.#log?.write(`[desktop] failed to start Harness: ${error.message}\n`)
    })
    child.on('close', (code, signal) => {
      stdoutLines.flush()
      const stderrTail = stderrLines.flush()
      if (stderrTail?.includes(SAFE_MODE_ELIGIBLE_MARKER) === true) safeModeEligible = true
      this.#log?.write(`[desktop] Harness exited code=${String(code)} signal=${String(signal)}\n`)
      if (this.#child === child) this.#child = undefined
      if (this.#stopping) {
        this.#options.onState('stopped')
        return
      }
      if (!ready) {
        if (safeModeEligible && !this.#safeMode) {
          this.#primaryStartupFailure = spawnError === undefined
            ? `Harness exited before becoming ready (code ${String(code)}, signal ${String(signal)}).`
            : `Harness could not start: ${spawnError.message}`
          this.#safeMode = true
          this.#log?.write('[desktop] Restarting Harness once with the installation-owned diagnostic profile.\n')
          this.#options.onState('restarting')
          this.#restartTimer = setTimeout(() => {
            this.#restartTimer = undefined
            this.start()
          }, 0)
          return
        }
        if (this.#safeMode) {
          this.#failed = true
          const secondary = spawnError === undefined
            ? `diagnostic safe mode exited before becoming ready (code ${String(code)}, signal ${String(signal)})`
            : `diagnostic safe mode could not start: ${spawnError.message}`
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
    })
  }

  /** Retry a startup that exhausted its pre-readiness attempts. */
  retry(): boolean {
    if (!this.#failed || this.#stopping) return false
    this.#failed = false
    this.#restartCount = 0
    this.#preReadyExitCount = 0
    this.#safeMode = false
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
      await new Promise<void>((resolve) => {
        let settled = false
        const finish = (): void => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          resolve()
        }
        const forceStop = async (): Promise<void> => {
          try {
            if (child.pid !== undefined && this.#options.terminateProcessTree !== undefined) {
              await this.#options.terminateProcessTree(child.pid, true)
            } else {
              child.kill('SIGKILL')
            }
          } catch (error) {
            this.#log?.write(`[desktop] failed to force-stop Harness process tree: ${error instanceof Error ? error.message : String(error)}\n`)
          } finally {
            finish()
          }
        }
        const timeout = setTimeout(() => { void forceStop() }, this.#options.stopTimeoutMs ?? STOP_TIMEOUT_MS)
        child.once('close', () => {
          finish()
        })
        if (child.pid !== undefined && this.#options.terminateProcessTree !== undefined) {
          void this.#options.terminateProcessTree(child.pid, false).catch((error: unknown) => {
            this.#log?.write(`[desktop] failed to request Harness process-tree shutdown: ${error instanceof Error ? error.message : String(error)}\n`)
          })
        } else {
          child.kill('SIGTERM')
        }
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
    this.#safeMode = false
    this.#primaryStartupFailure = undefined
    this.start()
    return true
  }
}

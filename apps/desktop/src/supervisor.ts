/** Supervise the local Harness process for the lifetime of the desktop app. */

import { mkdirSync, createWriteStream, type WriteStream } from 'node:fs'
import { dirname } from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { LineBuffer, parseHarnessReadyLine } from './readiness.ts'
import type { HarnessLaunch } from './launch.ts'

const RESTART_BASE_DELAY_MS = 500
const RESTART_MAX_DELAY_MS = 15_000
const STOP_TIMEOUT_MS = 5_000

/** Observable lifecycle states for the desktop chrome. */
export type HarnessState = 'starting' | 'ready' | 'restarting' | 'stopped'

/** Dependencies and lifecycle callbacks for {@link HarnessSupervisor}. */
export interface HarnessSupervisorOptions {
  launch: HarnessLaunch
  logPath: string
  environment: NodeJS.ProcessEnv
  onReady(url: string): void
  onState(state: HarnessState): void
}

/** Owns one restartable Harness child and its durable combined log. */
export class HarnessSupervisor {
  readonly #options: HarnessSupervisorOptions
  #child: ChildProcessWithoutNullStreams | undefined
  #log: WriteStream | undefined
  #restartTimer: NodeJS.Timeout | undefined
  #restartCount = 0
  #stopping = false

  /** @param options - Process launch, log destination, and lifecycle observers. */
  constructor(options: HarnessSupervisorOptions) {
    this.#options = options
  }

  /** Start the child process; repeated calls while it is running are ignored. */
  start(): void {
    if (this.#child !== undefined || this.#stopping) return
    mkdirSync(dirname(this.#options.logPath), { recursive: true })
    this.#log ??= createWriteStream(this.#options.logPath, { flags: 'a' })
    this.#options.onState(this.#restartCount === 0 ? 'starting' : 'restarting')

    const child = spawn(this.#options.launch.command, this.#options.launch.args, {
      env: { ...this.#options.environment, ...this.#options.launch.environment },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.#child = child
    let ready = false
    const stdoutLines = new LineBuffer()

    child.stdout.on('data', (chunk: Buffer) => {
      this.#log?.write(chunk)
      for (const line of stdoutLines.push(chunk.toString('utf8'))) {
        const url = parseHarnessReadyLine(line)
        if (url === undefined || ready) continue
        ready = true
        this.#restartCount = 0
        this.#options.onState('ready')
        this.#options.onReady(url)
      }
    })
    child.stderr.on('data', (chunk: Buffer) => this.#log?.write(chunk))
    child.on('error', error => this.#log?.write(`[desktop] failed to start Harness: ${error.message}\n`))
    child.on('close', (code, signal) => {
      stdoutLines.flush()
      this.#log?.write(`[desktop] Harness exited code=${String(code)} signal=${String(signal)}\n`)
      if (this.#child === child) this.#child = undefined
      if (this.#stopping) {
        this.#options.onState('stopped')
        return
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
        const timeout = setTimeout(() => {
          child.kill('SIGKILL')
          resolve()
        }, STOP_TIMEOUT_MS)
        child.once('close', () => {
          clearTimeout(timeout)
          resolve()
        })
        child.kill('SIGTERM')
      })
    }
    this.#child = undefined
    this.#log?.end()
    this.#log = undefined
    this.#options.onState('stopped')
  }
}

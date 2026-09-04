/** Bounded one-shot invocations of the bundled Harness CLI. */

import { spawn } from 'node:child_process'
import { acceptsHarnessInvocationExit, type HarnessLaunch } from './launch.ts'

const DIAGNOSTIC_LIMIT = 4_000
const OUTPUT_LIMIT = 1024 * 1024

/** Failure raised by a one-shot Harness command, including hard timeouts. */
export class HarnessInvocationError extends Error {
  readonly timedOut: boolean

  constructor(message: string, timedOut: boolean) {
    super(message)
    this.name = 'HarnessInvocationError'
    this.timedOut = timedOut
  }
}

/**
 * Execute one Harness CLI command without a shell.
 * @param launch - Resolved executable, arguments, and controlled environment.
 * @param acceptedExitCodes - Signal-free exit codes treated as success.
 * @param timeoutMs - Optional hard lifetime bound; omitted for legacy callers.
 * @returns Combined stdout and stderr for structured command parsing.
 */
export async function runHarnessInvocation(
  launch: HarnessLaunch,
  acceptedExitCodes: readonly number[] = [0],
  timeoutMs?: number,
): Promise<string> {
  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    throw new TypeError('desktop: Harness invocation timeout must be positive')
  }
  return new Promise<string>((resolve, reject) => {
    const child = spawn(launch.command, launch.args, {
      env: { ...process.env, ...launch.environment },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const output: Buffer[] = []
    let outputBytes = 0
    let settled = false
    let timedOut = false
    let forceKill: ReturnType<typeof setTimeout> | undefined
    let hardStop: ReturnType<typeof setTimeout> | undefined
    const fullOutput = (): string => Buffer.concat(output).toString('utf8')
    const diagnostic = (): string => fullOutput().slice(-DIAGNOSTIC_LIMIT)
    const finish = (operation: () => void): void => {
      if (settled) return
      settled = true
      if (timeout !== undefined) clearTimeout(timeout)
      if (forceKill !== undefined) clearTimeout(forceKill)
      if (hardStop !== undefined) clearTimeout(hardStop)
      operation()
    }
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
    child.stdout.on('data', retainOutput)
    child.stderr.on('data', retainOutput)
    const timeout = timeoutMs === undefined ? undefined : setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      forceKill = setTimeout(() => { child.kill('SIGKILL') }, 250)
      hardStop = setTimeout(() => { finish(() => {
        reject(new HarnessInvocationError(
          `desktop: Harness invocation timed out after ${timeoutMs}ms: ${diagnostic()}`,
          true,
        ))
      }) }, 1_000)
    }, timeoutMs)
    child.once('error', (error) => {
      finish(() => { reject(error) })
    })
    child.once('close', (code, signal) => {
      finish(() => {
        const value = fullOutput()
        if (timedOut) reject(new HarnessInvocationError(
          `desktop: Harness invocation timed out after ${String(timeoutMs)}ms: ${value.slice(-DIAGNOSTIC_LIMIT)}`,
          true,
        ))
        else if (acceptsHarnessInvocationExit(code, signal, acceptedExitCodes)) resolve(value)
        else reject(new HarnessInvocationError(
          `desktop: Harness invocation failed (${String(code)}, ${String(signal)}): ${value.slice(-DIAGNOSTIC_LIMIT)}`,
          false,
        ))
      })
    })
  })
}

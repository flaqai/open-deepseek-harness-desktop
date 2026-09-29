/** macOS foreground-window native operations for the floating Computer Use backend. */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { OrbComputerUseFrame, OrbComputerUsePlatform } from './orb-computer-use-backend.ts'

const execFileAsync = promisify(execFile)
const MAX_RESULT_BYTES = 44 * 1024 * 1024

/** The Desktop host hides both floating windows and returns their exact prior visibility. */
export interface OrbMacOverlayExclusion {
  exclude(): Promise<() => Promise<void>>
}

/** Native command runner; tests inject this to exercise the platform without HID input. */
export type OrbMacComputerUseCommand = (args: readonly string[], signal: AbortSignal) => Promise<string>

/** The only OS privileges this adapter uses. Reading them never prompts. */
export interface OrbMacComputerUsePermissions {
  readonly screenCapture: boolean
  readonly inputControl: boolean
}

/** Resolve the paired Swift helper from Desktop's emitted lib directory.
 * @returns Absolute path to the bundled executable.
 */
export function orbMacComputerUseHelperPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'orb-computer-use-macos')
}

/** Run one allowlisted native helper command without a shell.
 * @param args - Fixed command and validated fields.
 * @param signal - Cancels the child; an in-progress HID event may already have landed.
 * @returns One bounded JSON line from the helper.
 */
export async function runOrbMacComputerUseCommand(args: readonly string[], signal: AbortSignal): Promise<string> {
  const { stdout } = await execFileAsync(orbMacComputerUseHelperPath(), [...args], {
    signal, timeout: 15_000, maxBuffer: MAX_RESULT_BYTES, encoding: 'utf8',
  })
  return stdout
}

function record(line: string): Record<string, unknown> {
  if (line.length > MAX_RESULT_BYTES) throw new Error('orb computer use: native result exceeds supported size')
  let value: unknown
  try { value = JSON.parse(line) }
  catch { throw new Error('orb computer use: malformed native result') }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('orb computer use: malformed native result')
  }
  return value as Record<string, unknown>
}

/** Read current macOS TCC rights without opening a system permission prompt.
 * @param command - Optional injected command runner.
 * @param signal - Abort for the native lookup.
 * @returns Current screen capture and accessibility input grants.
 */
export async function readOrbMacComputerUsePermissions(
  command: OrbMacComputerUseCommand = runOrbMacComputerUseCommand,
  signal: AbortSignal = new AbortController().signal,
): Promise<OrbMacComputerUsePermissions> {
  if (process.platform !== 'darwin' && command === runOrbMacComputerUseCommand) {
    return { screenCapture: false, inputControl: false }
  }
  const value = record(await command(['permissions'], signal))
  if (typeof value.screenCapture !== 'boolean' || typeof value.inputControl !== 'boolean') {
    throw new Error('orb computer use: malformed native permission status')
  }
  return { screenCapture: value.screenCapture, inputControl: value.inputControl }
}

function frame(value: Record<string, unknown>): OrbComputerUseFrame {
  if (typeof value.windowId !== 'string' || !/^\d{1,10}$/u.test(value.windowId)
    || typeof value.appName !== 'string' || typeof value.png !== 'string'
    || typeof value.x !== 'number' || typeof value.y !== 'number'
    || typeof value.width !== 'number' || typeof value.height !== 'number'
    || (value.windowTitle !== undefined && typeof value.windowTitle !== 'string')) {
    throw new Error('orb computer use: malformed native capture')
  }
  const data = Buffer.from(value.png, 'base64')
  if (data.length === 0 || data.length > 32 * 1024 * 1024
    || !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error('orb computer use: malformed native screenshot')
  }
  return {
    data, mediaType: 'image/png', windowId: value.windowId, appName: value.appName,
    bounds: { x: value.x, y: value.y, width: value.width, height: value.height },
    ...(value.windowTitle === undefined ? {} : { windowTitle: value.windowTitle }),
  }
}

/** Create the macOS platform for one serialized backend instance.
 * @param overlay - Desktop's reversible hide operation for the orb and selection toolbar.
 * @param command - Optional injected helper command runner.
 * @returns Native platform operations with a second focus check inside each HID command.
 */
export function createOrbMacComputerUsePlatform(
  overlay: OrbMacOverlayExclusion,
  command: OrbMacComputerUseCommand = runOrbMacComputerUseCommand,
): OrbComputerUsePlatform {
  if (process.platform !== 'darwin' && command === runOrbMacComputerUseCommand) {
    throw new Error('orb computer use: macOS native platform is unavailable')
  }
  let capturedWindowId: string | undefined
  const target = (): string => {
    if (capturedWindowId === undefined) throw new Error('orb computer use: observe before input')
    return capturedWindowId
  }
  return {
    async withOverlayExcluded(run, signal) {
      signal.throwIfAborted()
      const restore = await overlay.exclude()
      try {
        signal.throwIfAborted()
        return await run()
      } finally {
        await restore()
      }
    },
    async captureFrontmost(signal) {
      signal.throwIfAborted()
      capturedWindowId = undefined
      const captured = frame(record(await command(['capture'], signal)))
      signal.throwIfAborted()
      capturedWindowId = captured.windowId
      return captured
    },
    async frontmostWindowId(signal) {
      signal.throwIfAborted()
      const value = record(await command(['focus'], signal))
      return typeof value.windowId === 'string' && /^\d{1,10}$/u.test(value.windowId) ? value.windowId : undefined
    },
    async click(input, signal) {
      signal.throwIfAborted()
      const value = record(await command([
        'click', target(), String(input.x), String(input.y), input.button, String(input.count),
      ], signal))
      if (value.ok !== true) throw new Error('orb computer use: native click was not confirmed')
    },
    async typeText(input, signal) {
      signal.throwIfAborted()
      const value = record(await command([
        'type', target(), String(input.x), String(input.y), Buffer.from(input.text).toString('base64'),
        input.replace ? '1' : '0', input.submit ? '1' : '0',
      ], signal))
      if (value.ok !== true) throw new Error('orb computer use: native input was not confirmed')
    },
  }
}

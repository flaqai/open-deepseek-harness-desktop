/** Linux X11 foreground-window operations for the floating Computer Use backend. */

import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { OrbComputerUseFrame, OrbComputerUsePlatform } from './orb-computer-use-backend.ts'

const execFileAsync = promisify(execFile)
const MAX_RESULT_BYTES = 44 * 1024 * 1024
const PNG_HEADER = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const WINDOW_TOKEN = /^\d{1,10}:-?\d{1,6}:-?\d{1,6}:\d{1,5}:\d{1,5}$/u

/** The Desktop host hides both floating windows and restores their prior visibility. */
export interface OrbLinuxOverlayExclusion {
  exclude(): Promise<() => Promise<void>>
}

/** Injectable native command runner used by the platform and focused tests. */
export type OrbLinuxComputerUseCommand = (args: readonly string[], signal: AbortSignal) => Promise<string>

/** Read-only capability status. Wayland has no supported foreground input path. */
export interface OrbLinuxComputerUsePermissions {
  readonly screenCapture: boolean
  readonly inputControl: boolean
  readonly status: 'available' | 'unsupported-wayland' | 'unavailable-x11'
}

/** Session facts used to reject Wayland and headless/Xwayland displays. */
export interface OrbLinuxSession {
  readonly platform: string
  readonly sessionType: string | undefined
  readonly display: string | undefined
}

function currentSession(): OrbLinuxSession {
  return { platform: process.platform, sessionType: process.env.XDG_SESSION_TYPE, display: process.env.DISPLAY }
}

/** Resolve the executable bundled beside Desktop's emitted JavaScript.
 * @returns Absolute native helper path.
 */
export function orbLinuxComputerUseHelperPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'orb-computer-use-linux')
}

/** Run one allowlisted native command without a shell.
 * @param args - Command and validated fields.
 * @param signal - Cancels the child; HID already delivered cannot be recalled.
 * @returns One bounded JSON result.
 */
export async function runOrbLinuxComputerUseCommand(args: readonly string[], signal: AbortSignal): Promise<string> {
  const { stdout } = await execFileAsync(orbLinuxComputerUseHelperPath(), [...args], {
    signal, timeout: 15_000, maxBuffer: MAX_RESULT_BYTES, encoding: 'utf8',
  })
  return stdout
}

function supportedX11(session: OrbLinuxSession): boolean {
  return session.platform === 'linux' && session.sessionType?.toLowerCase() === 'x11'
    && typeof session.display === 'string' && session.display.length > 0
}

function statusWithoutProbe(session: OrbLinuxSession): OrbLinuxComputerUsePermissions {
  return {
    screenCapture: false, inputControl: false,
    status: session.platform === 'linux' && session.sessionType?.toLowerCase() === 'wayland'
      ? 'unsupported-wayland' : 'unavailable-x11',
  }
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

/** Probe an X11 display without prompting or changing OS permissions.
 * @param command - Optional injected native runner.
 * @param signal - Abort for the probe.
 * @returns Current X11 capability or an explicit unsupported status.
 */
export async function readOrbLinuxComputerUsePermissions(
  command: OrbLinuxComputerUseCommand = runOrbLinuxComputerUseCommand,
  signal: AbortSignal = new AbortController().signal,
  session: OrbLinuxSession = currentSession(),
): Promise<OrbLinuxComputerUsePermissions> {
  if (!supportedX11(session)) return statusWithoutProbe(session)
  try {
    const value = record(await command(['permissions'], signal))
    if (typeof value.screenCapture !== 'boolean' || typeof value.inputControl !== 'boolean') {
      throw new Error('orb computer use: malformed native permission status')
    }
    return {
      screenCapture: value.screenCapture, inputControl: value.inputControl,
      status: value.screenCapture && value.inputControl ? 'available' : 'unavailable-x11',
    }
  } catch (error) {
    if (signal.aborted) throw error
    return { screenCapture: false, inputControl: false, status: 'unavailable-x11' }
  }
}

function frame(value: Record<string, unknown>): OrbComputerUseFrame {
  if (typeof value.windowId !== 'string' || !WINDOW_TOKEN.test(value.windowId)
    || typeof value.appName !== 'string' || typeof value.png !== 'string'
    || typeof value.x !== 'number' || typeof value.y !== 'number'
    || typeof value.width !== 'number' || typeof value.height !== 'number'
    || (value.windowTitle !== undefined && typeof value.windowTitle !== 'string')) {
    throw new Error('orb computer use: malformed native capture')
  }
  const data = Buffer.from(value.png, 'base64')
  if (data.length === 0 || data.length > 32 * 1024 * 1024 || !data.subarray(0, 8).equals(PNG_HEADER)) {
    throw new Error('orb computer use: malformed native screenshot')
  }
  return {
    data, mediaType: 'image/png', windowId: value.windowId, appName: value.appName,
    bounds: { x: value.x, y: value.y, width: value.width, height: value.height },
    ...(value.windowTitle === undefined ? {} : { windowTitle: value.windowTitle }),
  }
}

/** Create a restricted X11 platform with native focus checks inside every HID call.
 * @param overlay - Reversible orb and toolbar exclusion.
 * @param command - Optional injected native runner.
 * @returns Foreground capture and input operations.
 */
export function createOrbLinuxComputerUsePlatform(
  overlay: OrbLinuxOverlayExclusion,
  command: OrbLinuxComputerUseCommand = runOrbLinuxComputerUseCommand,
  session: OrbLinuxSession = currentSession(),
): OrbComputerUsePlatform {
  if (!supportedX11(session)) throw new Error('orb computer use: Linux X11 native platform is unavailable')
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
      return typeof value.windowId === 'string' && WINDOW_TOKEN.test(value.windowId) ? value.windowId : undefined
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

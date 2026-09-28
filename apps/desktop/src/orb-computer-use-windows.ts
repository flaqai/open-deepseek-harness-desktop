/** Windows foreground-window operations for the floating Computer Use backend. */

import { execFile } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { crc32, deflateSync } from 'node:zlib'
import type { OrbComputerUseFrame, OrbComputerUsePlatform } from './orb-computer-use-backend.ts'

const execFileAsync = promisify(execFile)
const MAX_CAPTURE_BYTES = 64 * 1024 * 1024
const MAX_RESULT_BYTES = 90 * 1024 * 1024
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

/** Desktop hides its own floating windows during observation and input. */
export interface OrbWindowsOverlayExclusion {
  exclude(): Promise<() => Promise<void>>
}

/** Native command runner; tests inject one so no OS input is posted. */
export type OrbWindowsComputerUseCommand = (args: readonly string[], signal: AbortSignal) => Promise<string>

/** Current interactive-desktop availability, read without requesting an OS grant. */
export interface OrbWindowsComputerUsePermissions {
  readonly screenCapture: boolean
  readonly inputControl: boolean
}

/**
 * Resolve the paired Windows helper from Desktop's emitted lib directory.
 * @returns Absolute path to the bundled executable.
 */
export function orbWindowsComputerUseHelperPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'orb-computer-use-windows.exe')
}

/**
 * Run one allowlisted native command without a shell.
 * @param args - Fixed operation and validated data fields.
 * @param signal - Cancels the child; input already posted cannot be retracted.
 * @returns A bounded JSON result from the helper.
 */
export async function runOrbWindowsComputerUseCommand(args: readonly string[], signal: AbortSignal): Promise<string> {
  const { stdout } = await execFileAsync(orbWindowsComputerUseHelperPath(), [...args], {
    signal, timeout: 15_000, maxBuffer: MAX_RESULT_BYTES, encoding: 'utf8', windowsHide: true,
  })
  return stdout
}

function record(line: string): Record<string, unknown> {
  if (line.length > MAX_RESULT_BYTES) throw new Error('orb computer use: native result exceeds supported size')
  let value: unknown
  try { value = JSON.parse(line) }
  catch { throw new Error('orb computer use: malformed native result') }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('orb computer use: malformed native result')
  }
  return value as Record<string, unknown>
}

function pngChunk(name: string, bytes: Buffer): Buffer {
  const type = Buffer.from(name, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(bytes.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([type, bytes])) >>> 0)
  return Buffer.concat([length, type, bytes, checksum])
}

function bgraPng(width: number, height: number, bgra: Buffer): Buffer {
  const rowBytes = width * 4
  const raster = Buffer.alloc((rowBytes + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const source = y * rowBytes
    const destination = y * (rowBytes + 1)
    raster[destination] = 0
    for (let x = 0; x < width; x += 1) {
      const pixel = source + x * 4
      const output = destination + 1 + x * 4
      raster[output] = bgra[pixel + 2] ?? 0
      raster[output + 1] = bgra[pixel + 1] ?? 0
      raster[output + 2] = bgra[pixel] ?? 0
      raster[output + 3] = 255
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  const result = Buffer.concat([
    PNG_SIGNATURE, pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(raster)), pngChunk('IEND', Buffer.alloc(0)),
  ])
  if (result.length > 32 * 1024 * 1024) throw new Error('orb computer use: captured image exceeds supported size')
  return result
}

function frame(value: Record<string, unknown>): OrbComputerUseFrame {
  const { windowId, appName, windowTitle, x, y, width, height, bgra } = value
  if (typeof windowId !== 'string' || !/^[0-9a-f]+:[0-9]+:[0-9a-f]{16}$/iu.test(windowId)
    || typeof appName !== 'string' || appName.length === 0 || appName.length > 256
    || (windowTitle !== undefined && (typeof windowTitle !== 'string' || windowTitle.length > 256))
    || typeof x !== 'number' || !Number.isSafeInteger(x)
    || typeof y !== 'number' || !Number.isSafeInteger(y)
    || typeof width !== 'number' || !Number.isInteger(width) || width < 2 || width > 16_384
    || typeof height !== 'number' || !Number.isInteger(height) || height < 2 || height > 16_384
    || typeof bgra !== 'string' || width * height * 4 > MAX_CAPTURE_BYTES
    || bgra.length > Math.ceil(MAX_CAPTURE_BYTES / 3) * 4) {
    throw new Error('orb computer use: malformed native capture')
  }
  const pixels = Buffer.from(bgra, 'base64')
  if (pixels.length !== width * height * 4) throw new Error('orb computer use: malformed native pixels')
  return {
    data: bgraPng(width, height, pixels), mediaType: 'image/png', windowId, appName,
    bounds: { x, y, width, height },
    ...(windowTitle === undefined ? {} : { windowTitle }),
  }
}

/**
 * Read Windows interactive-desktop capability without a permission prompt.
 * @param command - Optional injected native command runner.
 * @param signal - Abort for the native lookup.
 * @returns Current screen capture and input availability.
 */
export async function readOrbWindowsComputerUsePermissions(
  command: OrbWindowsComputerUseCommand = runOrbWindowsComputerUseCommand,
  signal: AbortSignal = new AbortController().signal,
): Promise<OrbWindowsComputerUsePermissions> {
  if (process.platform !== 'win32' && command === runOrbWindowsComputerUseCommand) {
    return { screenCapture: false, inputControl: false }
  }
  const value = record(await command(['permissions'], signal))
  if (typeof value.screenCapture !== 'boolean' || typeof value.inputControl !== 'boolean') {
    throw new Error('orb computer use: malformed native permission status')
  }
  return { screenCapture: value.screenCapture, inputControl: value.inputControl }
}

/**
 * Create the Windows platform for one serialized backend instance.
 * @param overlay - Desktop's reversible hide operation for the orb and selection toolbar.
 * @param command - Optional injected native command runner.
 * @returns Native operations that pin a process-lifetime HWND identity in every HID command.
 */
export function createOrbWindowsComputerUsePlatform(
  overlay: OrbWindowsOverlayExclusion,
  command: OrbWindowsComputerUseCommand = runOrbWindowsComputerUseCommand,
): OrbComputerUsePlatform {
  if (process.platform !== 'win32' && command === runOrbWindowsComputerUseCommand) {
    throw new Error('orb computer use: Windows native platform is unavailable')
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
      return typeof value.windowId === 'string' && /^[0-9a-f]+:[0-9]+:[0-9a-f]{16}$/iu.test(value.windowId)
        ? value.windowId : undefined
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

/** Validated ingress for the optional AX-only macOS selection monitor. */

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { OrbObservedSelection, OrbSelectionMonitorFactory } from './orb-selection.ts'
import { ORB_SELECTION_MAX_CHARACTERS } from './orb-selection.ts'

/** Native Node-API exports loaded only on macOS after local permission checks. */
export interface OrbMacSelectionBinding {
  start(onLine: (line: string) => void): void
  stop(): void
  excludePids(pids: string): void
}

/** Diagnostic states reported by the native monitor. */
export type OrbMacSelectionStatus = 'ready' | 'untrusted' | 'failed'

/** One process-local adapter; tests provide a fake native binding. */
export interface OrbMacSelectionOptions {
  readonly binding?: OrbMacSelectionBinding
  readonly platform?: NodeJS.Platform
  readonly onStatus?: (status: OrbMacSelectionStatus) => void
}

let binding: OrbMacSelectionBinding | undefined

/** Load the paired .node and .dylib from Desktop lib or its asar-unpacked mirror.
 * @returns The AX-only native binding.
 */
export function loadOrbMacSelectionBinding(): OrbMacSelectionBinding {
  if (process.platform !== 'darwin') throw new Error('desktop: orb selection monitor is macOS-only')
  if (binding !== undefined) return binding
  const require = createRequire(import.meta.url)
  binding = require(join(dirname(fileURLToPath(import.meta.url)), 'orb-selection-macos-napi.node')) as OrbMacSelectionBinding
  return binding
}

/** Accept only bounded, source-attributed text from the native process seam.
 * @param line - One UTF-8 JSON event from the native callback.
 * @returns A local selection or monitor state; invalid events are discarded.
 */
export function parseOrbMacSelectionLine(line: string): OrbObservedSelection | OrbMacSelectionStatus | undefined {
  if (line.length > 131072) return undefined
  let value: unknown
  try { value = JSON.parse(line) }
  catch { return undefined }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const event = value as Record<string, unknown>
  if (event.type === 'ready' || event.type === 'untrusted') return event.type
  if (event.type !== 'selection' || typeof event.text !== 'string'
    || event.text.trim().length === 0 || event.text.length > ORB_SELECTION_MAX_CHARACTERS
    || typeof event.x !== 'number' || !Number.isFinite(event.x)
    || typeof event.y !== 'number' || !Number.isFinite(event.y)
    || typeof event.pid !== 'number' || !Number.isSafeInteger(event.pid) || event.pid <= 0
    || event.pid === process.pid) return undefined
  return { text: event.text, point: { x: event.x, y: event.y } }
}

/** Create a fail-closed platform adapter; clipboard text is never read or changed.
 * @param options - Optional injected binding and state sink.
 * @returns Native monitor factory on macOS, otherwise undefined.
 */
export function createOrbMacSelectionMonitorFactory(
  options: OrbMacSelectionOptions = {},
): OrbSelectionMonitorFactory | undefined {
  if ((options.platform ?? process.platform) !== 'darwin') return undefined
  return (onSelection) => {
    let native: OrbMacSelectionBinding
    try { native = options.binding ?? loadOrbMacSelectionBinding() }
    catch (error) {
      console.warn('desktop: orb selection native binding is unavailable', error)
      options.onStatus?.('failed')
      return undefined
    }
    let stopped = false
    const report = (status: OrbMacSelectionStatus): void => {
      try { options.onStatus?.(status) }
      catch (error) { console.warn('desktop: orb selection status observer failed', error) }
    }
    const stopNative = (): void => {
      if (stopped) return
      stopped = true
      try { native.stop() }
      catch (error) { console.warn('desktop: orb selection native stop failed', error) }
    }
    try {
      native.start((line) => {
        if (stopped) return
        const event = parseOrbMacSelectionLine(line)
        if (event === 'untrusted') {
          stopNative()
          report('untrusted')
        } else if (event === 'ready') {
          report('ready')
        } else if (typeof event === 'object') {
          try { onSelection(event) }
          catch (error) { console.warn('desktop: orb selection event could not be presented', error) }
        }
      })
      native.excludePids(String(process.pid))
    } catch (error) {
      stopNative()
      console.warn('desktop: orb selection native monitor could not start', error)
      report('failed')
      return undefined
    }
    return {
      stop: stopNative,
      active: () => !stopped,
    }
  }
}

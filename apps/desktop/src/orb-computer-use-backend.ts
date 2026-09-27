/** A bounded foreground Computer Use controller for the floating chat. */

import { setTimeout as delay } from 'node:timers/promises'

/** One frontmost-window raster with the global rectangle used for input. */
export interface OrbComputerUseFrame {
  readonly data: Uint8Array
  readonly mediaType: 'image/png' | 'image/jpeg'
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  readonly appName: string
  readonly windowTitle?: string
}

/** Snapshot of the host's current authority, read again before every operation. */
export interface OrbComputerUseAuthority {
  readonly mode: 'local' | 'nas'
  readonly screenCapture: boolean
  readonly inputControl: boolean
}

/** Native operations supplied by the desktop host; this module never prompts for OS permission. */
export interface OrbComputerUsePlatform {
  withOverlayExcluded<T>(run: () => Promise<T>, signal: AbortSignal): Promise<T>
  captureFrontmost(signal: AbortSignal): Promise<OrbComputerUseFrame>
  click(input: { readonly x: number; readonly y: number; readonly button: 'left' | 'right'; readonly count: 1 | 2 }, signal: AbortSignal): Promise<void>
  typeText(input: {
    readonly x: number
    readonly y: number
    readonly text: string
    readonly replace: boolean
    readonly submit: boolean
  }, signal: AbortSignal): Promise<void>
}

/** Position in the displayed screenshot, not in a global or full-desktop coordinate space. */
export type OrbComputerUsePosition = readonly [number, number]

/** The supported direct GUI actions. Background commands retain their separate approval path. */
export type OrbComputerUseAction =
  | { readonly kind: 'click'; readonly position: OrbComputerUsePosition; readonly button: 'left' | 'right'; readonly count: 1 | 2 }
  | { readonly kind: 'type'; readonly position: OrbComputerUsePosition; readonly text: string; readonly replace: boolean; readonly submit: boolean }

/** A screenshot identity invalidated by every action or newer observation. */
export interface OrbComputerUseObservation {
  readonly frameId: number
  readonly frame: OrbComputerUseFrame
}

/** The sole foreground operation entry point for an author-style floating Computer Use session. */
export interface OrbComputerUseBackend {
  observe(signal?: AbortSignal): Promise<OrbComputerUseObservation>
  act(frameId: number, action: OrbComputerUseAction, signal?: AbortSignal): Promise<OrbComputerUseObservation>
  close(): Promise<void>
}

/** Dependencies owned by the Desktop Host and its exclusive Computer Use registration. */
export interface OrbComputerUseBackendOptions {
  readonly platform: OrbComputerUsePlatform
  readonly authority: () => Promise<OrbComputerUseAuthority>
  /** Pass `ctx.computerUse.register(ComputerUseProviderName('orb-native'))` here. */
  readonly acquireExclusive: () => Promise<() => Promise<void>>
  readonly postActionWaitMs: number
}

const MAX_IMAGE_BYTES = 32 * 1024 * 1024
const MAX_EDGE = 16_384

function requireAuthority(authority: OrbComputerUseAuthority, action: boolean): void {
  if (authority.mode !== 'local') throw new Error('orb computer use: unavailable in NAS mode')
  if (!authority.screenCapture) throw new Error('orb computer use: screen capture permission is required')
  if (action && !authority.inputControl) throw new Error('orb computer use: input control permission is required')
}

function requireFrame(frame: OrbComputerUseFrame): void {
  const { x, y, width, height } = frame.bounds
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isInteger(width) || !Number.isInteger(height)
    || width < 2 || height < 2 || width > MAX_EDGE || height > MAX_EDGE) {
    throw new Error('orb computer use: invalid captured window bounds')
  }
  if (frame.data.byteLength === 0 || frame.data.byteLength > MAX_IMAGE_BYTES) {
    throw new Error('orb computer use: captured window image exceeds supported size')
  }
}

function toGlobal(position: OrbComputerUsePosition, frame: OrbComputerUseFrame): { x: number; y: number } {
  if (position.length !== 2 || position.some(value => !Number.isInteger(value) || value < 0 || value > 1000)) {
    throw new Error('orb computer use: position must use integer screenshot coordinates from 0 to 1000')
  }
  const [horizontal, vertical] = position
  return {
    x: frame.bounds.x + Math.round(horizontal * (frame.bounds.width - 1) / 1000),
    y: frame.bounds.y + Math.round(vertical * (frame.bounds.height - 1) / 1000),
  }
}

function requireAction(action: OrbComputerUseAction): void {
  if (action.kind === 'click') {
    if ((action.button !== 'left' && action.button !== 'right') || (action.count !== 1 && action.count !== 2)) {
      throw new Error('orb computer use: invalid click options')
    }
    return
  }
  if (action.kind === 'type') {
    if (action.text.length === 0 || action.text.length > 32_768) throw new Error('orb computer use: invalid input text length')
    return
  }
  const exhaustive: never = action
  throw new Error(`orb computer use: unsupported action ${String(exhaustive)}`)
}

/**
 * Reserve Computer Use before exposing operations. Every call rechecks local authority,
 * excludes the floating windows during observation/input, and serializes HID and capture.
 * A cancelled action may already have delivered input; callers must observe fresh state.
 * @param options - Host authority, native operations, provider reservation, and settle delay.
 * @returns a live backend that must be closed before releasing its provider slot.
 */
export async function createOrbComputerUseBackend(options: OrbComputerUseBackendOptions): Promise<OrbComputerUseBackend> {
  if (!Number.isInteger(options.postActionWaitMs) || options.postActionWaitMs < 0 || options.postActionWaitMs > 10_000) {
    throw new Error('orb computer use: invalid post-action wait')
  }
  const release = await options.acquireExclusive()
  const lifetime = new AbortController()
  let tail: Promise<void> = Promise.resolve()
  const pending = new Set<Promise<unknown>>()
  let current: OrbComputerUseObservation | undefined
  let nextFrameId = 0
  let closed = false
  let closing: Promise<void> | undefined

  const enqueue = <T>(signal: AbortSignal | undefined, run: (active: AbortSignal) => Promise<T>): Promise<T> => {
    const active = signal === undefined ? lifetime.signal : AbortSignal.any([signal, lifetime.signal])
    const operation = tail.then(async () => {
      active.throwIfAborted()
      if (closed) throw new Error('orb computer use: backend is closed')
      return run(active)
    })
    tail = operation.then(() => {}, () => {})
    pending.add(operation)
    void operation.then(() => { pending.delete(operation) }, () => { pending.delete(operation) })
    return operation
  }

  const capture = async (signal: AbortSignal): Promise<OrbComputerUseObservation> => {
    signal.throwIfAborted()
    requireAuthority(await options.authority(), false)
    signal.throwIfAborted()
    const frame = await options.platform.captureFrontmost(signal)
    signal.throwIfAborted()
    requireFrame(frame)
    const observation = { frameId: ++nextFrameId, frame }
    current = observation
    return observation
  }

  return {
    observe(signal) {
      return enqueue(signal, active => options.platform.withOverlayExcluded(() => capture(active), active))
    },
    act(frameId, action, signal) {
      return enqueue(signal, async (active) => {
        if (current === undefined || current.frameId !== frameId) {
          throw new Error('orb computer use: screenshot is stale; observe the frontmost window again')
        }
        requireAction(action)
        const previous = current
        const point = toGlobal(action.position, previous.frame)
        current = undefined
        return options.platform.withOverlayExcluded(async () => {
          requireAuthority(await options.authority(), true)
          active.throwIfAborted()
          if (action.kind === 'click') {
            await options.platform.click({ ...point, button: action.button, count: action.count }, active)
          } else {
            await options.platform.typeText({ ...point, text: action.text, replace: action.replace, submit: action.submit }, active)
          }
          if (options.postActionWaitMs > 0) await delay(options.postActionWaitMs, undefined, { signal: active })
          return capture(active)
        }, active)
      })
    },
    close() {
      if (closing !== undefined) return closing
      closed = true
      current = undefined
      lifetime.abort()
      closing = (async () => {
        await Promise.allSettled(pending)
        await release()
      })()
      return closing
    },
  }
}

/** Click-through local Computer Use observation indicator. */

import { BrowserWindow, screen } from 'electron'

/** A rectangle in Electron display-independent screen coordinates. */
export interface OrbObservationRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** A visible stroke segment clipped to one display. */
export interface OrbObservationSegment extends OrbObservationRect {
  readonly edge: 'top' | 'right' | 'bottom' | 'left'
}

/** Narrow window interface for tests and alternate platform presentations. */
export interface OrbObservationWindow {
  setBounds(bounds: OrbObservationRect): void
  showInactive(): void
  hide(): void
  destroy(): void
  isDestroyed(): boolean
  readonly webContentsId: number
}

/** Runtime dependencies for one observation indicator. */
export interface OrbObservationHost {
  /** False for NAS, revoked screenshot permission, and unsupported display systems. */
  canObserveLocal(): boolean
  /** Work areas are in Electron display-independent coordinates. */
  workAreas(): readonly OrbObservationRect[]
  /** Convert an observed screen region to Electron coordinates. */
  toLogicalRegion(region: OrbObservationRect): OrbObservationRect
  createWindow(): OrbObservationWindow
}

/** Local observation indicator; it never captures or injects GUI input. */
export interface OrbObservationController {
  show(region: OrbObservationRect): 'shown' | 'unavailable' | 'invalid'
  hide(): void
  /** Recheck authority and display geometry after revocation or monitor change. */
  refresh(): void
  /** IDs to exclude when a screenshot backend supports window exclusion. */
  windowIds(): readonly number[]
  dispose(): void
}

/** Width of the visible observation stroke in logical pixels. */
export const ORB_OBSERVATION_STROKE = 6

function validRect(rect: OrbObservationRect): boolean {
  return Number.isFinite(rect.x) && Number.isFinite(rect.y)
    && Number.isFinite(rect.width) && Number.isFinite(rect.height)
    && rect.width > 0 && rect.height > 0
}

function intersection(a: OrbObservationRect, b: OrbObservationRect): OrbObservationRect | undefined {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  if (right <= x || bottom <= y) return undefined
  return { x, y, width: right - x, height: bottom - y }
}

/** Plan all visible border segments without moving an offscreen observed region.
 * @param region - Local screenshot region in logical points.
 * @param workAreas - Active displays' work areas.
 * @returns Four edges clipped independently against every display.
 */
export function orbObservationSegments(
  region: OrbObservationRect,
  workAreas: readonly OrbObservationRect[],
): readonly OrbObservationSegment[] {
  if (!validRect(region)) return []
  const stroke = Math.min(ORB_OBSERVATION_STROKE, region.width, region.height)
  const edges: readonly OrbObservationSegment[] = [
    { edge: 'top', x: region.x, y: region.y, width: region.width, height: stroke },
    { edge: 'right', x: region.x + region.width - stroke, y: region.y, width: stroke, height: region.height },
    { edge: 'bottom', x: region.x, y: region.y + region.height - stroke, width: region.width, height: stroke },
    { edge: 'left', x: region.x, y: region.y, width: stroke, height: region.height },
  ]
  return edges.flatMap(edge => workAreas.flatMap((area) => {
    if (!validRect(area)) return []
    const clipped = intersection(edge, area)
    return clipped === undefined ? [] : [{ ...clipped, edge: edge.edge }]
  }))
}

/** Create a controller with no ambient permission request or screenshot capture.
 * @param host - Live local authority, displays, and click-through window factory.
 * @returns Observation display controls for one local runtime.
 */
export function createOrbObservationController(host: OrbObservationHost): OrbObservationController {
  const windows: OrbObservationWindow[] = []
  let region: OrbObservationRect | undefined
  let disposed = false
  const hide = (): void => {
    region = undefined
    for (const window of windows) if (!window.isDestroyed()) window.hide()
  }
  const controller: OrbObservationController = {
    show(nextRegion) {
      if (disposed || !host.canObserveLocal()) { hide(); return 'unavailable' }
      if (!validRect(nextRegion)) { hide(); return 'invalid' }
      const logical = host.toLogicalRegion(nextRegion)
      if (!validRect(logical)) { hide(); return 'invalid' }
      const segments = orbObservationSegments(logical, host.workAreas())
      if (segments.length === 0) { hide(); return 'unavailable' }
      region = nextRegion
      for (const [index, segment] of segments.entries()) {
        const window = windows[index] ?? host.createWindow()
        if (windows[index] === undefined) windows.push(window)
        window.setBounds(segment)
        window.showInactive()
      }
      for (const window of windows.slice(segments.length)) if (!window.isDestroyed()) window.hide()
      return 'shown'
    },
    hide,
    refresh() {
      if (region === undefined || disposed) return
      controller.show(region)
    },
    windowIds() {
      return windows.filter(window => !window.isDestroyed()).map(window => window.webContentsId)
    },
    dispose() {
      if (disposed) return
      disposed = true
      region = undefined
      for (const window of windows) if (!window.isDestroyed()) window.destroy()
      windows.length = 0
    },
  }
  return controller
}

/** Create a non-activating, click-through stroke window with no renderer privileges.
 * @returns One Desktop-owned border segment.
 */
export function createElectronOrbObservationWindow(): OrbObservationWindow {
  const window = new BrowserWindow({
    width: 1,
    height: 1,
    frame: false,
    backgroundColor: '#3975ff',
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    show: false,
    hasShadow: false,
    resizable: false,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  })
  window.setIgnoreMouseEvents(true, { forward: true })
  window.setContentProtection(true)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => { event.preventDefault() })
  if (process.platform === 'darwin') window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  return {
    setBounds(bounds) {
      window.setBounds({
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.max(1, Math.round(bounds.width)),
        height: Math.max(1, Math.round(bounds.height)),
      })
    },
    showInactive() { window.showInactive() },
    hide() { window.hide() },
    destroy() { window.destroy() },
    isDestroyed() { return window.isDestroyed() },
    get webContentsId() { return window.webContents.id },
  }
}

/** Current Electron displays for the observation planner.
 * @returns Display work areas in logical points.
 */
export function orbObservationWorkAreas(): readonly OrbObservationRect[] {
  return screen.getAllDisplays().map(display => display.workArea)
}

/** Convert a Computer Use screenshot region to Electron logical points.
 * @param region - Computer Use region; Windows reports physical pixels.
 * @returns Region in Electron coordinates.
 */
export function orbObservationLogicalRegion(region: OrbObservationRect): OrbObservationRect {
  if (process.platform !== 'win32') return region
  return screen.screenToDipRect(null, region)
}

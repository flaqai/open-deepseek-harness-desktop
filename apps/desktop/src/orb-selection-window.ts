/** Cross-application selection toolbar with a fixed, unprivileged renderer. */

import { BrowserWindow, screen } from 'electron'
import type { OrbObservedSelection, OrbSelectionActions, OrbSelectionPoint } from './orb-selection.ts'

/** Initial toolbar size in Electron display-independent pixels. */
export const ORB_SELECTION_TOOLBAR_SIZE = { width: 356, height: 52 } as const

/** Work area or toolbar rectangle in Electron display-independent pixels. */
export interface OrbSelectionToolbarRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** The only renderer navigation requests that may dispatch an action. */
export type OrbSelectionToolbarAction = 'attach' | 'translate-zh' | 'translate-en' | 'search'

/** Unprivileged toolbar window operations; tests inject an in-memory implementation. */
export interface OrbSelectionToolbarWindow {
  readonly webContentsId: number
  load(): Promise<void>
  setActionHandler(handler: (action: OrbSelectionToolbarAction) => void): void
  setBounds(bounds: OrbSelectionToolbarRect): void
  showInactive(): void
  hide(): void
  destroy(): void
  isDestroyed(): boolean
}

/** Live local authority and platform policy for one DSH_HOME. */
export interface OrbSelectionToolbarHost {
  /** False for NAS, lost permission, or a stopped local runtime. */
  canShowLocal(): boolean
  /** False for native Wayland, where global window positioning is unavailable. */
  supportsPositioning(): boolean
  workAreas(): readonly OrbSelectionToolbarRect[]
  createWindow(locale: string): OrbSelectionToolbarWindow
  locale(): string
}

/** Toolbar lifecycle and screenshot-exclusion handle. */
export interface OrbSelectionWindowController {
  show(selection: OrbObservedSelection, actions: OrbSelectionActions): Promise<'shown' | 'unavailable'>
  hide(): void
  setTaskRunning(running: boolean): void
  setInputActive(active: boolean): void
  refreshAuthority(): void
  readonly webContentsId: number | undefined
  dispose(): void
}

function validRect(rect: OrbSelectionToolbarRect): boolean {
  return Number.isFinite(rect.x) && Number.isFinite(rect.y)
    && Number.isFinite(rect.width) && Number.isFinite(rect.height)
    && rect.width > 0 && rect.height > 0
}

/** Place a toolbar near selection release, clamped to its own display's work area.
 * @param point - Electron screen point in DIP, not Windows physical pixels.
 * @param workAreas - Current display work areas in DIP.
 * @returns Toolbar bounds, or undefined when no display can place it.
 */
export function orbSelectionToolbarBounds(
  point: OrbSelectionPoint,
  workAreas: readonly OrbSelectionToolbarRect[],
): OrbSelectionToolbarRect | undefined {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return undefined
  const areas = workAreas.filter(validRect)
  const area = areas.find(rect => point.x >= rect.x && point.y >= rect.y
    && point.x < rect.x + rect.width && point.y < rect.y + rect.height)
  if (area === undefined) return undefined
  const width = Math.min(ORB_SELECTION_TOOLBAR_SIZE.width, area.width)
  const height = Math.min(ORB_SELECTION_TOOLBAR_SIZE.height, area.height)
  const x = Math.min(Math.max(Math.round(point.x), area.x), area.x + area.width - width)
  const y = Math.min(Math.max(Math.round(point.y + 8), area.y), area.y + area.height - height)
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
}

/** Parse only the four fixed action URLs; arbitrary navigation is always denied.
 * @param url - Renderer-requested URL.
 * @returns Allowlisted action or undefined.
 */
export function parseOrbSelectionActionUrl(url: string): OrbSelectionToolbarAction | undefined {
  let parsed: URL
  try { parsed = new URL(url) } catch { return undefined }
  if (parsed.protocol !== 'orb-selection-action:' || parsed.pathname !== '/'
    || parsed.username !== '' || parsed.password !== '' || parsed.port !== ''
    || parsed.search !== '' || parsed.hash !== '') return undefined
  switch (parsed.hostname) {
    case 'attach':
    case 'translate-zh':
    case 'translate-en':
    case 'search': return parsed.hostname
    default: return undefined
  }
}

/** Native Wayland cannot promise toolbar placement or show-without-focus.
 * @returns Whether this platform can use a positioned cross-app overlay.
 */
export function orbSelectionSupportsPositioning(): boolean {
  return process.platform !== 'linux' || process.env.XDG_SESSION_TYPE?.toLowerCase() !== 'wayland'
}

/** Create the cross-app toolbar controller. No selection automatically sends a message.
 * @param host - Local authority and restricted window factory.
 * @returns Explicit action toolbar for one active local runtime.
 */
export function createOrbSelectionWindowController(host: OrbSelectionToolbarHost): OrbSelectionWindowController {
  let window: OrbSelectionToolbarWindow | undefined
  let loading: Promise<void> | undefined
  let disposed = false
  let taskRunning = false
  let inputActive = false
  let generation = 0
  const available = (): boolean => !disposed && !taskRunning && !inputActive
    && host.canShowLocal() && host.supportsPositioning()
  const hide = (): void => {
    generation++
    if (window !== undefined && !window.isDestroyed()) window.hide()
  }
  const controller: OrbSelectionWindowController = {
    async show(selection, actions) {
      if (!available()) { hide(); return 'unavailable' }
      const bounds = orbSelectionToolbarBounds(selection.point, host.workAreas())
      if (bounds === undefined) { hide(); return 'unavailable' }
      const ticket = ++generation
      if (window === undefined || window.isDestroyed()) {
        window = host.createWindow(host.locale())
        loading = window.load()
      }
      const target = window
      try { await loading }
      catch (error) {
        if (window === target) { window = undefined; loading = undefined }
        if (!target.isDestroyed()) target.destroy()
        throw error
      }
      if (ticket !== generation || !available() || target.isDestroyed()) return 'unavailable'
      target.setActionHandler((action) => {
        if (ticket !== generation || !available()) { hide(); return }
        hide()
        switch (action) {
          case 'attach': actions.attach(); return
          case 'translate-zh': actions.translate('zh'); return
          case 'translate-en': actions.translate('en'); return
          case 'search':
            void actions.search().catch(() => { console.warn('desktop: selection web search failed') })
            return
        }
      })
      target.setBounds(bounds)
      target.showInactive()
      return 'shown'
    },
    hide,
    setTaskRunning(running) { taskRunning = running; if (running) hide() },
    setInputActive(active) { inputActive = active; if (active) hide() },
    refreshAuthority() { if (!available()) hide() },
    get webContentsId() { return window !== undefined && !window.isDestroyed() ? window.webContentsId : undefined },
    dispose() {
      if (disposed) return
      disposed = true
      hide()
      if (window !== undefined && !window.isDestroyed()) window.destroy()
      window = undefined
      loading = undefined
    },
  }
  return controller
}

function toolbarHtml(locale: string): string {
  const chinese = /^zh(?:-|$)/iu.test(locale)
  const labels = chinese
    ? ['发给悬浮聊天', '译中', '译英', '搜索']
    : ['Send to chat', 'To Chinese', 'To English', 'Search']
  const actions: readonly OrbSelectionToolbarAction[] = ['attach', 'translate-zh', 'translate-en', 'search']
  const links = actions.map((action, index) =>
    `<a role="button" href="orb-selection-action://${action}/" aria-label="${labels[index]}">${labels[index]}</a>`).join('')
  return `<!doctype html><html lang="${chinese ? 'zh' : 'en'}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>html,body{margin:0;background:transparent;font:13px system-ui,sans-serif}body{padding:4px}nav{display:flex;align-items:center;gap:3px;height:44px;padding:0 5px;border:1px solid #d0d6e2;border-radius:12px;background:#fff;box-shadow:0 5px 20px #12223d33}a{color:#202735;text-decoration:none;white-space:nowrap;padding:9px 7px;border-radius:8px}a:hover,a:focus-visible{background:#eaf0ff;outline:2px solid #3975ff;outline-offset:-2px}@media(prefers-color-scheme:dark){nav{background:#1d2635;border-color:#53627a}a{color:#f2f5fa}a:hover,a:focus-visible{background:#334261}}</style></head><body><nav aria-label="${chinese ? '划词操作' : 'Selection actions'}">${links}</nav></body></html>`
}

/** Construct one sandboxed, no-preload toolbar; action URLs never navigate.
 * @param locale - Current Desktop locale for fixed labels.
 * @returns A positioned non-activating window adapter.
 */
export function createElectronOrbSelectionToolbarWindow(locale: string): OrbSelectionToolbarWindow {
  const window = new BrowserWindow({
    width: ORB_SELECTION_TOOLBAR_SIZE.width,
    height: ORB_SELECTION_TOOLBAR_SIZE.height,
    frame: false,
    transparent: process.platform !== 'linux',
    backgroundColor: '#ffffff',
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    show: false,
    hasShadow: process.platform !== 'linux',
    resizable: false,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      javascript: false,
    },
  })
  let handler: ((action: OrbSelectionToolbarAction) => void) | undefined
  window.setContentProtection(true)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    const action = parseOrbSelectionActionUrl(url)
    if (action !== undefined) handler?.(action)
  })
  window.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape' && input.type === 'keyDown') {
      event.preventDefault()
      handler = undefined
      window.hide()
    }
  })
  if (process.platform === 'darwin') window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  return {
    get webContentsId() { return window.webContents.id },
    async load() {
      await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(toolbarHtml(locale))}`)
    },
    setActionHandler(next) { handler = next },
    setBounds(bounds) { window.setBounds(bounds) },
    showInactive() { window.showInactive() },
    hide() { handler = undefined; window.hide() },
    destroy() { handler = undefined; window.destroy() },
    isDestroyed() { return window.isDestroyed() },
  }
}

/** Current display work areas for the selection toolbar.
 * @returns Electron logical work areas.
 */
export function orbSelectionWorkAreas(): readonly OrbSelectionToolbarRect[] {
  return screen.getAllDisplays().map(display => display.workArea)
}

/** Registrant-owned native editable menu subscription and command projection. */
import type { EditableHistory } from '@deepseek-ai/dsh-client-ui-primitives'
import type { EditableCommand, EditableMenuBridge, EditableMenuRequest } from './editable-menu.ts'

/** Presentation facts read through the renderer-made private hook. */
export interface EditableMenuSnapshot { request: EditableMenuRequest | null; failed: boolean }

/** Own native events and target history without injecting transport into business components. */
export class DesktopEditableMenuProjection {
  private readonly state = {
    snapshot: { request: null, failed: false } as EditableMenuSnapshot,
    listeners: new Set<() => void>(),
    target: null as HTMLElement | null,
    history: null as EditableHistory | null,
    revision: 0,
  }
  /**
   * @param bridge Native editable menu transport, retained by the registrant only.
   * @param resolveHistory Current owning service's root-fenced history lookup.
   */
  constructor(
    private readonly bridge: EditableMenuBridge,
    private readonly resolveHistory: (target: HTMLElement | null) => EditableHistory | null,
  ) {}
  /** Read the current presentation snapshot. @returns Current request and operation failure. */
  getSnapshot = (): EditableMenuSnapshot => this.state.snapshot
  /** Subscribe for the framework-made hook. @param listener Change callback. @returns Subscription cleanup. */
  subscribe = (listener: () => void): (() => void) => {
    this.state.listeners.add(listener)
    return () => { this.state.listeners.delete(listener) }
  }
  private publish(snapshot: EditableMenuSnapshot): void {
    this.state.snapshot = snapshot
    for (const listener of this.state.listeners) listener()
  }
  /** Start the sole native event subscription. @returns Lifecycle cleanup invalidating pending actions. */
  start(): () => void {
    const stop = this.bridge.subscribe((next) => {
      this.state.revision++
      const pointed = document.elementFromPoint(next.x, next.y)
      this.state.target = pointed?.closest<HTMLElement>('input, textarea, [contenteditable]')
        ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
      this.state.history = this.resolveHistory(this.state.target)
      const history = this.state.history?.read()
      const allowed = history === undefined || history === null ? next.allowed : [
        ...next.allowed.filter(command => command !== 'undo' && command !== 'redo'),
        ...(history.canUndo ? ['undo' as const] : []), ...(history.canRedo ? ['redo' as const] : []),
      ]
      this.publish({ request: { ...next, allowed }, failed: false })
    })
    return () => { stop(); this.state.revision++; this.close(); this.state.target = null; this.state.history = null }
  }
  /** Current DOM focus-return target. @returns Original editable target, or null before the first request. */
  returnFocus = (): HTMLElement | null => this.state.target
  /** Dismiss the current native context without applying an edit. */
  close = (): void => {
    const request = this.state.snapshot.request
    if (request !== null) this.bridge.dismiss(request.token)
    this.publish({ request: null, failed: false })
  }
  /** Dispatch one selected menu command after native target/token validation. @param id Shared menu row identity. */
  select = (id: string): void => {
    const current = this.state.snapshot.request
    if (current === null) return
    const revision = this.state.revision
    this.publish({ request: null, failed: false })
    const index = id.startsWith('replace:') ? Number(id.slice(8)) : undefined
    let command: EditableCommand = index === undefined ? id as EditableCommand : 'replace'
    const history = this.state.history
    const direction = command === 'undo' || command === 'redo' ? command : null
    if (history !== null && direction !== null) command = direction === 'undo' ? 'editorUndo' : 'editorRedo'
    void this.bridge.execute({ token: current.token, command, ...(index === undefined ? {} : { suggestion: index }) })
      .then(() => {
        if (this.state.revision !== revision) return
        if (history !== null && direction !== null && !history.execute(direction)) throw new Error('Editor history changed')
      }).catch(() => {
        if (this.state.revision === revision) this.publish({ request: null, failed: true })
      })
  }
}

/** Explicitly enabled global shortcut for a copied selection. */

import { globalShortcut } from 'electron'

/** Fixed accelerator avoids accepting arbitrary renderer-supplied key combinations. */
export const ORB_COPIED_SELECTION_ACCELERATOR = 'CommandOrControl+Shift+O'

/** Registration status for the floating-ball settings page. */
export type OrbShortcutStatus =
  | { readonly state: 'disabled' }
  | { readonly state: 'registered'; readonly accelerator: string }
  | { readonly state: 'unavailable'; readonly reason: 'local-authority' | 'task-running' | 'input-active' }
  | { readonly state: 'conflict'; readonly accelerator: string }
  | { readonly state: 'failed' }

/** Narrow shortcut registry, owned by the Electron main process. */
export interface OrbShortcutRegistry {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
}

/** The registered shortcut never receives the clipboard contents. */
export interface OrbShortcutHost {
  /** False for NAS, revoked local permission, or a stopped local runtime. */
  canUseLocalSelection(): boolean
  /** Reads user-copied text only after the user presses the registered shortcut. */
  invokeCopiedSelection(): void
  onStatus(status: OrbShortcutStatus): void
  onTriggerError?(error: unknown): void
}

/** Lifecycle controls for one active Desktop runtime. */
export interface OrbShortcutController {
  setEnabled(enabled: boolean): OrbShortcutStatus
  setTaskRunning(running: boolean): OrbShortcutStatus
  setInputActive(active: boolean): OrbShortcutStatus
  /** Call when NAS mode or OS permission changes. */
  refreshAuthority(): OrbShortcutStatus
  status(): OrbShortcutStatus
  dispose(): void
}

/** Create an owned shortcut controller; it is disabled until the user enables it.
 * @param registry - Electron global shortcut registry.
 * @param host - Live runtime authority and explicit selection action.
 * @returns Idempotent registration controls.
 */
export function createOrbShortcutController(
  registry: OrbShortcutRegistry,
  host: OrbShortcutHost,
): OrbShortcutController {
  let enabled = false
  let registered = false
  let taskRunning = false
  let inputActive = false
  let disposed = false
  let current: OrbShortcutStatus = { state: 'disabled' }
  const publish = (status: OrbShortcutStatus): OrbShortcutStatus => {
    current = status
    host.onStatus(status)
    return status
  }
  const release = (): void => {
    if (!registered) return
    registered = false
    registry.unregister(ORB_COPIED_SELECTION_ACCELERATOR)
  }
  const reconcile = (): OrbShortcutStatus => {
    if (disposed || !enabled) { release(); return publish({ state: 'disabled' }) }
    const reason = !host.canUseLocalSelection() ? 'local-authority'
      : taskRunning ? 'task-running'
        : inputActive ? 'input-active' : undefined
    if (reason !== undefined) { release(); return publish({ state: 'unavailable', reason }) }
    if (registered) return publish({ state: 'registered', accelerator: ORB_COPIED_SELECTION_ACCELERATOR })
    try {
      registered = registry.register(ORB_COPIED_SELECTION_ACCELERATOR, () => {
        if (disposed || !enabled || taskRunning || inputActive || !host.canUseLocalSelection()) return
        try { host.invokeCopiedSelection() }
        catch (error) { host.onTriggerError?.(error) }
      })
    } catch (error) {
      host.onTriggerError?.(error)
      return publish({ state: 'failed' })
    }
    return registered
      ? publish({ state: 'registered', accelerator: ORB_COPIED_SELECTION_ACCELERATOR })
      : publish({ state: 'conflict', accelerator: ORB_COPIED_SELECTION_ACCELERATOR })
  }
  return {
    setEnabled(value) { enabled = value; return reconcile() },
    setTaskRunning(value) { taskRunning = value; return reconcile() },
    setInputActive(value) { inputActive = value; return reconcile() },
    refreshAuthority: reconcile,
    status: () => current,
    dispose() {
      if (disposed) return
      disposed = true
      release()
      publish({ state: 'disabled' })
    },
  }
}

/** Electron adapter; the controller unregisters only its own accelerator.
 * @returns Global-shortcut operations.
 */
export function electronOrbShortcutRegistry(): OrbShortcutRegistry {
  return {
    register: (accelerator, callback) => globalShortcut.register(accelerator, callback),
    unregister: (accelerator) => { globalShortcut.unregister(accelerator) },
  }
}

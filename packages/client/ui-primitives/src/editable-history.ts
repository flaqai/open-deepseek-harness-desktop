/** Root-bound model editing history shared by custom inputs and contextual menus. */

/** Two editing commands supported by a model-owned history. */
export type EditableHistoryDirection = 'undo' | 'redo'
/** Read-only availability projected by the history owner. */
export interface EditableHistoryState { canUndo: boolean; canRedo: boolean }
/** Minimal model adapter; draft text, history entries and editor objects stay private. */
export interface EditableHistoryProvider {
  /** Return null while the model is not editable or no longer owns this root. */
  read(): EditableHistoryState | null
  /** Dispatch one available model-history command. */
  execute(direction: EditableHistoryDirection): boolean
}
/** History access additionally fenced to one current connected root registration. */
export type EditableHistory = EditableHistoryProvider

/** Instance-owned registration map; the containing UI service owns its disposal. */
export class EditableHistoryRegistry {
  private readonly state = { disposed: false, roots: new WeakMap<HTMLElement, { provider: EditableHistoryProvider }>() }

  /**
   * Register one custom editable root's model-history adapter.
   * @param root Mounted custom editor root; native form controls retain browser history.
   * @param provider Owner-supplied current availability and command dispatch.
   * @returns Cleanup which cannot remove a newer registration on the same root.
   */
  register(root: HTMLElement, provider: EditableHistoryProvider): () => void {
    if (this.state.disposed) throw new Error('Editable history registry is disposed')
    const entry = { provider }
    this.state.roots.set(root, entry)
    return () => { if (this.state.roots.get(root) === entry) this.state.roots.delete(root) }
  }

  /**
   * Resolve model history without crossing a nested input or unregistered editing host.
   * @param target Editable DOM target; ordinary inputs and unrelated roots return null.
   * @returns Root-fenced access; read returns null after registry/root disposal, replacement or read-only state.
   */
  forTarget(target: HTMLElement | null): EditableHistory | null {
    if (this.state.disposed) return null
    let root = target
    while (root !== null) {
      if (root.matches('input, textarea, select')) return null
      if (this.state.roots.has(root)) break
      if (root.hasAttribute('contenteditable')) return null
      root = root.parentElement
    }
    const entry = root === null ? undefined : this.state.roots.get(root)
    if (root === null || entry === undefined) return null
    const boundRoot = root
    const read = (): EditableHistoryState | null => {
      if (this.state.disposed || !boundRoot.isConnected || this.state.roots.get(boundRoot) !== entry
        || boundRoot.getAttribute('contenteditable') === 'false' || boundRoot.hasAttribute('readonly')
        || boundRoot.hasAttribute('disabled')) return null
      return entry.provider.read()
    }
    return {
      read,
      execute(direction) {
        const state = read()
        if (state === null || !(direction === 'undo' ? state.canUndo : state.canRedo)) return false
        return entry.provider.execute(direction)
      },
    }
  }

  /** Invalidate every outstanding handle when the owning UI service is disposed. */
  dispose(): void { this.state.disposed = true }
}

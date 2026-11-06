/** Register the Composer's private Lexical history with the shared editable-root registry. */
import type { EditableHistoryRegistry } from '@deepseek-ai/dsh-client-ui-primitives'
import { REDO_COMMAND, UNDO_COMMAND, type LexicalEditor } from 'lexical'
import type { HistoryState } from '@lexical/history'

/**
 * Adapt actual Lexical history to the editor's current DOM root.
 * @param editor Model-owned editor, whose history plugin is already registered.
 * @param history That editor's actual history state.
 * @param registry Explicit owning UI service instance receiving the adapter.
 * @returns Listener and root registration cleanup; editor internals remain private.
 */
export function registerComposerEditingHistory(
  editor: LexicalEditor, history: HistoryState, registry: EditableHistoryRegistry,
): () => void {
  let unregisterRoot: (() => void) | undefined
  const remove = editor.registerRootListener((next) => {
    unregisterRoot?.()
    unregisterRoot = undefined
    if (next === null) return
    unregisterRoot = registry.register(next, {
      read: () => editor.getRootElement() === next && editor.isEditable()
        ? { canUndo: history.undoStack.length > 0, canRedo: history.redoStack.length > 0 } : null,
      execute: direction => editor.dispatchCommand(direction === 'undo' ? UNDO_COMMAND : REDO_COMMAND, undefined),
    })
  })
  return () => { remove(); unregisterRoot?.(); unregisterRoot = undefined }
}

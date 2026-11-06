/** Closed commands and redacted native metadata for one editable context menu. */
export type EditableMenuCommand = 'editorUndo' | 'editorRedo' | 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll' | 'replace' | 'add' | 'toggle'
/** One short-lived native editable context, without input contents or clipboard data. */
export interface EditableMenuRequest {
  token: string
  x: number
  y: number
  suggestions: string[]
  misspelled: boolean
  spellingAllowed: boolean
  spellingEnabled: boolean
  spellingAvailable: boolean
  allowed: readonly EditableMenuCommand[]
}
/** Renderer command bound to a native token, never to an arbitrary word or document. */
export interface EditableMenuAction { token: string; command: EditableMenuCommand; suggestion?: number }

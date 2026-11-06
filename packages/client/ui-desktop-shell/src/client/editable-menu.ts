/** Narrow editable-menu bridge; native field contents and clipboard values are never exposed. */
export type EditableCommand = 'editorUndo' | 'editorRedo' | 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll' | 'replace' | 'add' | 'toggle'
/** Redacted native context valid for one command and one editable DOM target. */
export interface EditableMenuRequest {
  token: string
  x: number
  y: number
  suggestions: string[]
  misspelled: boolean
  spellingAllowed: boolean
  spellingEnabled: boolean
  spellingAvailable: boolean
  allowed: readonly EditableCommand[]
}
/** Local editable actions supplied only by the trusted Desktop preload. */
export interface EditableMenuBridge {
  subscribe(listener: (request: EditableMenuRequest) => void): () => void
  execute(action: { token: string; command: EditableCommand; suggestion?: number }): Promise<void>
  dismiss(token: string): void
}

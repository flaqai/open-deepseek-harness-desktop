/** Local editable-field menu metadata and fenced native editing commands. */
import { randomUUID } from 'node:crypto'
import { ipcMain, type WebContents, type ContextMenuParams } from 'electron'
import { DESKTOP_IPC } from './desktop-ipc-protocol.ts'
import type { EditableMenuAction, EditableMenuCommand, EditableMenuRequest } from './editable-menu-protocol.ts'

/** Availability is set only after the offline dictionary initialization succeeds. */
export interface LocalSpellingState {
  available: boolean
  enabled(): boolean
  setEnabled(enabled: boolean): void
}

/**
 * Forward trusted editable contexts to the application menu without exposing field contents.
 * @param renderer The Harness renderer, excluding embedded frames and guests.
 * @param trusted Whether the renderer currently owns the trusted application URL.
 * @param spelling Device-local preference and initialized dictionary availability.
 * @returns Listener cleanup; navigation invalidates every pending command.
 */
export function installSpellingContextMenu(
  renderer: WebContents, trusted: () => boolean, spelling: LocalSpellingState,
): () => void {
  let context: {
    request: EditableMenuRequest
    params: ContextMenuParams
    url: string
    frame: Electron.WebFrameMain
    expires: number
  } | undefined
  let disposed = false
  const clear = (): void => { context = undefined }
  const listener = (_event: Electron.Event, params: ContextMenuParams): void => {
    clear()
    if (renderer.isDestroyed() || !trusted() || !params.isEditable
      || params.frame !== renderer.mainFrame || params.frameURL !== renderer.getURL()) return
    const flags = params.editFlags
    const allowed: EditableMenuCommand[] = ['editorUndo', 'editorRedo']
    if (flags.canUndo) allowed.push('undo')
    if (flags.canRedo) allowed.push('redo')
    if (flags.canCut) allowed.push('cut')
    if (flags.canCopy) allowed.push('copy')
    if (flags.canPaste) allowed.push('paste')
    if (flags.canSelectAll) allowed.push('selectAll')
    const spellingAllowed = params.formControlType !== 'input-password'
    const suggestions = spellingAllowed && spelling.enabled() ? [...new Set(params.dictionarySuggestions)].slice(0, 8) : []
    const misspelled = spellingAllowed && spelling.enabled() && Boolean(params.misspelledWord)
    if (spellingAllowed && spelling.available) allowed.push('toggle')
    if (misspelled && spelling.available) allowed.push('add')
    if (suggestions.length > 0 && spelling.available) allowed.push('replace')
    const request: EditableMenuRequest = { token: randomUUID(), x: params.x, y: params.y, suggestions, misspelled,
      spellingAllowed, spellingAvailable: spelling.available, spellingEnabled: spelling.available && spelling.enabled(), allowed }
    context = { request, params, url: renderer.getURL(), frame: renderer.mainFrame, expires: Date.now() + 60_000 }
    renderer.send(DESKTOP_IPC.editableMenuOpen, request)
  }
  const command = (event: Electron.IpcMainInvokeEvent, action: unknown): void => {
    const current = context
    if (renderer.isDestroyed() || !trusted() || event.sender !== renderer || event.senderFrame !== renderer.mainFrame
      || current === undefined || current.expires < Date.now() || renderer.getURL() !== current.url || renderer.mainFrame !== current.frame
      || typeof action !== 'object' || action === null || !('token' in action) || action.token !== current.request.token
      || !('command' in action) || typeof action.command !== 'string'
      || !current.request.allowed.includes(action.command as EditableMenuCommand)) throw new Error('desktop: editable context expired')
    const value = action as EditableMenuAction
    clear()
    switch (value.command) {
      case 'replace': {
        const suggestion = typeof value.suggestion === 'number' && Number.isInteger(value.suggestion)
          ? current.request.suggestions[value.suggestion] : undefined
        if (suggestion === undefined) throw new Error('desktop: invalid spelling suggestion')
        renderer.replaceMisspelling(suggestion); break
      }
      case 'add': renderer.session.addWordToSpellCheckerDictionary(current.params.misspelledWord); break
      case 'toggle':
        if (!spelling.available) throw new Error('desktop: local spelling dictionaries are unavailable')
        spelling.setEnabled(!spelling.enabled()); break
      // The renderer owns model history; this only consumes its validated native token.
      case 'editorUndo': case 'editorRedo': break
      case 'undo': renderer.undo(); break
      case 'redo': renderer.redo(); break
      case 'cut': renderer.cut(); break
      case 'copy': renderer.copy(); break
      case 'paste': renderer.paste(); break
      case 'selectAll': renderer.selectAll(); break
    }
  }
  ipcMain.handle(DESKTOP_IPC.editableMenuCommand, command)
  renderer.on('context-menu', listener)
  renderer.on('did-start-navigation', clear)
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    clear()
    ipcMain.removeHandler(DESKTOP_IPC.editableMenuCommand)
    renderer.removeListener('context-menu', listener)
    renderer.removeListener('did-start-navigation', clear)
    renderer.removeListener('destroyed', dispose)
  }
  renderer.once('destroyed', dispose)
  return dispose
}

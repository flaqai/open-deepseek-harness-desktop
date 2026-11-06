import { EventEmitter } from 'node:events'
import { ipcMain, type ContextMenuParams, type WebContents } from 'electron'
import { expect, it, vi } from 'vitest'
import { installSpellingContextMenu } from '../src/spellcheck-context-menu.ts'
import { DESKTOP_IPC } from '../src/desktop-ipc-protocol.ts'
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), removeHandler: vi.fn() } }))
function fixture() {
  const renderer = Object.assign(new EventEmitter(), {
    mainFrame: {}, getURL: () => 'http://127.0.0.1:1234/', isDestroyed: () => false,
    send: vi.fn(), replaceMisspelling: vi.fn(), undo: vi.fn(), redo: vi.fn(), cut: vi.fn(),
    copy: vi.fn(), paste: vi.fn(), selectAll: vi.fn(),
    session: { addWordToSpellCheckerDictionary: vi.fn() },
  })
  const spelling = { available: true, enabled: () => true, setEnabled: vi.fn() }
  let trusted = true
  vi.mocked(ipcMain).handle.mockClear()
  const dispose = installSpellingContextMenu(renderer as unknown as WebContents, () => trusted, spelling)
  const handler = vi.mocked(ipcMain).handle.mock.calls[0]![1]
  const invoke = (event: Electron.IpcMainInvokeEvent, action: unknown): void => { handler(event, action) }
  const event = { sender: renderer, senderFrame: renderer.mainFrame } as unknown as Electron.IpcMainInvokeEvent
  const params = {
    isEditable: true, formControlType: 'input-text', misspelledWord: 'wrold', dictionarySuggestions: ['world', 'word'],
    frame: renderer.mainFrame, frameURL: renderer.getURL(), x: 4, y: 5,
    editFlags: { canUndo: true, canRedo: false, canCut: true, canCopy: true, canPaste: true,
      canSelectAll: true, canDelete: true, canEditRichly: false },
  } as ContextMenuParams
  const open = (extra: Partial<ContextMenuParams> = {}) => {
    renderer.emit('context-menu', {}, { ...params, ...extra })
    return renderer.send.mock.lastCall?.[1] as { token: string; suggestions: string[]; allowed: string[]; spellingAllowed: boolean }
  }
  return { renderer, spelling, dispose, invoke, event, open, untrust: () => { trusted = false } }
}
it('sends redacted metadata and executes one native suggestion once', () => {
  const f = fixture()
  const request = f.open()
  expect(f.renderer.send.mock.lastCall?.[0]).toBe(DESKTOP_IPC.editableMenuOpen)
  expect(request.suggestions).toEqual(['world', 'word'])
  expect(request).not.toHaveProperty('misspelledWord')
  f.invoke(f.event, { token: request.token, command: 'replace', suggestion: 0 })
  expect(f.renderer.replaceMisspelling).toHaveBeenCalledWith('world')
  expect(() =>{  f.invoke(f.event, { token: request.token, command: 'replace', suggestion: 0 }) }).toThrow(/expired/u)
  f.dispose()
})
it('excludes noneditable and embedded frames, and omits password spelling', () => {
  const f = fixture()
  f.open({ isEditable: false })
  f.open({ frame: {} as Electron.WebFrameMain })
  expect(f.renderer.send).not.toHaveBeenCalled()
  const request = f.open({ formControlType: 'input-password' })
  expect(request.spellingAllowed).toBe(false)
  expect(request.allowed).not.toContain('add')
  expect(request.allowed).not.toContain('toggle')
  f.dispose()
})
it('rejects wrong frame, lost trust, navigation, unavailable commands and arbitrary replacements', () => {
  const f = fixture()
  let request = f.open()
  expect(() =>{  f.invoke({ ...f.event, senderFrame: null }, { token: request.token, command: 'copy' }) }).toThrow(/expired/u)
  expect(() =>{  f.invoke(f.event, { token: request.token, command: 'redo' }) }).toThrow(/expired/u)
  expect(() =>{  f.invoke(f.event, { token: request.token, command: 'replace', suggestion: 9 }) }).toThrow(/invalid/u)
  request = f.open()
  f.renderer.emit('did-start-navigation')
  expect(() =>{  f.invoke(f.event, { token: request.token, command: 'paste' }) }).toThrow(/expired/u)
  request = f.open(); f.untrust()
  expect(() =>{  f.invoke(f.event, { token: request.token, command: 'cut' }) }).toThrow(/expired/u)
  expect(f.renderer.cut).not.toHaveBeenCalled()
  f.dispose()
})
it('toggles initialized local spelling and uses native clipboard commands', () => {
  const f = fixture()
  let request = f.open()
  f.invoke(f.event, { token: request.token, command: 'toggle' })
  expect(f.spelling.setEnabled).toHaveBeenCalledWith(false)
  request = f.open()
  f.invoke(f.event, { token: request.token, command: 'paste' })
  expect(f.renderer.paste).toHaveBeenCalledOnce()
  f.spelling.available = false
  request = f.open()
  expect(request.allowed).not.toContain('toggle')
  expect(() =>{  f.invoke(f.event, { token: request.token, command: 'toggle' }) }).toThrow(/expired/u)
  f.dispose()
  expect(f.renderer.listenerCount('context-menu')).toBe(0)
})

it('consumes a Composer history claim without running native history or trusting native redo availability', () => {
  const f = fixture()
  const request = f.open()
  expect(request.allowed).not.toContain('redo')
  f.invoke(f.event, { token: request.token, command: 'editorRedo' })
  expect(f.renderer.redo).not.toHaveBeenCalled()
  expect(f.renderer.undo).not.toHaveBeenCalled()
  expect(() => { f.invoke(f.event, { token: request.token, command: 'editorRedo' }) }).toThrow(/expired/u)
  f.dispose()
})

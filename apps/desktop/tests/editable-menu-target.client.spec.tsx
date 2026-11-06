// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { createEditableMenuTarget } from '../src/editable-menu-target.ts'
afterEach(() => { document.body.replaceChildren() })
function input() {
  const field = document.createElement('textarea')
  field.value = 'hello world'
  document.body.append(field)
  field.focus(); field.setSelectionRange(6, 11)
  field.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
  return field
}
it('restores the original selection from menu focus without replacing text', () => {
  const target = createEditableMenuTarget(document)
  const field = input()
  expect(target.bind('context')).toBe(true)
  const menu = document.createElement('div'); menu.dataset.contextMenu = ''
  const row = document.createElement('button'); menu.append(row); document.body.append(menu); row.focus()
  field.setSelectionRange(0, 0)
  expect(target.restore('context')).toBe(true)
  expect(field.selectionStart).toBe(6)
  expect(field.selectionEnd).toBe(11)
  expect(field.value).toBe('hello world')
  target.dispose()
})
it('refuses a changed field, stale token or a different focused input', () => {
  const target = createEditableMenuTarget(document)
  const first = input(); target.bind('first')
  first.dispatchEvent(new Event('input', { bubbles: true }))
  expect(target.restore('first')).toBe(false)
  const second = input(); target.bind('second')
  expect(target.restore('first')).toBe(false)
  first.focus()
  expect(target.restore('second')).toBe(false)
  second.remove()
  expect(target.restore('second')).toBe(false)
  target.dispose()
})
it('refuses readonly fields and invalidates contenteditable mutations', async () => {
  const target = createEditableMenuTarget(document)
  const field = input(); field.readOnly = true
  field.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
  expect(target.bind('readonly')).toBe(false)
  const editor = document.createElement('div'); editor.setAttribute('contenteditable', 'true'); editor.textContent = 'wrold'
  document.body.append(editor)
  editor.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
  expect(target.bind('editor')).toBe(true)
  editor.textContent = 'changed'
  await Promise.resolve()
  expect(target.restore('editor')).toBe(false)
  target.dispose()
})

it('accepts plain-text and inherited editable hosts without treating read-only chips as editors', () => {
  const target = createEditableMenuTarget(document)
  for (const attribute of ['', 'plaintext-only']) {
    const editor = document.createElement('div'); editor.setAttribute('contenteditable', attribute)
    const span = document.createElement('span'); editor.append(span); document.body.append(editor)
    span.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    expect(target.bind('editable')).toBe(true)
    const chip = document.createElement('span'); chip.setAttribute('contenteditable', 'false'); editor.append(chip)
    chip.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    expect(target.bind('chip')).toBe(false)
    editor.remove()
  }
  target.dispose()
})

it('rejects silent property assignments and same-input caret clicks after opening', () => {
  const target = createEditableMenuTarget(document)
  const field = input(); target.bind('value')
  field.value = 'replacement without input event'
  expect(target.restore('value')).toBe(false)
  field.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })); target.bind('caret')
  field.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
  field.setSelectionRange(1, 1)
  expect(target.restore('caret')).toBe(false)
  target.dispose()
})

it('binds the native post-contextmenu misspelling selection before menu focus', () => {
  const target = createEditableMenuTarget(document)
  const editor = document.createElement('div')
  editor.setAttribute('contenteditable', 'true'); editor.dataset.lexicalEditor = 'true'; editor.tabIndex = 0
  const span = document.createElement('span'); span.dataset.lexicalText = 'true'; span.textContent = 'recieve '
  editor.append(span); document.body.append(editor); editor.focus()
  const text = span.firstChild as Text
  const selection = document.getSelection()!
  const initial = document.createRange(); initial.setStart(text, 8); initial.collapse(true)
  selection.removeAllRanges(); selection.addRange(initial)
  span.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
  // Chromium applies its spelling marker selection after dispatching DOM contextmenu.
  const nativeRange = document.createRange(); nativeRange.setStart(text, 0); nativeRange.setEnd(text, 7)
  selection.removeAllRanges(); selection.addRange(nativeRange)
  expect(target.bind('spelling')).toBe(true)
  const menu = document.createElement('button'); menu.dataset.contextMenu = ''; document.body.append(menu); menu.focus()
  selection.removeAllRanges()
  expect(target.restore('spelling')).toBe(true)
  expect(selection.toString()).toBe('recieve')
  expect(selection.getRangeAt(0).startOffset).toBe(0)
  expect(selection.getRangeAt(0).endOffset).toBe(7)
  target.dispose()
})

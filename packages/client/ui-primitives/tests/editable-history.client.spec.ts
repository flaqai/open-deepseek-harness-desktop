// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { EditableHistoryRegistry } from '../src/editable-history.ts'
afterEach(() => { document.body.replaceChildren() })
function editor() {
  const root = document.createElement('div'); root.setAttribute('contenteditable', 'true')
  const text = document.createElement('span'); root.append(text); document.body.append(root)
  return { root, text }
}
it('reads owner history dynamically and dispatches only available model commands', () => {
  const registry = new EditableHistoryRegistry()
  const { root, text } = editor()
  let state = { canUndo: true, canRedo: false }
  const execute = vi.fn(() => true)
  const dispose = registry.register(root, { read: () => state, execute })
  const history = registry.forTarget(text)
  expect(history?.read()).toEqual(state)
  expect(history?.execute('redo')).toBe(false)
  expect(execute).not.toHaveBeenCalled()
  expect(history?.execute('undo')).toBe(true)
  expect(execute).toHaveBeenCalledExactlyOnceWith('undo')
  state = { canUndo: false, canRedo: true }
  expect(history?.read()).toEqual(state)
  expect(history?.execute('redo')).toBe(true)
  dispose()
  expect(history?.read()).toBeNull()
  expect(history?.execute('redo')).toBe(false)
})
it('invalidates old registrations without allowing their disposer to remove a replacement', () => {
  const registry = new EditableHistoryRegistry()
  const { root } = editor()
  const provider = { read: () => ({ canUndo: true, canRedo: false }), execute: vi.fn(() => true) }
  const firstDispose = registry.register(root, provider)
  const old = registry.forTarget(root)
  const secondDispose = registry.register(root, provider)
  firstDispose(); firstDispose()
  expect(old?.read()).toBeNull()
  expect(old?.execute('undo')).toBe(false)
  expect(registry.forTarget(root)?.read()?.canUndo).toBe(true)
  root.remove()
  expect(registry.forTarget(root)?.read()).toBeNull()
  secondDispose()
})
it('respects read-only ownership and does not cross nested controls or editing hosts', () => {
  const registry = new EditableHistoryRegistry()
  const { root } = editor()
  let locked = false
  const dispose = registry.register(root, { read: () => locked ? null : ({ canUndo: true, canRedo: false }), execute: () => true })
  const history = registry.forTarget(root)
  locked = true
  expect(history?.read()).toBeNull()
  expect(history?.execute('undo')).toBe(false)
  locked = false
  root.setAttribute('contenteditable', 'false')
  expect(history?.read()).toBeNull()
  root.setAttribute('contenteditable', 'true')
  for (const tag of ['input', 'textarea', 'select']) {
    const field = document.createElement(tag); root.append(field)
    expect(registry.forTarget(field)).toBeNull()
  }
  for (const value of ['true', 'false', 'plaintext-only']) {
    const nested = document.createElement('div'); nested.setAttribute('contenteditable', value)
    const inner = document.createElement('span'); nested.append(inner); root.append(nested)
    expect(registry.forTarget(inner)).toBeNull()
  }
  dispose()
})

it('isolates two UI owners and invalidates outstanding access on owner disposal', () => {
  const first = new EditableHistoryRegistry()
  const second = new EditableHistoryRegistry()
  const { root } = editor()
  const provider = { read: () => ({ canUndo: true, canRedo: false }), execute: vi.fn(() => true) }
  first.register(root, provider)
  expect(second.forTarget(root)).toBeNull()
  const handle = first.forTarget(root)
  first.dispose()
  expect(handle?.read()).toBeNull()
  expect(handle?.execute('undo')).toBe(false)
  expect(first.forTarget(root)).toBeNull()
  expect(() => first.register(root, provider)).toThrow(/disposed/u)
  expect(provider.execute).not.toHaveBeenCalled()
})

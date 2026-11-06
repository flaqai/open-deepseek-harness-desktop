import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { EditableHistory } from '@deepseek-ai/dsh-client-ui-primitives'
import { DesktopEditableMenuProjection } from '../src/client/editable-menu-projection.ts'
import type { EditableMenuBridge } from '../src/client/editable-menu.ts'
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { DesktopEditableMenu, editableMenuEntries, type DesktopEditableMenuProps } from '../src/client/DesktopEditableMenu.tsx'
import type { EditableMenuRequest } from '../src/client/editable-menu.ts'
import { en } from '../src/client/editable-menu-locales.ts'
afterEach(() => { cleanup(); vi.restoreAllMocks(); Reflect.deleteProperty(document, 'elementFromPoint') })
const request: EditableMenuRequest = {
  token: 'native-token', x: 20, y: 25, suggestions: ['world'], misspelled: true, spellingAllowed: true,
  spellingAvailable: true, spellingEnabled: true, allowed: ['replace', 'add', 'toggle', 'copy', 'paste', 'selectAll'],
}
function renderMenu(bridge: EditableMenuBridge, resolveHistory: (target: HTMLElement | null) => EditableHistory | null = () => null) {
  const projection = new DesktopEditableMenuProjection(bridge, resolveHistory)
  const stop = projection.start()
  onTestFinished(stop)
  return render(<DesktopEditableMenu {...({
    useEditableMenu: bindSnapshotSelector(projection), close: projection.close, select: projection.select,
    returnFocus: projection.returnFocus, t: (key: keyof typeof en) => en[key],
  } as DesktopEditableMenuProps)} />)
}
it('keeps the spelling checkbox visible without a misspelling and disables unavailable dictionaries', () => {
  const entries = editableMenuEntries({ ...request, misspelled: false, suggestions: [], spellingAvailable: false }, key => en[key])
  expect(entries.find(row => row.id === 'toggle')).toMatchObject({ checked: true, disabled: true })
  expect(entries.find(row => row.id === 'copy')).toMatchObject({ label: 'Copy', disabled: false })
  expect(entries.find(row => row.id === 'undo')).toMatchObject({ disabled: true })
  expect(entries.some(row => row.id === 'add')).toBe(false)
  expect(editableMenuEntries({ ...request, misspelled: false, spellingAllowed: false }, key => en[key])
    .some(row => row.id === 'toggle')).toBe(false)
})
it('renders the shared contextual menu and dispatches one token-bound native replacement', () => {
  let show: ((value: EditableMenuRequest) => void) | undefined
  const execute = vi.fn(() => Promise.resolve())
  const bridge = { subscribe: vi.fn((callback: (value: EditableMenuRequest) => void) => { show = callback; return () => {} }),
    execute, dismiss: vi.fn() }
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => document.body })
  const view = renderMenu(bridge)
  act(() => { show?.(request) })
  expect(view.getByRole('menuitemcheckbox', { name: en.toggle }).getAttribute('aria-checked')).toBe('true')
  expect(view.getByRole('menu').hasAttribute('data-context-menu')).toBe(true)
  fireEvent.click(view.getByRole('menuitem', { name: 'world' }))
  expect(execute).toHaveBeenCalledExactlyOnceWith({ token: 'native-token', command: 'replace', suggestion: 0 })
  expect(view.queryByRole('menu')).toBeNull()
})

it('uses model redo availability and waits for a valid native token before dispatch', async () => {
  let show: ((value: EditableMenuRequest) => void) | undefined
  let acknowledge = (): void => {}
  const claimed = new Promise<void>((resolve) => { acknowledge = resolve })
  const history = { read: () => ({ canUndo: false, canRedo: true }), execute: vi.fn(() => true) }
  const bridge = { subscribe: (callback: (value: EditableMenuRequest) => void) => { show = callback; return () => {} },
    execute: vi.fn(() => claimed), dismiss: vi.fn() }
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => document.body })
  const view = renderMenu(bridge, () => history)
  act(() => { show?.({ ...request, allowed: ['copy', 'editorRedo'], misspelled: false }) })
  const redo = view.getByRole('menuitem', { name: en.redo })
  expect(redo.hasAttribute('disabled')).toBe(false)
  fireEvent.click(redo)
  expect(bridge.execute).toHaveBeenCalledExactlyOnceWith({ token: 'native-token', command: 'editorRedo' })
  expect(history.execute).not.toHaveBeenCalled()
  await act(async () => { acknowledge(); await claimed })
  expect(history.execute).toHaveBeenCalledExactlyOnceWith('redo')
})
it('does not dispatch model history when the native token is stale', async () => {
  let show: ((value: EditableMenuRequest) => void) | undefined
  const history = { read: () => ({ canUndo: true, canRedo: false }), execute: vi.fn(() => true) }
  const bridge = { subscribe: (callback: (value: EditableMenuRequest) => void) => { show = callback; return () => {} },
    execute: vi.fn(() => Promise.reject(new Error('context expired'))), dismiss: vi.fn() }
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => document.body })
  const view = renderMenu(bridge, () => history)
  act(() => { show?.({ ...request, allowed: ['copy', 'editorUndo'], misspelled: false }) })
  await act(async () => { fireEvent.click(view.getByRole('menuitem', { name: en.undo })); await Promise.resolve() })
  expect(history.execute).not.toHaveBeenCalled()
  expect(view.getByRole('alert').textContent).toBe(en.failed)
})

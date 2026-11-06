// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SettingsNavigationEditor } from '../src/client/SettingsNavigationEditor.tsx'
import { resolveSettingsLayout } from '../src/client/section-layout.ts'
import { en } from '../src/client/locales.ts'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'

afterEach(cleanup)
const rows = [{ id: 'general', order: 1, label: 'General' }, { id: 'models', order: 2, label: 'Models' }]
function Fixture({ change = vi.fn() }: { change?: (value: unknown) => void }) {
  const [layout, setLayout] = useState(() => ({ ...resolveSettingsLayout(rows, undefined, []), hiddenIds: ['models'] }))
  return <SettingsNavigationEditor rows={rows} layout={layout} onChange={(operation) => {
    setLayout((current) => { const next = operation(current); change(next); return next })
  }} t={makeTranslate(en)} onClose={() => {}} />
}
function addGroup() {
  fireEvent.click(screen.getByRole('button', { name: en['nav.addGroup'] }))
  fireEvent.change(screen.getByLabelText(en['nav.groupName']), { target: { value: 'Work' } })
  fireEvent.click(screen.getByRole('button', { name: en['nav.save'] }))
}
it('creates and renames groups only after confirming the name', () => {
  const change = vi.fn()
  render(<Fixture change={change} />)
  fireEvent.click(screen.getByRole('button', { name: en['nav.addGroup'] }))
  expect(change).not.toHaveBeenCalled()
  const input = screen.getByLabelText(en['nav.groupName'])
  fireEvent.change(input, { target: { value: 'Work group' } })
  fireEvent.click(screen.getByRole('button', { name: en['nav.save'] }))
  expect(screen.getByRole('group', { name: 'Work group' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en['nav.renameGroup'] }))
  fireEvent.change(screen.getByLabelText(en['nav.groupName']), { target: { value: 'Personal' } })
  fireEvent.click(screen.getByRole('button', { name: en['nav.save'] }))
  expect(screen.getByRole('group', { name: 'Personal' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: en['nav.up'] })).toBeNull()
})
it('requires deletion confirmation', () => {
  render(<Fixture />)
  expect(screen.queryByRole('button', { name: en['nav.deleteGroup'] })).toBeNull()
  addGroup()
  fireEvent.click(screen.getByRole('button', { name: en['nav.deleteGroup'] }))
  expect(screen.getByRole('group', { name: 'Work' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en['nav.cancel'] }))
  expect(screen.queryByRole('alert')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: en['nav.deleteGroup'] }))
  fireEvent.click(screen.getByRole('button', { name: en['nav.confirmDelete'] }))
  expect(screen.queryByRole('group', { name: 'Work' })).toBeNull()
})
it('changes group visibility independently of single entry recovery', () => {
  const change = vi.fn()
  render(<Fixture change={change} />)
  addGroup()
  fireEvent.click(screen.getByRole('switch', { name: en['nav.showGroup'] }))
  expect(change.mock.lastCall?.[0]).toMatchObject({ hiddenIds: ['models'], nodes: [{ kind: 'section' }, { kind: 'section' }, { kind: 'group', hidden: true }] })
  fireEvent.click(screen.getByRole('button', { name: en['nav.restoreEntry'] }))
  expect(change.mock.lastCall?.[0]).toMatchObject({ hiddenIds: [], nodes: [{ kind: 'section' }, { kind: 'section' }, { kind: 'group', hidden: true }] })
})

it('opens the requested rename or deletion action from the group menu', () => {
  const layout = { ...resolveSettingsLayout(rows, undefined, []), nodes: [
    { kind: 'group' as const, id: 'work', label: 'Work', sectionIds: ['models'] },
  ] }
  Element.prototype.scrollIntoView = vi.fn()
  const props = { rows, layout, onChange: vi.fn(), onClose: vi.fn(), t: makeTranslate(en), selectedGroupId: 'work' }
  const view = render(<SettingsNavigationEditor {...props} selectedGroupAction="rename" />)
  expect(screen.getByLabelText<HTMLInputElement>(en['nav.groupName']).value).toBe('Work')
  view.rerender(<SettingsNavigationEditor {...props} selectedGroupAction="delete" />)
  expect(screen.getByRole('alert').textContent).toContain(en['nav.deleteGroupHint'])
})

it('restores panel dimensions without changing navigation preferences', () => {
  const reset = vi.fn()
  const change = vi.fn()
  render(<SettingsNavigationEditor rows={rows} layout={resolveSettingsLayout(rows, undefined, [])}
    onChange={change} onClose={() => {}} onResetSize={reset} t={makeTranslate(en)} />)
  fireEvent.click(screen.getByRole('button', { name: en['nav.resetSize'] }))
  expect(reset).toHaveBeenCalledOnce()
  expect(change).not.toHaveBeenCalled()
})


it('opens a requested new-group name form directly and focuses the name field', () => {
  const change = vi.fn()
  render(<SettingsNavigationEditor rows={rows} layout={resolveSettingsLayout(rows, undefined, [])}
    selectedGroupAction="create" onChange={change} onClose={() => {}} t={makeTranslate(en)} />)
  const field = screen.getByLabelText<HTMLInputElement>(en['nav.groupName'])
  expect(document.activeElement).toBe(field)
  expect(field.value).toBe('')
  expect(change).not.toHaveBeenCalled()
  fireEvent.change(field, { target: { value: 'New context group' } })
  fireEvent.click(screen.getByRole('button', { name: en['nav.save'] }))
  expect(change).toHaveBeenCalledOnce()
})

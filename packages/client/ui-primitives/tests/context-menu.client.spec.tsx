// @vitest-environment jsdom
import { contextMenuHook } from '@deepseek-ai/dsh-client-test-runtime'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Menu, MenuItemButton } from '../src/Menu.tsx'
import { ReferenceChip } from '../src/user-text.tsx'

afterEach(() => { vi.restoreAllMocks(); cleanup(); document.documentElement.style.removeProperty('--dsh-frame-top-clearance') })

it('places pointer menus at the cursor above the frame inset and focuses after portal placement', async () => {
  document.documentElement.style.setProperty('--dsh-frame-top-clearance', '96px')
  const close = vi.fn()
  const view = render(<Menu open portal autoFocus contextual anchor={null} onClose={close}
    getAnchorRect={() => new DOMRect(200, 20, 0, 0)} items={[{ id: 'copy', label: 'Copy' }]} />)
  const menu = view.getByRole('menu')
  expect(menu.style.top).toBe('24px')
  expect(menu.style.getPropertyValue('--dsh-anchored-max-height')).toBe(`${window.innerHeight - 24}px`)
  await waitFor(() => { expect(document.activeElement).toBe(view.getByRole('menuitem')) })
  fireEvent.pointerDown(document.body, { button: 2 })
  expect(close).not.toHaveBeenCalled()
  fireEvent.pointerDown(document.body, { button: 0 })
  expect(close).toHaveBeenCalledOnce()
})

it('groups data icons per divider, preserves component rows, and makes exit frames inert', () => {
  const props = { open: true, portal: true, contextual: true, anchor: null, onClose: vi.fn(),
    items: [{ id: 'first', label: 'First', icon: <svg /> }, { id: 'second', label: 'Second' },
      { type: 'separator' as const, id: 'split' }, { id: 'third', label: 'Third' }] }
  const view = render(<Menu {...props}><MenuItemButton onSelect={() => {}}>Plugin</MenuItemButton></Menu>)
  expect(view.getByRole('menuitem', { name: 'First' }).firstElementChild?.getAttribute('aria-hidden') === 'true').toBe(true)
  expect(view.getByRole('menuitem', { name: 'Second' }).firstElementChild?.getAttribute('aria-hidden') === 'true').toBe(true)
  expect(view.getByRole('menuitem', { name: 'Third' }).firstElementChild?.getAttribute('aria-hidden') === 'true').toBe(false)
  expect(view.getByRole('menuitem', { name: 'Plugin' }).firstElementChild?.getAttribute('aria-hidden') === 'true').toBe(false)
  view.rerender(<Menu {...props} exiting="replace" />)
  expect(view.queryByRole('menu')).toBeNull()
  expect(document.querySelector('[data-menu-phase="replace"]')).not.toBeNull()
})

it('aligns data groups, footers and submenus independently without modifying slot rows', () => {
  const hasColumn = (row: HTMLElement) => row.firstElementChild?.getAttribute('aria-hidden') === 'true'
  const view = render(<Menu open contextual anchor={null} onClose={() => {}}
    items={[{ id: 'plain', label: 'Plain' }, { type: 'separator', id: 'split' },
      { type: 'label', id: 'heading', text: 'Actions' },
      { id: 'icon', label: 'Icon', icon: <svg /> }, { id: 'aligned', label: 'Aligned' },
      { id: 'parent', label: 'Parent', submenu: [
        { id: 'child', label: 'Child' }, { type: 'separator', id: 'subsplit' },
        { id: 'subicon', label: 'Sub icon', icon: <svg /> }, { id: 'subaligned', label: 'Sub aligned' },
      ] }]}
    footer={[{ id: 'footer', label: 'Footer' }, { id: 'footerIcon', label: 'Footer icon', icon: <svg /> }]}
  >
    <MenuItemButton onSelect={() => {}}>Plugin plain</MenuItemButton>
    <MenuItemButton icon={<svg />} onSelect={() => {}}>Plugin icon</MenuItemButton>
  </Menu>)
  expect(hasColumn(view.getByRole('menuitem', { name: 'Plain' }))).toBe(false)
  expect(hasColumn(view.getByRole('menuitem', { name: 'Aligned' }))).toBe(true)
  expect(view.getByRole('menuitem', { name: 'Aligned' }).firstElementChild?.textContent).toBe('')
  expect(hasColumn(view.getByRole('menuitem', { name: 'Footer' }))).toBe(true)
  expect(hasColumn(view.getByRole('menuitem', { name: 'Plugin plain' }))).toBe(false)
  expect(view.getByRole('menuitem', { name: 'Plugin icon' }).querySelector('svg')).not.toBeNull()
  fireEvent.focus(view.getByRole('menuitem', { name: 'Parent' }))
  expect(hasColumn(view.getByRole('menuitem', { name: 'Child' }))).toBe(false)
  expect(hasColumn(view.getByRole('menuitem', { name: 'Sub aligned' }))).toBe(true)
  view.rerender(<Menu open contextual anchor={null} onClose={() => {}}
    items={[{ id: 'icon', label: 'Icon', icon: <svg /> }, { id: 'plain', label: 'Plain' }]}
    footer={[{ id: 'footer', label: 'Footer' }]} />)
  expect(hasColumn(view.getByRole('menuitem', { name: 'Plain' }))).toBe(true)
  expect(hasColumn(view.getByRole('menuitem', { name: 'Footer' }))).toBe(false)
  view.rerender(<Menu open anchor={null} onClose={() => {}}
    items={[{ id: 'icon', label: 'Icon', icon: <svg /> }, { id: 'plain', label: 'Plain' }]}
    footer={[{ id: 'footer', label: 'Footer' }]} />)
  expect(hasColumn(view.getByRole('menuitem', { name: 'Plain' }))).toBe(false)
  expect(hasColumn(view.getByRole('menuitem', { name: 'Footer' }))).toBe(false)
})

it('keeps a menu-only reference focusable without inventing an activation action', () => {
  const open = vi.fn()
  const view = render(<ReferenceChip appearance="file" label="Reference" title="File reference" contextMenuProps={contextMenuHook(open)().getTriggerProps({ kind: 'image', value: { url: 'file' } })} />)
  const chip = view.getByText('Reference')
  expect(chip.tabIndex).toBe(0)
  expect(chip.tagName).toBe('SPAN')
  fireEvent.keyDown(chip, { key: 'F10', shiftKey: true })
  expect(open).toHaveBeenCalledOnce()
  expect(document.activeElement).toBe(chip)
})

it('keeps reference activation separate from selection and repeated clicks', () => {
  const activate = vi.fn()
  const open = vi.fn()
  const view = render(<ReferenceChip appearance="file" label="Reference" title="Reference" onActivate={activate} contextMenuProps={contextMenuHook(open)().getTriggerProps({ kind: 'image', value: { url: 'file' } })} />)
  const chip = view.getByRole('button')
  fireEvent.click(chip, { detail: 2 })
  const selection = document.getSelection()!
  selection.removeAllRanges()
  const range = document.createRange()
  range.selectNodeContents(chip)
  selection.addRange(range)
  try {
    expect(selection.isCollapsed).toBe(false)
    fireEvent.click(chip, { detail: 1 })
    expect(activate).not.toHaveBeenCalled()
    fireEvent.contextMenu(chip)
    expect(open).toHaveBeenCalledOnce()
  } finally { selection.removeAllRanges() }
  fireEvent.click(chip, { detail: 1 })
  expect(activate).toHaveBeenCalledOnce()
})

it('retains the original selected text while activating a context action by pointer', () => {
  const text = document.createElement('p')
  text.textContent = 'Selected original words'
  document.body.appendChild(text)
  const selection = document.getSelection()!
  const range = document.createRange()
  range.selectNodeContents(text)
  selection.removeAllRanges()
  selection.addRange(range)
  const select = vi.fn()
  const view = render(<Menu open contextual preserveSelection ariaLabel="Selected text actions" anchor={null}
    onClose={() => {}} onSelect={select} items={[{ id: 'quote', label: 'Quote' }]} />)
  const row = view.getByRole('menuitem', { name: 'Quote' })
  expect(fireEvent.pointerDown(row)).toBe(false)
  fireEvent.click(row)
  expect(select).toHaveBeenCalledWith('quote')
  expect(selection.toString()).toBe('Selected original words')
  expect(view.getByRole('menu', { name: 'Selected text actions' }).hasAttribute('data-context-menu')).toBe(true)
  selection.removeAllRanges()
  text.remove()
})

it('exposes toggle semantics for data and component rows and walks checked rows with the keyboard', async () => {
  const select = vi.fn()
  const componentSelect = vi.fn()
  const view = render(<Menu open contextual autoFocus anchor={<button>Open</button>} onClose={() => {}} onSelect={select}
    items={[{ id: 'spelling', label: 'Spelling', checked: true }, { id: 'grammar', label: 'Grammar', checked: false }]}>
    <MenuItemButton checked onSelect={componentSelect}>Plugin toggle</MenuItemButton>
  </Menu>)
  const spelling = view.getByRole('menuitemcheckbox', { name: 'Spelling', checked: true })
  const grammar = view.getByRole('menuitemcheckbox', { name: 'Grammar', checked: false })
  expect(spelling.querySelector('svg')).not.toBeNull()
  expect(grammar.querySelector('svg')).toBeNull()
  await waitFor(() => { expect(document.activeElement).toBe(spelling) })
  fireEvent.keyDown(spelling, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(grammar)
  fireEvent.keyDown(grammar, { key: 'Tab' })
  expect(select).toHaveBeenCalledWith('grammar')
  const component = view.getByRole('menuitemcheckbox', { name: 'Plugin toggle', checked: true })
  component.focus()
  fireEvent.keyDown(component, { key: 'Tab' })
  expect(componentSelect).toHaveBeenCalledOnce()
})

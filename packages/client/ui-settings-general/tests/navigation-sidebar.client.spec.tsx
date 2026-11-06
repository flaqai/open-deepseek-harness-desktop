// @vitest-environment jsdom
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { SettingsNavigation } from '../src/client/SettingsNavigation.tsx'
import type { SettingsNavigationLayout, SettingsNavigationNode } from '../src/types.ts'
import { en } from '../src/client/locales.ts'

const initial: SettingsNavigationLayout = { version: 2, hiddenIds: [], nodes: [
  { kind: 'section', id: 'general' }, { kind: 'section', id: 'models' },
  { kind: 'group', id: 'work', label: 'Work', sectionIds: ['plugins', 'approval'], collapsed: false },
] }
const rows = ['general', 'models', 'plugins', 'approval'].map((id, order) => ({ id, label: id, order }))
const selected = vi.fn()
const saved = vi.fn<(layout: SettingsNavigationLayout) => void>()
const animate = vi.fn()
function Fixture({ value = initial, manage = () => {}, organize = () => {} }: { value?: SettingsNavigationLayout; manage?: (id: string, action: 'rename' | 'delete') => void; organize?: (action: 'create' | 'manage') => void }) {
  const [layout, update] = useState(value)
  return <SettingsNavigation rows={rows} layout={layout} active="general" t={makeTranslate(en)} icon={() => null} onSelect={selected} onManage={manage} onOrganize={organize}
    mutate={(operation) => { update((current) => { const next = operation(current); saved(next); return next }) }} />
}
function rect(top: number, height: number, left = 0, width = 180): DOMRect {
  return { x: left, y: top, top, bottom: top + height, left, right: left + width, width, height, toJSON: () => ({}) }
}
function height(element: Element): number {
  if (element.getAttribute('data-navigation-kind') !== 'group') return 40
  return 40 + (element.querySelector('[inert]') ? 0 : element.querySelectorAll('[data-navigation-section]').length * 40)
}
function topOf(element: Element): number {
  const siblings = [...element.parentElement!.children].filter(node => node.hasAttribute('data-navigation-top'))
  return siblings.slice(0, siblings.indexOf(element)).reduce((total, node) => total + height(node) + 8, 0)
}
beforeEach(() => {
  vi.useFakeTimers(); saved.mockClear(); selected.mockClear(); animate.mockClear()
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  Element.prototype.getAnimations = () => []
  Element.prototype.animate = animate
  vi.stubGlobal('PointerEvent', MouseEvent)
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  Element.prototype.scrollIntoView = vi.fn()
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function(this: Element) {
    const top = this.closest('[data-navigation-top]')
    if (!top) return rect(0, 500)
    const y = topOf(top)
    if (this.hasAttribute('data-navigation-heading')) return rect(y, 40)
    if (this === top) return rect(y, height(top))
    const row = this.closest('[data-navigation-section]')
    const index = [...top.querySelectorAll('[data-navigation-section]')].indexOf(row!)
    return rect(y + 40 + index * 40, 40, 12, 164)
  })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
function start(name = 'general', y = 20) {
  fireEvent.pointerDown(name === 'Work' ? screen.getByText(name, { selector: 'button' }) : screen.getByRole('button', { name }), { button: 0, clientX: 30, clientY: y })
  act(() => { vi.advanceTimersByTime(200) })
}
function track(y: number, x = 30) { fireEvent.pointerMove(window, { clientX: x, clientY: y }) }
function drop() { fireEvent.pointerUp(window); act(() => { vi.advanceTimersByTime(180) }) }
function group(layout = saved.mock.lastCall?.[0]) {
  return layout?.nodes.find((node): node is Extract<SettingsNavigationNode, { kind: 'group' }> => node.kind === 'group' && node.id === 'work')
}
function ids(layout = saved.mock.lastCall?.[0]) { return layout?.nodes.map(node => node.id) }
function key(name: string) { fireEvent.keyDown(window, { key: name }) }
function collapsed(): SettingsNavigationLayout { return { ...initial, nodes: initial.nodes.map(node => node.kind === 'group' ? { ...node, collapsed: true } : node) } }

it('thickens the scrollbar only while the pointer is in its column, independently of scrolling', () => {
  const { container } = render(<Fixture />)
  const rail = container.firstElementChild as HTMLElement
  vi.spyOn(rail, 'getBoundingClientRect').mockReturnValue(rect(0, 200, 0, 180))
  Object.defineProperties(rail, { scrollHeight: { value: 500 }, clientHeight: { value: 200 } })
  fireEvent.pointerMove(rail, { clientX: 40, pointerType: 'mouse' })
  fireEvent.wheel(rail)
  fireEvent.scroll(rail)
  expect(rail.getAttribute('data-scrollbar-hovered')).toBe('false')
  fireEvent.pointerMove(rail, { clientX: 175, pointerType: 'mouse' })
  expect(rail.getAttribute('data-scrollbar-hovered')).toBe('true')
  fireEvent.wheel(rail)
  fireEvent.scroll(rail)
  expect(rail.getAttribute('data-scrollbar-hovered')).toBe('true')
  fireEvent.pointerMove(rail, { clientX: 40, pointerType: 'mouse' })
  expect(rail.getAttribute('data-scrollbar-hovered')).toBe('false')
  fireEvent.pointerEnter(rail, { clientX: 175, pointerType: 'mouse' })
  fireEvent.pointerLeave(rail)
  expect(rail.getAttribute('data-scrollbar-hovered')).toBe('false')
})

it('opens pages on short clicks but suppresses clicks following a long press', () => {
  render(<Fixture />)
  const page = screen.getByRole('button', { name: 'general' })
  fireEvent.pointerDown(page, { button: 0 }); fireEvent.pointerUp(window); fireEvent.click(page)
  expect(selected).toHaveBeenCalledOnce()
  start(); fireEvent.click(page)
  expect(selected).toHaveBeenCalledOnce()
})
it('activates at 200ms and reserves the original row until settlement', () => {
  const { container } = render(<Fixture />)
  fireEvent.pointerDown(screen.getByRole('button', { name: 'general' }), { button: 0 })
  act(() => { vi.advanceTimersByTime(199) })
  expect(document.querySelector('[data-navigation-ghost]')).toBeNull()
  act(() => { vi.advanceTimersByTime(1) })
  expect(container.querySelector('[data-navigation-section="general"]')?.getAttribute('data-placeholder')).toBe('true')
  track(75); fireEvent.pointerUp(window)
  expect(saved).not.toHaveBeenCalled()
  expect(document.querySelector('[data-navigation-ghost]')?.getAttribute('data-phase')).toBe('settling')
  act(() => { vi.advanceTimersByTime(180) })
  expect(ids()).toEqual(['models', 'general', 'work'])
  expect(document.querySelector('[data-navigation-ghost]')).toBeNull()
})
it.each(['movement', 'cancel', 'release'])('cancels pending activation on %s', (reason) => {
  render(<Fixture />)
  fireEvent.pointerDown(screen.getByRole('button', { name: 'general' }), { button: 0, clientX: 10, clientY: 10 })
  if (reason === 'movement') track(10, 19)
  else if (reason === 'cancel') fireEvent.pointerCancel(window)
  else fireEvent.pointerUp(window)
  act(() => { vi.advanceTimersByTime(200) })
  expect(document.querySelector('[data-navigation-ghost]')).toBeNull(); expect(saved).not.toHaveBeenCalled()
})
it.each([false, true])('highlights a group header and inserts first while retaining collapsed=%s', (isCollapsed) => {
  const { container } = render(<Fixture value={isCollapsed ? collapsed() : initial} />)
  start(); track(110)
  expect(container.querySelector('[data-navigation-container="work"]')?.getAttribute('data-drop-into')).toBe('true')
  expect(container.querySelector('[data-navigation-drop-indicator]')).toBeNull()
  expect(screen.getByRole('status').textContent).toContain('Work')
  drop()
  expect(group()).toMatchObject({ sectionIds: ['general', 'plugins', 'approval'], collapsed: isCollapsed })
  expect(container.querySelector('[data-drop-into="true"]')).toBeNull()
})
it('accepts a header drop on an empty group', () => {
  render(<Fixture value={{ ...initial, nodes: initial.nodes.map(node => node.kind === 'group' ? { ...node, sectionIds: [] } : node) }} />)
  start(); track(110); drop()
  expect(group()).toMatchObject({ sectionIds: ['general'] })
})
it('shows only a group-local insertion line when placing between members', () => {
  const { container } = render(<Fixture />)
  start(); track(170)
  const line = container.querySelector('[data-navigation-drop-indicator]')!
  expect(line.getAttribute('data-scope')).toBe('inside')
  expect(line.closest('[data-navigation-container]')?.getAttribute('data-navigation-container')).toBe('work')
  expect(container.querySelector('[data-drop-into="true"]')).toBeNull()
  drop(); expect(group()).toMatchObject({ sectionIds: ['plugins', 'general', 'approval'] })
})
it('reorders within a group using the same insertion feedback', () => {
  render(<Fixture />)
  start('plugins', 150); track(210); drop()
  expect(group()).toMatchObject({ sectionIds: ['approval', 'plugins'] })
})
it('detaches a member into the gap above its group', () => {
  const { container } = render(<Fixture />)
  start('plugins', 150); track(92)
  const line = container.querySelector('[data-navigation-drop-indicator]')!
  expect(line.getAttribute('data-scope')).toBe('standalone')
  expect(line.getAttribute('data-edge')).toBeNull()
  expect(line.parentElement?.getAttribute('data-navigation-top')).toBe('work')
  drop(); expect(ids()).toEqual(['general', 'models', 'plugins', 'work'])
  expect(group()).toMatchObject({ sectionIds: ['approval'] })
})
it.each([[-5, ['plugins', 'general', 'models', 'work']], [260, ['general', 'models', 'work', 'plugins']]])('detaches to list edge %s', (y, expected) => {
  render(<Fixture />); start('plugins', 150); track(y); drop(); expect(ids()).toEqual(expected)
})
it('allows an independent item between two group cards', () => {
  render(<Fixture value={{ ...initial, nodes: [...initial.nodes, { kind: 'group', id: 'home', label: 'Home', sectionIds: [] }] }} />)
  start(); track(220); drop(); expect(ids()).toEqual(['models', 'work', 'general', 'home'])
})
it('moves a whole group across independent items without nesting', () => {
  const { container } = render(<Fixture />)
  start('Work', 110); track(0)
  expect(container.querySelector('[data-navigation-drop-indicator]')?.getAttribute('data-scope')).toBe('group')
  expect(container.querySelector('[data-drop-into="true"]')).toBeNull()
  drop(); expect(ids()).toEqual(['work', 'general', 'models']); expect(group()).toMatchObject({ sectionIds: ['plugins', 'approval'] })
})
it('cancels without saving or leaking Escape to the modal', () => {
  const { container } = render(<Fixture />); const close = vi.fn(); document.addEventListener('keydown', close)
  start(); track(110); key('Escape'); drop()
  expect(saved).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled()
  expect(ids(initial)).toEqual(['general', 'models', 'work'])
  expect(container.querySelector('[data-drop-into="true"], [data-navigation-drop-indicator]')).toBeNull()
  document.removeEventListener('keydown', close)
})
it('does not commit a previous valid target after leaving the rail horizontally', () => {
  render(<Fixture />); start(); track(110); track(110, 500); drop(); expect(saved).not.toHaveBeenCalled()
})
it('preserves reduced motion by committing without delayed settlement', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  render(<Fixture />); start(); track(75); fireEvent.pointerUp(window)
  expect(saved).toHaveBeenCalledOnce(); expect(animate).not.toHaveBeenCalled()
})
it('keeps a stable target under a stationary pointer during preview displacement', () => {
  render(<Fixture />); start(); track(75)
  for (let index = 0; index < 12; index++) track(75)
  drop(); expect(ids()).toEqual(['models', 'general', 'work'])
  expect(animate).toHaveBeenCalled()
})
it('supports keyboard independent ordering, group entry, detachment and cancellation', () => {
  const { container } = render(<Fixture />)
  fireEvent.keyDown(screen.getByRole('button', { name: 'general' }), { key: ' ' })
  key('ArrowDown'); expect(saved).not.toHaveBeenCalled(); key('Enter')
  expect(ids()).toEqual(['models', 'general', 'work'])
  fireEvent.keyDown(screen.getByRole('button', { name: 'general' }), { key: ' ' })
  key('ArrowRight'); expect(container.querySelector('[data-drop-into="true"]')).not.toBeNull(); key('Enter')
  expect(group()).toMatchObject({ sectionIds: ['general', 'plugins', 'approval'] })
  fireEvent.keyDown(screen.getByRole('button', { name: 'general' }), { key: ' ' })
  key('ArrowLeft'); key('Enter'); expect(ids()).toEqual(['models', 'general', 'work'])
  fireEvent.keyDown(screen.getByRole('button', { name: 'general' }), { key: ' ' })
  key('ArrowRight'); key('Escape'); expect(saved).toHaveBeenCalledTimes(3)
})
it('restores keyboard focus to the header after entering a collapsed group', () => {
  render(<Fixture value={collapsed()} />)
  fireEvent.keyDown(screen.getByRole('button', { name: 'general' }), { key: ' ' }); key('ArrowRight'); key('Enter')
  expect(document.activeElement).toBe(screen.getByText('Work', { selector: 'button' }))
})
it('keeps collapsed members inert and toggles the animated wrapper without removing content', () => {
  const { container } = render(<Fixture />)
  const member = container.querySelector('[data-navigation-section="plugins"]')!
  fireEvent.click(screen.getByRole('button', { name: 'Work', expanded: true }))
  expect(member.closest('[data-collapsed="true"][inert]')).not.toBeNull()
  expect(screen.queryByRole('button', { name: 'plugins' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Work', expanded: false }))
  expect(container.querySelector('[data-navigation-section="plugins"]')).toBe(member)
  expect(member.closest('[inert]')).toBeNull()
})
it('keeps long group labels as complete text beside separate menu and collapse controls', () => {
  const name = '特别长的分组名字'.repeat(4)
  render(<Fixture value={{ ...initial, nodes: [{ kind: 'group', id: 'work', label: name, sectionIds: [] }] }} />)
  expect(screen.getByText(name, { selector: 'button' }).textContent).toBe(name)
  expect(screen.getByRole('button', { name: `${en['nav.organize']}: ${name}` })).toBeDefined()
  expect(screen.getByRole('button', { name, expanded: true })).toBeDefined()
})
it('continues scrolling near a viewport edge and cancels its frame on completion', () => {
  const { container } = render(<Fixture />); start(); track(495)
  const tick = vi.mocked(requestAnimationFrame).mock.calls[0]![0]
  act(() => { tick(0) }); expect(container.firstElementChild!.scrollTop).toBeGreaterThan(0)
  drop(); expect(cancelAnimationFrame).toHaveBeenCalled()
})
it('offers group management and explicit detachment without organizer ordering commands', () => {
  const manage = vi.fn(); render(<Fixture manage={manage} />)
  fireEvent.click(screen.getByRole('button', { name: `${en['nav.organize']}: Work` }))
  fireEvent.click(screen.getByRole('menuitem', { name: en['nav.renameGroup'] })); expect(manage).toHaveBeenCalledWith('work', 'rename')
  fireEvent.click(screen.getByRole('button', { name: `${en['nav.organize']}: plugins` }))
  fireEvent.click(screen.getByRole('menuitem', { name: en['nav.dropStandalone'] }))
  expect(ids()).toEqual(['general', 'models', 'work', 'plugins'])
})

it('uses a visible header target when moving upward into a collapsed group', () => {
  const base = collapsed()
  const { container } = render(<Fixture value={{ ...base, nodes: [...base.nodes.filter(node => node.id !== 'general'), { kind: 'section', id: 'general' }] }} />)
  fireEvent.keyDown(screen.getByRole('button', { name: 'general' }), { key: ' ' })
  key('ArrowUp')
  expect(container.querySelector('[data-drop-into="true"]')?.getAttribute('data-navigation-container')).toBe('work')
  expect(container.querySelector('[data-navigation-drop-indicator]')).toBeNull()
  key('Enter'); expect(group()).toMatchObject({ sectionIds: ['general', 'plugins', 'approval'], collapsed: true })
})
it('places initial modal focus on a collapsed active member group header', () => {
  const { container } = render(<Fixture value={{ ...initial, nodes: [{ kind: 'group', id: 'work', label: 'Work', sectionIds: ['general'], collapsed: true }] }} />)
  expect(container.querySelector('[data-modal-autofocus]')?.textContent).toBe('Work')
})

it('skips hidden and temporarily absent top-level entries during keyboard moves', () => {
  render(<Fixture value={{ version: 2, hiddenIds: ['models'], nodes: [
    { kind: 'section', id: 'general' }, { kind: 'section', id: 'models' },
    { kind: 'section', id: 'missing' }, { kind: 'section', id: 'plugins' },
  ] }} />)
  fireEvent.keyDown(screen.getByRole('button', { name: 'general' }), { key: ' ' })
  key('ArrowDown'); key('Enter')
  expect(ids()).toEqual(['models', 'missing', 'plugins', 'general'])
})

it('keeps the visible header and hit region aligned while entering, leaving and returning', () => {
  const { container } = render(<Fixture />)
  start()
  const header = () => container.querySelector('[data-navigation-heading]')!.getBoundingClientRect()
  const originalTop = header().top
  track(header().top + 20)
  expect(header().top).toBe(originalTop)
  expect(container.querySelector('[data-drop-into="true"]')).not.toBeNull()
  track(header().top - 4)
  expect(container.querySelector('[data-drop-into="true"]')).toBeNull()
  expect(container.querySelector('[data-navigation-drop-indicator]')?.getAttribute('data-scope')).toBe('standalone')
  track(header().top + 20)
  expect(container.querySelector('[data-drop-into="true"]')).not.toBeNull()
  expect(container.querySelector('[data-navigation-drop-indicator]')).toBeNull()
  drop(); expect(group()).toMatchObject({ sectionIds: ['general', 'plugins', 'approval'] })
})


it('right-clicks a nested settings item without selecting it and uses the shared contextual menu', () => {
  render(<Fixture />)
  const page = screen.getByRole('button', { name: 'plugins' })
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 80, clientY: 140 })
  fireEvent(page.querySelector('span:last-child')!, event)
  expect(event.defaultPrevented).toBe(true)
  expect(selected).not.toHaveBeenCalled()
  expect(screen.getAllByRole('menu')).toHaveLength(1)
  expect(screen.getByRole('menu').hasAttribute('data-context-menu')).toBe(true)
  fireEvent.click(screen.getByRole('menuitem', { name: en['nav.hideItem'] }))
  expect(saved.mock.lastCall?.[0].hiddenIds).toEqual(['plugins'])
  expect(group()?.sectionIds).toEqual(['plugins', 'approval'])
})

it('reuses group actions and exposes a recovery organizer on the empty navigation rail', () => {
  const organize = vi.fn(), manage = vi.fn()
  const { container } = render(<Fixture organize={organize} manage={manage} />)
  fireEvent.contextMenu(screen.getByText('Work', { selector: 'button' }), { clientX: 50, clientY: 110 })
  fireEvent.click(screen.getByRole('menuitem', { name: en['nav.renameGroup'] }))
  expect(manage).toHaveBeenCalledWith('work', 'rename')
  fireEvent.contextMenu(screen.getByText('Work', { selector: 'button' }), { clientX: 50, clientY: 110 })
  fireEvent.click(screen.getByRole('menuitem', { name: en['nav.hideGroup'] }))
  expect(group()?.hidden).toBe(true)
  fireEvent.contextMenu(container.firstElementChild!, { clientX: 170, clientY: 300 })
  expect(screen.queryByRole('menuitem', { name: en['nav.hideItem'] })).toBeNull()
  fireEvent.click(screen.getByRole('menuitem', { name: en['nav.organize'] }))
  expect(organize).toHaveBeenCalledWith('manage')
  expect(group()?.sectionIds).toEqual(['plugins', 'approval'])
})

it.each([{ key: 'F10', shiftKey: true }, { key: 'ContextMenu' }])('opens keyboard context menus and restores focus on Escape: $key', (gesture) => {
  render(<Fixture />)
  const page = screen.getByRole('button', { name: 'general' })
  page.focus()
  fireEvent.keyDown(page, gesture)
  expect(screen.getByRole('menuitem', { name: en['nav.hideItem'] })).toBeTruthy()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('menu')).toBeNull()
  expect(document.activeElement).toBe(page)
  expect(saved).not.toHaveBeenCalled()
})

it('cancels an armed hold before opening a context menu and refuses menus during an active drag', () => {
  render(<Fixture />)
  const page = screen.getByRole('button', { name: 'general' })
  fireEvent.pointerDown(page, { button: 0, clientX: 20, clientY: 20 })
  fireEvent.contextMenu(page, { clientX: 20, clientY: 20 })
  act(() => { vi.advanceTimersByTime(200) })
  expect(document.querySelector('[data-navigation-ghost]')).toBeNull()
  fireEvent.keyDown(document, { key: 'Escape' })
  start()
  fireEvent.contextMenu(page, { clientX: 20, clientY: 20 })
  expect(screen.queryByRole('menu')).toBeNull()
  expect(document.querySelector('[data-navigation-ghost]')).not.toBeNull()
  key('Escape')
  expect(saved).not.toHaveBeenCalled()
})

it('offers creation from both the item menu and navigation whitespace', () => {
  const organize = vi.fn()
  const { container } = render(<Fixture organize={organize} />)
  fireEvent.contextMenu(screen.getByRole('button', { name: 'general' }))
  fireEvent.click(screen.getByRole('menuitem', { name: en['nav.addGroup'] }))
  fireEvent.contextMenu(container.firstElementChild!, { clientX: 170, clientY: 300 })
  fireEvent.click(screen.getByRole('menuitem', { name: en['nav.addGroup'] }))
  expect(organize.mock.calls).toEqual([['create'], ['create']])
  expect(saved).not.toHaveBeenCalled()
})

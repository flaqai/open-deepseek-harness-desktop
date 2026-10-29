// @vitest-environment jsdom
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { SettingsNavigation } from '../src/client/SettingsNavigation.tsx'
import type { SettingsNavigationLayout } from '../src/types.ts'
import { en } from '../src/client/locales.ts'

const initial: SettingsNavigationLayout = { version: 1, hiddenIds: [], groups: [
  { id: 'ungrouped', label: '', sectionIds: ['general', 'models'] },
  { id: 'work', label: 'Work', sectionIds: [], collapsed: true },
] }
const selected = vi.fn()
const animate = vi.fn()
const saved = vi.fn<(layout: SettingsNavigationLayout) => void>()
const rows = [{ id: 'general', label: 'General', order: 1 }, { id: 'models', label: 'Models', order: 2 }]
function Fixture({ manage = () => {} }: { manage?: (id: string, action: 'rename' | 'delete') => void }) {
  const [layout, update] = useState(initial)
  return <SettingsNavigation rows={rows} layout={layout} active="general" t={makeTranslate(en)} icon={() => null} onSelect={selected} onManage={manage}
    mutate={(operation) => { update((current) => { const next = operation(current); saved(next); return next }) }} />
}
beforeEach(() => {
  vi.useFakeTimers()
  saved.mockClear()
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  Element.prototype.getAnimations = () => []
  animate.mockClear()
  Element.prototype.animate = animate
  selected.mockClear()
  vi.stubGlobal('PointerEvent', MouseEvent)
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })
it('previews keyboard row movement and commits only with Enter', () => {
  render(<Fixture />)
  const general = screen.getByRole('button', { name: 'General' })
  fireEvent.keyDown(general, { key: ' ' })
  fireEvent.keyDown(general, { key: 'ArrowDown' })
  expect(saved).not.toHaveBeenCalled()
  fireEvent.keyDown(window, { key: 'Enter' })
  act(() => { vi.advanceTimersByTime(180) })
  expect(saved.mock.lastCall?.[0].groups[0]?.sectionIds).toEqual(['models', 'general'])
})
it('offers menus without opening the organizer and omits ordering commands', () => {
  render(<Fixture />)
  fireEvent.click(screen.getByRole('button', { name: `${en['nav.organize']}: Work` }))
  expect(screen.queryByRole('menuitem', { name: en['nav.up'] })).toBeNull()
  expect(screen.queryByRole('menuitem', { name: en['nav.down'] })).toBeNull()
})
it('short clicks open pages and a long press suppresses the subsequent click', () => {
  render(<Fixture />)
  const page = screen.getByRole('button', { name: 'General' })
  fireEvent.pointerDown(page, { button: 0 })
  fireEvent.pointerUp(window)
  fireEvent.click(page)
  expect(selected).toHaveBeenCalledTimes(1)
  fireEvent.pointerDown(page, { button: 0 })
  act(() => { vi.advanceTimersByTime(350) })
  fireEvent.pointerUp(window)
  fireEvent.click(page)
  expect(selected).toHaveBeenCalledTimes(1)
})
it.each(['movement', 'cancel', 'release'])('cancels pending activation on %s', (reason) => {
  render(<Fixture />)
  fireEvent.pointerDown(screen.getByRole('button', { name: 'General' }), { button: 0, clientX: 10, clientY: 10 })
  if (reason === 'movement') fireEvent.pointerMove(window, { clientX: 19, clientY: 10 })
  else if (reason === 'cancel') fireEvent.pointerCancel(window)
  else fireEvent.pointerUp(window)
  act(() => { vi.advanceTimersByTime(350) })
  expect(document.querySelector('[data-navigation-ghost]')).toBeNull()
  expect(saved).not.toHaveBeenCalled()
})
it('opens the selected group rename or deletion action from the left menu', () => {
  const manage = vi.fn()
  render(<Fixture manage={manage} />)
  fireEvent.click(screen.getByRole('button', { name: `${en['nav.organize']}: Work` }))
  fireEvent.click(screen.getByRole('menuitem', { name: en['nav.renameGroup'] }))
  expect(manage).toHaveBeenLastCalledWith('work', 'rename')
  fireEvent.click(screen.getByRole('button', { name: `${en['nav.organize']}: Work` }))
  fireEvent.click(screen.getByRole('menuitem', { name: en['nav.deleteGroup'] }))
  expect(manage).toHaveBeenLastCalledWith('work', 'delete')
})
it('drops a row onto a collapsed empty group without expanding it', () => {
  const { container } = render(<Fixture />)
  const destination = container.querySelector('[data-navigation-group="work"]')!
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => destination })
  const handle = screen.getByRole('button', { name: 'General' })
  fireEvent.pointerDown(handle, { button: 0, pointerId: 1 })
  act(() => { vi.advanceTimersByTime(350) })
  fireEvent.pointerMove(window, { clientX: 20, clientY: 20 })
  fireEvent.pointerUp(window)
  act(() => { vi.advanceTimersByTime(180) })
  expect(saved.mock.lastCall?.[0].groups[1]).toMatchObject({ sectionIds: ['general'], collapsed: true })
})
it('places a row after the pointer target within the same group', () => {
  const { container } = render(<Fixture />)
  const destination = container.querySelector('[data-navigation-section="models"]')!
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => destination })
  const handle = screen.getByRole('button', { name: 'General' })
  fireEvent.pointerDown(handle, { button: 0, pointerId: 1 })
  act(() => { vi.advanceTimersByTime(350) })
  fireEvent.pointerMove(window, { clientX: 20, clientY: 20 })
  fireEvent.pointerUp(window)
  act(() => { vi.advanceTimersByTime(180) })
  expect(saved.mock.lastCall?.[0].groups[0]?.sectionIds).toEqual(['models', 'general'])
})
it('cancels drag with Escape without persisting or closing the modal', () => {
  render(<Fixture />)
  const handle = screen.getByRole('button', { name: 'General' })
  const close = vi.fn()
  document.addEventListener('keydown', close)
  fireEvent.pointerDown(handle, { button: 0, pointerId: 1 })
  act(() => { vi.advanceTimersByTime(350) })
  fireEvent.keyDown(window, { key: 'Escape' })
  fireEvent.pointerUp(window)
  act(() => { vi.advanceTimersByTime(180) })
  expect(saved).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
  document.removeEventListener('keydown', close)
})
it('moves a complete group and continuously scrolls while holding near an edge', () => {
  const { container } = render(<Fixture />)
  const destination = container.querySelector('[data-navigation-group="ungrouped"]')!
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => destination })
  const handle = screen.getByText('Work', { selector: 'button' })
  fireEvent.pointerDown(handle, { button: 0, pointerId: 1 })
  act(() => { vi.advanceTimersByTime(350) })
  fireEvent.pointerMove(window, { clientX: 20, clientY: 0 })
  const tick = vi.mocked(requestAnimationFrame).mock.calls[0]?.[0]
  const rail = container.firstElementChild as HTMLElement
  tick?.(0)
  expect(rail.scrollTop).toBe(-8)
  tick?.(16)
  expect(rail.scrollTop).toBe(-16)
  const changedTarget = container.querySelector('[data-navigation-group="work"]')!
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => changedTarget })
  act(() => { tick?.(32) })
  expect(saved).not.toHaveBeenCalled()
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => destination })
  act(() => { tick?.(48) })
  fireEvent.pointerUp(window)
  act(() => { vi.advanceTimersByTime(180) })
  expect(saved.mock.lastCall?.[0].groups.map((group: { id: string }) => group.id)).toEqual(['work', 'ungrouped'])
  expect(cancelAnimationFrame).toHaveBeenCalled()
})
it('keeps a floating placeholder and settles before saving the new order', () => {
  const { container } = render(<Fixture />)
  const models = container.querySelector('[data-navigation-section="models"]')!
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => models })
  fireEvent.pointerDown(screen.getByRole('button', { name: 'General' }), { button: 0 })
  act(() => { vi.advanceTimersByTime(349) })
  expect(document.querySelector('[data-navigation-ghost]')).toBeNull()
  act(() => { vi.advanceTimersByTime(1) })
  expect(document.querySelector('[data-navigation-ghost]')?.getAttribute('data-phase')).toBe('dragging')
  expect(container.querySelector('[data-navigation-section="general"]')?.getAttribute('data-placeholder')).toBe('true')
  fireEvent.pointerMove(window, { clientX: 20, clientY: 20 })
  fireEvent.pointerUp(window)
  expect(document.querySelector('[data-navigation-ghost]')?.getAttribute('data-phase')).toBe('settling')
  expect(saved).not.toHaveBeenCalled()
  act(() => { vi.advanceTimersByTime(180) })
  expect(saved.mock.lastCall?.[0].groups[0]?.sectionIds).toEqual(['models', 'general'])
  expect(document.querySelector('[data-navigation-ghost]')).toBeNull()
})
it('respects reduced motion and commits without a settlement delay', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  const { container } = render(<Fixture />)
  const models = container.querySelector('[data-navigation-section="models"]')!
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => models })
  fireEvent.pointerDown(screen.getByRole('button', { name: 'General' }), { button: 0 })
  act(() => { vi.advanceTimersByTime(350) })
  fireEvent.pointerMove(window, { clientX: 20, clientY: 20 })
  fireEvent.pointerUp(window)
  expect(saved).toHaveBeenCalledTimes(1)
  expect(animate).not.toHaveBeenCalled()
  expect(document.querySelector('[data-navigation-ghost]')).toBeNull()
})
it('animates neighboring rows into the reserved slot when the preview moves', () => {
  const geometry = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function(this: Element) {
    const rows = [...document.querySelectorAll('[data-navigation-section]')]
    const index = rows.indexOf(this)
    return { x: 0, y: index * 40, top: index * 40, bottom: index * 40 + 40,
      left: 0, right: 160, width: 160, height: 40, toJSON: () => ({}) }
  })
  try {
    const { container } = render(<Fixture />)
    const models = container.querySelector('[data-navigation-section="models"]')!
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => models })
    fireEvent.pointerDown(screen.getByRole('button', { name: 'General' }), { button: 0 })
    act(() => { vi.advanceTimersByTime(350) })
    fireEvent.pointerMove(window, { clientX: 20, clientY: 75 })
    expect(animate).toHaveBeenCalledWith(
      [{ transform: 'translateY(40px)' }, { transform: 'translateY(0)' }],
      { duration: 180, easing: 'cubic-bezier(0.2,0,0,1)' },
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(saved).not.toHaveBeenCalled()
    expect([...container.querySelectorAll('[data-navigation-section]')].map(row => row.getAttribute('data-navigation-section')))
      .toEqual(['general', 'models'])
  } finally { geometry.mockRestore() }
})
it('restores keyboard focus after cross-group moves and cancellation', () => {
  render(<Fixture />)
  fireEvent.keyDown(screen.getByRole('button', { name: 'General' }), { key: ' ' })
  fireEvent.keyDown(window, { key: 'ArrowRight' })
  fireEvent.keyDown(window, { key: 'Enter' })
  expect(saved.mock.lastCall?.[0].groups[1]?.sectionIds).toEqual(['general'])
  expect(document.activeElement).toBe(screen.getByText('Work', { selector: 'button' }))
  fireEvent.keyDown(document.activeElement!, { key: ' ' })
  fireEvent.keyDown(window, { key: 'ArrowUp' })
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(saved).toHaveBeenCalledTimes(1)
  expect(document.activeElement).toBe(screen.getByText('Work', { selector: 'button' }))
  fireEvent.keyDown(document.activeElement!, { key: ' ' })
  fireEvent.keyDown(window, { key: 'ArrowUp' })
  fireEvent.keyDown(window, { key: 'Enter' })
  expect(saved.mock.lastCall?.[0].groups[0]?.id).toBe('work')
})
it('keeps the dragged row size and horizontal position inside the sidebar', () => {
  const geometry = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function(this: Element) {
    const height = this.hasAttribute('data-navigation-section') ? 40 : 400
    return { x: 10, y: 0, top: 0, bottom: height, left: 10, right: 170, width: 160, height, toJSON: () => ({}) }
  })
  try {
    render(<Fixture />)
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null })
    fireEvent.pointerDown(screen.getByRole('button', { name: 'General' }), { button: 0, clientX: 30, clientY: 20 })
    act(() => { vi.advanceTimersByTime(350) })
    fireEvent.pointerMove(window, { clientX: 500, clientY: 700 })
    const ghost = document.querySelector<HTMLElement>('[data-navigation-ghost]')!
    expect(ghost.style.left).toBe('0px')
    expect(ghost.style.top).toBe('360px')
    expect(ghost.style.width).toBe('160px')
    expect(ghost.style.height).toBe('40px')
    fireEvent.pointerCancel(window)
  } finally { geometry.mockRestore() }
})
it('does not reverse the insertion target when neighboring animation crosses a stationary pointer', () => {
  let animated = false
  const geometry = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function(this: Element) {
    const isRow = this.hasAttribute('data-navigation-section')
    const top = this.getAttribute('data-navigation-section') === 'models' ? (animated ? 0 : 40) : 0
    const height = isRow ? 40 : 160
    return { x: 0, y: top, top, bottom: top + height, left: 0, right: 160, width: 160, height, toJSON: () => ({}) }
  })
  try {
    const { container } = render(<Fixture />)
    const models = container.querySelector('[data-navigation-section="models"]')!
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => models })
    fireEvent.pointerDown(screen.getByRole('button', { name: 'General' }), { button: 0, clientX: 20, clientY: 20 })
    act(() => { vi.advanceTimersByTime(350) })
    fireEvent.pointerMove(window, { clientX: 20, clientY: 50 })
    animated = true
    for (let index = 0; index < 12; index++) fireEvent.pointerMove(window, { clientX: 20, clientY: 50 })
    fireEvent.pointerUp(window)
    act(() => { vi.advanceTimersByTime(180) })
    expect(saved).not.toHaveBeenCalled()
  } finally { geometry.mockRestore() }
})
it('keeps the final slot stable after rapidly crossing several rows in both directions', () => {
  const entries = Array.from({ length: 6 }, (_, index) => ({ id: String(index), label: `Page ${index}`, order: index }))
  const layout: SettingsNavigationLayout = { version: 1, hiddenIds: [],
    groups: [{ id: 'ungrouped', label: '', sectionIds: entries.map(row => row.id) }] }
  let moving = false
  const geometry = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function(this: Element) {
    const id = this.getAttribute('data-navigation-section')
    const top = id === null ? 0 : Number(id) * 40 + (moving ? -35 : 0)
    const height = id === null ? 400 : 40
    return { x: 0, y: top, top, bottom: top + height, left: 0, right: 160, width: 160, height, toJSON: () => ({}) }
  })
  try {
    render(<SettingsNavigation rows={entries} layout={layout} active="0" t={makeTranslate(en)} icon={() => null}
      onSelect={selected} onManage={() => {}} mutate={(operation) => { saved(operation(layout)) }} />)
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Page 0' }), { button: 0, clientX: 20, clientY: 20 })
    act(() => { vi.advanceTimersByTime(350) })
    moving = true
    for (const y of [210, 90, 230, 50, 170, 170, 170]) fireEvent.pointerMove(window, { clientX: 20, clientY: y })
    fireEvent.pointerUp(window)
    act(() => { vi.advanceTimersByTime(180) })
    expect(saved.mock.lastCall?.[0].groups[0]?.sectionIds).toEqual(['1', '2', '3', '0', '4', '5'])
  } finally { geometry.mockRestore() }
})

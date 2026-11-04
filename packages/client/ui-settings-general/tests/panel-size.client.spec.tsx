// @vitest-environment jsdom
import { act, renderHook, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { usePanelSize } from '../src/client/use-panel-size.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('doubles edge movement to retain the centered anchor, caps size and resets', () => {
  vi.stubGlobal('innerWidth', 1600); vi.stubGlobal('innerHeight', 1200)
  const { result } = renderHook(usePanelSize)
  act(() => { result.current.reset() })
  act(() => { result.current.start('e', { button: 0, clientX: 800, clientY: 0, pointerId: 1, preventDefault() {}, stopPropagation() {} } as unknown as ReactPointerEvent<HTMLElement>) })
  act(() => { const event = new MouseEvent('pointermove', { clientX: 900 }); Object.defineProperty(event, 'pointerId', { value: 1 }); window.dispatchEvent(event) })
  expect(result.current.style).toMatchObject({ '--settings-width': '1008px' })
  act(() => { const event = new MouseEvent('pointermove', { clientX: 2000 }); Object.defineProperty(event, 'pointerId', { value: 1 }); window.dispatchEvent(event) })
  expect(result.current.style).toMatchObject({ '--settings-width': '1200px' })
  act(() => { result.current.reset() })
  expect(result.current.style).toMatchObject({ '--settings-width': '808px', '--settings-nav-width': '196px' })
})
it('clamps to smaller viewports and only adjusts the split for divider drag', () => {
  vi.stubGlobal('innerWidth', 1000); vi.stubGlobal('innerHeight', 700)
  const { result } = renderHook(usePanelSize)
  act(() => { result.current.reset() })
  expect(result.current.style).toMatchObject({ '--settings-height': '652px' })
  act(() => { result.current.start('divider', { currentTarget: document.createElement('div'), button: 0, clientX: 196, clientY: 0, pointerId: 2, preventDefault() {}, stopPropagation() {} } as unknown as ReactPointerEvent<HTMLElement>) })
  act(() => { const event = new MouseEvent('pointermove', { clientX: 270 }); Object.defineProperty(event, 'pointerId', { value: 2 }); window.dispatchEvent(event) })
  expect(result.current.style).toMatchObject({ '--settings-width': '808px', '--settings-height': '652px', '--settings-nav-width': '270px' })
  act(() => { window.dispatchEvent(new Event('pointercancel')); result.current.reset() })
})

it('resizes only horizontally from the separate divider without scrolling the rail', () => {
  vi.stubGlobal('innerWidth', 1400); vi.stubGlobal('innerHeight', 1000)
  const nav = document.createElement('nav')
  const rail = document.createElement('div'); rail.dataset.scrolling = 'false'
  const handle = document.createElement('div'); nav.append(rail, handle)
  Object.defineProperties(rail, { scrollHeight: { value: 1200 }, clientHeight: { value: 400 } })
  const { result } = renderHook(usePanelSize)
  act(() => { result.current.reset() })
  act(() => { result.current.start('divider', {
    currentTarget: handle, button: 0, clientX: 196, clientY: 100, pointerId: 3,
    preventDefault() {}, stopPropagation() {},
  } as unknown as ReactPointerEvent<HTMLElement>) })
  act(() => {
    const event = new MouseEvent('pointermove', { clientX: 196, clientY: 120 })
    Object.defineProperty(event, 'pointerId', { value: 3 }); window.dispatchEvent(event)
  })
  expect(rail.scrollTop).toBe(0)
  expect(result.current.style).toMatchObject({ '--settings-nav-width': '196px', '--settings-width': '808px' })
  expect(result.current.dividerDragging).toBe(true)
  act(() => {
    const event = new MouseEvent('pointermove', { clientX: 220, clientY: 150 })
    Object.defineProperty(event, 'pointerId', { value: 3 }); window.dispatchEvent(event)
  })
  expect(rail.scrollTop).toBe(0)
  expect(result.current.style).toMatchObject({ '--settings-nav-width': '220px' })
  act(() => {
    const event = new MouseEvent('pointerup')
    Object.defineProperty(event, 'pointerId', { value: 3 }); window.dispatchEvent(event)
  })
  expect(result.current.dividerDragging).toBe(false)
  act(() => { result.current.reset() })
})

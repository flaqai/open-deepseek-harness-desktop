// @vitest-environment jsdom
/** Menu backing lifetime and placement identity. */
import { createRef } from 'react'
import { createPortal } from 'react-dom'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { MenuSurface } from '../src/MenuSurface.tsx'

afterEach(cleanup)

it('keeps each backing after its menu anchor and removes it when unmounted', () => {
  const ref = createRef<HTMLDivElement>()
  const view = render(createPortal(<MenuSurface ref={ref} role="menu" compact><button>Action</button></MenuSurface>, document.body))
  const menu = screen.getByRole('menu')
  const backing = document.querySelector<HTMLElement>('[data-menu-backing]')!
  expect(ref.current).toBe(menu)
  expect(menu.compareDocumentPosition(backing) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
  expect(backing.style.getPropertyValue('--dsh-menu-anchor')).toBe(menu.style.getPropertyValue('--dsh-menu-anchor'))
  expect(backing.getAttribute('aria-hidden')).toBe('true')
  view.unmount()
  expect(document.querySelector('[data-menu-backing]')).toBeNull()
})

it('gives simultaneously open menus independent anchors and follows visibility changes', () => {
  const view = render(<><MenuSurface role="menu" /><MenuSurface role="menu" /></>)
  const anchors = screen.getAllByRole('menu').map(menu => menu.style.getPropertyValue('--dsh-menu-anchor'))
  expect(new Set(anchors).size).toBe(2)
  expect(document.querySelectorAll('[data-menu-backing]')).toHaveLength(2)
  view.rerender(<MenuSurface role="menu" style={{ visibility: 'hidden' }} />)
  expect(document.querySelector<HTMLElement>('[data-menu-backing]')!.style.visibility).toBe('hidden')
})

it('shares contextual corners with native backings without assigning them visible menu layout', () => {
  const view = render(<MenuSurface contextual role="menu"><button>Action</button></MenuSurface>)
  const menu = view.getByRole('menu')
  const backing = document.querySelector<HTMLElement>('[data-menu-backing]')!
  expect(menu.hasAttribute('data-context-menu')).toBe(true)
  expect(menu.className).toContain('contextual')
  expect(backing.className).toContain('contextual')
})

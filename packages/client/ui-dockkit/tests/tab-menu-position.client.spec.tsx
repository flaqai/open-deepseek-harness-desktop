// @vitest-environment jsdom
/** Dock tab context menus remain reachable at viewport edges and after layout movement. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { TabMenu } from '../src/components/TabMenu.tsx'
import { TEST_LABELS } from './fixtures.client.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function layout(initialRect: DOMRect, width = 196, height = 100) {
  let rect = initialRect
  const anchor = document.createElement('button')
  document.body.appendChild(anchor)
  vi.spyOn(anchor, 'getBoundingClientRect').mockImplementation(() => rect)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    const max = Number.parseFloat(this.style.getPropertyValue('--dsh-anchored-max-width'))
    return this.hasAttribute('data-dockkit-tab-menu') ? Math.min(width, Number.isNaN(max) ? width : max) : 100
  })
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    const max = Number.parseFloat(this.style.getPropertyValue('--dsh-anchored-max-height'))
    return this.hasAttribute('data-dockkit-tab-menu') ? Math.min(height, Number.isNaN(max) ? height : max) : 30
  })
  const props = { labels: TEST_LABELS, anchor, onClose: vi.fn(), onDismiss: vi.fn(), extras: undefined }
  const view = render(<TabMenu {...props} />)
  onTestFinished(() => { view.unmount(); anchor.remove() })
  return { ...view, props, move: (next: DOMRect) => { rect = next }, release: () => { view.unmount(); anchor.remove() } }
}

describe('TabMenu viewport placement', () => {
  it('keeps all actions above the viewport bottom when the tab is in a lower split', () => {
    vi.stubGlobal('innerWidth', 800)
    vi.stubGlobal('innerHeight', 600)
    const view = layout(new DOMRect(700, 550, 90, 30))
    try {
      const menu = view.getByRole('menu')
      expect(Number.parseFloat(menu.style.top)).toBe(496)
      expect(Number.parseFloat(menu.style.left)).toBe(600)
      expect(Number.parseFloat(menu.style.top) + menu.offsetHeight).toBeLessThanOrEqual(596)
      expect(menu.querySelector('[role="menuitem"]')).not.toBeNull()
    } finally { view.release() }
  })

  it('bounds both dimensions on narrow, short viewports and preserves the selected action', () => {
    vi.stubGlobal('innerWidth', 160)
    vi.stubGlobal('innerHeight', 90)
    const view = layout(new DOMRect(140, 60, 20, 20), 400, 500)
    try {
      const menu = view.getByRole('menu')
      expect(menu.style.getPropertyValue('--dsh-anchored-max-width')).toBe('152px')
      expect(menu.style.getPropertyValue('--dsh-anchored-max-height')).toBe('82px')
      expect(menu.style.left).toBe('4px')
      expect(menu.style.top).toBe('4px')
      fireEvent.click(view.getByRole('menuitem', { name: TEST_LABELS.closeTab }))
      expect(view.props.onClose).toHaveBeenCalledOnce()
    } finally { view.release() }
  })

  it('repositions an open menu on scrolling and resizing, then removes tracking on unmount', () => {
    vi.stubGlobal('innerWidth', 800)
    vi.stubGlobal('innerHeight', 600)
    const view = layout(new DOMRect(100, 100, 90, 30))
    const menu = view.getByRole('menu')
    expect(menu.style.top).toBe('134px')
    view.move(new DOMRect(200, 300, 90, 30))
    fireEvent.scroll(window)
    expect(menu.style.left).toBe('200px')
    expect(menu.style.top).toBe('334px')
    vi.stubGlobal('innerHeight', 360)
    fireEvent.resize(window)
    expect(menu.style.top).toBe('256px')
    const remove = vi.spyOn(window, 'removeEventListener')
    view.release()
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function), true)
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function))
  })

  it('uses the visible viewport after browser zoom and retains scrolling constraints', () => {
    vi.stubGlobal('visualViewport', Object.assign(new EventTarget(), {
      width: 180, height: 240, offsetLeft: 30, offsetTop: 40,
    }))
    const view = layout(new DOMRect(160, 220, 30, 20), 196, 120)
    try {
      const menu = view.getByRole('menu')
      expect(menu.style.left).toBe('34px')
      expect(menu.style.top).toBe('156px')
      expect(menu.style.getPropertyValue('--dsh-anchored-max-height')).toBe('232px')
      const css = readFileSync(resolve('packages/client/ui-dockkit/src/components/dockkit.module.css'), 'utf8')
      expect(css).toMatch(/\.menu\s*\{[^}]*max-width: var\(--dsh-anchored-max-width/)
      expect(css).toMatch(/\.menu\s*\{[^}]*max-height: var\(--dsh-anchored-max-height/)
      expect(css).toMatch(/\.menuViewport\s*\{[^}]*overflow: auto/)
    } finally { view.release() }
  })
})

// @vitest-environment jsdom
/** CSS owns viewport placement; the menu owns anchor and interaction lifetimes. */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { TabMenu } from '../src/components/TabMenu.tsx'
import { TEST_LABELS } from './fixtures.client.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function layout(anchor = document.createElement('button')) {
  document.body.appendChild(anchor)
  const props = { labels: TEST_LABELS, anchor, onClose: vi.fn(), onDismiss: vi.fn(), extras: undefined }
  const view = render(<TabMenu {...props} />)
  onTestFinished(() => { view.unmount(); anchor.remove() })
  return { ...view, props, anchor }
}

describe('TabMenu CSS anchor lifetime', () => {
  it('uses the actual tab element as a CSS anchor without measuring it', () => {
    const anchor = document.createElement('button')
    const measure = vi.spyOn(anchor, 'getBoundingClientRect')
    const view = layout(anchor)
    const menu = view.getByRole('menu')
    expect(menu.style.getPropertyValue('position-anchor')).toBe(anchor.style.getPropertyValue('anchor-name'))
    expect(anchor.style.getPropertyValue('anchor-name')).toMatch(/^--dsh-tab-menu-/)
    expect(measure).not.toHaveBeenCalled()
    fireEvent.scroll(window)
    fireEvent.resize(window)
    expect(measure).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('menuitem', { name: TEST_LABELS.closeTab }))
    expect(view.props.onClose).toHaveBeenCalledOnce()
  })

  it('restores the previous anchor declaration when the menu closes', () => {
    const anchor = document.createElement('button')
    anchor.style.setProperty('anchor-name', '--embedder-anchor', 'important')
    const view = layout(anchor)
    expect(anchor.style.getPropertyValue('anchor-name')).not.toBe('--embedder-anchor')
    view.unmount()
    expect(anchor.style.getPropertyValue('anchor-name')).toBe('--embedder-anchor')
    expect(anchor.style.getPropertyPriority('anchor-name')).toBe('important')
  })

  it('moves its anchor association when the menu is rebound to another tab', () => {
    const view = layout()
    const other = document.createElement('button')
    document.body.appendChild(other)
    onTestFinished(() => { other.remove() })
    view.rerender(<TabMenu {...view.props} anchor={other} />)
    expect(view.anchor.style.getPropertyValue('anchor-name')).toBe('')
    expect(view.getByRole('menu').style.getPropertyValue('position-anchor')).toBe(other.style.getPropertyValue('anchor-name'))
    view.unmount()
    expect(other.style.getPropertyValue('anchor-name')).toBe('')
  })

  it('does not leave an anchor or popup behind when no actions remain', () => {
    const view = layout()
    view.rerender(<TabMenu {...view.props} onClose={undefined} />)
    expect(view.queryByRole('menu')).toBeNull()
    expect(view.anchor.style.getPropertyValue('anchor-name')).toBe('')
  })
})

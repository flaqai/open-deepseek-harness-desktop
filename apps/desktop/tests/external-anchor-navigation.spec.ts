// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { installExternalAnchorNavigation } from '../src/external-anchor-navigation.ts'

const disposers: Array<() => void> = []
afterEach(() => { disposers.splice(0).forEach((dispose) => { dispose() }); document.body.replaceChildren() })

function setup() {
  const open = vi.fn(() => Promise.resolve())
  const failed = vi.fn()
  disposers.push(installExternalAnchorNavigation(document, open, failed))
  return { open, failed }
}

function anchor(href = 'https://github.com/example/plugin'): HTMLAnchorElement {
  const link = document.createElement('a')
  link.href = href
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  link.innerHTML = '<span>Plugin</span>'
  document.body.append(link)
  return link
}

it.each([
  { button: 0 }, { button: 0, ctrlKey: true }, { button: 0, metaKey: true },
  { button: 0, shiftKey: true }, { button: 1 },
])('routes an unhandled external anchor once for %j', (init) => {
  const { open } = setup()
  const link = anchor()
  const event = new MouseEvent(init.button === 1 ? 'auxclick' : 'click', { ...init, bubbles: true, cancelable: true })
  link.firstElementChild!.dispatchEvent(event)
  expect(open).toHaveBeenCalledExactlyOnceWith(link.href)
  expect(event.defaultPrevented).toBe(true)
})

it('keeps page-owned navigation, including Markdown sidebar delegates, in control', () => {
  const { open } = setup()
  const link = anchor()
  const delegated = vi.fn()
  link.addEventListener('click', (event) => { event.preventDefault(); delegated() })
  link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  expect(delegated).toHaveBeenCalledOnce()
  expect(open).not.toHaveBeenCalled()
})

it.each(['#section', '/settings', 'javascript:void(0)', 'file:///tmp/example', 'mailto:test@example.invalid',
  'https://user:password@example.invalid/'])('does not bridge internal or unsafe destination %s', (href) => {
  const { open } = setup()
  const link = anchor(href)
  const event = new MouseEvent('click', { bubbles: true, cancelable: true })
  link.dispatchEvent(event)
  expect(open).not.toHaveBeenCalled()
  expect(event.defaultPrevented).toBe(false)
  event.preventDefault()
})

it('does not take over downloads or right clicks', () => {
  const { open } = setup()
  const link = anchor()
  link.download = 'plugin.tgz'
  link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  link.removeAttribute('download')
  link.dispatchEvent(new MouseEvent('auxclick', { button: 2, bubbles: true, cancelable: true }))
  expect(open).not.toHaveBeenCalled()
})

it('never installs a browser-opening delegate inside an iframe', () => {
  const { open } = setup()
  const frame = document.createElement('iframe')
  document.body.append(frame)
  const child = frame.contentDocument!
  disposers.push(installExternalAnchorNavigation(child, open, vi.fn()))
  child.body.innerHTML = '<a href="https://example.invalid/" target="_blank" rel="noreferrer">Outside</a>'
  const event = new MouseEvent('click', { bubbles: true, cancelable: true })
  child.querySelector('a')!.dispatchEvent(event)
  expect(open).not.toHaveBeenCalled()
})

it('reports a bridge rejection once without exposing the target or retrying', async () => {
  const error = new Error('system browser unavailable')
  const open = vi.fn(() => Promise.reject(error))
  const failed = vi.fn()
  disposers.push(installExternalAnchorNavigation(document, open, failed))
  anchor().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  await Promise.resolve()
  expect(open).toHaveBeenCalledOnce()
  expect(failed).toHaveBeenCalledExactlyOnceWith(error)
})

it('removes both activation listeners when its document is unloaded', () => {
  const open = vi.fn(() => Promise.resolve())
  installExternalAnchorNavigation(document, open, vi.fn())()
  anchor().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  anchor().dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }))
  expect(open).not.toHaveBeenCalled()
})

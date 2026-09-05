import { describe, expect, it, vi } from 'vitest'
import { DesktopWebAccess, parseDesktopWebUrl, type DesktopWebStatus } from '../src/desktop-web-access.ts'

const URL = 'http://127.0.0.1:43121/?token=abc_DEF-123'

function bench() {
  const statuses: DesktopWebStatus[] = []
  const openExternal = vi.fn(() => Promise.resolve())
  const hideWindow = vi.fn()
  const showWindow = vi.fn()
  const access = new DesktopWebAccess({
    openExternal,
    canHideWindow: () => true,
    hideWindow,
    showWindow,
    publish: (status) => { statuses.push(status) },
  })
  return { access, statuses, openExternal, hideWindow, showWindow }
}

describe('desktop local Web access', () => {
  it('accepts only an authenticated numeric-port loopback root', () => {
    expect(parseDesktopWebUrl(URL)).toBe(URL)
    for (const value of [
      'https://127.0.0.1:43121/?token=a',
      'http://localhost:43121/?token=a',
      'http://127.0.0.1:43121/',
      'http://127.0.0.1:43121/path?token=a',
      'http://127.0.0.1:43121/?token=a&next=https://example.com',
      'http://user@127.0.0.1:43121/?token=a',
    ]) expect(() => parseDesktopWebUrl(value)).toThrow(/invalid local Web/u)
  })

  it('opens one in-flight handoff and hides only after success', async () => {
    let resolve!: () => void
    const pending = new Promise<void>((done) => { resolve = done })
    const b = bench()
    b.openExternal.mockReturnValueOnce(pending)
    b.access.setReady(URL)
    const first = b.access.open()
    const second = b.access.open()
    expect(first).toBe(second)
    expect(b.access.status()).toEqual({ phase: 'opening' })
    expect(b.hideWindow).not.toHaveBeenCalled()
    resolve()
    await first
    expect(b.openExternal).toHaveBeenCalledOnce()
    expect(b.openExternal).toHaveBeenCalledWith(URL)
    expect(b.hideWindow).toHaveBeenCalledOnce()
    expect(b.access.status()).toEqual({ phase: 'ready' })
  })

  it('decorates only the URL sent to the system browser', async () => {
    const b = bench()
    const access = new DesktopWebAccess({
      openExternal: b.openExternal,
      decorateUrl: url => `${url}#dsh-desktop-return=opaque`,
      canHideWindow: () => true,
      hideWindow: b.hideWindow,
      showWindow: b.showWindow,
      publish: () => {},
    })
    access.setReady(URL)
    await access.open()
    expect(b.openExternal).toHaveBeenCalledWith(`${URL}#dsh-desktop-return=opaque`)
    expect(access.status()).toEqual({ phase: 'ready' })
  })

  it('retains the current generation for retry and keeps the window visible after failure', async () => {
    const b = bench()
    b.openExternal.mockRejectedValueOnce(new Error('no browser'))
    b.access.setReady(URL)
    await expect(b.access.open()).rejects.toThrow('no browser')
    expect(b.hideWindow).not.toHaveBeenCalled()
    expect(b.access.status()).toEqual({ phase: 'error', message: 'no browser' })
    await expect(b.access.open()).resolves.toEqual({ opened: true, hidden: true })
  })

  it('automatically opens once per URL generation and restores the window after failure', async () => {
    const b = bench()
    b.openExternal.mockRejectedValueOnce(new Error('blocked'))
    b.access.setReady(URL)
    b.access.openAutomatically(true)
    b.access.openAutomatically(true)
    await vi.waitFor(() => { expect(b.showWindow).toHaveBeenCalledOnce() })
    expect(b.openExternal).toHaveBeenCalledOnce()
    b.access.setReady(URL)
    b.access.openAutomatically(true)
    expect(b.openExternal).toHaveBeenCalledOnce()
    b.access.clear()
    b.access.setReady('http://127.0.0.1:43122/?token=next')
    b.access.openAutomatically(true)
    await vi.waitFor(() => { expect(b.openExternal).toHaveBeenCalledTimes(2) })
  })

  it('keeps the desktop visible when the tray is unavailable', async () => {
    const b = bench()
    const access = new DesktopWebAccess({
      openExternal: b.openExternal,
      canHideWindow: () => false,
      hideWindow: b.hideWindow,
      showWindow: b.showWindow,
      publish: () => {},
    })
    access.setReady(URL)
    await expect(access.open()).resolves.toEqual({ opened: true, hidden: false })
    expect(b.hideWindow).not.toHaveBeenCalled()
  })

  it('does not hide or republish readiness when an old generation finishes late', async () => {
    let resolve!: () => void
    const b = bench()
    b.openExternal.mockReturnValueOnce(new Promise<void>((done) => { resolve = done }))
    b.access.setReady(URL)
    const opening = b.access.open()
    b.access.clear()
    resolve()
    await expect(opening).resolves.toEqual({ opened: true, hidden: false })
    expect(b.hideWindow).not.toHaveBeenCalled()
    expect(b.access.status()).toEqual({ phase: 'starting' })
  })
})

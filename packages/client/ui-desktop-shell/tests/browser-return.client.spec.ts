// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  captureDesktopReturnTarget, parseDesktopReturnUrl, requestDesktopReturn,
} from '../src/client/browser-return.ts'

const RETURN_URL = 'http://127.0.0.1:51777/show?token=abc_DEF-123'

afterEach(() => {
  window.sessionStorage.clear()
  window.history.replaceState(null, '', '/')
  vi.restoreAllMocks()
})

describe('browser return handoff', () => {
  it('accepts only the fixed loopback reveal endpoint', () => {
    expect(parseDesktopReturnUrl(RETURN_URL)).toBe(RETURN_URL)
    for (const value of [
      'https://127.0.0.1:51777/show?token=a', 'http://localhost:51777/show?token=a',
      'http://127.0.0.1:51777/other?token=a', 'http://127.0.0.1:51777/show',
      'http://127.0.0.1:51777/show?token=a&next=x',
    ]) expect(() => parseDesktopReturnUrl(value)).toThrow(/invalid browser return/u)
  })

  it('captures the fragment per tab and scrubs it from the visible URL', () => {
    window.history.replaceState(null, '', `/#dsh-desktop-return=${encodeURIComponent(RETURN_URL)}`)
    expect(captureDesktopReturnTarget()).toBe(RETURN_URL)
    expect(window.location.hash).toBe('')
    expect(captureDesktopReturnTarget()).toBe(RETURN_URL)
  })

  it('rejects and forgets malformed fragments', () => {
    window.sessionStorage.setItem('dsh.desktop-return.v1', RETURN_URL)
    window.history.replaceState(null, '', '/#dsh-desktop-return=https%3A%2F%2Fexample.com')
    expect(captureDesktopReturnTarget()).toBeUndefined()
    expect(window.location.hash).toBe('')
    expect(captureDesktopReturnTarget()).toBeUndefined()
  })

  it('posts without credentials or referrer and reports failure', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))
    await requestDesktopReturn(RETURN_URL, fetch)
    expect(fetch).toHaveBeenCalledWith(RETURN_URL, {
      method: 'POST', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
    })
    fetch.mockResolvedValueOnce(new Response(null, { status: 403 }))
    await expect(requestDesktopReturn(RETURN_URL, fetch)).rejects.toThrow('HTTP 403')
  })
})

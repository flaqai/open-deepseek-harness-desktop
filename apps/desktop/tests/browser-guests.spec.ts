import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const partitions = vi.hoisted(() => new Map<string, {
  request: (details: { url: string }, callback: (decision: { cancel: boolean }) => void) => void
  permission: (contents: unknown, permission: string, callback: (allowed: boolean) => void) => void
  download: (event: { preventDefault(): void }) => void
}>())
vi.mock('electron', () => ({
  app: { isPackaged: true },
  session: { fromPartition: (name: string) => {
    const policy: {
      request: (details: { url: string }, callback: (decision: { cancel: boolean }) => void) => void
      permission: (contents: unknown, permission: string, callback: (allowed: boolean) => void) => void
      download: (event: { preventDefault(): void }) => void
      setPermissionRequestHandler: (handler: (contents: unknown, permission: string, callback: (allowed: boolean) => void) => void) => void
      setPermissionCheckHandler: typeof vi.fn
      setDevicePermissionHandler: typeof vi.fn
      setDisplayMediaRequestHandler: typeof vi.fn
      on: (name: string, handler: (event: { preventDefault(): void }) => void) => void
      webRequest: {
        onBeforeRequest: (handler: (details: { url: string }, callback: (decision: { cancel: boolean }) => void) => void) => void
      }
    } = {
      request: () => {}, permission: () => {}, download: () => {},
      setPermissionRequestHandler(handler: typeof policy.permission) { policy.permission = handler },
      setPermissionCheckHandler: vi.fn(), setDevicePermissionHandler: vi.fn(),
      setDisplayMediaRequestHandler: vi.fn(),
      on(name, handler) { if (name === 'will-download') policy.download = handler },
      webRequest: { onBeforeRequest(handler: typeof policy.request) { policy.request = handler } },
    }
    partitions.set(name, policy)
    return policy
  } },
}))

import { DesktopBrowserGuests } from '../src/browser-guests.ts'

class Contents extends EventEmitter {
  destroyed = false
  send = vi.fn()
  isDestroyed = () => this.destroyed
  close = vi.fn((_options?: unknown) => { this.destroyed = true; this.emit('destroyed') })
  getURL = () => this.url
  setWindowOpenHandler = vi.fn((handler: (request: { url: string; postBody?: unknown }) => { action: string }) => { this.open = handler })
  open?: (request: { url: string; postBody?: unknown }) => { action: string }
  constructor(readonly url = '') { super() }
}

beforeEach(() => { partitions.clear() })

describe('native Sidebar browser guest leases', () => {
  it('issues opaque leases and one isolated storage partition per Workspace', async () => {
    const guests = new DesktopBrowserGuests(() => ['http://127.0.0.1:3080'])
    const owner = new Contents()
    const first = guests.acquire(owner as never, 'cwd:/one')
    const second = guests.acquire(owner as never, 'cwd:/one')
    const other = guests.acquire(owner as never, 'cwd:/two')
    expect(first.lease).not.toBe(second.lease)
    expect(first.partition).toBe(second.partition)
    expect(first.partition).not.toBe(other.partition)
    expect(partitions.size).toBe(2)
    await expect(guests.release(new Contents() as never, first.lease)).rejects.toThrow('another window')
    await guests.release(owner as never, first.lease)
  })

  it('rejects forged attachment and strips renderer-controlled guest privileges', () => {
    const guests = new DesktopBrowserGuests(() => ['http://127.0.0.1:3080'])
    const owner = new Contents()
    guests.bind(owner as never, () => () => {})
    const reservation = guests.acquire(owner as never, 'cwd:/one')
    const forged = { preventDefault: vi.fn() }
    owner.emit('will-attach-webview', forged, {}, { src: 'about:blank#forged', partition: reservation.partition })
    expect(forged.preventDefault).toHaveBeenCalledOnce()
    const event = { preventDefault: vi.fn() }
    const preferences: Record<string, unknown> = { preload: '/untrusted.js', nodeIntegration: true }
    owner.emit('will-attach-webview', event, preferences, {
      src: `about:blank#${reservation.lease}`, partition: reservation.partition,
    })
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(preferences).toMatchObject({ nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true })
    expect(preferences).not.toHaveProperty('preload')
    const repeated = { preventDefault: vi.fn() }
    owner.emit('will-attach-webview', repeated, {}, {
      src: `about:blank#${reservation.lease}`, partition: reservation.partition,
    })
    expect(repeated.preventDefault).toHaveBeenCalledOnce()
  })

  it('denies application requests, device permissions and downloads in guest storage', () => {
    const guests = new DesktopBrowserGuests(() => ['http://127.0.0.1:3080'])
    const reservation = guests.acquire(new Contents() as never, 'cwd:/one')
    const policy = partitions.get(reservation.partition)!
    let blocked = false
    policy.request({ url: 'http://localhost:3080/api' }, (decision) => { blocked = decision.cancel })
    expect(blocked).toBe(true)
    policy.request({ url: 'https://github.com/' }, (decision) => { blocked = decision.cancel })
    expect(blocked).toBe(false)
    policy.permission(null, 'media', (allowed) => { expect(allowed).toBe(false) })
    const download = { preventDefault: vi.fn() }
    policy.download(download)
    expect(download.preventDefault).toHaveBeenCalledOnce()
  })

  it('routes approved popup URLs to the owner and releases the guest with its lease', async () => {
    const guests = new DesktopBrowserGuests(() => ['http://127.0.0.1:3080'])
    const owner = new Contents()
    guests.bind(owner as never, () => () => {})
    const reservation = guests.acquire(owner as never, 'cwd:/one')
    owner.emit('will-attach-webview', { preventDefault: vi.fn() }, {}, {
      src: `about:blank#${reservation.lease}`, partition: reservation.partition,
    })
    const guest = new Contents(`about:blank#${reservation.lease}`)
    owner.emit('did-attach-webview', {}, guest)
    guest.emit('dom-ready')
    expect(guest.open?.({ url: 'https://github.com/' })).toEqual({ action: 'deny' })
    expect(owner.send).toHaveBeenCalledWith('dsh:desktop:browser:open-requested', {
      lease: reservation.lease, url: 'https://github.com/',
    })
    expect(guest.open?.({ url: 'file:///etc/passwd' })).toEqual({ action: 'deny' })
    expect(guest.open?.({ url: 'http://localhost:3080/' })).toEqual({ action: 'deny' })
    expect(owner.send).toHaveBeenCalledTimes(1)
    const forbiddenNavigation = { isMainFrame: true, url: 'file:///etc/passwd', preventDefault: vi.fn() }
    guest.emit('will-frame-navigate', forbiddenNavigation)
    expect(forbiddenNavigation.preventDefault).toHaveBeenCalledOnce()
    const harnessRedirect = { preventDefault: vi.fn() }
    guest.emit('will-redirect', harnessRedirect, 'http://localhost:3080/', false, true)
    expect(harnessRedirect.preventDefault).toHaveBeenCalledOnce()
    await guests.release(owner as never, reservation.lease)
    expect(guest.close).toHaveBeenCalledOnce()
  })
})

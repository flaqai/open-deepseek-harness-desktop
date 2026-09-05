import { request } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopReturnControl, parseHarnessOrigin } from '../src/desktop-return-control.ts'

const controls: DesktopReturnControl[] = []

afterEach(async () => {
  await Promise.allSettled(controls.splice(0).map(control => control.close()))
})

function post(url: string, origin: string, method = 'POST'): Promise<number> {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const call = request({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method,
      headers: { origin },
    }, (response) => {
      response.resume()
      response.once('end', () => { resolve(response.statusCode ?? 0) })
    })
    call.once('error', reject)
    call.end()
  })
}

describe('desktop browser return control', () => {
  it('accepts only a numeric-port IPv4 loopback Harness origin', () => {
    expect(parseHarnessOrigin('http://127.0.0.1:43121/')).toBe('http://127.0.0.1:43121')
    for (const value of [
      'https://127.0.0.1:43121/', 'http://localhost:43121/', 'http://127.0.0.1/',
      'http://127.0.0.1:43121/path', 'http://127.0.0.1:43121/?token=a',
    ]) expect(() => parseHarnessOrigin(value)).toThrow(/invalid Harness/u)
  })

  it('reveals the window only for the current exact origin and token', async () => {
    const showWindow = vi.fn()
    const control = new DesktopReturnControl({ showWindow })
    controls.push(control)
    await control.start()
    control.setHarnessOrigin('http://127.0.0.1:43121/')
    const url = control.returnUrl()
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/show\?token=/u)
    await expect(post(url!, 'http://127.0.0.1:9999')).resolves.toBe(403)
    await expect(post(url!.replace(/.$/u, 'x'), 'http://127.0.0.1:43121')).resolves.toBe(403)
    await expect(post(url!, 'http://127.0.0.1:43121', 'GET')).resolves.toBe(403)
    expect(showWindow).not.toHaveBeenCalled()
    await expect(post(url!, 'http://127.0.0.1:43121')).resolves.toBe(204)
    expect(showWindow).toHaveBeenCalledOnce()
  })

  it('invalidates the former generation after rotation or clear', async () => {
    const showWindow = vi.fn()
    const control = new DesktopReturnControl({ showWindow })
    controls.push(control)
    await control.start()
    control.setHarnessOrigin('http://127.0.0.1:43121/')
    const former = control.returnUrl()!
    control.setHarnessOrigin('http://127.0.0.1:43121/')
    expect(control.returnUrl()).toBe(former)
    control.setHarnessOrigin('http://127.0.0.1:43122/')
    await expect(post(former, 'http://127.0.0.1:43121')).resolves.toBe(403)
    control.clear()
    await expect(post(control.returnUrl() ?? former, 'http://127.0.0.1:43122')).resolves.toBe(403)
    expect(showWindow).not.toHaveBeenCalled()
  })
})

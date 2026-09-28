import { describe, expect, it, vi } from 'vitest'
import {
  createOrbComputerUseBackend,
  type OrbComputerUseAuthority,
  type OrbComputerUseFrame,
  type OrbComputerUsePlatform,
} from '../src/orb-computer-use-backend.ts'

const frame: OrbComputerUseFrame = {
  data: new Uint8Array([1, 2, 3]),
  mediaType: 'image/png',
  bounds: { x: 200, y: 100, width: 101, height: 51 },
  windowId: 'native-window-42',
  appName: 'Target',
}

function fixture() {
  let authority: OrbComputerUseAuthority = { mode: 'local', screenCapture: true, inputControl: true }
  const events: string[] = []
  const platform: OrbComputerUsePlatform = {
    async withOverlayExcluded(run) {
      events.push('overlay:begin')
      try { return await run() }
      finally { events.push('overlay:end') }
    },
    async captureFrontmost() {
      events.push('capture')
      return frame
    },
    async frontmostWindowId() {
      events.push('focus')
      return frame.windowId
    },
    async click(input) { events.push(`click:${input.x},${input.y}`) },
    async typeText(input) { events.push(`type:${input.x},${input.y}:${input.text}`) },
  }
  const release = vi.fn(async () => { events.push('release') })
  const acquireExclusive = vi.fn(async () => {
    events.push('reserve')
    return release
  })
  return {
    events,
    platform,
    release,
    acquireExclusive,
    authority: async () => authority,
    setAuthority: (next: OrbComputerUseAuthority) => { authority = next },
  }
}

describe('floating Computer Use backend', () => {
  it('reserves the sole provider before use and excludes the overlay through action and recapture', async () => {
    const f = fixture()
    const backend = await createOrbComputerUseBackend({ ...f, postActionWaitMs: 0 })
    const first = await backend.observe()
    expect(first.frameId).toBe(1)
    const second = await backend.act(first.frameId, { kind: 'click', position: [1000, 0], button: 'left', count: 1 })
    expect(second.frameId).toBe(2)
    expect(f.events).toEqual([
      'reserve', 'overlay:begin', 'capture', 'overlay:end',
      'overlay:begin', 'focus', 'click:300,100', 'capture', 'overlay:end',
    ])
    await backend.close()
    expect(f.events.at(-1)).toBe('release')
    expect(f.acquireExclusive).toHaveBeenCalledOnce()
    expect(f.release).toHaveBeenCalledOnce()
  })

  it('rejects NAS mode and revoked OS rights at the execution entry', async () => {
    const f = fixture()
    const backend = await createOrbComputerUseBackend({ ...f, postActionWaitMs: 0 })
    f.setAuthority({ mode: 'nas', screenCapture: true, inputControl: true })
    await expect(backend.observe()).rejects.toThrow('NAS mode')
    f.setAuthority({ mode: 'local', screenCapture: true, inputControl: true })
    const first = await backend.observe()
    f.setAuthority({ mode: 'local', screenCapture: true, inputControl: false })
    await expect(backend.act(first.frameId, { kind: 'click', position: [0, 0], button: 'left', count: 1 })).rejects.toThrow('input control permission')
    expect(f.events).not.toContain('click:200,100')
    f.setAuthority({ mode: 'local', screenCapture: false, inputControl: false })
    await expect(backend.observe()).rejects.toThrow('screen capture permission')
    await backend.close()
  })

  it('invalidates previous images after a new observation or attempted input', async () => {
    const f = fixture()
    const backend = await createOrbComputerUseBackend({ ...f, postActionWaitMs: 0 })
    const old = await backend.observe()
    const fresh = await backend.observe()
    await expect(backend.act(old.frameId, { kind: 'click', position: [0, 0], button: 'left', count: 1 })).rejects.toThrow('stale')
    f.setAuthority({ mode: 'local', screenCapture: true, inputControl: false })
    await expect(backend.act(fresh.frameId, { kind: 'click', position: [0, 0], button: 'left', count: 1 })).rejects.toThrow('input control permission')
    f.setAuthority({ mode: 'local', screenCapture: true, inputControl: true })
    await expect(backend.act(fresh.frameId, { kind: 'click', position: [0, 0], button: 'left', count: 1 })).rejects.toThrow('stale')
    await backend.close()
  })

  it('rejects input if another app takes focus after the screenshot', async () => {
    const f = fixture()
    const backend = await createOrbComputerUseBackend({ ...f, postActionWaitMs: 0 })
    const first = await backend.observe()
    f.platform.frontmostWindowId = async () => 'another-window'
    await expect(backend.act(first.frameId, { kind: 'click', position: [500, 500], button: 'left', count: 1 }))
      .rejects.toThrow('frontmost window changed')
    expect(f.events.some(event => event.startsWith('click:'))).toBe(false)
    await expect(backend.act(first.frameId, { kind: 'click', position: [500, 500], button: 'left', count: 1 }))
      .rejects.toThrow('stale')
    await backend.close()
  })

  it('validates screenshot coordinates and serialized input', async () => {
    const f = fixture()
    const backend = await createOrbComputerUseBackend({ ...f, postActionWaitMs: 0 })
    const first = await backend.observe()
    await expect(backend.act(first.frameId, { kind: 'click', position: [1001, 0], button: 'left', count: 1 })).rejects.toThrow('0 to 1000')
    const second = await backend.act(first.frameId, { kind: 'type', position: [500, 1000], text: 'hello', replace: false, submit: false })
    expect(second.frameId).toBe(2)
    expect(f.events).toContain('type:250,150:hello')
    await backend.close()
  })

  it('waits for in-flight native input before releasing the provider', async () => {
    const f = fixture()
    let completeInput: (() => void) | undefined
    f.platform.click = async () => {
      await new Promise<void>((resolve) => { completeInput = resolve })
      f.events.push('click:done')
    }
    const backend = await createOrbComputerUseBackend({ ...f, postActionWaitMs: 0 })
    const first = await backend.observe()
    const operation = backend.act(first.frameId, { kind: 'click', position: [0, 0], button: 'left', count: 1 })
    await vi.waitFor(() => { expect(completeInput).toBeTypeOf('function') })
    const closing = backend.close()
    expect(f.release).not.toHaveBeenCalled()
    completeInput?.()
    await expect(operation).rejects.toThrow()
    await closing
    expect(f.events.indexOf('click:done')).toBeLessThan(f.events.indexOf('release'))
  })

  it('rejects malformed native captures before returning them to a session', async () => {
    const f = fixture()
    f.platform.captureFrontmost = async () => ({
      ...frame,
      bounds: { x: 200, y: 100, width: 0, height: 51 },
    })
    const backend = await createOrbComputerUseBackend({ ...f, postActionWaitMs: 0 })
    await expect(backend.observe()).rejects.toThrow('invalid captured window bounds')
    await backend.close()
  })

  it('rejects a screenshot without a stable native window identity', async () => {
    const f = fixture()
    f.platform.captureFrontmost = async () => ({ ...frame, windowId: '' })
    const backend = await createOrbComputerUseBackend({ ...f, postActionWaitMs: 0 })
    await expect(backend.observe()).rejects.toThrow('invalid captured window identity')
    await backend.close()
  })

  it('rejects unexpected native screenshot metadata', async () => {
    const f = fixture()
    f.platform.captureFrontmost = async () => ({ ...frame, mediaType: 'text/plain' as 'image/png' })
    const backend = await createOrbComputerUseBackend({ ...f, postActionWaitMs: 0 })
    await expect(backend.observe()).rejects.toThrow('unsupported screenshot format')
    f.platform.captureFrontmost = async () => ({ ...frame, appName: '' })
    await expect(backend.observe()).rejects.toThrow('invalid captured application identity')
    await backend.close()
  })

  it('does not reserve a provider for invalid configuration', async () => {
    const f = fixture()
    await expect(createOrbComputerUseBackend({ ...f, postActionWaitMs: -1 })).rejects.toThrow('invalid post-action wait')
    expect(f.acquireExclusive).not.toHaveBeenCalled()
  })
})

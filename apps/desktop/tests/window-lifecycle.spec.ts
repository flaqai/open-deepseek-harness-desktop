import { describe, expect, it, vi } from 'vitest'
import { createDesktopLifecycle } from '../src/window-lifecycle.ts'

function bench(closeBehavior: 'tray' | 'quit') {
  const window = {
    hide: vi.fn(), show: vi.fn(), focus: vi.fn(), restore: vi.fn(), isMinimized: vi.fn(() => false),
  }
  const disposeHost = vi.fn(() => Promise.resolve())
  const releaseQuit = vi.fn()
  const lifecycle = createDesktopLifecycle({
    getWindow: () => window as never,
    createWindow: () => window as never,
    readCloseBehavior: () => closeBehavior,
    disposeHost,
    releaseQuit,
    reportError: vi.fn(),
  })
  return { lifecycle, window, disposeHost, releaseQuit }
}

describe('desktop lifecycle', () => {
  it('hides an ordinary close when tray behavior is selected', () => {
    const b = bench('tray')
    const event = { preventDefault: vi.fn() }
    b.lifecycle.onWindowClose(event as never)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(b.window.hide).toHaveBeenCalledOnce()
    expect(b.disposeHost).not.toHaveBeenCalled()
  })

  it('serializes quit requests and releases only after host disposal', async () => {
    const b = bench('quit')
    const first = b.lifecycle.requestQuit()
    const second = b.lifecycle.requestQuit()
    expect(first).toBe(second)
    await first
    expect(b.disposeHost).toHaveBeenCalledOnce()
    expect(b.releaseQuit).toHaveBeenCalledOnce()
  })
})

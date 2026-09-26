import { describe, expect, it, vi } from 'vitest'
import { createDesktopLifecycle, type DesktopLifecycleOptions } from '../src/window-lifecycle.ts'

function bench(closeBehavior: 'tray' | 'quit', options: Partial<DesktopLifecycleOptions> = {}) {
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
    ...options,
  })
  return { lifecycle, window, disposeHost, releaseQuit }
}

describe('desktop lifecycle', () => {
  it('does not schedule a restart until cleanup has completed', async () => {
    let settle!: () => void
    const cleanup = new Promise<void>((resolve) => { settle = resolve })
    const b = bench('quit', { disposeHost: () => cleanup })
    const relaunch = vi.fn()
    const pending = b.lifecycle.requestRestart(relaunch)
    await Promise.resolve()
    expect(relaunch).not.toHaveBeenCalled()
    expect(b.releaseQuit).not.toHaveBeenCalled()
    settle()
    await pending
    expect(relaunch).toHaveBeenCalledOnce()
    expect(b.releaseQuit).toHaveBeenCalledOnce()
  })

  it('keeps the window alive and allows retry after failed process cleanup', async () => {
    const failure = new Error('managed range remains alive')
    const cleanup = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(undefined)
    const reportError = vi.fn()
    const b = bench('quit', { disposeHost: cleanup, reportError })
    const relaunch = vi.fn()
    await b.lifecycle.requestRestart(relaunch)
    expect(relaunch).not.toHaveBeenCalled()
    expect(b.releaseQuit).not.toHaveBeenCalled()
    expect(b.lifecycle.isQuitting).toBe(false)
    expect(b.window.show).toHaveBeenCalledOnce()
    expect(reportError).toHaveBeenCalledWith(failure)
    await b.lifecycle.requestRestart(relaunch)
    expect(cleanup).toHaveBeenCalledTimes(2)
    expect(relaunch).toHaveBeenCalledOnce()
    expect(b.releaseQuit).toHaveBeenCalledOnce()
  })
  it('does not schedule a relaunch or stop Harness while a plugin mutation is active', async () => {
    const b = bench('quit', { canQuit: () => false })
    const relaunch = vi.fn()
    await b.lifecycle.requestRestart(relaunch)
    await b.lifecycle.requestQuit()
    expect(relaunch).not.toHaveBeenCalled()
    expect(b.disposeHost).not.toHaveBeenCalled()
    expect(b.lifecycle.isQuitting).toBe(false)
  })
  it('keeps the window accessible when tray creation failed', () => {
    const warning = vi.fn()
    const b = bench('tray', { canHideToTray: () => false, onTrayUnavailable: warning })
    b.lifecycle.onWindowClose({ preventDefault: vi.fn() } as never)
    expect(warning).toHaveBeenCalledOnce()
    expect(b.window.hide).not.toHaveBeenCalled()
    expect(b.disposeHost).not.toHaveBeenCalled()
  })
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

  it('waits for task confirmation before disposing and leaves a cancelled quit intact', async () => {
    const decision = Promise.withResolvers<boolean>()
    const confirmQuit = vi.fn(() => decision.promise)
    const b = bench('quit', { confirmQuit })
    const pending = b.lifecycle.requestQuit()
    expect(b.lifecycle.requestQuit()).toBe(pending)
    await Promise.resolve()
    expect(confirmQuit).toHaveBeenCalledOnce()
    expect(b.disposeHost).not.toHaveBeenCalled()
    decision.resolve(false)
    await pending
    expect(b.lifecycle.isQuitting).toBe(false)
    expect(b.disposeHost).not.toHaveBeenCalled()
    expect(b.releaseQuit).not.toHaveBeenCalled()
    await b.lifecycle.requestQuit()
    expect(confirmQuit).toHaveBeenCalledTimes(2)
  })

  it('lets quick restart supersede a pending quit decision without trusting its late answer', async () => {
    const decision = Promise.withResolvers<boolean>()
    const cancelQuitConfirmation = vi.fn()
    const b = bench('quit', { confirmQuit: () => decision.promise, cancelQuitConfirmation })
    const pendingQuit = b.lifecycle.requestQuit()
    const relaunch = vi.fn()
    await b.lifecycle.requestRestart(relaunch)
    decision.resolve(true)
    await pendingQuit
    expect(cancelQuitConfirmation).toHaveBeenCalledOnce()
    expect(b.disposeHost).toHaveBeenCalledOnce()
    expect(relaunch).toHaveBeenCalledOnce()
    expect(b.releaseQuit).toHaveBeenCalledOnce()
  })

  it('lets a definitive system session end bypass a dialog without bypassing cleanup', async () => {
    const decision = Promise.withResolvers<boolean>()
    const confirmQuit = vi.fn(() => decision.promise)
    const cancelQuitConfirmation = vi.fn()
    const b = bench('quit', { confirmQuit, cancelQuitConfirmation })
    const ordinaryQuit = b.lifecycle.requestQuit()
    await b.lifecycle.requestQuit({ skipConfirmation: true })
    decision.resolve(false)
    await ordinaryQuit
    expect(cancelQuitConfirmation).toHaveBeenCalledOnce()
    expect(b.disposeHost).toHaveBeenCalledOnce()
    expect(b.releaseQuit).toHaveBeenCalledOnce()
  })

  it('does not open a superseded dialog when system termination arrives in the same turn', async () => {
    const confirmQuit = vi.fn(async () => true)
    const b = bench('quit', { confirmQuit })
    const ordinaryQuit = b.lifecycle.requestQuit()
    await b.lifecycle.requestQuit({ skipConfirmation: true })
    await ordinaryQuit
    expect(confirmQuit).not.toHaveBeenCalled()
    expect(b.disposeHost).toHaveBeenCalledOnce()
  })

  it('rechecks the mutation guard after approval and refuses teardown if work started meanwhile', async () => {
    const decision = Promise.withResolvers<boolean>()
    let busy = false
    const b = bench('quit', { confirmQuit: () => decision.promise, canQuit: () => !busy })
    const pending = b.lifecycle.requestQuit()
    busy = true
    decision.resolve(true)
    await pending
    expect(b.disposeHost).not.toHaveBeenCalled()
    expect(b.lifecycle.isQuitting).toBe(false)
  })

  it('schedules one relaunch and performs the same graceful host disposal', async () => {
    const b = bench('tray')
    const relaunch = vi.fn()
    const first = b.lifecycle.requestRestart(relaunch)
    const second = b.lifecycle.requestRestart(relaunch)

    expect(first).toBe(second)
    expect(relaunch).not.toHaveBeenCalled()
    await first
    expect(relaunch).toHaveBeenCalledOnce()
    expect(b.disposeHost).toHaveBeenCalledOnce()
    expect(b.releaseQuit).toHaveBeenCalledOnce()
  })
})

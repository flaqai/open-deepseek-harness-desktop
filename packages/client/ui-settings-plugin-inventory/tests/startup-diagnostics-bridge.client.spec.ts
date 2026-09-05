import { afterEach, describe, expect, it, vi } from 'vitest'
import { desktopStartupDiagnosticsAvailable } from '../src/client/startup-diagnostics-bridge.ts'

afterEach(() => {
  delete (globalThis as typeof globalThis & { deepSeekHarnessDesktop?: unknown }).deepSeekHarnessDesktop
})

describe('desktop startup diagnostics bridge', () => {
  it('is unavailable unless every narrow desktop method is present', () => {
    expect(desktopStartupDiagnosticsAvailable()).toBeUndefined()
    ;(globalThis as typeof globalThis & { deepSeekHarnessDesktop?: unknown }).deepSeekHarnessDesktop = {
      startupDiagnostics: { list: async () => [], openLog: async () => ({ error: '' }) },
    }
    expect(desktopStartupDiagnosticsAvailable()).toBeUndefined()
  })

  it('forwards only an opaque incident id and fixed recovery actions', async () => {
    const list = vi.fn(async () => [])
    const retry = vi.fn(async () => ({ status: 'plugin-started' as const, installId: 'desktop-bundled:test' }))
    const openLog = vi.fn(async () => ({ error: '' }))
    ;(globalThis as typeof globalThis & { deepSeekHarnessDesktop?: unknown }).deepSeekHarnessDesktop = {
      startupDiagnostics: { list, retry, openLog },
    }

    const bridge = desktopStartupDiagnosticsAvailable()
    await expect(bridge?.list()).resolves.toEqual([])
    await expect(bridge?.retry('incident-id')).resolves.toEqual({
      status: 'plugin-started', installId: 'desktop-bundled:test',
    })
    await expect(bridge?.openLog()).resolves.toEqual({ error: '' })
    expect(retry).toHaveBeenCalledWith('incident-id')
  })
})

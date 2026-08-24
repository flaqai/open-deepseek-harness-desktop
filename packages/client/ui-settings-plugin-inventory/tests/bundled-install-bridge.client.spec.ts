// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  PluginInstallId,
  PluginInstallRequest,
  PluginInstallSnapshot,
} from '@deepseek-ai/dsh-host-plugin-inventory/types'
import {
  getDeferredPluginInstall,
  getPluginInstall,
  installDesktopDiagnosticFixture,
  openDesktopHarnessLog,
  restartDesktopApplication,
  startDeferredPluginInstall,
  startPluginInstall,
} from '../src/client/bundled-install-bridge.ts'
import type { DesktopBundledPluginInstallSnapshot } from '../src/client/bundled-install-bridge.ts'

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).deepSeekHarnessDesktop
})

const request: PluginInstallRequest = { profile: 'web', packageSpec: 'dsh-better-sidebar@0.15.2' }
const desktopSnapshot = {
  installId: 'desktop-bundled:one' as PluginInstallId,
  profile: 'web', packageSpec: request.packageSpec,
  command: 'dsh plugin --profile web add dsh-better-sidebar@0.15.2', phase: 'running',
  stage: 'extracting' as const, progress: 46,
} satisfies DesktopBundledPluginInstallSnapshot

describe('desktop bundled install bridge', () => {
  it('uses an allowlisted desktop job and polls it through Electron', async () => {
    const startInstall = vi.fn(async () => ({ handled: true as const, snapshot: desktopSnapshot }))
    const getInstall = vi.fn(async () => ({ ...desktopSnapshot, phase: 'succeeded' as const }))
    ;(globalThis as unknown as Record<string, unknown>).deepSeekHarnessDesktop = {
      bundledPlugins: { startInstall, getInstall },
    }
    const fallbackStart = vi.fn<(_: PluginInstallRequest) => Promise<PluginInstallSnapshot>>()
    await expect(startPluginInstall(request, fallbackStart)).resolves.toBe(desktopSnapshot)
    expect(fallbackStart).not.toHaveBeenCalled()
    await expect(getPluginInstall(desktopSnapshot.installId, vi.fn())).resolves.toMatchObject({ phase: 'succeeded' })
    expect(getInstall).toHaveBeenCalledWith('desktop-bundled:one')
  })

  it('falls back to Host Remote for non-bundled requests and ids', async () => {
    const hostSnapshot = { ...desktopSnapshot, installId: 'host-one' as PluginInstallId }
    ;(globalThis as unknown as Record<string, unknown>).deepSeekHarnessDesktop = {
      bundledPlugins: { startInstall: vi.fn(async () => ({ handled: false as const })), getInstall: vi.fn() },
    }
    const fallbackStart = vi.fn(async () => hostSnapshot)
    await expect(startPluginInstall(request, fallbackStart)).resolves.toBe(hostSnapshot)
    const fallbackGet = vi.fn(async () => hostSnapshot)
    await expect(getPluginInstall(hostSnapshot.installId, fallbackGet)).resolves.toBe(hostSnapshot)
    expect(fallbackGet).toHaveBeenCalledWith(hostSnapshot.installId)
  })

  it('uses narrow deferred, log, and restart capabilities when Electron exposes them', async () => {
    const startDeferred = vi.fn(async () => ({ handled: true as const, snapshot: desktopSnapshot }))
    const getInstall = vi.fn(async () => desktopSnapshot)
    const openLog = vi.fn(async () => ({ opened: true }))
    const restart = vi.fn(async () => ({ restarting: true }))
    ;(globalThis as unknown as Record<string, unknown>).deepSeekHarnessDesktop = {
      bundledPlugins: { startInstall: vi.fn(), startDeferred, getInstall },
      shell: { openLog, restart },
    }
    await expect(startDeferredPluginInstall(request)).resolves.toBe(desktopSnapshot)
    await expect(getDeferredPluginInstall(desktopSnapshot.installId)).resolves.toBe(desktopSnapshot)
    await expect(openDesktopHarnessLog()).resolves.toBe(true)
    await expect(restartDesktopApplication()).resolves.toBe(true)
    expect(openLog).toHaveBeenCalledOnce()
    expect(restart).toHaveBeenCalledOnce()
  })

  it('stays invisible when the deferred marker or desktop bridge is unavailable', async () => {
    await expect(startDeferredPluginInstall(request)).resolves.toBeUndefined()
    await expect(openDesktopHarnessLog()).resolves.toBe(false)
    await expect(restartDesktopApplication()).resolves.toBe(false)
    await expect(installDesktopDiagnosticFixture()).resolves.toBeUndefined()
  })

  it('runs only the fixed diagnostic fixture capability exposed by Electron source mode', async () => {
    const install = vi.fn(async () => ({ installed: true as const, diagnostic: 'real quarantine report' }))
    ;(globalThis as unknown as Record<string, unknown>).deepSeekHarnessDesktop = { diagnosticFixtures: { install } }
    await expect(installDesktopDiagnosticFixture()).resolves.toBe('real quarantine report')
    expect(install).toHaveBeenCalledOnce()
    ;(globalThis as unknown as Record<string, unknown>).deepSeekHarnessDesktop = { shell: {}, bundledPlugins: {} }
    await expect(installDesktopDiagnosticFixture()).resolves.toBeUndefined()
  })
})

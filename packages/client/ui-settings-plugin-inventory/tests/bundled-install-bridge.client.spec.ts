// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  PluginInstallId,
  PluginInstallRequest,
  PluginInstallSnapshot,
} from '@deepseek-ai/dsh-host-plugin-inventory/types'
import { getPluginInstall, startPluginInstall } from '../src/client/bundled-install-bridge.ts'

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).deepSeekHarnessDesktop
})

const request: PluginInstallRequest = { profile: 'web', packageSpec: 'dsh-better-sidebar@0.15.2' }
const desktopSnapshot = {
  installId: 'desktop-bundled:one' as PluginInstallId,
  profile: 'web', packageSpec: request.packageSpec,
  command: 'dsh plugin --profile web add dsh-better-sidebar@0.15.2', phase: 'running',
} satisfies PluginInstallSnapshot

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
})

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  PluginInstallId,
  PluginInstallRequest,
  PluginInstallSnapshot,
} from '@deepseek-ai/dsh-host-plugin-inventory/types'
import {
  cancelDesktopDiagnosticLabRun,
  restoreAllDesktopDiagnosticLabRun,
  desktopDiagnosticLabAvailable,
  exportDesktopDiagnosticLabRun,
  getDeferredPluginInstall,
  getCurrentDesktopDiagnosticLabRun,
  getDesktopDiagnosticLabRun,
  getPluginInstall,
  listDesktopDiagnosticLabScenarios,
  openDesktopHarnessLog,
  restartDesktopApplication,
  startDesktopDiagnosticLab,
  startDeferredPluginInstall,
  startPluginInstall,
  subscribeDesktopDiagnosticLab,
} from '../src/client/bundled-install-bridge.ts'
import type {
  DesktopBundledPluginInstallSnapshot,
  DiagnosticLabRunSnapshot,
  DiagnosticLabScenario,
} from '../src/client/bundled-install-bridge.ts'

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'deepSeekHarnessDesktop')
})

function setDesktopBridge(value: object): void {
  Object.defineProperty(globalThis, 'deepSeekHarnessDesktop', { configurable: true, value })
}

const request: PluginInstallRequest = { profile: 'web', packageSpec: 'dsh-better-sidebar' }
const desktopSnapshot = {
  installId: 'desktop-bundled:one' as PluginInstallId,
  profile: 'web', packageSpec: request.packageSpec,
  command: 'dsh plugin --profile web add dsh-better-sidebar@0.16.1', phase: 'running',
  stage: 'extracting' as const, progress: 46,
} satisfies DesktopBundledPluginInstallSnapshot
const labScenario = {
  id: 'orphaned-bundle',
  title: 'Orphaned bundle',
  description: 'Fixture',
  expectedCode: 'ORPHANED_BUNDLE',
  targets: ['isolated', 'active-profile'],
} satisfies DiagnosticLabScenario
const labSnapshot = {
  schema: 2,
  runId: 'lab-one',
  target: 'isolated',
  scenarioIds: [labScenario.id],
  phase: 'queued',
  completedSteps: 0,
  totalSteps: 6,
  recovery: 'clean',
  startedAt: '2026-08-28T00:00:00.000Z',
  results: [],
} satisfies DiagnosticLabRunSnapshot

describe('desktop bundled install bridge', () => {
  it('uses an allowlisted desktop job and polls it through Electron', async () => {
    const startInstall = vi.fn(async () => ({ handled: true as const, snapshot: desktopSnapshot }))
    const getInstall = vi.fn(async () => ({ ...desktopSnapshot, phase: 'succeeded' as const }))
    setDesktopBridge({
      bundledPlugins: { startInstall, getInstall },
    })
    const fallbackStart = vi.fn<(_: PluginInstallRequest) => Promise<PluginInstallSnapshot>>()
    await expect(startPluginInstall(request, fallbackStart)).resolves.toBe(desktopSnapshot)
    expect(fallbackStart).not.toHaveBeenCalled()
    await expect(getPluginInstall(desktopSnapshot.installId, vi.fn())).resolves.toMatchObject({ phase: 'succeeded' })
    expect(getInstall).toHaveBeenCalledWith('desktop-bundled:one')
  })

  it('falls back to Host Remote for non-bundled requests and ids', async () => {
    const hostSnapshot = { ...desktopSnapshot, installId: 'host-one' as PluginInstallId }
    setDesktopBridge({
      bundledPlugins: { startInstall: vi.fn(async () => ({ handled: false as const })), getInstall: vi.fn() },
    })
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
    setDesktopBridge({
      bundledPlugins: { startInstall: vi.fn(), startDeferred, getInstall },
      shell: { openLog, restart },
    })
    await expect(startDeferredPluginInstall(request)).resolves.toBe(desktopSnapshot)
    await expect(getDeferredPluginInstall(desktopSnapshot.installId)).resolves.toBe(desktopSnapshot)
    await expect(openDesktopHarnessLog()).resolves.toBe(true)
    await expect(restartDesktopApplication()).resolves.toBe(true)
    expect(openLog).toHaveBeenCalledOnce()
    expect(restart).toHaveBeenCalledOnce()
  })

  it('stays invisible when the deferred marker or desktop bridge is unavailable', async () => {
    expect(desktopDiagnosticLabAvailable()).toBe(false)
    await expect(startDeferredPluginInstall(request)).resolves.toBeUndefined()
    await expect(openDesktopHarnessLog()).resolves.toBe(false)
    await expect(restartDesktopApplication()).resolves.toBe(false)
    await expect(listDesktopDiagnosticLabScenarios()).rejects.toThrow('desktop diagnostic lab bridge is unavailable')
    expect(subscribeDesktopDiagnosticLab(vi.fn())).toEqual(expect.any(Function))
  })

  it('routes every Diagnostics Lab operation through the complete restricted bridge', async () => {
    const catalog = vi.fn(async () => [labScenario])
    const start = vi.fn(async () => labSnapshot)
    const getRun = vi.fn(async () => labSnapshot)
    const cancel = vi.fn(async () => ({ ...labSnapshot, phase: 'cancelled' as const }))
    const restoreAll = vi.fn(async () => ({ ...labSnapshot, phase: 'restored' as const }))
    const exportReport = vi.fn(async () => '{"schema":2}')
    const onStatus = vi.fn(() => () => {})
    setDesktopBridge({
      diagnosticLab: { catalog, current: vi.fn(async () => labSnapshot), start, getRun, cancel, restoreAll, exportReport, onStatus },
    })
    expect(desktopDiagnosticLabAvailable()).toBe(true)
    await expect(listDesktopDiagnosticLabScenarios()).resolves.toEqual([labScenario])
    await expect(getCurrentDesktopDiagnosticLabRun()).resolves.toBe(labSnapshot)
    await expect(startDesktopDiagnosticLab({
      scenarioIds: [labScenario.id], target: 'isolated',
    })).resolves.toBe(labSnapshot)
    await expect(getDesktopDiagnosticLabRun('lab-one')).resolves.toBe(labSnapshot)
    await expect(cancelDesktopDiagnosticLabRun('lab-one')).resolves.toMatchObject({ phase: 'cancelled' })
    await expect(restoreAllDesktopDiagnosticLabRun('lab-one')).resolves.toMatchObject({ phase: 'restored' })
    await expect(exportDesktopDiagnosticLabRun('lab-one')).resolves.toBe('{"schema":2}')
    const unsubscribe = subscribeDesktopDiagnosticLab(vi.fn())
    expect(onStatus).toHaveBeenCalledOnce()
    unsubscribe()
    setDesktopBridge({ shell: {}, bundledPlugins: {} })
    expect(desktopDiagnosticLabAvailable()).toBe(false)
    await expect(startDesktopDiagnosticLab({
      scenarioIds: [labScenario.id], target: 'isolated',
    })).rejects.toThrow('desktop diagnostic lab bridge is unavailable')
  })
})

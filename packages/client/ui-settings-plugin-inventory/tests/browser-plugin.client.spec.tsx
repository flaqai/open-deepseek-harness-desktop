// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ClientModuleLoader } from '@deepseek-ai/dsh-client-modules/client'
import { apply, inject, NS } from '../src/client/index.ts'
import { PluginInventorySettingsTab } from '../src/client/PluginInventorySettingsTab.tsx'
import { PluginDiagnosticsSection } from '../src/client/PluginDiagnosticsSection.tsx'
import type { PluginDiagnosticsSectionInjected } from '../src/client/PluginDiagnosticsSection.tsx'
import { ExternalToolsSection } from '../src/client/ExternalToolsSection.tsx'
import { PluginDiscovery } from '../src/client/PluginDiscovery.tsx'
import { ImportedPluginRestoreSection } from '../src/client/ImportedPluginRestore.tsx'
import { QuarantineNotice } from '../src/client/QuarantineNotice.tsx'
import type { PluginInventorySettingsTabInjected } from '../src/client/PluginInventorySettingsTab.tsx'
import { apply as hostApply } from '../src/index.ts'

usePinnedBrowserLanguages('zh-CN')
afterEach(() => {
  cleanup()
  delete (globalThis as typeof globalThis & { deepSeekHarnessDesktop?: unknown }).deepSeekHarnessDesktop
})

const EMPTY = { entries: [], dependencyHealth: { lastRepair: null, quarantined: [] } }

function isInventoryInjected(value: unknown): value is PluginInventorySettingsTabInjected {
  return typeof value === 'object' && value !== null
    && 'resolveText' in value && typeof value.resolveText === 'function'
    && 'retryClient' in value && typeof value.retryClient === 'function'
    && 'list' in value && typeof value.list === 'function'
    && 'presetName' in value && typeof value.presetName === 'function'
}

function isDiagnosticsInjected(value: unknown): value is PluginDiagnosticsSectionInjected {
  return typeof value === 'object' && value !== null
    && 'openPluginMarket' in value && typeof value.openPluginMarket === 'function'
}
type ListResult =
  | { readonly ok: true; readonly value: typeof EMPTY }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

const restoreBridge = {
  development: true,
  get: vi.fn(),
  checkSources: vi.fn(),
  start: vi.fn(),
  chooseLocalDirectory: vi.fn(),
  chooseLocalArchive: vi.fn(),
  dismiss: vi.fn(),
  ignore: vi.fn(),
}

async function bench(options: { desktopRestore?: boolean; diagnosticLab?: boolean } = {}) {
  const diagnosticLabCatalog = vi.fn(async () => [{
    id: 'orphaned-bundle' as const,
    title: 'Orphaned bundle',
    description: 'Fixture',
    expectedCode: 'ORPHANED_BUNDLE',
    targets: ['isolated' as const, 'active-profile' as const],
  }])
  const diagnosticLab = {
    catalog: diagnosticLabCatalog,
    current: vi.fn(async () => undefined),
    start: vi.fn(),
    getRun: vi.fn(),
    cancel: vi.fn(),
    restoreAll: vi.fn(),
    exportReport: vi.fn(),
    onStatus: vi.fn(() => () => {}),
  }
  const desktop = {
    ...(options.desktopRestore !== false ? { importedPlugins: restoreBridge } : {}),
    ...(options.diagnosticLab === true ? { diagnosticLab } : {}),
  }
  if (Object.keys(desktop).length > 0) {
    ;(globalThis as typeof globalThis & { deepSeekHarnessDesktop?: unknown }).deepSeekHarnessDesktop = desktop
  }
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  const retryClient = vi.fn(async () => {})
  ctx.provide('modules', { entries: { state: createSnapshotStore({ syncing: false, failures: [] }), retry: retryClient } } as unknown as ClientModuleLoader)
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  const settingsOpen = vi.fn()
  ctx.provide('settingsNavigation', { open: settingsOpen } as never)
  const list = vi.fn<() => Promise<ListResult>>()
    .mockResolvedValue({ ok: true, value: EMPTY })
  const startInstall = vi.fn(async () => ({ ok: false as const, error: { code: 'REMOTE_ERROR', message: 'blocked' } }))
  const getInstall = vi.fn(async () => ({ ok: false as const, error: { code: 'REMOTE_ERROR', message: 'missing' } }))
  const startUninstall = vi.fn(async () => ({ ok: false, error: { code: 'REMOTE_ERROR', message: 'unavailable' } }))
  const startQuarantineRetry = vi.fn(async () => ({ ok: false, error: { code: 'REMOTE_ERROR', message: 'unavailable' } }))
  const uninstallQuarantine = vi.fn(async () => ({ ok: false, error: { code: 'REMOTE_ERROR', message: 'unavailable' } }))
  const dismissDependencyHealth = vi.fn(async () => ({ ok: false, error: { code: 'REMOTE_ERROR', message: 'unavailable' } }))
  const startDependencyDoctor = vi.fn(async () => ({ ok: false, error: { code: 'REMOTE_ERROR', message: 'unavailable' } }))
  const getDependencyDoctor = vi.fn(async () => ({ ok: false, error: { code: 'REMOTE_ERROR', message: 'unavailable' } }))
  const externalTools = vi.fn(async () => ({
    ok: true as const,
    value: { scope: 'complete-presets' as const, codex: false, claudeCode: false },
  }))
  const setExternalTool = vi.fn(async () => ({
    ok: true as const,
    value: { scope: 'complete-presets' as const, codex: true, claudeCode: false },
  }))
  ctx.provide('remote.pluginInventory', {
    list,
    startInstall,
    startUninstall,
    getInstall,
    startQuarantineRetry,
    uninstallQuarantine,
    dismissDependencyHealth,
    startDependencyDoctor,
    getDependencyDoctor,
    externalTools,
    setExternalTool,
  })
  return {
    ctx,
    slots: ctx.get('slots') as SlotRegistry,
    locale,
    retryClient,
    list,
    startInstall,
    getInstall,
    diagnosticLabCatalog,
    settingsOpen,
  }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'settings.plugins.tab': { kind: 'list', scope: 'root' },
      'settings.section': { kind: 'list', scope: 'root' },
      'conversation.hero.pluginDiscovery': { kind: 'single', scope: 'root' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
}

describe('ui-settings-plugin-inventory browser plugin', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares only the services used by the Settings Remote contribution', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.pluginInventory', 'settingsNavigation'])
  })

  it('registers a localized tab without reading the Remote eagerly', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = b.slots.entries('settings.plugins.tab')[0]!
    expect(entry.component).toBe(PluginInventorySettingsTab)
    expect(entry.options).toMatchObject({ id: 'all', order: 10 })
    expect(entry.locale).toBe(NS)
    expect(resolveSlotLabel(entry.options.label)).toBe('插件列表')
    const sections = b.slots.entries('settings.section')
    const external = sections.find(section => section.options.id === 'external-tools')!
    expect(external.component).toBe(ExternalToolsSection)
    expect(external.options).toMatchObject({ id: 'external-tools', order: 18 })
    expect(resolveSlotLabel(external.options.label)).toBe('工具与能力')
    const restore = sections.find(section => section.options.id === 'plugin-restore')!
    expect(restore.component).toBe(ImportedPluginRestoreSection)
    expect(restore.options).toMatchObject({ id: 'plugin-restore', order: 22 })
    expect(resolveSlotLabel(restore.options.label)).toBe('插件恢复')
    const diagnostics = sections.find(section => section.options.id === 'diagnostics')!
    expect(diagnostics.component).toBe(PluginDiagnosticsSection)
    expect(diagnostics.options).toMatchObject({ id: 'diagnostics', order: 25 })
    expect(resolveSlotLabel(diagnostics.options.label)).toBe('诊断')
    const diagnosticsInjected = diagnostics.inject?.()
    if (!isDiagnosticsInjected(diagnosticsInjected)) throw new Error('diagnostics injection was not registered')
    expect(diagnosticsInjected.diagnosticLab).toBeUndefined()
    diagnosticsInjected.openPluginMarket('@linxin666/dsh-client-ui-task-board')
    expect(b.settingsOpen).toHaveBeenCalledWith({
      sectionId: 'market',
      subsectionId: 'discover:@linxin666/dsh-client-ui-task-board',
    })
    expect(b.slots.entries('conversation.hero.pluginDiscovery')[0]?.component).toBe(PluginDiscovery)
    const overlays = b.slots.entries('shell.overlay')
    expect(overlays).toHaveLength(1)
    expect(overlays[0]?.component).toBe(QuarantineNotice)
    expect(b.list).not.toHaveBeenCalled()

    const injected = entry.inject?.()
    if (!isInventoryInjected(injected)) throw new Error('inventory injection was not registered')
    const text = { en: 'Local tools', zh: '本地工具' }
    expect(injected.resolveText(text)).toBe('本地工具')
    b.locale.setLocale('en')
    expect(injected.resolveText(text)).toBe('Local tools')
    b.locale.setLocale('zh')
    injected.retryClient()
    const retryError = vi.spyOn(b.ctx.logger, 'error').mockImplementation(() => {})
    b.retryClient.mockRejectedValueOnce(new Error('retry unavailable'))
    injected.retryClient()
    await vi.waitFor(() => { expect(retryError).toHaveBeenCalled() })
    retryError.mockRestore()
    await expect(injected.list()).resolves.toEqual(EMPTY)
    expect(b.list).toHaveBeenCalledOnce()
    b.list.mockResolvedValueOnce({ ok: false, error: { code: 'REMOTE_ERROR', message: 'unavailable' } })
    await expect(injected.list()).rejects.toThrow('pluginInventory.list failed: REMOTE_ERROR: unavailable')

    // Shipped preset names resolve over the agent-preset dictionaries the
    // real plugin registers; user-authored metadata stays untranslated.
    b.locale.register('settings.agentPreset', 'zh', { presetStandardName: '标准模式' } as never)
    expect(injected.presetName({ id: 'standard', isDefault: true, rows: [] })).toBe('标准模式')
    expect(injected.presetName({ id: 'mine', name: '我自己的', isDefault: false, rows: [] })).toBe('我自己的')
    await b.ctx.fiber.dispose()
  })

  it('does not expose desktop-only plugin recovery in an ordinary Web client', async () => {
    const b = await bench({ desktopRestore: false })
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    expect(b.slots.entries('settings.section').some(section => section.options.id === 'plugin-restore')).toBe(false)
    await b.ctx.fiber.dispose()
  })

  it('exposes the restricted Diagnostics Lab only when Electron provides its full bridge', async () => {
    const b = await bench({ diagnosticLab: true })
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const diagnostics = b.slots.entries('settings.section')
      .find(section => section.options.id === 'diagnostics')!
    const injected = diagnostics.inject?.()
    if (!isDiagnosticsInjected(injected)) throw new Error('diagnostics injection was not registered')
    await expect(injected.diagnosticLab?.listScenarios()).resolves.toEqual([
      expect.objectContaining({ id: 'orphaned-bundle' }),
    ])
    expect(b.slots.entries('shell.overlay')).toHaveLength(2)
    expect(b.diagnosticLabCatalog).toHaveBeenCalledOnce()
    await b.ctx.fiber.dispose()
  })

  it('follows locale and recovers across late declaration and declarer reload', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    expect(b.slots.entries('conversation.hero.pluginDiscovery')).toHaveLength(0)
    expect(b.slots.entries('shell.overlay')).toHaveLength(0)

    const stop = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.plugins.tab')).toHaveLength(1) })
    b.locale.setLocale('en')
    expect(resolveSlotLabel(b.slots.entries('settings.plugins.tab')[0]!.options.label)).toBe('Plugin list')
    const englishSections = b.slots.entries('settings.section')
    expect(resolveSlotLabel(englishSections.find(section => section.options.id === 'external-tools')!.options.label))
      .toBe('Tools & capabilities')
    expect(resolveSlotLabel(englishSections.find(section => section.options.id === 'plugin-restore')!.options.label))
      .toBe('Plugin recovery')
    expect(resolveSlotLabel(englishSections.find(section => section.options.id === 'diagnostics')!.options.label))
      .toBe('Diagnostics')

    stop()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    expect(b.slots.entries('conversation.hero.pluginDiscovery')).toHaveLength(0)
    declare(b.slots)
    await vi.waitFor(() => {
      expect(b.slots.entries('settings.plugins.tab')[0]?.component).toBe(PluginInventorySettingsTab)
      const sections = b.slots.entries('settings.section')
      expect(sections.find(section => section.options.id === 'external-tools')?.component).toBe(ExternalToolsSection)
      expect(sections.find(section => section.options.id === 'plugin-restore')?.component).toBe(ImportedPluginRestoreSection)
      expect(sections.find(section => section.options.id === 'diagnostics')?.component).toBe(PluginDiagnosticsSection)
      expect(b.slots.entries('conversation.hero.pluginDiscovery')[0]?.component).toBe(PluginDiscovery)
      expect(b.slots.entries('shell.overlay')).toHaveLength(1)
    })

    await fiber.dispose()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    expect(b.slots.entries('conversation.hero.pluginDiscovery')).toHaveLength(0)
    expect(b.slots.entries('shell.overlay')).toHaveLength(0)
    expect(() => b.locale.register(NS, 'zh', {})).not.toThrow()
    await b.ctx.fiber.dispose()
  })
})

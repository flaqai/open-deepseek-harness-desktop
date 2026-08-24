// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject, NS } from '../src/client/index.ts'
import { PluginInventorySettingsTab } from '../src/client/PluginInventorySettingsTab.tsx'
import { PluginDiagnosticsSection } from '../src/client/PluginDiagnosticsSection.tsx'
import { ExternalToolsSection } from '../src/client/ExternalToolsSection.tsx'
import { PluginDiscovery } from '../src/client/PluginDiscovery.tsx'
import { BetterSidebarInstallCard } from '../src/client/BetterSidebarInstallCard.tsx'
import type { PluginInventorySettingsTabInjected } from '../src/client/PluginInventorySettingsTab.tsx'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

const EMPTY = { entries: [], dependencyHealth: { lastRepair: null, quarantined: [] } }
type ListResult =
  | { readonly ok: true; readonly value: typeof EMPTY }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
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
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, list, startInstall, getInstall }
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
  it('declares only the services used by the Settings Remote contribution', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.pluginInventory'])
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
    expect(resolveSlotLabel(external.options.label)).toBe('外部工具')
    const diagnostics = sections.find(section => section.options.id === 'diagnostics')!
    expect(diagnostics.component).toBe(PluginDiagnosticsSection)
    expect(diagnostics.options).toMatchObject({ id: 'diagnostics', order: 25 })
    expect(resolveSlotLabel(diagnostics.options.label)).toBe('诊断')
    expect(b.slots.entries('conversation.hero.pluginDiscovery')[0]?.component).toBe(PluginDiscovery)
    expect(b.slots.entries('shell.overlay')[0]?.component).toBe(BetterSidebarInstallCard)
    expect(b.list).not.toHaveBeenCalled()

    const injected = (entry.inject as unknown as () => PluginInventorySettingsTabInjected)()
    await expect(injected.list()).resolves.toEqual(EMPTY)
    expect(b.list).toHaveBeenCalledOnce()
    b.list.mockResolvedValueOnce({ ok: false, error: { code: 'REMOTE_ERROR', message: 'unavailable' } })
    await expect(injected.list()).rejects.toThrow('pluginInventory.list failed: REMOTE_ERROR: unavailable')
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
      .toBe('External tools')
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
      expect(sections.find(section => section.options.id === 'diagnostics')?.component).toBe(PluginDiagnosticsSection)
      expect(b.slots.entries('conversation.hero.pluginDiscovery')[0]?.component).toBe(PluginDiscovery)
      expect(b.slots.entries('shell.overlay')[0]?.component).toBe(BetterSidebarInstallCard)
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

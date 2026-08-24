/** Host plugin inventory and controlled installation registered into Web UI. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { PluginInventorySettingsTab, type PluginInventorySettingsTabInjected } from './PluginInventorySettingsTab.tsx'
import { PluginDiagnosticsSection, type PluginDiagnosticsSectionInjected } from './PluginDiagnosticsSection.tsx'
import { PluginDiscovery } from './PluginDiscovery.tsx'
import type { PluginDiscoveryInjected } from './PluginDiscovery.tsx'
import { ExternalToolsSection, type ExternalToolsSectionInjected } from './ExternalToolsSection.tsx'
import { en, zh, type PluginInventoryLocaleKey } from './locales.ts'
import { getPluginInstall, startPluginInstall } from './bundled-install-bridge.ts'

export type { PluginInventorySettingsTabInjected, PluginInventorySettingsTabProps } from './PluginInventorySettingsTab.tsx'
export type { PluginDiagnosticsSectionInjected, PluginDiagnosticsSectionProps } from './PluginDiagnosticsSection.tsx'
export type { PluginInventoryLocaleKey } from './locales.ts'
export type { ExternalToolsSectionInjected, ExternalToolsSectionProps } from './ExternalToolsSection.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Host plugin inventory and controlled-installation copy. */
    'settings.pluginInventory': PluginInventoryLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.pluginInventory'

/** Services required by the Settings registration and generated Remote face. */
export const inject = ['slots', 'locale', 'remote', 'remote.pluginInventory']

/** Contribute the lazy inventory tab and new-session discovery entry. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-plugin-inventory: dictionaries')

  const t = ctx.locale.bind(NS)
  const list: PluginInventorySettingsTabInjected['list'] = async () => {
    const result = await ctx.remote.pluginInventory.list()
    if (!result.ok) {
      throw new Error(`pluginInventory.list failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const getHostInstall: PluginInventorySettingsTabInjected['getInstall'] = async (installId) => {
    const result = await ctx.remote.pluginInventory.getInstall(installId)
    if (!result.ok) throw new Error(`pluginInventory.getInstall failed: ${result.error.code}: ${result.error.message}`)
    return result.value
  }
  const getInstall: PluginInventorySettingsTabInjected['getInstall'] = installId => (
    getPluginInstall(installId, getHostInstall)
  )
  const startUninstall: PluginInventorySettingsTabInjected['startUninstall'] = async (request) => {
    const result = await ctx.remote.pluginInventory.startUninstall(request)
    if (!result.ok) throw new Error(`pluginInventory.startUninstall failed: ${result.error.code}: ${result.error.message}`)
    return result.value
  }
  const injected = (): PluginInventorySettingsTabInjected => ({
    list,
    getInstall,
    startUninstall,
  })
  const diagnosticsInjected = (): PluginDiagnosticsSectionInjected => ({
    list,
    getInstall,
    startUninstall,
    startDependencyDoctor: async (request) => {
      const result = await ctx.remote.pluginInventory.startDependencyDoctor(request)
      if (!result.ok) throw new Error(`pluginInventory.startDependencyDoctor failed: ${result.error.code}: ${result.error.message}`)
      return result.value
    },
    getDependencyDoctor: async (doctorId) => {
      const result = await ctx.remote.pluginInventory.getDependencyDoctor(doctorId)
      if (!result.ok) throw new Error(`pluginInventory.getDependencyDoctor failed: ${result.error.code}: ${result.error.message}`)
      return result.value
    },
    startQuarantineRetry: async (request) => {
      const result = await ctx.remote.pluginInventory.startQuarantineRetry(request)
      if (!result.ok) throw new Error(`pluginInventory.startQuarantineRetry failed: ${result.error.code}: ${result.error.message}`)
      return result.value
    },
    uninstallQuarantine: async (request) => {
      const result = await ctx.remote.pluginInventory.uninstallQuarantine(request)
      if (!result.ok) throw new Error(`pluginInventory.uninstallQuarantine failed: ${result.error.code}: ${result.error.message}`)
      return result.value
    },
    dismissDependencyHealth: async (request) => {
      const result = await ctx.remote.pluginInventory.dismissDependencyHealth(request)
      if (!result.ok) throw new Error(`pluginInventory.dismissDependencyHealth failed: ${result.error.code}: ${result.error.message}`)
      return result.value
    },
  })
  const discoveryInjected = (): PluginDiscoveryInjected => ({
    startInstall: request => startPluginInstall(request, async (fallbackRequest) => {
      const result = await ctx.remote.pluginInventory.startInstall(fallbackRequest)
      if (!result.ok) {
        throw new Error(`pluginInventory.startInstall failed: ${result.error.code}: ${result.error.message}`)
      }
      return result.value
    }),
    getInstall,
  })
  const externalToolsInjected = (): ExternalToolsSectionInjected => ({
    list,
    getInstall,
    startInstall: discoveryInjected().startInstall,
    externalTools: async () => {
      const result = await ctx.remote.pluginInventory.externalTools()
      if (!result.ok) throw new Error(`pluginInventory.externalTools failed: ${result.error.code}: ${result.error.message}`)
      return result.value
    },
    setExternalTool: async (tool, enabled) => {
      const result = await ctx.remote.pluginInventory.setExternalTool({ tool, enabled })
      if (!result.ok) throw new Error(`pluginInventory.setExternalTool failed: ${result.error.code}: ${result.error.message}`)
      return result.value
    },
  })

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'all',
    order: 10,
    label: () => t('tab'),
    locale: NS,
    inject: injected,
  }, PluginInventorySettingsTab))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'external-tools',
    order: 18,
    label: () => t('external.nav'),
    locale: NS,
    inject: externalToolsInjected,
  }, ExternalToolsSection))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'diagnostics',
    order: 25,
    label: () => t('diagnostics.nav'),
    locale: NS,
    inject: diagnosticsInjected,
  }, PluginDiagnosticsSection))
  ctx.slots.inject('conversation.hero.pluginDiscovery', () => ctx.slots.register({
    name: 'conversation.hero.pluginDiscovery',
    locale: NS,
    inject: discoveryInjected,
  }, PluginDiscovery))
}

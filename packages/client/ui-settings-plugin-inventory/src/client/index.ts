/** Host plugin inventory and controlled installation registered into Web UI. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the shipped preset dictionaries used by presetDisplayText.
import type {} from '@deepseek-ai/dsh-client-ui-agent-preset/client'
import { presetDisplayText } from '@deepseek-ai/dsh-agent-presets/display'
import { PluginInventorySettingsTab, type PluginInventorySettingsTabInjected } from './PluginInventorySettingsTab.tsx'
import { PluginDiagnosticsSection, type PluginDiagnosticsSectionInjected } from './PluginDiagnosticsSection.tsx'
import { PluginDiscovery } from './PluginDiscovery.tsx'
import type { PluginDiscoveryInjected } from './PluginDiscovery.tsx'
import { ExternalToolsSection, type ExternalToolsSectionInjected } from './ExternalToolsSection.tsx'
import { resolveExternalToolInstallRequest } from './external-tool-compatibility-bridge.ts'
import { DiagnosticLabProgressCard } from './DiagnosticLabProgressCard.tsx'
import { QuarantineNotice, type QuarantineNoticeInjected } from './QuarantineNotice.tsx'
import {
  ImportedPluginRestoreSection,
  importedPluginRestoreInjected,
} from './ImportedPluginRestore.tsx'
import { readImportedPluginRestoreBridge } from './imported-restore-bridge.ts'
import { desktopPluginSnapshotsAvailable } from './plugin-snapshot-bridge.ts'
import { desktopSettingsRecoveryAvailable } from './settings-recovery-bridge.ts'
import { desktopStartupDiagnosticsAvailable } from './startup-diagnostics-bridge.ts'
import { en, zh, type PluginInventoryLocaleKey } from './locales.ts'
import {
  cancelDesktopDiagnosticLabRun,
  restoreAllDesktopDiagnosticLabRun,
  desktopDiagnosticLabAvailable,
  exportDesktopDiagnosticLabRun,
  getCurrentDesktopDiagnosticLabRun,
  getDesktopDiagnosticLabRun,
  getPluginInstall,
  listDesktopDiagnosticLabScenarios,
  startDesktopDiagnosticLab,
  subscribeDesktopDiagnosticLab,
  startPluginInstall,
} from './bundled-install-bridge.ts'

export {
  BetterSidebarInstallCard,
  type BetterSidebarInstallCardInjected,
  type BetterSidebarInstallCardProps,
} from './BetterSidebarInstallCard.tsx'

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
export const inject = ['slots', 'locale', 'remote', 'remote.pluginInventory', 'settingsNavigation']

/** Contribute the lazy inventory tab and new-session discovery entry. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-plugin-inventory: dictionaries')

  const t = ctx.locale.bind(NS)
  const importedPluginRestoreAvailable = readImportedPluginRestoreBridge() !== undefined
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
  const agentPresetCopy = ctx.locale.bind('settings.agentPreset')
  const presetName: PluginInventorySettingsTabInjected['presetName'] = preset =>
    presetDisplayText(preset, agentPresetCopy).name
  const injected = (): PluginInventorySettingsTabInjected => ({
    list,
    getInstall,
    startUninstall,
    presetName,
  })
  const diagnosticLab = desktopDiagnosticLabAvailable()
    ? {
      listScenarios: listDesktopDiagnosticLabScenarios,
      current: getCurrentDesktopDiagnosticLabRun,
      start: startDesktopDiagnosticLab,
      getRun: getDesktopDiagnosticLabRun,
      cancel: cancelDesktopDiagnosticLabRun,
      restoreAll: restoreAllDesktopDiagnosticLabRun,
      exportReport: exportDesktopDiagnosticLabRun,
      subscribe: subscribeDesktopDiagnosticLab,
    }
    : undefined
  const pluginSnapshots = desktopPluginSnapshotsAvailable()
  const settingsRecovery = desktopSettingsRecoveryAvailable()
  const startupDiagnostics = desktopStartupDiagnosticsAvailable()
  const diagnosticsInjected = (): PluginDiagnosticsSectionInjected => ({
    list,
    getInstall,
    startUninstall,
    ...(diagnosticLab === undefined ? {} : { diagnosticLab }),
    ...(pluginSnapshots === undefined ? {} : { pluginSnapshots }),
    ...(settingsRecovery === undefined ? {} : { settingsRecovery }),
    ...(startupDiagnostics === undefined ? {} : { startupDiagnostics }),
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
    approveQuarantineBuild: async (request) => {
      const result = await ctx.remote.pluginInventory.approveQuarantineBuild(request)
      if (!result.ok) throw new Error(`pluginInventory.approveQuarantineBuild failed: ${result.error.code}: ${result.error.message}`)
      return result.value
    },
    approveDiagnosticBuild: async (request) => {
      const result = await ctx.remote.pluginInventory.approveDiagnosticBuild(request)
      if (!result.ok) throw new Error(`pluginInventory.approveDiagnosticBuild failed: ${result.error.code}: ${result.error.message}`)
      return result.value
    },
    exportDiagnostics: async () => {
      const result = await ctx.remote.pluginInventory.exportDiagnostics()
      if (!result.ok) throw new Error(`pluginInventory.exportDiagnostics failed: ${result.error.code}: ${result.error.message}`)
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
    openPluginMarket: (packageName) => {
      ctx.settingsNavigation.open({ sectionId: 'market', subsectionId: `discover:${packageName}` })
    },
  })
  const startControlledInstall = (request: Parameters<typeof startPluginInstall>[0]) => startPluginInstall(
    request,
    async (fallbackRequest) => {
      const result = await ctx.remote.pluginInventory.startInstall(fallbackRequest)
      if (!result.ok) {
        throw new Error(`pluginInventory.startInstall failed: ${result.error.code}: ${result.error.message}`)
      }
      return result.value
    },
  )
  const discoveryInjected = (): PluginDiscoveryInjected => ({
    list,
    startInstall: startControlledInstall,
    getInstall,
    openSettings: (sectionId, subsectionId) => {
      ctx.settingsNavigation.open({ sectionId, ...(subsectionId === undefined ? {} : { subsectionId }) })
    },
  })
  const quarantineNoticeInjected = (): QuarantineNoticeInjected => ({
    list,
    dismissDependencyHealth: diagnosticsInjected().dismissDependencyHealth,
    openDiagnostics: () => { ctx.settingsNavigation.open({ sectionId: 'diagnostics' }) },
  })
  const externalToolsInjected = (): ExternalToolsSectionInjected => ({
    list,
    getInstall,
    installExternalTool: async toolId => startControlledInstall(await resolveExternalToolInstallRequest(toolId)),
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
  if (importedPluginRestoreAvailable) {
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: 'plugin-restore',
      order: 22,
      label: () => t('restore.nav'),
      locale: NS,
      inject: importedPluginRestoreInjected,
    }, ImportedPluginRestoreSection))
  }
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'diagnostics',
    order: 25,
    label: () => t('diagnostics.nav'),
    locale: NS,
    inject: diagnosticsInjected,
  }, PluginDiagnosticsSection))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'plugin-quarantine-notice',
    order: 70,
    locale: NS,
    inject: quarantineNoticeInjected,
  }, QuarantineNotice))
  if (diagnosticLab !== undefined) {
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay',
      id: 'diagnostic-lab-progress',
      order: 80,
      locale: NS,
      inject: () => diagnosticLab,
    }, DiagnosticLabProgressCard))
  }
  ctx.slots.inject('conversation.hero.pluginDiscovery', () => ctx.slots.register({
    name: 'conversation.hero.pluginDiscovery',
    locale: NS,
    inject: discoveryInjected,
  }, PluginDiscovery))
}

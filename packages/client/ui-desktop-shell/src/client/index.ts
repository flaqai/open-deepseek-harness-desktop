/** Desktop shell settings and the scoped browser-to-Electron return action. */

import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { DesktopPreferencesRow } from './DesktopPreferencesRow.tsx'
import { DesktopAboutSection } from './DesktopAboutSection.tsx'
import { DesktopBrowserReturnButton } from './DesktopBrowserReturnButton.tsx'
import { DesktopLogDirectoryAction } from './DesktopLogDirectoryAction.tsx'
import { DesktopSidebarUpdateButton } from './DesktopSidebarUpdateButton.tsx'
import { DesktopUpdateBadge } from './DesktopUpdateBadge.tsx'
import { NasRuntimeSection } from './NasRuntimeSection.tsx'
import { readDesktopBridge, readDesktopLocalShell } from './bridge.ts'
import { captureDesktopReturnTarget, requestDesktopReturn } from './browser-return.ts'
import { DesktopShellController } from './controller.ts'
import { registerDesktopLanguages } from './community-locales.ts'
import { navigateDesktopMenu } from './menu-navigation.ts'
import { en, zh, type DesktopShellKey } from './locales.ts'

export type { DesktopShellKey } from './locales.ts'
export { DesktopShellController } from './controller.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'desktop-shell': DesktopShellKey
  }
}

const NS = 'desktop-shell'
export const inject = ['slots', 'locale', 'connection']

function hasStartSession(value: unknown): value is { startSession(): void } {
  return typeof value === 'object' && value !== null
    && 'startSession' in value && typeof value.startSession === 'function'
}

export function apply(ctx: Context): void {
  ctx.effect(() => registerDesktopLanguages(ctx), 'ui-desktop-shell: community languages')
  const bridge = readDesktopBridge()
  if (bridge === null) {
    const target = captureDesktopReturnTarget()
    if (target === undefined) return
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-desktop-shell: browser return dictionaries')
    ctx.slots.inject('sidebar.settings.action', () => ctx.slots.register({
      name: 'sidebar.settings.action', id: 'desktop-return', order: -30, locale: NS,
      inject: () => ({ returnToDesktop: () => requestDesktopReturn(target) }),
    }, DesktopBrowserReturnButton))
    return
  }
  const localShell = readDesktopLocalShell(bridge.shell)
  const connection = ctx.get('connection') as ConnectionHandle
  bridge.shell.reportReadiness('client')
  ctx.effect(() => {
    const reportGeneration = (): void => {
      if (connection.generation.getSnapshot() !== undefined) {
        bridge.shell.reportReadiness('event-dispatch')
      }
    }
    reportGeneration()
    return connection.generation.subscribe(reportGeneration)
  }, 'ui-desktop-shell: readiness reporting')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-desktop-shell: dictionaries')
  const controller = new DesktopShellController(bridge)
  const menu = bridge.menu
  if (menu !== undefined) ctx.inject(['settingsNavigation', 'uiWorkspace'], (inner) => {
    inner.effect(() => {
      const report = (): void => { menu.reportState({
        available: true, ready: connection.state.getSnapshot() === 'connected', locale: inner.locale.getSnapshot().active,
      }) }
      const removeCommand = menu.onCommand((command) => {
        return navigateDesktopMenu(command, {
          startSession: () => {
            const workspace: unknown = inner.get('uiWorkspace')
            if (!hasStartSession(workspace)) {
              throw new TypeError('desktop shell: Workspace navigation is unavailable')
            }
            workspace.startSession()
          },
          open: (request) => { inner.settingsNavigation.open(request) },
          hasSection: id => inner.slots.entries('settings.section').some(entry => entry.options.id === id),
          general: (destination) => { controller.navigate(destination) },
          openRemoteControl: async () => {
            if ((await bridge.shell.getCapabilities()).runtimeKind === 'nas') {
              throw new Error(inner.locale.bind(NS)('remote.nasUnavailable'))
            }
            const plugins = inner.get('pluginNavigation')
            if (plugins === undefined) throw new Error(inner.locale.bind(NS)('menu.unavailable'))
            plugins.openBundle('@agents-anywhere/dsh-bridge-next')
          },
          unavailable: () => inner.locale.bind(NS)('menu.unavailable'),
        })
      })
      const removeState = connection.state.subscribe(report)
      const removeLocale = inner.locale.subscribe(report)
      report()
      return () => {
        removeCommand(); removeState(); removeLocale()
        menu.reportState({ available: false, ready: false, locale: inner.locale.getSnapshot().active })
      }
    }, 'ui-desktop-shell: native menu navigation')
  })
  ctx.effect(() => {
    controller.start()
    return () => { controller.dispose() }
  }, 'ui-desktop-shell: bridge state')
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item', id: 'desktop-shell', order: 75, locale: NS,
    inject: () => ({
      controller, icons: bridge.icons, processes: bridge.processes, downloadNetwork: controller.downloadNetwork,
      ...(localShell === undefined ? {} : { openLog: () => localShell.openLog() }),
    }),
  }, DesktopPreferencesRow))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'about', order: 100, label: () => ctx.locale.bind(NS)('about.nav'), locale: NS,
    inject: () => ({
      controller, feedback: bridge.communityFeedback, downloadNetwork: controller.downloadNetwork,
      openLink: (kind: 'github' | 'cnb' | 'issues') => {
        const links = {
          github: 'https://github.com/flaqai/open-deepseek-harness-desktop',
          cnb: 'https://cnb.cool/hecoococ/open-deepseek-harness-desktop',
          issues: 'https://github.com/flaqai/open-deepseek-harness-desktop/issues',
        }
        return bridge.externalBrowser?.open(links[kind]) ?? Promise.reject(new Error('External browser is unavailable'))
      },
    }),
  }, DesktopAboutSection))
  const nasBridge = bridge.nas
  if (nasBridge !== undefined) ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'nas-runtime', order: 45, label: () => ctx.locale.bind(NS)('nas.nav'), locale: NS,
    inject: () => ({ bridge: nasBridge }),
  }, NasRuntimeSection))
  if (localShell !== undefined) ctx.slots.inject('settings.action', () => ctx.slots.register({
    name: 'settings.action', id: 'desktop-log-directory', order: -10, locale: NS,
    inject: () => ({ openLog: () => localShell.openLog() }),
  }, DesktopLogDirectoryAction))
  ctx.inject(['settingsNavigation'], (inner) => {
    const openUpdates = (): void => {
      inner.settingsNavigation.open({ sectionId: 'about' })
      controller.navigate('updates')
    }
    inner.effect(() => {
      const openDownloadNetwork = (): void => {
        inner.settingsNavigation.open({ sectionId: 'general' })
        controller.navigate('download-network')
      }
      window.addEventListener('open-dsh:download-network', openDownloadNetwork)
      return () => { window.removeEventListener('open-dsh:download-network', openDownloadNetwork) }
    }, 'ui-desktop-shell: market download settings navigation')
    inner.slots.inject('settings.action', () => inner.slots.register({
      name: 'settings.action', id: 'desktop-update', order: -20, locale: NS,
      inject: () => ({
        controller,
        openUpdates,
      }),
    }, DesktopUpdateBadge))
    inner.slots.inject('sidebar.settings.action', () => inner.slots.register({
      name: 'sidebar.settings.action', id: 'desktop-update', order: -20, locale: NS,
      inject: () => ({ controller, openUpdates }),
    }, DesktopSidebarUpdateButton))
  })
}

/** Electron-only desktop shell settings and Release notification plugin. */

import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { DesktopPreferencesRow } from './DesktopPreferencesRow.tsx'
import { DesktopSidebarUpdateButton } from './DesktopSidebarUpdateButton.tsx'
import { DesktopUpdateBadge } from './DesktopUpdateBadge.tsx'
import { readDesktopBridge } from './bridge.ts'
import { DesktopShellController } from './controller.ts'
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

export function apply(ctx: Context): void {
  const bridge = readDesktopBridge()
  if (bridge === null) return
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
        ready: connection.state.getSnapshot() === 'connected', locale: inner.locale.getSnapshot().active,
      }) }
      const removeCommand = menu.onCommand((command) => {
        navigateDesktopMenu(command, {
          startSession: () => { (inner.get('uiWorkspace') as unknown as { startSession(): void }).startSession() },
          open: (request) => { inner.settingsNavigation.open(request) },
          hasSection: id => inner.slots.entries('settings.section').some(entry => entry.options.id === id),
          general: (destination) => { controller.navigate(destination) },
          unavailable: () => inner.locale.bind(NS)('menu.unavailable'),
        })
      })
      const removeState = connection.state.subscribe(report)
      const removeLocale = inner.locale.subscribe(report)
      report()
      return () => {
        removeCommand(); removeState(); removeLocale()
        menu.reportState({ ready: false, locale: inner.locale.getSnapshot().active })
      }
    }, 'ui-desktop-shell: native menu navigation')
  })
  ctx.effect(() => {
    controller.start()
    return () => { controller.dispose() }
  }, 'ui-desktop-shell: bridge state')
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item', id: 'desktop-shell', order: 75, locale: NS,
    inject: () => ({ controller, icons: bridge.icons }),
  }, DesktopPreferencesRow))
  ctx.inject(['settingsNavigation'], (inner) => {
    const openUpdates = (): void => {
      inner.settingsNavigation.open({ sectionId: 'general' })
      controller.navigate('updates')
    }
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

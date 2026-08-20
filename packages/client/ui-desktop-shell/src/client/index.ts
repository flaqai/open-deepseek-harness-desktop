/** Electron-only desktop shell settings and Release notification plugin. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { DesktopPreferencesRow } from './DesktopPreferencesRow.tsx'
import { readDesktopBridge } from './bridge.ts'
import { DesktopShellController } from './controller.ts'
import { en, zh, type DesktopShellKey } from './locales.ts'
import { ReleaseFooterAction } from './ReleaseFooterAction.tsx'

export type { DesktopShellKey } from './locales.ts'
export { DesktopShellController } from './controller.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'desktop-shell': DesktopShellKey
  }
}

const NS = 'desktop-shell'
export const inject = ['slots', 'locale']

export function apply(ctx: ClientContext): void {
  const bridge = readDesktopBridge()
  if (bridge === null) return
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-desktop-shell: dictionaries')
  const controller = new DesktopShellController(bridge)
  ctx.effect(() => {
    controller.start()
    return () => { controller.dispose() }
  }, 'ui-desktop-shell: bridge state')
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item', id: 'desktop-shell', order: 75, locale: NS,
    inject: () => ({ controller }),
  }, DesktopPreferencesRow))
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: 'desktop-release', order: 0, locale: NS,
    inject: () => ({ controller }),
  }, ReleaseFooterAction))
}

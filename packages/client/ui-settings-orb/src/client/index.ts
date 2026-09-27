/** Dedicated community Desktop floating-ball Settings section. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { OrbSettingsSection, type OrbSettingsInjected } from './OrbSettingsSection.tsx'
import { readOrbDesktopBridge, type OrbSettingsView } from './orb-bridge.ts'
import { en, zh, type OrbSettingsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Floating-ball Settings copy. */
    'settings.orb': OrbSettingsKey
  }
}

/** Required services: slots, copy, and section navigation. */
export const inject = ['slots', 'locale', 'settingsNavigation']

/** Register the Settings page and subscribe to per-home host state.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  const bridge = readOrbDesktopBridge()
  const view = createSnapshotStore<OrbSettingsView>({ phase: bridge === undefined ? 'unavailable' : 'loading' })
  const reload = (): void => {
    if (bridge === undefined) return
    view.set({ phase: 'loading' })
    void bridge.get().then(
      (settings) => { view.set({ phase: 'ready', settings }) },
      () => { view.set({ phase: 'error' }) },
    )
  }
  ctx.effect(() => ctx.locale.register('settings.orb', { zh, en }), 'ui-settings-orb: dictionaries')
  if (bridge !== undefined) ctx.effect(() => {
    const off = bridge.onChanged((settings) => { view.set({ phase: 'ready', settings }) })
    reload()
    return off
  }, 'ui-settings-orb: host state')
  const injected = (): OrbSettingsInjected => ({
    hooks: { orb: view },
    update: async (patch) => {
      if (bridge === undefined) return
      const current = view.getSnapshot()
      try { view.set({ phase: 'ready', settings: await bridge.update(patch) }) }
      catch (error) {
        if (current.phase === 'ready') view.set({ phase: 'ready', settings: current.settings, error: String(error) })
        else view.set({ phase: 'error' })
      }
    },
    reload,
    openTools: () => { ctx.settingsNavigation.open({ sectionId: 'external-tools' }) },
  })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'orb', order: 19, label: () => ctx.locale.bind('settings.orb')('nav'),
    locale: 'settings.orb', inject: injected,
  }, OrbSettingsSection))
}

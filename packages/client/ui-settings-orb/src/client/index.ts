/** Dedicated community Desktop floating-ball Settings section. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { OrbSettingsSection, type OrbSettingsInjected } from './OrbSettingsSection.tsx'
import { readOrbDesktopBridge, readOrbQuickRestart, type OrbSettings, type OrbSettingsView } from './orb-bridge.ts'
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
  const restart = readOrbQuickRestart()
  const view = createSnapshotStore<OrbSettingsView>({ phase: bridge === undefined ? 'unavailable' : 'loading' })
  let generation = 0
  let disposed = false
  const reload = (): void => {
    if (bridge === undefined) return
    const currentGeneration = ++generation
    view.set({ phase: 'loading' })
    void Promise.all([bridge.get(), bridge.getStatus?.()]).then(
      ([settings, status]) => { if (!disposed && currentGeneration === generation) view.set({ phase: 'ready', settings, status }) },
      () => { if (!disposed && currentGeneration === generation) view.set({ phase: 'error' }) },
    )
  }
  ctx.effect(() => ctx.locale.register('settings.orb', { zh, en }), 'ui-settings-orb: dictionaries')
  if (bridge !== undefined) ctx.effect(() => {
    disposed = false
    const off = bridge.onChanged((settings) => {
      const current = view.getSnapshot()
      if (current.phase === 'ready') view.set({ ...current, settings })
      else reload()
    })
    reload()
    return () => { disposed = true; generation += 1; off() }
  }, 'ui-settings-orb: host state')
  const act = async (action: () => Promise<OrbSettings>): Promise<void> => {
    const current = view.getSnapshot()
    if (current.phase !== 'ready' || current.busy) return
    view.set({ ...current, busy: true, error: undefined })
    try {
      const settings = await action()
      if (disposed) return
      const latest = view.getSnapshot()
      view.set({ phase: 'ready', settings, status: latest.phase === 'ready' ? latest.status : current.status })
      if (bridge?.getStatus !== undefined) void bridge.getStatus().then((status) => {
        const next = view.getSnapshot()
        if (!disposed && next.phase === 'ready') view.set({ ...next, status })
      }, () => {})
    } catch (error) {
      if (!disposed) view.set({ ...current, error: String(error) })
    }
  }
  const injected = (): OrbSettingsInjected => ({
    hooks: { orb: view },
    update: async (patch) => {
      if (bridge === undefined) return
      await act(() => bridge.update(patch))
    },
    selectBackend: async (backend) => {
      const selectBackend = bridge?.selectBackend?.bind(bridge)
      if (selectBackend === undefined) return
      await act(() => selectBackend(backend))
    },
    canSelectBackend: bridge?.selectBackend !== undefined,
    canRestart: restart !== undefined,
    restart: async () => {
      if (restart === undefined) return
      const current = view.getSnapshot()
      if (current.phase !== 'ready' || current.status?.pendingRestart !== true || current.status.mode !== 'local') return
      try { await restart() }
      catch (error) { if (!disposed) view.set({ ...current, error: String(error) }) }
    },
    reload,
    openTools: () => { ctx.settingsNavigation.open({ sectionId: 'external-tools' }) },
  })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'orb', order: 19, label: () => ctx.locale.bind('settings.orb')('nav'),
    locale: 'settings.orb', inject: injected,
  }, OrbSettingsSection))
}

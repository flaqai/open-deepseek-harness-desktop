/** Built-in current Profile MCP settings and scoped Remote adapter. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import mcpSettingsRemote from '@deepseek-ai/dsh-mcp-settings/remote'
import { McpSettings, type McpSettingsInjected } from './McpSettings.tsx'
import { en, zh, ja, es, fr, de, ru, pt, ko, type McpLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'settings.mcp': McpLocaleKey }
}
export const inject = ['slots', 'locale', 'remote']
/** Mount the generated Remote and register exactly one settings page. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register('settings.mcp', { zh, en, ja, es, fr, de, ru, pt, ko }), 'mcp-settings: dictionaries')
  const mounted = ctx.remote.$mount(mcpSettingsRemote)
  ctx.effect(() => {
    void mounted.catch(() => { /* The first page request reports a failed mount. */ })
    return async () => {
      const release = await mounted.catch(() => undefined)
      await release?.()
    }
  }, 'mcp-settings: remote')
  const unwrap = async <T>(
    promise: Promise<{ ok: true; value: T } | { ok: false; error: { code: string; message: string } }>,
  ): Promise<T> => {
    const result = await promise
    if (!result.ok) throw new Error(result.error.code)
    return result.value
  }
  const face = (): McpSettingsInjected => ({
    list: async () => { await mounted; return unwrap(ctx.remote.mcpSettings.list()) },
    upsert: async (config) => { await mounted; return unwrap(ctx.remote.mcpSettings.upsert(config)) },
    remove: async (name) => { await mounted; return unwrap(ctx.remote.mcpSettings.deleteServer(name)) },
    setEnabled: async (name, enabled) => { await mounted; return unwrap(ctx.remote.mcpSettings.setEnabled(name, enabled)) },
    getTools: async (name) => { await mounted; return unwrap(ctx.remote.mcpSettings.getTools(name)) },
  })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'mcp', order: 19, locale: 'settings.mcp',
    label: () => ctx.locale.bind('settings.mcp')('title'), inject: face,
  }, McpSettings))
}

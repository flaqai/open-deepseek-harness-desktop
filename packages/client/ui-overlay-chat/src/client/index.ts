/** Floating chat root hosted on the existing authenticated Desktop Web origin. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { OverlayChatRoot, type OverlayChatInjected } from './OverlayChatRoot.tsx'
import { en, zh, type OrbChatKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Floating chat chrome and controls. */
    orbChat: OrbChatKey
  }
}

interface OrbRendererBridge {
  collapse(): Promise<void>
  openMain(): Promise<void>
}

function readOrbBridge(): OrbRendererBridge | undefined {
  const value = (globalThis as typeof globalThis & { dshOrb?: Partial<OrbRendererBridge> }).dshOrb
  return typeof value?.collapse === 'function' && typeof value.openMain === 'function'
    ? value as OrbRendererBridge : undefined
}

/** Services required for root registration, session navigation, and locale copy. */
export const inject = ['slots', 'locale', 'uiWorkspace']

/** Install compact chat only in the dedicated Desktop floating renderer.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  if (new URLSearchParams(window.location.search).get('surface') !== 'orb') return
  const bridge = readOrbBridge()
  if (bridge === undefined) return
  ctx.effect(() => ctx.locale.register('orbChat', { zh, en }), 'ui-overlay-chat: dictionaries')
  ctx.effect(() => ctx.slots.register({
    name: 'root',
    locale: 'orbChat',
    children: {
      'conversation.view': { kind: 'list', scope: 'session' },
      'conversation.input.overlay': { kind: 'list', scope: 'session' },
    },
    inject: (): OverlayChatInjected => ({
      startSession: () => { ctx.uiWorkspace.startSession() },
      openSession: (id) => { ctx.uiWorkspace.openSession(id) },
      collapse: () => { void bridge.collapse() },
      openMain: () => { void bridge.openMain() },
    }),
  }, OverlayChatRoot), 'ui-overlay-chat: compact root')
}

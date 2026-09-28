/** Floating chat root hosted on the existing authenticated Desktop Web origin. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { OverlayChatRoot, type OverlayChatInjected } from './OverlayChatRoot.tsx'
import { en, zh, type OrbChatKey } from './locales.ts'
import { createOrbBackgroundClient } from './orb-background-client.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Floating chat chrome and controls. */
    orbChat: OrbChatKey
  }
}

interface OrbRendererBridge {
  collapse(): Promise<void>
  openMain(): Promise<void>
  ensureCallerSession?(): Promise<string>
  onSelectionText?(callback: (text: string) => void): () => void
}

function readOrbBridge(): OrbRendererBridge | undefined {
  const value = (globalThis as typeof globalThis & { dshOrb?: Partial<OrbRendererBridge> }).dshOrb
  return typeof value?.collapse === 'function' && typeof value.openMain === 'function'
    ? value as OrbRendererBridge : undefined
}

/** Services required for root registration, session navigation, and locale copy. */
export const inject = ['slots', 'locale', 'uiWorkspace', 'sessions', 'conversation']

/** Insert trusted selected text into the retained main Session draft, never its send path.
 * @param ctx - Session catalog and Conversation input resolver.
 * @param text - Bounded plain text received from the orb preload.
 * @returns Whether the current Session accepted the draft.
 */
export function insertSelectionIntoCurrentDraft(ctx: Pick<ClientContext, 'sessions' | 'conversation'>, text: string): boolean {
  const list = ctx.sessions.list.getSnapshot()
  const id = list.ids.find(candidate => (list.byId[candidate]?.retainedBy.mainView ?? 0) > 0)
  const binding = id === undefined ? undefined : ctx.sessions.binding(id)
  if (binding === undefined) return false
  try {
    const input = ctx.conversation.input.for(binding.ctx)
    const state = input.state.getSnapshot()
    if (state.phase !== 'plain') return false
    input.setDraft(state.draft === '' ? text : `${state.draft}\n${text}`)
    input.focus()
    return true
  } catch (_retiredBinding) {
    // A Session can be released between reading the catalog and borrowing its input.
    return false
  }
}

/** Install compact chat only in the dedicated Desktop floating renderer.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  if (new URLSearchParams(window.location.search).get('surface') !== 'orb') return
  const bridge = readOrbBridge()
  if (bridge === undefined) return
  const onSelectionText = bridge.onSelectionText === undefined
    ? undefined : (callback: (text: string) => void) => bridge.onSelectionText?.(callback) ?? (() => {})
  const ensureCallerSession = bridge.ensureCallerSession === undefined
    ? undefined : () => bridge.ensureCallerSession?.() ?? Promise.reject(new Error('floating Session bridge is unavailable'))
  const backgroundTasks = createOrbBackgroundClient(fetch)
  ctx.effect(() => ctx.locale.register('orbChat', { zh, en }), 'ui-overlay-chat: dictionaries')
  ctx.effect(() => ctx.slots.register({
    name: 'root',
    locale: 'orbChat',
    children: {
      'main': { kind: 'keyed', scope: 'root' },
    },
    inject: (): OverlayChatInjected => ({
      startSession: () => { ctx.uiWorkspace.startSession() },
      openSession: (id) => { ctx.uiWorkspace.openSession(id) },
      collapse: () => { void bridge.collapse() },
      openMain: () => { void bridge.openMain() },
      ...(ensureCallerSession === undefined ? {} : {
        ensureCallerSession,
      }),
      ...(onSelectionText === undefined ? {} : { onSelectionText: (callback: (text: string) => void) => onSelectionText(callback) }),
      insertSelection: text => insertSelectionIntoCurrentDraft(ctx, text),
      backgroundTasks,
    }),
  }, OverlayChatRoot), 'ui-overlay-chat: compact root')
}

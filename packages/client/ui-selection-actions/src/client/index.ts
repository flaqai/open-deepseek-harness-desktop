/** Browser plugin for selected-text actions in read-only conversation surfaces. */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SelectionActionsFeedback } from './SelectionActionsFeedback.tsx'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { SelectionActions, type SelectionActionsInjected } from './SelectionActions.tsx'
import { insertConversationQuote, requireQuoteWorkspace } from './quote-actions.ts'
import { registerSideConversations } from './side-conversation.tsx'
import { de, en, es, fr, ja, ko, NS, pt, ru, zh, type SelectionActionsKey } from './locales.ts'

export type { SelectionActionsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Contextual selected-text action copy. */
    selectionActions: SelectionActionsKey
  }
}

/** Required client services. */
export const inject = ['slots', 'sessions', 'uiSession', 'uiWorkspace', 'conversation', 'uiConversation', 'locale', 'remoteAccess', 'workspaces', 'resources', 'sidebarRight', 'sidebarRightTabs']

function readDesktopRestart(): (() => Promise<void>) | undefined {
  const desktop = (globalThis as typeof globalThis & { deepSeekHarnessDesktop?: unknown }).deepSeekHarnessDesktop
  if (desktop === null || typeof desktop !== 'object') return undefined
  const shell = (desktop as { shell?: unknown }).shell
  if (shell === null || typeof shell !== 'object') return undefined
  const restart = (shell as { restart?: unknown }).restart
  if (typeof restart !== 'function') return undefined
  return async () => { await restart.call(shell) }
}

function appendAvailable(ctx: Context, sessionId: SessionId | undefined): boolean {
  if (sessionId === undefined) return false
  const summary = ctx.sessions.list.getSnapshot().byId[sessionId]
  if (summary === undefined
    || ctx.uiSession.sessionStatus.getSnapshot().get(sessionId)?.pendingInteraction !== undefined) return false
  const actx = ctx.sessions.scope(sessionId)
  if (actx === undefined) return false
  const session = ctx.sessions.sessionOf(actx)?.getSnapshot()
  if (session === undefined || session.removed || session.openState !== 'open'
    || session.pendingSubmissions.length > 0) return false
  if (session.subagent?.address.mode === 'continuable' && !session.subagent.parentAvailable) return false
  if (ctx.conversation.blocks.storeFor(sessionId).getSnapshot() !== undefined) return false
  const phase = ctx.conversation.input.for(actx).state.getSnapshot().phase
  return phase === 'plain'
}

function createAppendAvailability(ctx: Context, sessionId: SessionId): HostObservable<boolean> {
  return {
    getSnapshot: () => appendAvailable(ctx, sessionId),
    subscribe: (listener) => {
      let nestedStops: (() => void)[] = []
      const stopNested = (): void => {
        for (const stop of nestedStops) stop()
        nestedStops = []
      }
      const bindCurrent = (): void => {
        stopNested()
        const actx = ctx.sessions.scope(sessionId)
        if (actx === undefined) return
        const session = ctx.sessions.sessionOf(actx)
        if (session === undefined) return
        nestedStops = [
          session.subscribe(listener),
          ctx.uiSession.sessionStatus.subscribe(listener),
          ctx.conversation.input.for(actx).state.subscribe(listener),
          ctx.conversation.blocks.storeFor(sessionId).subscribe(listener),
        ]
      }
      const stopSessions = ctx.sessions.list.subscribe(() => {
        bindCurrent()
        listener()
      })
      bindCurrent()
      return () => {
        stopSessions()
        stopNested()
      }
    },
  }
}

/** Register scoped right-click actions and independent shell feedback. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, ko, es, fr, de, pt, ru }), 'ui-selection-actions: dictionaries')
  const feedback = createSnapshotStore<{ seq: number; text: string } | null>(null)
  let feedbackSeq = 0
  const restartDesktop = readDesktopRestart()
  const askAside = registerSideConversations(ctx)
  const injected = (sessionId: SessionId): SelectionActionsInjected => ({
    hooks: { appendAvailable: createAppendAvailability(ctx, sessionId) },
    notify: (text) => { feedback.set({ seq: ++feedbackSeq, text }) },
    copy: writeClipboard,
    askInNewConversation: async (workspaceId, text) => {
      requireQuoteWorkspace(ctx, sessionId, workspaceId)
      const initialization = { inserted: false }
      await ctx.uiWorkspace.openWorkspace(workspaceId, (targetId) => {
        insertConversationQuote(ctx, targetId, text)
        initialization.inserted = true
      })
      if (!initialization.inserted) throw new Error('selection actions: opening the conversation was cancelled')
    },
    askInSideConversation: (workspaceId, text) => askAside(sessionId, workspaceId, text),
    appendToCurrent: (targetSessionId, text) => {
      if (targetSessionId !== sessionId || !appendAvailable(ctx, sessionId)) {
        throw new Error('selection actions: current composer is not editable')
      }
      insertConversationQuote(ctx, sessionId, text)
    },
    ...(restartDesktop === undefined ? {} : { restartDesktop }),
  })

  ctx.effect(() => ctx.uiConversation.interactions.register({
    id: 'selection-actions',
    onInteraction(request) {
      if (request.trigger !== 'contextmenu' || !request.hasSelection) return
      const text = request.readText()
      if (text === null || text.trim() === '') return
      request.preventDefault()
      request.open()
    },
  }), 'ui-selection-actions: text interactions')
  ctx.slots.inject('conversation.chat.text-interaction', () => ctx.slots.register({
    name: 'conversation.chat.text-interaction', key: 'selection-actions', locale: NS, inject: injected,
  }, SelectionActions))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'selection-actions-feedback', locale: NS,
    inject: () => ({ hooks: { feedback }, clear: () => { feedback.set(null) } }),
  }, SelectionActionsFeedback))
}

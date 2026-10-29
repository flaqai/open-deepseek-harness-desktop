/** Browser plugin for selected-text actions in read-only conversation surfaces. */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { SelectionActions, type SelectionActionsInjected } from './SelectionActions.tsx'
import { appendSelectionToDraft } from './selection.ts'
import { de, en, es, fr, ja, ko, NS, pt, ru, zh, type SelectionActionsKey } from './locales.ts'

export type { SelectionActionsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Contextual selected-text action copy. */
    selectionActions: SelectionActionsKey
  }
}

/** Required client services. */
export const inject = ['slots', 'sessions', 'uiSession', 'uiWorkspace', 'conversation', 'locale']

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
  return phase !== 'adjudicating' && phase !== 'submitting'
}

function currentSessionId(ctx: Context): SessionId | undefined {
  return Object.values(ctx.sessions.list.getSnapshot().byId)
    .find(session => (session.retainedBy.mainView ?? 0) > 0)?.id
}

function createAppendAvailability(ctx: Context): HostObservable<boolean> {
  return {
    getSnapshot: () => appendAvailable(ctx, currentSessionId(ctx)),
    subscribe: (listener) => {
      let nestedStops: (() => void)[] = []
      const stopNested = (): void => {
        for (const stop of nestedStops) stop()
        nestedStops = []
      }
      const bindCurrent = (): void => {
        stopNested()
        const sessionId = currentSessionId(ctx)
        if (sessionId === undefined) return
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

/** Register the localized root-overlay contribution. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, ko, es, fr, de, pt, ru }), 'ui-selection-actions: dictionaries')
  const availability = createAppendAvailability(ctx)
  const restartDesktop = readDesktopRestart()
  const injected = (): SelectionActionsInjected => ({
    hooks: { appendAvailable: availability },
    copy: writeClipboard,
    askInNewConversation: async (workspaceId, draft) => {
      await ctx.uiWorkspace.openWorkspace(workspaceId, (sessionId) => {
        const actx = ctx.sessions.scope(sessionId)
        if (actx === undefined) throw new Error(`selection actions: session "${sessionId}" has no scope`)
        ctx.conversation.input.for(actx).setDraft(draft)
      })
    },
    appendToCurrent: (sessionId, text) => {
      const current = currentSessionId(ctx)
      if (current !== sessionId || !appendAvailable(ctx, sessionId)) {
        throw new Error('selection actions: current composer is not editable')
      }
      const actx = ctx.sessions.scope(sessionId)
      if (actx === undefined) throw new Error(`selection actions: session "${sessionId}" has no scope`)
      const input = ctx.conversation.input.for(actx)
      input.setDraft(appendSelectionToDraft(input.state.getSnapshot().draft, text))
    },
    ...(restartDesktop === undefined ? {} : { restartDesktop }),
  })

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'selection-actions',
    order: 10,
    locale: NS,
    inject: injected,
  }, SelectionActions))
}

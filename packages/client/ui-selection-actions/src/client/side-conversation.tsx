/** Ordinary Session chats hosted by the official embedded Conversation factory. */
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { ResourceProvider } from '@deepseek-ai/dsh-client-resources/client'
import type { ConversationViewsProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRenderFactories, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { insertConversationQuote, requireQuoteWorkspace } from './quote-actions.ts'
import css from './SideConversation.module.css'

const KIND = 'selectionchat'
const TAB_ID = '@deepseek-ai/dsh-client-ui-selection-actions/chat'
const PREFIX = 'dsh-resource://selectionchat/session/'

interface SideConversationResource { readonly reference: SessionReference }
interface PendingQuote { readonly text: string; readonly ready: ReturnType<typeof Promise.withResolvers<void>> }

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap { selectionChat: unknown }
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface ResourceProtocolMap { selectionchat: SideConversationResource }
  interface SlotMap {
    /**
     * Body of an ordinary quoted conversation in a right-sidebar tab. Register one component
     * without owner props; it receives the Session provided by the tab's resource. The built-in
     * occupant embeds the official Conversation and composer. Replacing it replaces only this
     * ordinary-chat body, not subagent tabs; without an occupant the tab has no body.
     */
    'selectionActions.side.conversation': { kind: 'single'; scope: 'session' }
  }
}

/** Parse an ordinary Session address without inventing subagent lineage. */
export function sideConversationId(address: string): SessionId | undefined {
  if (!address.startsWith(PREFIX)) return undefined
  try {
    const id = decodeURIComponent(address.slice(PREFIX.length))
    return id === '' || id === '.' || id === '..' || /[\\/?#\u0000-\u001f\u007f]/u.test(id) ? undefined : SessionId(id)
  } catch { return undefined }
}

function FixedChat(props: ConversationViewsProps) {
  return <>{props.renderSlot('conversation.session', { view: 'chat' })}</>
}

/** Share the official Conversation content, composer, and Chat layout. */
export function SideConversationPanel({ useSession, useConversation, renderFactorySlot }:
PropsRuntime<'selectionActions.side.conversation'> & PropsRenderFactories) {
  const session = useSession(value => value)
  const conversation = useConversation(value => value)
  const active = conversation.activeTargets.size > 0 || (!session.blank && !session.awaitingFirstTurn) || session.running
  const settling = !active && session.openState === 'loading'
  const hero = !active && !settling && !session.promptAttempted
  return renderFactorySlot('conversation.content', {
    variant: 'embedded', phase: settling ? 'settling' : hero ? 'hero' : 'active', hero,
  }, { slots: { views: FixedChat } })
}

function SideConversationTab({ useResource, useTabInfo, SessionProvider, renderSlot }:
PropsRuntime<'sidebar.right.pane.tab'> & PropsRenderSlots<'selectionActions.side.conversation'>) {
  const { tab } = useTabInfo()
  const resource = useResource<'selectionchat'>(tab.contentId)
  return <div className={css.root}>
    {resource.failure !== undefined ? <p role="alert">{resource.failure.message}</p> : null}
    {resource.value === undefined ? null : <SessionProvider session={resource.value.reference}>
      {renderSlot('selectionActions.side.conversation', {})}
    </SessionProvider>}
  </div>
}

function aborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason instanceof Error ? signal.reason : new Error('Side conversation cancelled'))
    else signal.addEventListener('abort', () => { reject(signal.reason instanceof Error ? signal.reason : new Error('Side conversation cancelled')) }, { once: true })
  })
}

/** Register an ordinary chat resource and return its explicit quoted-draft opening action. */
export function registerSideConversations(ctx: Context):
(sourceSessionId: SessionId, workspaceId: WorkspaceId, text: string) => Promise<void> {
  const lifetime = new AbortController()
  const pending = new Map<SessionId, PendingQuote>()
  ctx.effect(() => () => { lifetime.abort(new Error('selection actions: plugin disposed')) }, 'selection-actions: chat lifetime')
  const provider: ResourceProvider<'selectionchat'> = {
    protocol: KIND,
    async *open(address, { signal }) {
      const sessionId = sideConversationId(address)
      const quote = sessionId === undefined ? undefined : pending.get(sessionId)
      let reference: SessionReference | undefined
      try {
        if (sessionId === undefined) throw new Error('selection actions: invalid side conversation address')
        reference = ctx.sessions.retain(sessionId, { source: 'selectionChat', signal })
        await reference.ready
        signal.throwIfAborted()
        if (quote !== undefined) {
          if (pending.get(sessionId) !== quote) throw new Error('selection actions: side opening cancelled')
          insertConversationQuote(ctx, sessionId, quote.text)
          pending.delete(sessionId)
          quote.ready.resolve()
        }
        yield { ok: true, value: { reference } }
        await aborted(signal).catch(() => {})
      } catch (error) {
        quote?.ready.reject(error)
        if (!signal.aborted) yield { ok: false, error: {
          name: 'RemoteError', isDSHRemoteError: true, code: 'gateway/internal', message: error instanceof Error ? error.message : 'Could not open the conversation', details: {},
        } }
      } finally {
        if (sessionId !== undefined) pending.delete(sessionId)
        reference?.release()
      }
    },
  }
  ctx.effect(() => ctx.resources.register(provider), 'selection-actions: chat resource')
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: TAB_ID, kind: KIND, patterns: [`${PREFIX}**`], priority: 'builtin',
    canOpen: address => sideConversationId(address) !== undefined,
    title: (address) => {
      const id = sideConversationId(address)
      return id === undefined ? address : ctx.sessions.list.getSnapshot().byId[id]?.displayTitle ?? id
    },
  }), 'selection-actions: chat tab')
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: TAB_ID,
    children: { 'selectionActions.side.conversation': { kind: 'single', scope: 'session' } },
  }, SideConversationTab))
  ctx.slots.inject('selectionActions.side.conversation', () => ctx.slots.register({
    name: 'selectionActions.side.conversation',
  }, SideConversationPanel))

  return async (sourceSessionId, workspaceId, text) => {
    lifetime.signal.throwIfAborted()
    requireQuoteWorkspace(ctx, sourceSessionId, workspaceId)
    const hostSessionId = ctx.sidebarRight.mounted.getSnapshot()
    if (hostSessionId === undefined) throw new Error('selection actions: no visible conversation sidebar')
    const sessionId = await ctx.sessions.create({ workspaceId })
    lifetime.signal.throwIfAborted()
    requireQuoteWorkspace(ctx, sourceSessionId, workspaceId)
    if (ctx.sidebarRight.mounted.getSnapshot() !== hostSessionId) {
      throw new Error('selection actions: the sidebar conversation changed while creating a Session')
    }
    const address = `${PREFIX}${encodeURIComponent(sessionId)}`
    const quote: PendingQuote = { text, ready: Promise.withResolvers<void>() }
    pending.set(sessionId, quote)
    const timeout = AbortSignal.timeout(15_000)
    const signal = AbortSignal.any([timeout, lifetime.signal])
    try {
      ctx.sidebarRight.openResourceIn(hostSessionId, address, { kind: KIND, preferNewPane: true })
      await Promise.race([quote.ready.promise, aborted(signal)])
    } catch (error) {
      pending.delete(sessionId)
      for (const tab of ctx.sidebarRight.openTabs.getSnapshot()) {
        if (tab.sessionId === hostSessionId && tab.contentId === address && tab.kind === KIND) {
          ctx.sidebarRight.closeIn(hostSessionId, tab.tabId)
        }
      }
      throw error
    }
  }
}

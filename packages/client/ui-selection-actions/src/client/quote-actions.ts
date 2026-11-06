/** Session-scoped quote insertion with current access and workspace checks. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type {} from '@deepseek-ai/dsh-api-remote-access/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'

/**
 * Require a currently writable Session and insert an official quote without submitting it.
 * @param ctx - Client context supplying current Session access and composer services.
 * @param sessionId - Target Session whose existing draft will receive the quote.
 * @param text - Selected text retained before the menu was dismissed.
 * @throws When access or the composer refuses insertion; existing draft content is preserved.
 */
export function insertConversationQuote(ctx: Context, sessionId: SessionId, text: string): void {
  const access = { allowed: false }
  const stop = ctx.uiSession.whenAccess(sessionId, 'session/prompt', () => {
    access.allowed = true
    return () => {}
  })
  stop()
  const actx = ctx.sessions.scope(sessionId)
  if (!access.allowed || actx === undefined || !ctx.conversation.input.for(actx).insertQuote(text)) {
    throw new Error('selection actions: the conversation cannot accept a quote')
  }
}

/**
 * Require creation access and the source conversation's actual Workspace.
 * @param ctx - Client context supplying current access and Workspace snapshots.
 * @param sourceSessionId - Conversation where the selection was made.
 * @param workspaceId - Requested Workspace for the new ordinary conversation.
 * @throws When creation is forbidden or the Workspace does not contain the source Session.
 */
export function requireQuoteWorkspace(ctx: Context, sourceSessionId: SessionId, workspaceId: WorkspaceId): void {
  const access = { allowed: false }
  const stop = ctx.remoteAccess.whenAccess('session/create', () => {
    access.allowed = true
    return () => {}
  })
  stop()
  const workspace = ctx.workspaces.list.getSnapshot().items.find(item => item.workspaceId === workspaceId)
  if (!access.allowed || workspace === undefined || !workspace.sessionIds.includes(sourceSessionId)) {
    throw new Error('selection actions: the workspace cannot create a conversation')
  }
}

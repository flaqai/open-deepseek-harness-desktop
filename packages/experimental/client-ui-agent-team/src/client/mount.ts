/** Source-safe Agent Teams browser registration. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { TeamAction, type TeamActionInjected } from './TeamAction.tsx'
import { AgentTeamComposerHint, AgentTeamUseAction, type AgentTeamOnboardingInjected } from './AgentTeamOnboarding.tsx'
import { en, NS, zh, type TeamKey } from './locales.ts'
import { AgentTeamOnboardingController } from './onboarding.ts'

const AGENT_TEAM_BUNDLE = '@deepseek-ai/dsh-experimental-agent-team-profile'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Agent Teams roster and task-board copy. */
    'agent-team': TeamKey
  }
}

/** Required browser services for navigation, slots, and localized copy. */
export const inject = ['sessions', 'uiWorkspace', 'conversation', 'slots', 'locale']

/**
 * Register the Team locale dictionaries and the conversation-header action.
 * The panel reads the Lead Session's `agentTeam` projection from the shared
 * Session store; this registration performs no Team RPC.
 * @param ctx - Client Context carrying the injected navigation, locale, slot, and Session services.
 */
export function registerAgentTeamUi(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'client-ui-agent-team: dictionaries')
  const t = ctx.locale.bind(NS)
  const sessions = ctx.sessions
  const onboarding = new AgentTeamOnboardingController()
  const leadSessionId = (sessionId: SessionId): SessionId => {
    const address = sessions.binding(sessionId)?.session.getSnapshot().subagent?.address
    return address?.parentSessionId ?? sessionId
  }

  const actions: TeamActionInjected = {
    openTeammate(sessionId: SessionId, childSessionId: SessionId): void {
      const parentSessionId = leadSessionId(sessionId)
      if ((sessions.retainInfo(sessionId).getSnapshot().retainedBy.mainView ?? 0) === 0) return
      if (childSessionId === parentSessionId) {
        ctx.uiWorkspace.openSession(parentSessionId)
        return
      }
      ctx.uiWorkspace.openSession({
        parentSessionId,
        childSessionId,
        mode: 'continuable',
      })
    },
  }

  const onboardingActions: AgentTeamOnboardingInjected = {
    hooks: { agentTeamOnboarding: onboarding.store },
    startUse(sessionId): void {
      onboarding.show(sessionId)
      ctx.uiWorkspace.openSession(sessionId)
    },
    fillPrompt(sessionId): void {
      const actx = sessions.scope(sessionId)
      if (actx === undefined) return
      const input = ctx.conversation.input.for(actx)
      if (input.state.getSnapshot().draft.trim() === '') input.setDraft(t('promptDraft'))
      input.focus()
      onboarding.dismiss(sessionId)
    },
    offerOnboarding: (sessionId, blank) => { onboarding.offer(sessionId, blank) },
    dismissOnboarding: (sessionId) => { onboarding.dismiss(sessionId) },
  }

  ctx.slots.inject(
    'conversation.session.header.actions',
    () => ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'agent-team',
      order: -20,
      locale: NS,
      inject: () => ({ ...actions, ...onboardingActions }),
    }, TeamAction),
  )
  ctx.slots.inject(
    'conversation.composer.dock',
    () => ctx.slots.register({
      name: 'conversation.composer.dock',
      id: 'agent-team-onboarding',
      order: -20,
      locale: NS,
      inject: () => onboardingActions,
    }, AgentTeamComposerHint),
  )
  ctx.slots.inject(
    'plugins.bundle.action',
    () => ctx.slots.register({
      name: 'plugins.bundle.action',
      key: AGENT_TEAM_BUNDLE,
      locale: NS,
      inject: () => onboardingActions,
    }, AgentTeamUseAction),
  )
}

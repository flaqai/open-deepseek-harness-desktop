/** Agent Teams discovery controls shared by the Plugins page and composer. */

import { useEffect, type ReactNode } from 'react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { Button, IconCloseOutline16, IconUserOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { GlobalStandardProps, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { NS } from './locales.ts'
import type { AgentTeamOnboardingState } from './onboarding.ts'
import css from './AgentTeamOnboarding.module.css'

/** Shared business face injected into every Agent Teams onboarding surface. */
export interface AgentTeamOnboardingInjected {
  hooks: { agentTeamOnboarding: SnapshotStore<AgentTeamOnboardingState> }
  offerOnboarding: (sessionId: SessionId, blank: boolean) => void
  startUse: (sessionId: SessionId) => void
  fillPrompt: (sessionId: SessionId) => void
  dismissOnboarding: (sessionId: SessionId) => void
}

/** Most recently updated unarchived ordinary conversation with at least one durable event. */
export function recentNonblankSession(state: SessionListState, archivedSessionIds: readonly SessionId[] = []): SessionId | undefined {
  const archived = new Set(archivedSessionIds)
  let selected: { id: SessionId; updatedAt: number } | undefined
  for (const id of state.ids) {
    const session = state.byId[id]
    if (session === undefined || session.blank || session.origin === 'subagent' || archived.has(id)) continue
    if (selected === undefined || session.updatedAt > selected.updatedAt) {
      selected = { id: session.id, updatedAt: session.updatedAt }
    }
  }
  return selected?.id
}

type UseActionProps =
  GlobalStandardProps
  & PropsLocale<typeof NS>
  & InjectFace<Pick<AgentTeamOnboardingInjected, 'startUse'>>

/** Plugins-page handoff to the latest non-empty conversation. */
export function AgentTeamUseAction({ useSessions, useWorkspaces, startUse, t }: UseActionProps): ReactNode {
  const archivedSessionIds = useWorkspaces(state => state.archivedSessionIds)
  const target = useSessions(state => recentNonblankSession(state, archivedSessionIds))
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={target === undefined}
      title={target === undefined ? t('useUnavailable') : undefined}
      onClick={() => { if (target !== undefined) startUse(target) }}
    >
      {t('useNow')}
    </Button>
  )
}

type TeamSettingsProps = PropsRuntime<'plugins.item'>
  & PropsLocale<typeof NS>
  & InjectFace<Pick<AgentTeamOnboardingInjected, 'startUse'>>

/** Discover the per-conversation switch without adding a global Team setting. */
export function AgentTeamSettings(props: TeamSettingsProps): ReactNode {
  if (props.view === 'summary') return props.t('mode.description')
  return <>
    <p>{props.t('onboardingLocation')}</p>
    <AgentTeamUseAction {...props} />
  </>
}

type ComposerHintProps =
  PropsRuntime<'conversation.composer.dock'>
  & PropsLocale<typeof NS>
  & InjectFace<Pick<AgentTeamOnboardingInjected, 'hooks' | 'fillPrompt' | 'dismissOnboarding' | 'offerOnboarding'>>

/** Input-adjacent example shown while the Agent Teams mode switch is introduced. */
export function AgentTeamComposerHint({
  sessionId, useAgentTeamOnboarding, useSession, useProjection, offerOnboarding, fillPrompt, dismissOnboarding, t,
}: ComposerHintProps): ReactNode {
  const blank = useSession(state => state.blank)
  const enabled = useProjection('agentTeam')?.enabled === true
  useEffect(() => { if (enabled) offerOnboarding(sessionId, blank) }, [enabled, blank, sessionId, offerOnboarding])
  const visible = useAgentTeamOnboarding(state => state.targetSessionId === sessionId)
  if (!visible) return null
  return (
    <div className={css.composerHint} role="status" data-agent-team-composer-hint>
      <span className={css.location}>{t('onboardingLocation')}</span>
      <div className={css.hintActions}>
        <button type="button" className={css.prompt} onClick={() => { fillPrompt(sessionId) }}>
          <IconUserOutline16 size={14} aria-hidden="true" />
          <span>{t('composerHint')}</span>
        </button>
        <button
          type="button"
          className={css.dismiss}
          aria-label={t('onboardingDismiss')}
          onClick={() => { dismissOnboarding(sessionId) }}
        >
          <IconCloseOutline16 size={13} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

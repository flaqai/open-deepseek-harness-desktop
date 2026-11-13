/** One-time and explicit Agent Teams discovery state shared by its UI seats. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Browser-local acknowledgement: the first successful location cue has been shown. */
export const AGENT_TEAM_ONBOARDING_STORAGE_KEY = 'dsh.agent-team.onboarding.v1'

/** Current Agent Teams discovery cue and its monotonic display generation. */
export interface AgentTeamOnboardingState {
  /** Session whose model-menu switch and composer hint are being introduced. */
  readonly targetSessionId?: SessionId
  /** Why the cue is visible; explicit use remains available after first-run discovery. */
  readonly source?: 'automatic' | 'go-use'
  /** Distinguishes repeated explicit requests for the same Session. */
  readonly sequence: number
}

type BrowserStorage = Pick<Storage, 'getItem' | 'setItem'>

function availableStorage(): BrowserStorage | undefined {
  if (typeof localStorage === 'undefined') return undefined
  return localStorage
}

/** Coordinate the one-time model-menu cue and repeatable Plugins-page handoff. */
export class AgentTeamOnboardingController {
  /** Observable discovery state consumed by the model menu, composer, and Plugins page. */
  readonly store: SnapshotStore<AgentTeamOnboardingState> = createSnapshotStore({ sequence: 0 })
  private firstRunPending: boolean

  constructor(private readonly storage: BrowserStorage | undefined = availableStorage()) {
    try {
      this.firstRunPending = storage?.getItem(AGENT_TEAM_ONBOARDING_STORAGE_KEY) !== 'seen'
    } catch {
      this.firstRunPending = true
    }
  }

  /**
   * Introduce the model-menu switch once, only after a real conversation is visible.
   * @param sessionId - visible conversation that owns the cue.
   * @param blank - whether the conversation has no user-visible content yet.
   */
  offer(sessionId: SessionId, blank: boolean): void {
    if (!this.firstRunPending || blank) return
    this.firstRunPending = false
    try {
      this.storage?.setItem(AGENT_TEAM_ONBOARDING_STORAGE_KEY, 'seen')
    } catch {
      // Storage denial must not prevent the in-memory cue.
    }
    this.show(sessionId, 'automatic')
  }

  /**
   * Show the cue for an explicit Plugins-page handoff, even after onboarding.
   * @param sessionId - conversation opened by the handoff.
   * @param source - automatic discovery or an explicit Plugins-page action.
   */
  show(sessionId: SessionId, source: 'automatic' | 'go-use' = 'go-use'): void {
    const sequence = this.store.getSnapshot().sequence + 1
    this.store.set({ targetSessionId: sessionId, source, sequence })
  }

  /**
   * Clear only the cue owned by the Session the person is interacting with.
   * @param sessionId - conversation dismissing its own cue.
   */
  dismiss(sessionId: SessionId): void {
    const current = this.store.getSnapshot()
    if (current.targetSessionId !== sessionId) return
    this.store.set({ sequence: current.sequence })
  }
}

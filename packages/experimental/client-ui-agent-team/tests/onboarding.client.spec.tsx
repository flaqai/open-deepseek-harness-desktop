// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import {
  AgentTeamComposerHint, AgentTeamUseAction, recentNonblankSession,
} from '../src/client/AgentTeamOnboarding.tsx'
import {
  AGENT_TEAM_ONBOARDING_STORAGE_KEY, AgentTeamOnboardingController,
} from '../src/client/onboarding.ts'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const SESSION = 'recent' as SessionId
const OLDER = 'older' as SessionId
const BLANK = 'blank' as SessionId
const CHILD = 'child' as SessionId
const t = makeTranslate(zh, commonZh)
const unused = (): never => { throw new Error('unused onboarding fixture prop') }
const globalProps = {
  useSessions: unused,
  usePanelInfo: unused,
  useSessionStatus: unused,
  useSessionRetainInfo: unused,
  useWorkspaces: unused,
  useResource: unused,
}
const sessionProps = {
  useSession: unused,
  useProjection: unused,
  useConversation: unused,
  useInput: unused,
  useChat: unused,
  useTrajectory: unused,
  inputActions: {
    captureInsertion: unused, insertText: unused, setDraft: unused,
    addAttachments: unused, removeAttachment: unused, pruneAttachments: unused, submit: unused,
  },
}

function sessionState() {
  return {
    ids: [OLDER, BLANK, CHILD, SESSION],
    byId: {
      [OLDER]: { id: OLDER, displayTitle: 'Older', running: false, retainedBy: {}, blank: false, updatedAt: 1 },
      [BLANK]: { id: BLANK, displayTitle: 'Blank', running: false, retainedBy: {}, blank: true, updatedAt: 9 },
      [CHILD]: { id: CHILD, displayTitle: 'Child', running: false, retainedBy: {}, blank: false, updatedAt: 8, origin: 'subagent' as const },
      [SESSION]: { id: SESSION, displayTitle: 'Recent', running: false, retainedBy: {}, blank: false, updatedAt: 7 },
    },
    phase: 'ready' as const,
    subagentsByParent: {},
    jobsBySession: {},
    projectionsBySession: {},
  }
}

describe('Agent Teams onboarding', () => {
  it('offers the location cue once and skips blank conversations', () => {
    const controller = new AgentTeamOnboardingController(localStorage)
    controller.offer(BLANK, true)
    expect(controller.store.getSnapshot().targetSessionId).toBeUndefined()
    controller.offer(SESSION, false)
    expect(controller.store.getSnapshot()).toMatchObject({ targetSessionId: SESSION, source: 'automatic' })
    expect(localStorage.getItem(AGENT_TEAM_ONBOARDING_STORAGE_KEY)).toBe('seen')

    const next = new AgentTeamOnboardingController(localStorage)
    next.offer(OLDER, false)
    expect(next.store.getSnapshot().targetSessionId).toBeUndefined()
    next.show(OLDER)
    expect(next.store.getSnapshot()).toMatchObject({ targetSessionId: OLDER, source: 'go-use' })
  })

  it('chooses the newest nonblank ordinary conversation', () => {
    expect(recentNonblankSession(sessionState())).toBe(SESSION)
  })

  it('hands an enabled bundle to the recent conversation', () => {
    const startUse = vi.fn()
    const props = {
      ...globalProps,
      enabled: true,
      useSessions: bindSnapshotSelector(createSnapshotStore(sessionState())),
      startUse,
      t,
    } satisfies ComponentProps<typeof AgentTeamUseAction>
    render(<AgentTeamUseAction {...props} />)
    fireEvent.click(screen.getByRole('button', { name: zh.useNow }))
    expect(startUse).toHaveBeenCalledExactlyOnceWith(SESSION)
  })

  it('shows a non-destructive composer suggestion for the targeted conversation', () => {
    const fillPrompt = vi.fn()
    const dismissOnboarding = vi.fn()
    const props = {
      ...globalProps,
      ...sessionProps,
      sessionId: SESSION,
      useAgentTeamOnboarding: bindSnapshotSelector(createSnapshotStore({ targetSessionId: SESSION, sequence: 1 })),
      fillPrompt,
      dismissOnboarding,
      t,
    } satisfies ComponentProps<typeof AgentTeamComposerHint>
    render(<AgentTeamComposerHint {...props} />)
    fireEvent.click(screen.getByRole('button', { name: zh.composerHint }))
    expect(fillPrompt).toHaveBeenCalledExactlyOnceWith(SESSION)
    fireEvent.click(screen.getByRole('button', { name: zh.onboardingDismiss }))
    expect(dismissOnboarding).toHaveBeenCalledExactlyOnceWith(SESSION)
  })
})

// @vitest-environment jsdom
/** Conversation Header Session actions: transcript copy and persistence-backed confirmations. */

import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { EMPTY_CHAT_SNAPSHOT } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ConversationSnapshot, ConversationViewSnapshotMap } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ConversationHeaderMenuContribution } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locales.ts'
import {
  conversationTranscript, SessionActions, SessionRemovalMenuItem,
} from '../src/client/skeleton/SessionActions.tsx'

const SID = 'session-actions' as SessionId
const t = makeTranslate(zh, commonZh)
const unused = (): never => { throw new Error('unused session-actions fixture prop') }
const standardProps = {
  usePanelInfo: unused, useSessions: unused, useSessionStatus: unused,
  useSessionRetainInfo: unused, useWorkspaces: unused, useResource: unused,
  useSession: unused, useProjection: unused, useInput: unused,
  useChat: unused, useTrajectory: unused,
  inputActions: {
    captureInsertion: unused, insertText: unused, setDraft: unused,
    addAttachments: unused, removeAttachment: unused, pruneAttachments: unused, submit: unused,
  },
}

const nodes = [
  { kind: 'user', seq: 1, time: 1, content: [{ type: 'text', text: '检查项目' }], source: null },
  {
    kind: 'assistant', seq: 2, time: 2, turn: 1, step: 1,
    blocks: [{ kind: 'text', text: '已经完成检查。' }],
  },
] as const

function snapshot(partial: typeof EMPTY_CHAT_SNAPSHOT.legacy.partial = null): ConversationSnapshot {
  const chat = { ...EMPTY_CHAT_SNAPSHOT, legacy: { ...EMPTY_CHAT_SNAPSHOT.legacy, nodes, partial } }
  const viewsByTarget: Partial<ConversationViewSnapshotMap> = { chat }
  return {
    views: {
      get: <Target extends Extract<keyof ConversationViewSnapshotMap, string>>(target: Target) => viewsByTarget[target],
      grouped: () => undefined,
    },
    activeTargets: new Set(['chat']),
  }
}

function sessionSnapshot(running = false): SessionSnapshot {
  return {
    sessionId: SID, pendingSubmissions: [], running, subagent: null,
    removed: false, openState: 'open', openError: null, hasMore: false,
    loadingOlder: false, promptError: null, blank: false, lastAgentError: null,
    promptAttempted: true, awaitingFirstTurn: false,
  }
}

function mountCopy() {
  const conversation = createSnapshotStore(snapshot())
  const props = {
    ...standardProps,
    sessionId: SID,
    useConversation: bindSnapshotSelector(conversation),
    t,
  } satisfies ComponentProps<typeof SessionActions>
  render(<SessionActions {...props} />)
}

function mountRemoval(running = false) {
  const session = createSnapshotStore(sessionSnapshot(running))
  const archive = vi.fn(() => Promise.resolve())
  let contribution: ConversationHeaderMenuContribution | undefined
  const props = {
    ...standardProps,
    useConversation: unused,
    sessionId: SID,
    useSession: bindSnapshotSelector(session),
    archive,
    registerMenuItem: (next: ConversationHeaderMenuContribution) => {
      contribution = next
      return () => { if (contribution === next) contribution = undefined }
    },
    t,
  } satisfies ComponentProps<typeof SessionRemovalMenuItem>
  render(<SessionRemovalMenuItem {...props} />)
  return { archive, contribution: () => contribution! }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('SessionActions', () => {
  it('copies the loaded visible transcript with localized speaker labels', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    mountCopy()

    fireEvent.click(screen.getByRole('button', { name: '复制已加载对话' }))
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('用户:\n检查项目\n\nDeepSeek:\n已经完成检查。')
    })
    expect(screen.getByRole('button', { name: '复制成功' })).toBeTruthy()
  })

  it('contributes only Delete session and explains retained audit logs before removal', async () => {
    const b = mountRemoval()
    await waitFor(() => { expect(b.contribution().item.label).toBe('删除会话') })
    expect(b.contribution().id).toBe('conversation-session-remove')
    act(() => { b.contribution().onSelect('conversation-session-remove') })

    expect(screen.getByRole('dialog', { name: '删除当前会话？' }).textContent).toContain('底层日志不会被物理删除')
    fireEvent.click(screen.getByRole('button', { name: '删除会话' }))
    await waitFor(() => { expect(b.archive).toHaveBeenCalledTimes(1) })
  })

  it('disables only the contributed Delete session row while the agent is running', async () => {
    const b = mountRemoval(true)
    await waitFor(() => { expect(b.contribution().item.disabled).toBe(true) })
  })
})

describe('conversationTranscript', () => {
  it('omits private reasoning and includes the active visible response', () => {
    const source = snapshot({
      turn: 2,
      step: 1,
      blocks: [
        { kind: 'reasoning', text: 'private' },
        { kind: 'text', text: '正在处理' },
      ],
    })
    expect(conversationTranscript(source, { user: 'User', assistant: 'Agent' }))
      .toBe('User:\n检查项目\n\nAgent:\n已经完成检查。\n\nAgent:\n正在处理')
  })
})

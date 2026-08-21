// @vitest-environment jsdom
/** Conversation Header Session actions: transcript copy and persistence-backed confirmations. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import {
  createSnapshotStore, EMPTY_CHAT_SNAPSHOT, EMPTY_CONVERSATION_VIEWS,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ConversationSnapshot, SessionId, WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locales.ts'
import {
  conversationTranscript, SessionActions,
} from '../src/client/skeleton/SessionActions.tsx'

const SID = 'session-actions' as SessionId
const WID = 'workspace-actions' as WorkspaceId
const t = makeTranslate(zh, commonZh)

function snapshot(overrides: Partial<ConversationSnapshot> = {}): ConversationSnapshot {
  return {
    sessionId: SID,
    views: EMPTY_CONVERSATION_VIEWS,
    chat: EMPTY_CHAT_SNAPSHOT,
    nodes: [
      { kind: 'user', seq: 1, time: 1, content: [{ type: 'text', text: '检查项目' }], source: null },
      {
        kind: 'assistant', seq: 2, time: 2, turn: 1, step: 1,
        blocks: [{ kind: 'text', text: '已经完成检查。' }],
      },
    ],
    turnTimings: new Map(),
    turnEnds: new Map(),
    partial: null,
    runningCalls: [],
    pending: [],
    queue: [],
    running: false,
    subagent: null,
    composerPhase: 'active',
    removed: false,
    openState: 'open',
    openError: null,
    hasMore: false,
    loadingOlder: false,
    promptError: null,
    blank: false,
    lastAgentError: null,
    ...overrides,
  }
}

function mount(overrides: Partial<ConversationSnapshot> = {}) {
  const store = createSnapshotStore(snapshot(overrides))
  const archive = vi.fn(() => Promise.resolve())
  const clearAndRestart = vi.fn(() => Promise.resolve())
  render(
    <SessionActions
      sessionId={SID}
      useSession={bindSnapshotSelector(store)}
      workspaceId={WID}
      archive={archive}
      clearAndRestart={clearAndRestart}
      t={t}
    />,
  )
  return { archive, clearAndRestart }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('SessionActions', () => {
  it('copies the loaded visible transcript with localized speaker labels', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    mount()

    fireEvent.click(screen.getByRole('button', { name: '复制已加载对话' }))
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('用户:\n检查项目\n\nDeepSeek:\n已经完成检查。')
    })
    expect(screen.getByRole('button', { name: '复制成功' })).toBeTruthy()
  })

  it('requires confirmation before clearing into a new Session', async () => {
    const { clearAndRestart, archive } = mount()
    fireEvent.click(screen.getByRole('button', { name: '更多会话操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '清空并新建会话' }))

    expect(screen.getByRole('dialog', { name: '清空当前会话？' }).textContent).toContain('同一工作区')
    expect(clearAndRestart).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '清空并新建' }))
    await waitFor(() => { expect(clearAndRestart).toHaveBeenCalledTimes(1) })
    expect(archive).not.toHaveBeenCalled()
  })

  it('explains retained audit logs before removing the Session', async () => {
    const { archive } = mount()
    fireEvent.click(screen.getByRole('button', { name: '更多会话操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '删除会话' }))

    expect(screen.getByRole('dialog', { name: '删除当前会话？' }).textContent).toContain('底层日志不会被物理删除')
    fireEvent.click(screen.getByRole('button', { name: '删除会话' }))
    await waitFor(() => { expect(archive).toHaveBeenCalledTimes(1) })
  })

  it('disables lifecycle actions while the agent is running', () => {
    mount({ running: true })
    fireEvent.click(screen.getByRole('button', { name: '更多会话操作' }))
    expect(screen.getByRole<HTMLButtonElement>('menuitem', { name: '清空并新建会话' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('menuitem', { name: '删除会话' }).disabled).toBe(true)
  })
})

describe('conversationTranscript', () => {
  it('omits private reasoning and includes the active visible response', () => {
    const source = snapshot({
      partial: {
        turn: 2,
        step: 1,
        blocks: [
          { kind: 'reasoning', text: 'private' },
          { kind: 'text', text: '正在处理' },
        ],
      },
    })
    expect(conversationTranscript(source, { user: 'User', assistant: 'Agent' }))
      .toBe('User:\n检查项目\n\nAgent:\n已经完成检查。\n\nAgent:\n正在处理')
  })
})

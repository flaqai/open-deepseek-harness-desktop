import { contextMenuHook } from '@deepseek-ai/dsh-client-test-runtime'
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { SelectionActions, type SelectionActionsProps } from '../src/client/SelectionActions.tsx'
import { SelectionActionsFeedback } from '../src/client/SelectionActionsFeedback.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const sessionId = SessionId('session-1')
const workspaceId = WorkspaceId('workspace-1')
const sessionState: SessionListState = {
  ids: [sessionId],
  byId: {
    [sessionId]: {
      id: sessionId, displayTitle: 'Session 1', running: false, retainedBy: { mainView: 1 },
      blank: false, updatedAt: 1,
    },
  },
  phase: 'ready',
  projectionsBySession: {},
}
const workspaceState: WorkspaceSnapshot = {
  items: [{
    workspaceId, path: '/workspace-1', title: 'Workspace 1', sessionIds: [sessionId],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }],
  archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null,
}
const sessions = createSnapshotStore(sessionState)
const workspaces = createSnapshotStore(workspaceState)
const unused = (): never => { throw new Error('unused selection-actions fixture prop') }

function props(appendAvailable = true, restartDesktop?: () => Promise<void>): SelectionActionsProps {
  return {
    sessionId, trigger: 'selection', readText: () => 'selected words', dismiss: vi.fn(), clearSelection: vi.fn(),
    useSession: unused, useProjection: unused, useConversation: unused, useInput: unused, useChat: unused, useTrajectory: unused,
    inputActions: {
      insertQuote: unused, captureInsertion: unused, insertText: unused, setDraft: unused, persistDraft: unused,
      addAttachments: unused, removeAttachment: unused, pruneAttachments: unused, submit: unused,
    },
    useAccess: () => true, useRemoteAccess: () => true, useSessionAccess: () => true, useWorkspaceAccess: () => true,
    useContextMenu: contextMenuHook(), useSessions: bindSnapshotSelector(sessions),
    useWorkspaces: bindSnapshotSelector(workspaces), usePanelInfo: unused, useSessionStatus: unused,
    useSessionRetainInfo: unused, useResource: unused,
    useAppendAvailable: bindSnapshotSelector(createSnapshotStore(appendAvailable)),
    notify: vi.fn(), copy: vi.fn(async () => true), askInNewConversation: vi.fn(async () => {}),
    askInSideConversation: vi.fn(async () => {}), appendToCurrent: vi.fn(),
    ...(restartDesktop === undefined ? {} : { restartDesktop }), t: makeTranslate(en),
  }
}

describe('SelectionActions', () => {
  it('renders selected text actions without document gesture listeners', () => {
    const injected = props()
    render(<SelectionActions {...injected} />)
    expect(screen.getByRole('toolbar')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(injected.copy).toHaveBeenCalledWith('selected words')
    expect(injected.dismiss).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Ask in new conversation' }))
    expect(injected.askInNewConversation).toHaveBeenCalledWith('workspace-1', 'selected words')
    fireEvent.click(screen.getByRole('button', { name: 'Add to conversation' }))
    expect(injected.appendToCurrent).toHaveBeenCalledWith('session-1', 'selected words')
  })

  it('uses the area session rather than another main-view retention', () => {
    const injected = props()
    render(<SelectionActions {...injected} sessionId={SessionId('other')} />)
    expect(screen.queryByRole('button', { name: 'Ask in new conversation' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add to conversation' })).toBeNull()
  })

  it('retains copy while readonly permission removes draft actions', () => {
    render(<SelectionActions {...props()} useAccess={() => false} useRemoteAccess={() => false} />)
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy()
  })

  it('puts the desktop quick restart at the bottom of the context menu', () => {
    const injected = props(false, vi.fn(async () => {}))
    render(<SelectionActions {...injected} trigger="contextmenu" />)
    const items = screen.getAllByRole('menuitem')
    expect(items.at(-1)?.textContent).toBe('Quick restart')
    expect(screen.queryByRole('menuitem', { name: 'Add to conversation' })).toBeNull()
    fireEvent.click(items.at(-1)!)
    expect(injected.restartDesktop).toHaveBeenCalledOnce()
    expect(injected.dismiss).toHaveBeenCalledOnce()
  })

  it('captures immutable text and reports copy failures after dismissal', async () => {
    const injected = props()
    const copy = vi.fn(async () => false)
    let selection: string | null = 'selected words'
    render(<SelectionActions {...injected} readText={() => selection} dismiss={() => { selection = null }} copy={copy} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(copy).toHaveBeenCalledWith('selected words')
    await vi.waitFor(() => { expect(injected.notify).toHaveBeenCalledWith('Copy failed') })
  })

  it('keeps asynchronous feedback visible after the conversation popup unmounts', async () => {
    const feedback = createSnapshotStore<{ seq: number; text: string } | null>(null)
    const feedbackProps = { useFeedback: bindSnapshotSelector(feedback), clear: () => { feedback.set(null) } }
    const injected = props()
    const view = render(<><SelectionActionsFeedback {...feedbackProps} /><SelectionActions {...injected}
      notify={(text) => { feedback.set({ seq: 1, text }) }} copy={async () => false} /></>)
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    view.rerender(<SelectionActionsFeedback {...feedbackProps} />)
    expect(await screen.findByText('Copy failed')).toBeTruthy()
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  it('renders no action when the area selection becomes unavailable before mounting', () => {
    render(<SelectionActions {...props()} readText={() => null} />)
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  it('opens a side conversation with the selected text without sending', () => {
    const injected = props()
    render(<SelectionActions {...injected} trigger="contextmenu" />)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ask in side conversation' }))
    expect(injected.askInSideConversation).toHaveBeenCalledWith(workspaceId, 'selected words')
    expect(injected.dismiss).toHaveBeenCalledOnce()
  })

})

it('uses the shared contextual menu while preserving the official selected-text snapshot', () => {
  const injected = props()
  const view = render(<SelectionActions {...injected} trigger="contextmenu" />)
  const menu = view.getByRole('menu', { name: 'Selected text menu' })
  expect(menu.hasAttribute('data-context-menu')).toBe(true)
  expect(menu.getAttribute('data-menu-material')).toBe('translucent')
  const side = view.getByRole('menuitem', { name: 'Ask in side conversation' })
  expect(fireEvent.pointerDown(side)).toBe(false)
  expect(injected.clearSelection).not.toHaveBeenCalled()
  fireEvent.click(side)
  expect(injected.askInSideConversation).toHaveBeenCalledWith(workspaceId, 'selected words')
  expect(injected.dismiss).toHaveBeenCalledOnce()
})

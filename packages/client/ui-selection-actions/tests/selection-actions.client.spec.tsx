// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { SelectionActions, type SelectionActionsProps } from '../src/client/SelectionActions.tsx'
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
    useSessions: bindSnapshotSelector(sessions),
    useWorkspaces: bindSnapshotSelector(workspaces),
    usePanelInfo: unused,
    useSessionStatus: unused,
    useSessionRetainInfo: unused,
    useResource: unused,
    useAppendAvailable: bindSnapshotSelector(createSnapshotStore(appendAvailable)),
    copy: vi.fn(async () => true),
    askInNewConversation: vi.fn(async () => {}),
    appendToCurrent: vi.fn(),
    ...(restartDesktop === undefined ? {} : { restartDesktop }),
    t: makeTranslate(en),
  }
}

function selectText(target: HTMLElement): void {
  const text = target.firstChild!
  const range = document.createRange()
  range.setStart(text, 0)
  range.setEnd(text, text.textContent!.length)
  range.getBoundingClientRect = vi.fn(() => ({
    x: 20, y: 30, left: 20, top: 30, right: 100, bottom: 50,
    width: 80, height: 20, toJSON: () => ({}),
  }))
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
}

describe('SelectionActions', () => {
  let text: HTMLElement

  beforeEach(() => {
    document.body.replaceChildren()
    const scope = document.createElement('div')
    scope.dataset.selectionActionsScope = ''
    text = document.createElement('p')
    text.textContent = 'selected words'
    scope.appendChild(text)
    document.body.appendChild(scope)
  })

  it('opens a horizontal toolbar after selection and runs all three actions', async () => {
    const injected = props()
    render(<SelectionActions {...injected} />)
    selectText(text)
    fireEvent.pointerUp(text, { button: 0 })

    expect(screen.getByRole('toolbar')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ask in new conversation' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add to current conversation' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(injected.copy).toHaveBeenCalledWith('selected words')

    selectText(text)
    fireEvent.pointerUp(text, { button: 0 })
    fireEvent.click(screen.getByRole('button', { name: 'Ask in new conversation' }))
    expect(injected.askInNewConversation).toHaveBeenCalledWith(
      'workspace-1',
      'Please answer the following selected text:\n\n> selected words',
    )

    selectText(text)
    fireEvent.pointerUp(text, { button: 0 })
    fireEvent.click(screen.getByRole('button', { name: 'Add to current conversation' }))
    expect(injected.appendToCurrent).toHaveBeenCalledWith('session-1', 'selected words')
  })

  it('uses a vertical menu for context click and hides append while input is unavailable', () => {
    render(<SelectionActions {...props(false)} />)
    selectText(text)
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 90, clientY: 70 })
    fireEvent(text, event)

    expect(event.defaultPrevented).toBe(true)
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Copy' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Ask in new conversation' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Add to current conversation' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Quick restart' })).toBeNull()
  })

  it('puts the desktop quick restart at the bottom of the context menu', () => {
    const restartDesktop = vi.fn(async () => {})
    render(<SelectionActions {...props(true, restartDesktop)} />)
    selectText(text)
    fireEvent.contextMenu(text, { clientX: 90, clientY: 70 })

    const items = screen.getAllByRole('menuitem')
    expect(items.at(-1)?.textContent).toBe('Quick restart')
    expect(screen.getByRole('separator')).toBeTruthy()
    fireEvent.click(items.at(-1)!)
    expect(restartDesktop).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('keeps the native context menu without an eligible selection and dismisses on Escape', () => {
    render(<SelectionActions {...props()} />)
    const native = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    fireEvent(text, native)
    expect(native.defaultPrevented).toBe(false)

    selectText(text)
    fireEvent.pointerUp(text, { button: 0 })
    expect(screen.getByRole('toolbar')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('toolbar')).toBeNull()

    selectText(text)
    const sibling = document.createElement('p')
    sibling.textContent = 'not selected'
    text.parentElement!.appendChild(sibling)
    const elsewhere = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    fireEvent(sibling, elsewhere)
    expect(elsewhere.defaultPrevented).toBe(false)
  })

  it('does not activate inside interactive descendants', () => {
    const scope = text.parentElement!
    const button = document.createElement('button')
    button.textContent = 'interactive text'
    scope.appendChild(button)
    render(<SelectionActions {...props()} />)
    selectText(button)
    fireEvent.pointerUp(button, { button: 0 })
    expect(screen.queryByRole('toolbar')).toBeNull()
  })
})

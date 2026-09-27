// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { OverlayChatRoot, type OverlayChatRootProps } from '../src/client/OverlayChatRoot.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

it('routes floating content through the keyed main conversation slot', () => {
  const sessionId = 'session-1' as SessionListState['ids'][number]
  const list = {
    ids: [sessionId], phase: 'ready', projectionsBySession: {},
    byId: { [sessionId]: {
      id: sessionId, displayTitle: 'Recent work', retainedBy: { mainView: 1 }, running: true,
    } },
  } as SessionListState
  const openSession = vi.fn()
  const renderSlot = vi.fn(() => <div data-testid="normal-conversation" />)
  const messages: Readonly<Record<string, string>> = zh
  const t = (key: string, params?: Readonly<Record<string, string | number>>) => Object.entries(params ?? {})
    .reduce((value, [name, replacement]) => value.replaceAll(`{${name}}`, String(replacement)), messages[key] ?? key)
  const props = {
    t, renderSlot, useSessions: (select: (state: SessionListState) => unknown) => select(list),
    startSession: vi.fn(), openSession, collapse: vi.fn(), openMain: vi.fn(), insertSelection: vi.fn(),
  } as OverlayChatRootProps
  render(<OverlayChatRoot {...props} />)
  expect(screen.getByTestId('normal-conversation')).toBeTruthy()
  expect(renderSlot).toHaveBeenCalledWith('main', {}, { entryKey: 'conversation' })
  expect(screen.getByText('运行中的会话：1')).toBeTruthy()
  fireEvent.change(screen.getByRole('combobox', { name: zh.history }), { target: { value: sessionId } })
  expect(openSession).toHaveBeenCalledWith(sessionId)
})

it('keeps selected text pending until a session can accept its draft', () => {
  const sessionId = 'session-2' as SessionListState['ids'][number]
  let list = { ids: [], phase: 'ready', byId: {}, projectionsBySession: {} } as SessionListState
  let selection: ((text: string) => void) | undefined
  const startSession = vi.fn()
  const insertSelection = vi.fn(() => list.ids.length > 0)
  const props = {
    t: ((key: string) => (zh as Readonly<Record<string, string>>)[key] ?? key),
    renderSlot: vi.fn(() => null),
    useSessions: (select: (state: SessionListState) => unknown) => select(list),
    startSession, openSession: vi.fn(), collapse: vi.fn(), openMain: vi.fn(), insertSelection,
    onSelectionText: (listener: (text: string) => void) => { selection = listener; return () => { selection = undefined } },
  }
  const view = render(<OverlayChatRoot {...(props as OverlayChatRootProps)} />)
  act(() => { selection?.('Selected words') })
  act(() => { selection?.('More words') })
  expect(startSession).toHaveBeenCalledOnce()
  expect(screen.getByText(zh.selectionPending)).toBeTruthy()
  list = {
    ids: [sessionId], phase: 'ready', projectionsBySession: {},
    byId: { [sessionId]: { id: sessionId, displayTitle: 'New', retainedBy: { mainView: 1 }, running: false } },
  } as SessionListState
  view.rerender(<OverlayChatRoot {...(props as OverlayChatRootProps)} />)
  expect(insertSelection).toHaveBeenCalledWith('Selected words\nMore words')
  expect(screen.queryByText(zh.selectionPending)).toBeNull()
})

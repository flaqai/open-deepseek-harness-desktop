// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

it('opens the Host-owned Session but retains access to ordinary history', async () => {
  const other = 'session-history' as SessionListState['ids'][number]
  const owned = 'session-owned' as SessionListState['ids'][number]
  let list = {
    ids: [other, owned], phase: 'ready', projectionsBySession: {},
    byId: {
      [other]: { id: other, displayTitle: 'History', retainedBy: {}, running: false },
      [owned]: { id: owned, displayTitle: 'Floating chat', retainedBy: {}, running: false },
    },
  } as SessionListState
  const openSession = vi.fn((id: typeof other) => {
    list = { ...list, byId: Object.fromEntries(Object.entries(list.byId).map(([key, row]) => [key, {
      ...row, retainedBy: { mainView: key === id ? 1 : 0 },
    }])) }
  })
  const ensureCallerSession = vi.fn(async () => owned)
  const props = {
    t: ((key: string) => (zh as Readonly<Record<string, string>>)[key] ?? key),
    renderSlot: vi.fn(() => null),
    useSessions: (select: (state: SessionListState) => unknown) => select(list),
    startSession: vi.fn(), openSession, collapse: vi.fn(), openMain: vi.fn(), insertSelection: vi.fn(),
    ensureCallerSession,
  }
  const view = render(<OverlayChatRoot {...(props as OverlayChatRootProps)} />)
  await waitFor(() => { expect(openSession).toHaveBeenCalledWith(owned) })
  view.rerender(<OverlayChatRoot {...(props as OverlayChatRootProps)} />)
  fireEvent.change(screen.getByRole('combobox', { name: zh.history }), { target: { value: other } })
  expect(openSession).toHaveBeenLastCalledWith(other)
  expect(ensureCallerSession).toHaveBeenCalledOnce()
})

it('does not override a history choice made while the Host resolves the owned Session', async () => {
  const old = 'session-old' as SessionListState['ids'][number]
  const selected = 'session-manual' as SessionListState['ids'][number]
  let list = {
    ids: [old, selected], phase: 'ready', projectionsBySession: {},
    byId: {
      [old]: { id: old, displayTitle: 'Old', retainedBy: { mainView: 1 }, running: false },
      [selected]: { id: selected, displayTitle: 'Manual', retainedBy: {}, running: false },
    },
  } as SessionListState
  let resolveOwned!: (id: string) => void
  const ownedPromise = new Promise<string>((resolve) => { resolveOwned = resolve })
  const openSession = vi.fn((id: typeof old) => {
    list = { ...list, byId: Object.fromEntries(Object.entries(list.byId).map(([key, row]) => [key, {
      ...row, retainedBy: { mainView: key === id ? 1 : 0 },
    }])) }
  })
  const props = {
    t: ((key: string) => (zh as Readonly<Record<string, string>>)[key] ?? key),
    renderSlot: vi.fn(() => null),
    useSessions: (select: (state: SessionListState) => unknown) => select(list),
    startSession: vi.fn(), openSession, collapse: vi.fn(), openMain: vi.fn(), insertSelection: vi.fn(),
    ensureCallerSession: () => ownedPromise,
  }
  const view = render(<OverlayChatRoot {...(props as OverlayChatRootProps)} />)
  fireEvent.change(screen.getByRole('combobox', { name: zh.history }), { target: { value: selected } })
  // The Host can reply before the Session list emits its next render.
  await act(async () => { resolveOwned('session-owned') })
  expect(openSession).toHaveBeenCalledTimes(1)
  expect(openSession).toHaveBeenLastCalledWith(selected)
  view.rerender(<OverlayChatRoot {...(props as OverlayChatRootProps)} />)
})

it('shows a background worker only after the Host list confirms its submitted Session', async () => {
  const workerId = 'session-00000000-0000-4000-8000-000000000001'
  const list = { ids: [], phase: 'ready', byId: {}, projectionsBySession: {} } as SessionListState
  const workers = [{ sessionId: workerId, running: true }]
  let listResult: typeof workers = []
  const backgroundTasks = {
    list: vi.fn(async () => listResult),
    submit: vi.fn(async () => { listResult = workers; return workerId }),
    stop: vi.fn(async () => { listResult = [{ sessionId: workerId, running: false }] }),
  }
  const openSession = vi.fn()
  const props = {
    t: ((key: string) => (zh as Readonly<Record<string, string>>)[key] ?? key),
    renderSlot: vi.fn(() => null),
    useSessions: (select: (state: SessionListState) => unknown) => select(list),
    startSession: vi.fn(), openSession, collapse: vi.fn(), openMain: vi.fn(), insertSelection: vi.fn(),
    backgroundTasks,
  } as OverlayChatRootProps
  render(<OverlayChatRoot {...props} />)
  await screen.findByLabelText(zh.backgroundTaskLabel)
  expect(screen.queryByText(zh.backgroundWorker)).toBeNull()
  fireEvent.change(screen.getByLabelText(zh.backgroundTaskLabel), { target: { value: 'Prepare report' } })
  fireEvent.click(screen.getByRole('button', { name: zh.backgroundSubmit }))
  await waitFor(() => { expect(screen.getByText(zh.backgroundQueued)).toBeTruthy() })
  expect(backgroundTasks.submit).toHaveBeenCalledWith('Prepare report')
  fireEvent.click(screen.getByRole('button', { name: zh.backgroundOpen }))
  expect(openSession).toHaveBeenCalledWith(workerId)
  fireEvent.click(screen.getByRole('button', { name: zh.backgroundStop }))
  await waitFor(() => { expect(backgroundTasks.stop).toHaveBeenCalledWith(workerId) })
})

it('hides local task controls when the Host route is absent', async () => {
  const list = { ids: [], phase: 'ready', byId: {}, projectionsBySession: {} } as SessionListState
  const props = {
    t: ((key: string) => (zh as Readonly<Record<string, string>>)[key] ?? key),
    renderSlot: vi.fn(() => null),
    useSessions: (select: (state: SessionListState) => unknown) => select(list),
    startSession: vi.fn(), openSession: vi.fn(), collapse: vi.fn(), openMain: vi.fn(), insertSelection: vi.fn(),
    backgroundTasks: { list: async () => undefined, submit: vi.fn(), stop: vi.fn() },
  } as OverlayChatRootProps
  render(<OverlayChatRoot {...props} />)
  await waitFor(() => { expect(screen.queryByText(zh.backgroundTitle)).toBeNull() })
  expect(screen.queryByRole('button', { name: zh.backgroundSubmit })).toBeNull()
})

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ConversationHeaderMenuItemOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { SessionLogDownloadController } from '../src/client/controller.ts'
import { SessionLogDownloadHeaderAction } from '../src/client/HeaderAction.tsx'
import type { SessionLogDownloadHeaderProps } from '../src/client/HeaderAction.tsx'
import { en } from '../src/client/locales.ts'

const SID = 'session-export-header' as SessionId
function hasMenuRegistration(value: unknown): value is ConversationHeaderMenuItemOwnerProps {
  return typeof value === 'object' && value !== null
    && 'registerMenuItem' in value && typeof value.registerMenuItem === 'function'
}
const unused = (): never => { throw new Error('unused header-action fixture prop') }
const SessionProvider: SessionLogDownloadHeaderProps['SessionProvider'] = ({ children }) => children
const standardProps = {
  SessionProvider,
  usePanelInfo: unused, useSessions: unused, useSessionStatus: unused,
  useSessionRetainInfo: unused, useWorkspaces: unused, useResource: unused,
  useSession: unused, useProjection: unused, useConversation: unused, useInput: unused,
  useChat: unused, useTrajectory: unused,
  inputActions: {
    captureInsertion: unused, insertText: unused, setDraft: unused,
    addAttachments: unused, removeAttachment: unused, pruneAttachments: unused, submit: unused,
  },
}

function bindSnapshot<State>(store: ObservableSnapshot<State>) {
  return function useSnapshot<T>(selector: (state: State) => T): T {
    return useSyncExternalStore(
      listener => store.subscribe(listener),
      () => selector(store.getSnapshot()),
    )
  }
}

function bench(feedbackAvailable = false) {
  const controller = new SessionLogDownloadController(async () => new Response('zip'), vi.fn())
  const request = vi.fn((sessionId: SessionId) => controller.download(sessionId))
  const dismiss = vi.fn((sessionId: SessionId) => { controller.dismiss(sessionId) })
  let menuOwner: ConversationHeaderMenuItemOwnerProps | undefined
  const openFeedback = vi.fn()
  const feedback = createSnapshotStore(feedbackAvailable)
  const useSessionLogDownload = bindSnapshot(controller.store)
  const props = {
    ...standardProps,
    sessionId: SID,
    useSessionLogDownload,
    useFeedbackAvailable: bindSnapshot(feedback),
    openFeedback,
    request,
    dismiss,
    renderSlot: ((_key, owner) => {
      if (hasMenuRegistration(owner)) {
        const register = owner.registerMenuItem
        menuOwner = { registerMenuItem: (contribution) => {
          const remove = register(contribution)
          return () => { remove() }
        } }
      }
      return null
    }) satisfies SessionLogDownloadHeaderProps['renderSlot'],
    setIncludeCustomInstructions: (sessionId: SessionId, include: boolean) => {
      controller.setIncludeCustomInstructions(sessionId, include)
    },
    setRemember: (sessionId: SessionId, remember: boolean) => { controller.setRemember(sessionId, remember) },
    confirm: (sessionId: SessionId) => controller.confirm(sessionId),
    t: makeTranslate(en),
  } satisfies SessionLogDownloadHeaderProps
  const view = render(<SessionLogDownloadHeaderAction {...props} />)
  return { controller, request, openFeedback, feedback, view, menuOwner: () => menuOwner! }
}

afterEach(cleanup)

describe('Session export Header action', () => {
  it('opens Session feedback and closes the menu without starting a download', () => {
    const b = bench(true)
    fireEvent.click(b.view.getByRole('button', { name: 'More actions' }))
    fireEvent.click(b.view.getByRole('menuitem', { name: 'Feedback' }))
    expect(b.openFeedback).toHaveBeenCalledWith(SID)
    expect(b.request).not.toHaveBeenCalled()
    expect(b.view.queryByRole('menu')).toBeNull()
  })

  it('keeps export available without the feedback plugin', () => {
    const b = bench()
    fireEvent.click(b.view.getByRole('button', { name: 'More actions' }))
    expect(b.view.queryByRole('menuitem', { name: 'Feedback' })).toBeNull()
    expect(b.view.getByRole('menuitem', { name: 'Download session log' })).toBeTruthy()
  })

  it('updates the open menu when feedback becomes available, unloads, and reloads', () => {
    const b = bench()
    fireEvent.click(b.view.getByRole('button', { name: 'More actions' }))
    expect(b.view.queryByRole('menuitem', { name: 'Feedback' })).toBeNull()

    act(() => { b.feedback.set(true) })
    expect(b.view.getByRole('menuitem', { name: 'Feedback' })).toBeTruthy()
    act(() => { b.feedback.set(false) })
    expect(b.view.queryByRole('menuitem', { name: 'Feedback' })).toBeNull()
    expect(b.view.getByRole('menuitem', { name: 'Download session log' })).toBeTruthy()

    act(() => { b.feedback.set(true) })
    fireEvent.click(b.view.getByRole('menuitem', { name: 'Feedback' }))
    expect(b.openFeedback).toHaveBeenCalledWith(SID)
    expect(b.request).not.toHaveBeenCalled()
    expect(b.view.queryByRole('menu')).toBeNull()
  })

  it('opens the more-actions menu and downloads through the shared controller', async () => {
    const b = bench()
    const button = b.view.getByRole('button', { name: 'More actions' })
    expect(button.querySelector('svg')).not.toBeNull()
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(b.view.getByRole('menuitem', { name: 'Download session log' }))
    await waitFor(() => { expect(b.request).toHaveBeenCalledWith(SID) })
    expect(b.view.queryByRole('menuitem', { name: 'Download session log' })).toBeNull()
    expect(await b.view.findByRole('dialog', { name: 'Session download started' })).toBeTruthy()
  })

  it('closes the menu on Escape without downloading', () => {
    const b = bench()
    fireEvent.click(b.view.getByRole('button', { name: 'More actions' }))
    expect(b.view.getByRole('menuitem', { name: 'Download session log' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(b.view.queryByRole('menuitem', { name: 'Download session log' })).toBeNull()
    expect(b.request).not.toHaveBeenCalled()
  })

  it('appends community actions below the official log export row', () => {
    const b = bench()
    const selected = vi.fn()
    act(() => {
      b.menuOwner().registerMenuItem({
        id: 'conversation-session-remove',
        item: { id: 'conversation-session-remove', label: 'Delete session', danger: true },
        onSelect: selected,
      })
    })
    fireEvent.click(b.view.getByRole('button', { name: 'More actions' }))
    expect(b.view.getAllByRole('menuitem').map(item => item.textContent)).toEqual([
      'Download session log', 'Delete session',
    ])
    fireEvent.click(b.view.getByRole('menuitem', { name: 'Delete session' }))
    expect(selected).toHaveBeenCalledWith('conversation-session-remove')
  })

  it('disables the download row while either entry path downloads this Session', async () => {
    const b = bench(true)
    let release!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { release = resolve })
    const controller = new SessionLogDownloadController(() => pending, vi.fn())
    const useSessionLogDownload = bindSnapshot(controller.store)
    b.view.rerender(<SessionLogDownloadHeaderAction {...({
      ...standardProps,
      sessionId: SID,
      useSessionLogDownload,
      useFeedbackAvailable: bindSnapshot(b.feedback),
      openFeedback: b.openFeedback,
      request: (sessionId: SessionId) => controller.download(sessionId),
      dismiss: (sessionId: SessionId) => { controller.dismiss(sessionId) },
      setIncludeCustomInstructions: (sessionId: SessionId, include: boolean) => {
        controller.setIncludeCustomInstructions(sessionId, include)
      },
      setRemember: (sessionId: SessionId, remember: boolean) => { controller.setRemember(sessionId, remember) },
      confirm: (sessionId: SessionId) => controller.confirm(sessionId),
      renderSlot: () => null,
      t: makeTranslate(en),
    } satisfies SessionLogDownloadHeaderProps)} />)

    const download = controller.download(SID)
    const button = b.view.getByRole('button', { name: 'More actions' })
    await waitFor(() => { expect(button.getAttribute('aria-busy')).toBe('true') })
    fireEvent.click(button)
    const item = b.view.getByRole('menuitem', { name: 'Download session log' })
    expect((item as HTMLButtonElement).disabled).toBe(true)
    expect((b.view.getByRole('menuitem', { name: 'Feedback' }) as HTMLButtonElement).disabled).toBe(false)
    release(new Response('zip'))
    await download
    await waitFor(() => { expect(button.getAttribute('aria-busy')).toBe('false') })
    expect((item as HTMLButtonElement).disabled).toBe(false)
  })
})

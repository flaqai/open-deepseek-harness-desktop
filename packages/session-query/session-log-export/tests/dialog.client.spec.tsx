// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SessionLogDownloadController } from '../src/client/controller.ts'
import { SessionLogDownloadDialog } from '../src/client/Dialog.tsx'
import type { SessionLogDownloadDialogProps } from '../src/client/Dialog.tsx'
import { en } from '../src/client/locales.ts'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'

const SID = 'session-export-dialog' as SessionId
const unused = (): never => { throw new Error('unused dialog fixture prop') }
const standardProps = {
  usePanelInfo: unused, useSessions: unused, useSessionStatus: unused,
  useSessionRetainInfo: unused, useWorkspaces: unused, useResource: unused,
  useSession: unused, useProjection: unused, useConversation: unused, useInput: unused,
  useChat: unused, useTrajectory: unused,
  inputActions: {
    persistDraft: unused,
    captureInsertion: unused, insertText: unused, setDraft: unused,
    addAttachments: unused, removeAttachment: unused, pruneAttachments: unused, submit: unused,
  },
}

function bench(
  controller = new SessionLogDownloadController(
    async () => new Response('zip', { status: 200 }), vi.fn(),
  ),
) {
  const dismiss = vi.fn((sessionId: SessionId) => { controller.dismiss(sessionId) })
  function useSessionLogDownload<T>(selector: (state: ReturnType<typeof controller.store.getSnapshot>) => T): T {
    return useSyncExternalStore(
      listener => controller.store.subscribe(listener),
      () => selector(controller.store.getSnapshot()),
    )
  }
  const t = makeTranslate(en)
  const props = {
    ...standardProps,
    sessionId: SID,
    useSessionLogDownload,
    request: (sessionId: SessionId) => controller.download(sessionId),
    dismiss,
    setIncludeCustomInstructions: (sessionId: SessionId, include: boolean) => {
      controller.setIncludeCustomInstructions(sessionId, include)
    },
    setRemember: (sessionId: SessionId, remember: boolean) => { controller.setRemember(sessionId, remember) },
    confirm: (sessionId: SessionId) => controller.confirm(sessionId),
    t,
  } satisfies SessionLogDownloadDialogProps
  const view = render(<SessionLogDownloadDialog {...props} />)
  return { controller, dismiss, view }
}

afterEach(cleanup)

describe('SessionLogDownloadDialog', () => {
  it('shows both privacy choices and warns before remembering plaintext inclusion', async () => {
    const controller = new SessionLogDownloadController(
      async () => new Response('zip'), vi.fn(),
      { getPreference: () => 'ask', setPreference: vi.fn(async () => undefined) },
    )
    const b = bench(controller)
    await controller.download(SID)
    expect(await b.view.findByRole('dialog', { name: 'Export conversation diagnostics' })).toBeTruthy()
    fireEvent.click(b.view.getByRole('checkbox', { name: 'Include custom-prompt plaintext' }))
    fireEvent.click(b.view.getByRole('checkbox', { name: 'Do not ask again; remember this choice' }))
    expect(b.view.getByRole('alert').textContent).toContain('automatically contain prompt plaintext')
    fireEvent.click(b.view.getByRole('button', { name: 'Export' }))
    await waitFor(() => {
      expect(controller.store.getSnapshot().bySession[SID]?.status).toBe('success')
    })
  })

  it('shows a controller failure and closes it without reading Session history', async () => {
    const b = bench()
    act(() => {
      b.controller.store.set({
        bySession: { [SID]: { open: true, status: 'error', error: 'toolbar failed' } },
      })
    })
    const dialog = await b.view.findByRole('dialog', { name: 'Session export failed' })
    expect(dialog.textContent).toContain('toolbar failed')
    const close = b.view.getAllByRole('button', { name: 'Close' })[0]
    if (close === undefined) throw new Error('Session export dialog has no close button')
    fireEvent.click(close)
    await waitFor(() => { expect(b.dismiss).toHaveBeenCalledWith(SID) })
  })

  it('renders the in-flight state and the settled browser download state', async () => {
    let release!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { release = resolve })
    const controller = new SessionLogDownloadController(() => pending, vi.fn())
    const b = bench(controller)

    const download = controller.download(SID)
    expect(await b.view.findByRole('dialog', { name: 'Exporting Session' })).toBeTruthy()
    release(new Response('zip', { status: 200 }))
    await download
    expect(await b.view.findByRole('dialog', { name: 'Session download started' })).toBeTruthy()
  })

  it('uses fallback copy when a failure has no detail', async () => {
    const b = bench()
    act(() => {
      b.controller.store.set({
        bySession: { [SID]: { open: true, status: 'error', error: '' } },
      })
    })
    const dialog = await b.view.findByRole('dialog', { name: 'Session export failed' })
    expect(dialog.textContent).toContain('Could not start the Session export.')
    const close = b.view.getAllByRole('button', { name: 'Close' }).at(-1)
    if (close === undefined) throw new Error('Session export dialog has no footer action')
    fireEvent.click(close)
    await waitFor(() => { expect(b.dismiss).toHaveBeenCalledWith(SID) })
  })
})

import { expect, it, vi } from 'vitest'
import { insertSelectionIntoCurrentDraft } from '../src/client/index.ts'

it('appends trusted selection to the retained draft without submitting it', () => {
  const id = 'session-1'
  const scope = {}
  const setDraft = vi.fn()
  const focus = vi.fn()
  const submit = vi.fn()
  const ctx = {
    sessions: {
      list: { getSnapshot: () => ({ ids: [id], byId: { [id]: { retainedBy: { mainView: 1 } } } }) },
      binding: () => ({ ctx: scope }),
    },
    conversation: { input: { for: () => ({
      state: { getSnapshot: () => ({ phase: 'plain', draft: 'Existing draft' }) },
      setDraft, focus, submit,
    }) } },
  }
  expect(insertSelectionIntoCurrentDraft(ctx as never, 'Selected words')).toBe(true)
  expect(setDraft).toHaveBeenCalledWith('Existing draft\nSelected words')
  expect(focus).toHaveBeenCalledOnce()
  expect(submit).not.toHaveBeenCalled()
})

it('leaves a busy Session draft unchanged', () => {
  const setDraft = vi.fn()
  const ctx = {
    sessions: {
      list: { getSnapshot: () => ({ ids: ['session-1'], byId: { 'session-1': { retainedBy: { mainView: 1 } } } }) },
      binding: () => ({ ctx: {} }),
    },
    conversation: { input: { for: () => ({ state: { getSnapshot: () => ({ phase: 'submitting', draft: '' }) }, setDraft }) } },
  }
  expect(insertSelectionIntoCurrentDraft(ctx as never, 'Selected words')).toBe(false)
  expect(setDraft).not.toHaveBeenCalled()
})

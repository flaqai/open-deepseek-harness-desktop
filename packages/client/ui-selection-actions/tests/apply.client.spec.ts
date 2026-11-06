import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { ConversationInteractionRegistry } from '../../ui-conversation/src/client/conversation/interaction-registry.ts'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { apply, inject } from '../src/client/index.ts'
import { SelectionActions, type SelectionActionsInjected } from '../src/client/SelectionActions.tsx'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSelectionActionsInjected(value: unknown): value is SelectionActionsInjected {
  if (!isRecord(value) || !isRecord(value.hooks) || !isRecord(value.hooks.appendAvailable)) return false
  const appendAvailable = value.hooks.appendAvailable
  return typeof appendAvailable.getSnapshot === 'function'
    && typeof appendAvailable.subscribe === 'function'
    && typeof value.copy === 'function'
    && typeof value.askInNewConversation === 'function'
    && typeof value.appendToCurrent === 'function'
    && (value.restartDesktop === undefined || typeof value.restartDesktop === 'function')
}

function observable<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: (next: T) => { value = next; for (const listener of listeners) listener() },
  }
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('en')
  ctx.provide('locale', locale)
  const list = observable({
    byId: { 'session-1': { id: 'session-1', retainedBy: { mainView: 1 } } },
  })
  const sessionStatus = observable(new Map())
  const session = observable({
    removed: false,
    openState: 'open',
    pendingSubmissions: [],
    subagent: null,
  })
  const input = observable({ draft: 'existing', phase: 'plain' })
  const block = observable(undefined)
  const actx = {} as Context
  const setDraft = vi.fn((text: string) => { input.set({ ...input.getSnapshot(), draft: text }) })
  const connectWorkspace = vi.fn(async () => 'session-1')
  const openWorkspace = vi.fn(async (_workspaceId: string, beforeOpen?: (sessionId: string) => void) => {
    beforeOpen?.('session-1')
  })
  ctx.provide('sessions', {
    list,
    scope: () => actx,
    sessionOf: () => session,
  } as never)
  let promptAllowed = true
  let createAllowed = true
  const insertQuote = vi.fn(() => true)
  ctx.provide('uiSession', { sessionStatus, whenAccess: (_id: string, _action: string, run: () => () => void) => {
    if (promptAllowed) run()
    return () => {}
  } } as never)
  ctx.provide('remoteAccess', { whenAccess: (_action: string, run: () => () => void) => {
    if (createAllowed) run()
    return () => {}
  } } as never)
  ctx.provide('workspaces', { list: observable({ items: [{ workspaceId: 'workspace-1', sessionIds: ['session-1'] }] }) } as never)
  ctx.provide('resources', { register: () => () => {} } as never)
  ctx.provide('sidebarRightTabs', { register: () => () => {} } as never)
  ctx.provide('sidebarRight', { mounted: observable('session-1'), openTabs: observable([]) } as never)
  ctx.provide('uiWorkspace', { connectWorkspace, openWorkspace } as never)
  const interactions = new ConversationInteractionRegistry(ctx)
  ctx.provide('uiConversation', { interactions } as never)
  ctx.provide('conversation', {
    input: { for: () => ({ state: input, setDraft, insertQuote }) },
    blocks: { storeFor: () => block },
  } as never)
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: { 'shell.overlay': { kind: 'list', scope: 'root' }, 'conversation.chat.text-interaction': { kind: 'keyed', scope: 'session' } },
  } as never, () => null)
  await ctx.plugin({ inject: [...inject], apply }).await()
  const entry = slots.entries('conversation.chat.text-interaction')[0]!
  const injected: unknown = entry.inject?.('session-1' as never)
  if (!isSelectionActionsInjected(injected)) throw new TypeError('selection actions fixture injection is invalid')
  return { ctx, slots, entry, injected, interactions, list, sessionStatus, input, setDraft, insertQuote, openWorkspace,
    denyPrompt: () => { promptAllowed = false }, denyCreate: () => { createAllowed = false } }
}

describe('ui-selection-actions apply', () => {
  it('opens the selected-text surface through the official scoped interaction registry', async () => {
    const b = await bench()
    const preventDefault = vi.fn()
    expect(b.interactions.dispatch(SessionId('session-1'), {
      trigger: 'contextmenu', hasSelection: true, readText: () => 'finished assistant answer', preventDefault,
    })).toBe('selection-actions')
    expect(preventDefault).toHaveBeenCalledOnce()
    await b.ctx.fiber.dispose()
    expect(b.interactions.getSnapshot()).toEqual([])
  })

  it('leaves selection gestures and missing text to other consumers', async () => {
    const b = await bench()
    const preventDefault = vi.fn()
    for (const gesture of [
      { trigger: 'selection' as const, hasSelection: true, readText: () => 'official quote' },
      { trigger: 'contextmenu' as const, hasSelection: false, readText: () => null },
      { trigger: 'contextmenu' as const, hasSelection: true, readText: () => '   ' },
    ]) expect(b.interactions.dispatch(SessionId('session-1'), { ...gesture, preventDefault })).toBeNull()
    expect(preventDefault).not.toHaveBeenCalled()
    await b.ctx.fiber.dispose()
  })

  it('registers the conversation keyed surface and shell feedback', async () => {
    expect(inject).toEqual(['slots', 'sessions', 'uiSession', 'uiWorkspace', 'conversation', 'uiConversation', 'locale', 'remoteAccess', 'workspaces', 'resources', 'sidebarRight', 'sidebarRightTabs'])
    const b = await bench()
    expect(b.entry.component).toBe(SelectionActions)
    expect(b.entry.options).toMatchObject({ key: 'selection-actions' })
    expect(b.entry.locale).toBe('selectionActions')
    await b.ctx.fiber.dispose()
  })

  it('fills a new-conversation draft without sending and appends to the current draft', async () => {
    const b = await bench()
    await b.injected.askInNewConversation('workspace-1' as never, 'question draft')
    expect(b.openWorkspace).toHaveBeenCalledWith('workspace-1', expect.any(Function))
    expect(b.insertQuote).toHaveBeenCalledWith('question draft')
    expect(b.setDraft).not.toHaveBeenCalled()

    b.injected.appendToCurrent('session-1' as never, 'line one\nline two')
    expect(b.insertQuote).toHaveBeenLastCalledWith('line one\nline two')
    expect(b.input.getSnapshot().draft).toBe('existing')
    expect(() => { b.injected.appendToCurrent('another-session' as never, 'wrong target') }).toThrow('not editable')
    await b.ctx.fiber.dispose()
  })

  it('reports cancelled new-conversation navigation without claiming quote insertion', async () => {
    const b = await bench()
    b.openWorkspace.mockImplementation(async () => {})
    await expect(b.injected.askInNewConversation('workspace-1' as never, 'selection')).rejects.toThrow('cancelled')
    expect(b.insertQuote).not.toHaveBeenCalled()
    await b.ctx.fiber.dispose()
  })

  it('rechecks creation and quote permissions at invocation time', async () => {
    const b = await bench()
    b.denyPrompt()
    expect(() => { b.injected.appendToCurrent('session-1' as never, 'blocked') }).toThrow('cannot accept a quote')
    b.denyCreate()
    await expect(b.injected.askInNewConversation('workspace-1' as never, 'blocked')).rejects.toThrow('cannot create')
    await expect(b.injected.askInSideConversation('workspace-1' as never, 'blocked')).rejects.toThrow('cannot create')
    expect(b.insertQuote).not.toHaveBeenCalled()
    expect(b.openWorkspace).not.toHaveBeenCalled()
    await b.ctx.fiber.dispose()
  })

  it('removes append availability and rejects stale writes while an interaction is pending', async () => {
    const b = await bench()
    const notified = vi.fn()
    const stop = b.injected.hooks.appendAvailable.subscribe(notified)
    expect(b.injected.hooks.appendAvailable.getSnapshot()).toBe(true)
    b.sessionStatus.set(new Map([['session-1', { pendingInteraction: { kind: 'approval' } }]]) as never)
    expect(b.injected.hooks.appendAvailable.getSnapshot()).toBe(false)
    expect(notified).toHaveBeenCalled()
    expect(() => { b.injected.appendToCurrent('session-1' as never, 'blocked') }).toThrow('not editable')
    stop()
    await b.ctx.fiber.dispose()
  })

  it('projects only the trusted desktop restart bridge', async () => {
    const root = globalThis as typeof globalThis & { deepSeekHarnessDesktop?: unknown }
    const previous = root.deepSeekHarnessDesktop
    const restart = vi.fn(async () => ({ restarting: true }))
    root.deepSeekHarnessDesktop = { shell: { restart } }
    try {
      const b = await bench()
      await expect(b.injected.restartDesktop?.()).resolves.toBeUndefined()
      expect(restart).toHaveBeenCalledOnce()
      await b.ctx.fiber.dispose()
    } finally {
      if (previous === undefined) delete root.deepSeekHarnessDesktop
      else root.deepSeekHarnessDesktop = previous
    }
  })

  it('does not project obsolete or incomplete desktop bridge shapes', async () => {
    const root = globalThis as typeof globalThis & { deepSeekHarnessDesktop?: unknown }
    const previous = root.deepSeekHarnessDesktop
    try {
      for (const desktop of [{ restart: vi.fn() }, { shell: {} }, { shell: null }]) {
        root.deepSeekHarnessDesktop = desktop
        const b = await bench()
        expect(b.injected.restartDesktop).toBeUndefined()
        await b.ctx.fiber.dispose()
      }
    } finally {
      if (previous === undefined) delete root.deepSeekHarnessDesktop
      else root.deepSeekHarnessDesktop = previous
    }
  })
})

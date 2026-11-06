import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ResourceProvider } from '@deepseek-ai/dsh-client-resources/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { registerSideConversations, sideConversationId } from '../src/client/side-conversation.tsx'

const sourceId = SessionId('source')
const createdId = SessionId('new-session')
const workspaceId = WorkspaceId('workspace')

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  let provider: ResourceProvider<'selectionchat'> | undefined
  const resource = (): ResourceProvider<'selectionchat'> => {
    if (provider === undefined) throw new Error('missing side chat provider')
    return provider
  }
  const frames: unknown[] = []
  const abort = new AbortController()
  const release = vi.fn()
  const retain = vi.fn(() => ({ ready: Promise.resolve(), release }))
  const create = vi.fn(async () => createdId)
  const insertQuote = vi.fn(() => true)
  const submit = vi.fn()
  const closedTabId = 'created-tab'
  const openTabs = createSnapshotStore<readonly { sessionId: SessionId; tabId: string; contentId: string; kind: string }[]>([])
  let consumption: Promise<void> | undefined
  const openResourceIn = vi.fn((host: SessionId, address: string) => {
    openTabs.set([{ sessionId: host, tabId: closedTabId, contentId: address, kind: 'selectionchat' }])
    consumption = (async () => {
      for await (const frame of resource().open(address, { signal: abort.signal })) frames.push(frame)
    })()
  })
  const closeIn = vi.fn(() => { abort.abort() })
  let createAllowed = true
  let promptAllowed = true
  const allowed = (_action: unknown, run: () => () => void): (() => void) => {
    if (createAllowed) run()
    return () => {}
  }
  ctx.provide('remoteAccess', { whenAccess: allowed } as never)
  ctx.provide('uiSession', { whenAccess: (_id: unknown, _action: unknown, run: () => () => void) => {
    if (promptAllowed) run()
    return () => {}
  } } as never)
  ctx.provide('workspaces', { list: createSnapshotStore({ items: [{ workspaceId, sessionIds: [sourceId] }] }) } as never)
  ctx.provide('sessions', { create, retain, scope: () => ctx, list: createSnapshotStore({ byId: {} }) } as never)
  ctx.provide('conversation', { input: { for: () => ({ insertQuote, submit }) } } as never)
  ctx.provide('resources', { register: (next: ResourceProvider<'selectionchat'>) => { provider = next; return () => {} } } as never)
  ctx.provide('sidebarRightTabs', { register: () => () => {} } as never)
  const mounted = createSnapshotStore(sourceId)
  ctx.provide('sidebarRight', { mounted, openTabs, openResourceIn, closeIn } as never)
  const ask = registerSideConversations(ctx)
  return { ctx, ask, create, mounted, retain, insertQuote, submit, openResourceIn, closeIn, release, abort, frames, resource,
    settle: async () => consumption, denyCreate: () => { createAllowed = false }, denyPrompt: () => { promptAllowed = false } }
}

describe('ordinary sidebar conversation', () => {
  it('creates one ordinary Session with a quote and retains it only while the resource is open', async () => {
    const b = await bench()
    await b.ask(sourceId, workspaceId, 'selected answer')
    expect(b.create).toHaveBeenCalledWith({ workspaceId })
    expect(b.retain).toHaveBeenCalledWith(createdId, { source: 'selectionChat', signal: b.abort.signal })
    expect(b.insertQuote).toHaveBeenCalledWith('selected answer')
    expect(b.submit).not.toHaveBeenCalled()
    expect(b.openResourceIn).toHaveBeenCalledWith(sourceId, 'dsh-resource://selectionchat/session/new-session',
      { kind: 'selectionchat', preferNewPane: true })
    expect(b.release).not.toHaveBeenCalled()
    b.abort.abort()
    await b.settle()
    expect(b.release).toHaveBeenCalledOnce()
    await b.ctx.fiber.dispose()
  })

  it('rejects a changed sidebar host without opening an invisible or unrelated tab', async () => {
    const b = await bench()
    const created = Promise.withResolvers<SessionId>()
    b.create.mockImplementation(() => created.promise)
    const opening = expect(b.ask(sourceId, workspaceId, 'selected answer')).rejects.toThrow('sidebar conversation changed')
    b.mounted.set(SessionId('different-main-session'))
    created.resolve(createdId)
    await opening
    expect(b.openResourceIn).not.toHaveBeenCalled()
    expect(b.retain).not.toHaveBeenCalled()
    await b.ctx.fiber.dispose()
  })

  it('rejects creation permission changes before creating a Session', async () => {
    const b = await bench()
    b.denyCreate()
    await expect(b.ask(sourceId, workspaceId, 'selected')).rejects.toThrow('cannot create')
    expect(b.create).not.toHaveBeenCalled()
    await b.ctx.fiber.dispose()
  })

  it('rejects target prompt permission and releases its retained Session', async () => {
    const b = await bench()
    b.denyPrompt()
    await expect(b.ask(sourceId, workspaceId, 'selected')).rejects.toThrow('cannot accept a quote')
    await b.settle()
    expect(b.insertQuote).not.toHaveBeenCalled()
    expect(b.release).toHaveBeenCalledOnce()
    expect(b.closeIn).toHaveBeenCalledOnce()
    await b.ctx.fiber.dispose()
  })

  it('reports quote refusal and closes only its newly opened tab without deleting Session data', async () => {
    const b = await bench()
    b.insertQuote.mockReturnValue(false)
    await expect(b.ask(sourceId, workspaceId, 'blocked')).rejects.toThrow('cannot accept a quote')
    await b.settle()
    expect(b.closeIn).toHaveBeenCalledWith(sourceId, 'created-tab')
    expect(b.release).toHaveBeenCalledOnce()
    expect(b.submit).not.toHaveBeenCalled()
    expect(b.frames).toMatchObject([{ ok: false, error: { code: 'gateway/internal' } }])
    await b.ctx.fiber.dispose()
  })

  it('releases the reference when opening fails', async () => {
    const b = await bench()
    b.retain.mockImplementation(() => ({ ready: Promise.reject(new Error('open failed')), release: b.release }))
    await expect(b.ask(sourceId, workspaceId, 'selected')).rejects.toThrow('open failed')
    await b.settle()
    expect(b.release).toHaveBeenCalledOnce()
    expect(b.insertQuote).not.toHaveBeenCalled()
    await b.ctx.fiber.dispose()
  })

  it('restores a saved ordinary chat without repeating quote insertion', async () => {
    const b = await bench()
    const stream = b.resource().open('dsh-resource://selectionchat/session/existing', { signal: b.abort.signal })[Symbol.asyncIterator]()
    expect(await stream.next()).toMatchObject({ value: { ok: true } })
    expect(b.insertQuote).not.toHaveBeenCalled()
    b.abort.abort()
    await stream.next()
    expect(b.release).toHaveBeenCalledOnce()
    await b.ctx.fiber.dispose()
  })

  it('fails closed before creation for a foreign workspace and after plugin disposal', async () => {
    const b = await bench()
    await expect(b.ask(sourceId, WorkspaceId('foreign'), 'selection')).rejects.toThrow('cannot create')
    expect(b.create).not.toHaveBeenCalled()
    await b.ctx.fiber.dispose()
    await expect(b.ask(sourceId, workspaceId, 'selection')).rejects.toThrow('disposed')
    expect(b.create).not.toHaveBeenCalled()
  })

  it('never applies a quote after a timed-out opening resolves late', async () => {
    const b = await bench()
    const timeout = new AbortController()
    const ready = Promise.withResolvers<undefined>()
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
    b.retain.mockImplementation(() => ({ ready: ready.promise, release: b.release }))
    b.closeIn.mockImplementation(() => {})
    try {
      const opening = expect(b.ask(sourceId, workspaceId, 'late quote')).rejects.toThrow('timed out')
      await vi.waitFor(() => { expect(b.retain).toHaveBeenCalledOnce() })
      timeout.abort(new Error('timed out'))
      await opening
      ready.resolve(undefined)
      await b.settle()
      expect(b.insertQuote).not.toHaveBeenCalled()
      expect(b.release).toHaveBeenCalledOnce()
    } finally {
      timeoutSpy.mockRestore()
      await b.ctx.fiber.dispose()
    }
  })

  it('validates ordinary-session addresses without accepting subagent routing or extra path segments', () => {
    expect(sideConversationId('dsh-resource://selectionchat/session/ordinary')).toBe('ordinary')
    for (const value of ['dsh-resource://subagentchat/session/child?parent=source&mode=continuable',
      'dsh-resource://selectionchat/session/', 'dsh-resource://selectionchat/session/%ZZ',
      'dsh-resource://selectionchat/session/..', 'dsh-resource://selectionchat/session/a%5Cb',
      'dsh-resource://selectionchat/session/a%00b', 'dsh-resource://selectionchat/session/session/extra', 'dsh-resource://selectionchat/session/session?parent=source']) {
      expect(sideConversationId(value)).toBeUndefined()
    }
  })
})

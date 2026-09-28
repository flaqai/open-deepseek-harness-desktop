import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createDesktopOrbBackgroundTasks, type OrbBackgroundSessionDriver } from '../src/desktop-orb-background.ts'

const homes: string[] = []
afterEach(async () => { await Promise.all(homes.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'dsh-orb-background-'))
  homes.push(home)
  const caller = SessionId('session-00000000-0000-4000-8000-000000000001')
  const other = SessionId('session-00000000-0000-4000-8000-000000000002')
  const headers = new Map<SessionId, { id: SessionId; cwd: string; agentPreset: string; origin?: 'subagent' }>([
    [caller, { id: caller, cwd: join(home, 'orb-workspace'), agentPreset: 'standard' }],
    [other, { id: other, cwd: join(home, 'other'), agentPreset: 'standard' }],
  ])
  const running = new Set<string>()
  let local = true
  let owned = true
  const create = vi.fn(async (request: Parameters<OrbBackgroundSessionDriver['create']>[0]) => {
    if (request.sessionId === undefined || request.cwd === undefined || request.agentPreset === undefined) throw new Error('incomplete Session')
    headers.set(request.sessionId, { id: request.sessionId, cwd: request.cwd, agentPreset: request.agentPreset })
    return { sessionId: request.sessionId, agentPreset: request.agentPreset }
  })
  const prompt = vi.fn(async (request: Parameters<OrbBackgroundSessionDriver['prompt']>[0]) => {
    running.add(request.sessionId)
    return { accepted: true as const }
  })
  const cancel = vi.fn((request: Parameters<OrbBackgroundSessionDriver['cancel']>[0]) => {
    running.delete(request.sessionId)
    return { accepted: true as const }
  })
  const sessions = {
    create,
    prompt,
    cancel,
    inspect: async (id: SessionId) => {
      const meta = headers.get(id)
      if (meta === undefined) throw new Error('Session missing')
      return { meta: meta as never, events: [], inheritedEventCount: 0 as never }
    },
    list: async () => {
      return { items: [...headers].map(([sessionId]) => ({
        sessionId, running: running.has(sessionId), agentAvailable: true, updatedAt: 0, blank: false,
      })) }
    },
  } satisfies OrbBackgroundSessionDriver
  const owner = { ownsCaller: async (id: string) => id === caller && owned }
  const tasks = () => createDesktopOrbBackgroundTasks(home, owner, sessions, () => local)
  return { home, caller, other, headers, running, create, prompt, cancel, tasks,
    setLocal(value: boolean) { local = value }, setOwned(value: boolean) { owned = value } }
}

describe('local Desktop Orb background Sessions', () => {
  it('creates a standard Session, queues its prompt, and restores ownership after Host restart', async () => {
    const f = await fixture()
    const first = f.tasks()
    const receipt = await first.submit({ callerSessionId: f.caller, task: '  prepare the report  ' })
    expect(receipt.created).toBe(true)
    expect(f.create).toHaveBeenCalledWith({
      sessionId: receipt.sessionId, cwd: join(f.home, 'orb-workspace'), agentPreset: 'standard',
    })
    expect(f.prompt).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: receipt.sessionId, mode: 'queue', content: [{ type: 'text', text: 'prepare the report' }],
    }), expect.any(AbortSignal))
    const restarted = f.tasks()
    expect(await restarted.list(f.caller)).toEqual([{
      sessionId: receipt.sessionId, cwd: join(f.home, 'orb-workspace'), running: true,
    }])
    await restarted.submit({ callerSessionId: f.caller, workerSessionId: receipt.sessionId, task: 'revise it' })
    expect(f.create).toHaveBeenCalledTimes(1)
    await restarted.stop(f.caller, receipt.sessionId)
    expect(f.cancel).toHaveBeenCalledWith({ sessionId: receipt.sessionId })
    expect(await restarted.list(f.caller)).toEqual([{
      sessionId: receipt.sessionId, cwd: join(f.home, 'orb-workspace'), running: false,
    }])
  })

  it('rejects foreign callers, foreign workers, and NAS mode before admitting work', async () => {
    const f = await fixture()
    const tasks = f.tasks()
    const receipt = await tasks.submit({ callerSessionId: f.caller, task: 'draft' })
    await expect(tasks.submit({ callerSessionId: f.other, task: 'draft' })).rejects.toThrow('caller is not')
    await expect(tasks.stop(f.other, receipt.sessionId)).rejects.toThrow('caller is not')
    f.setLocal(false)
    await expect(tasks.submit({ callerSessionId: f.caller, task: 'draft' })).rejects.toThrow('local Desktop')
    await expect(tasks.list(f.caller)).rejects.toThrow('local Desktop')
    f.setLocal(true)
    f.setOwned(false)
    await expect(tasks.stop(f.caller, receipt.sessionId)).rejects.toThrow('caller is not')
    expect(f.prompt).toHaveBeenCalledTimes(1)
    expect(f.cancel).not.toHaveBeenCalled()
  })

  it('rejects a worker whose persisted Session no longer matches its standard identity', async () => {
    const f = await fixture()
    const tasks = f.tasks()
    const receipt = await tasks.submit({ callerSessionId: f.caller, task: 'draft' })
    f.headers.get(receipt.sessionId)!.origin = 'subagent'
    await expect(tasks.submit({ callerSessionId: f.caller, workerSessionId: receipt.sessionId, task: 'revise' }))
      .rejects.toThrow('differs from its ownership record')
    await expect(tasks.stop(f.caller, receipt.sessionId)).rejects.toThrow('differs from its ownership record')
    expect(f.prompt).toHaveBeenCalledTimes(1)
  })
})

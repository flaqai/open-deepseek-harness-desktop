import { describe, expect, it, vi } from 'vitest'
import {
  createOrbBackgroundTasks,
  type OrbBackgroundAuthority,
  type OrbBackgroundSessionDriver,
} from '../src/orb-background-task.ts'

function fixture() {
  let authority: OrbBackgroundAuthority = { home: '/local/harness', mode: 'local' }
  const owned = new Set(['orb-1', 'orb-2'])
  let next = 0
  const sessions = new Map<string, { preset: string; origin?: 'subagent'; cwd?: string; running: boolean }>()
  const create = vi.fn<OrbBackgroundSessionDriver<string>['create']>(async (input) => {
    const id = `worker-${++next}`
    sessions.set(id, { preset: input.preset, ...(input.cwd === undefined ? {} : { cwd: input.cwd }), running: false })
    return id
  })
  const enqueue = vi.fn<OrbBackgroundSessionDriver<string>['enqueue']>(async (input) => {
    sessions.get(input.sessionId)!.running = true
  })
  const inspect = vi.fn<OrbBackgroundSessionDriver<string>['inspect']>(async (id) => {
    const session = sessions.get(id)
    if (session === undefined) throw new Error('unknown Session')
    return session
  })
  const stop = vi.fn<OrbBackgroundSessionDriver<string>['stop']>(async (id) => {
    sessions.get(id)!.running = false
  })
  return {
    create,
    enqueue,
    inspect,
    stop,
    sessions,
    options: {
      home: '/local/harness',
      authority: async () => authority,
      ownsCaller: async (id: string) => owned.has(id),
      sessions: { create, enqueue, inspect, stop },
    },
    setAuthority: (nextAuthority: OrbBackgroundAuthority) => { authority = nextAuthority },
    setOwned: (id: string, value: boolean) => { if (value) owned.add(id); else owned.delete(id) },
  }
}

describe('floating background tasks', () => {
  it('creates only a standard Session and exposes status and stop to its caller', async () => {
    const f = fixture()
    const tasks = createOrbBackgroundTasks(f.options)
    const result = await tasks.submit({ callerSessionId: 'orb-1', task: '  write notes  ', cwd: '/local/work' })
    expect(result).toEqual({ sessionId: 'worker-1', created: true })
    expect(f.create).toHaveBeenCalledWith({ preset: 'standard', cwd: '/local/work' }, expect.any(AbortSignal))
    expect(f.enqueue).toHaveBeenCalledWith({ sessionId: 'worker-1', task: 'write notes' }, expect.any(AbortSignal))
    expect(await tasks.list('orb-1')).toEqual([{ sessionId: 'worker-1', task: 'write notes', cwd: '/local/work', status: 'running' }])
    await tasks.stop('orb-1', 'worker-1')
    expect(f.stop).toHaveBeenCalledWith('worker-1')
    expect(await tasks.list('orb-1')).toEqual([{ sessionId: 'worker-1', task: 'write notes', cwd: '/local/work', status: 'idle' }])
    await tasks.close()
    expect(f.stop).toHaveBeenCalledTimes(1)
  })

  it('rejects NAS mode, a switched home, and an unowned caller before creating work', async () => {
    const f = fixture()
    const tasks = createOrbBackgroundTasks(f.options)
    f.setAuthority({ home: '/local/harness', mode: 'nas' })
    await expect(tasks.submit({ callerSessionId: 'orb-1', task: 'go' })).rejects.toThrow('active local data directory')
    f.setAuthority({ home: '/other/harness', mode: 'local' })
    await expect(tasks.submit({ callerSessionId: 'orb-1', task: 'go' })).rejects.toThrow('active local data directory')
    f.setAuthority({ home: '/local/harness', mode: 'local' })
    await expect(tasks.submit({ callerSessionId: 'foreign', task: 'go' })).rejects.toThrow('not an owned')
    expect(f.create).not.toHaveBeenCalled()
    await tasks.close()
  })

  it('cannot list, stop, or continue another floating chat’s worker', async () => {
    const f = fixture()
    const tasks = createOrbBackgroundTasks(f.options)
    await tasks.submit({ callerSessionId: 'orb-1', task: 'draft' })
    expect(await tasks.list('orb-2')).toEqual([])
    await expect(tasks.stop('orb-2', 'worker-1')).rejects.toThrow('not owned')
    await expect(tasks.submit({ callerSessionId: 'orb-2', workerSessionId: 'worker-1', task: 'change it' })).rejects.toThrow('not owned')
    expect(f.stop).not.toHaveBeenCalled()
    expect(f.enqueue).toHaveBeenCalledTimes(1)
    await tasks.close()
  })

  it('continues only a standard Session with the same cwd and current caller authority', async () => {
    const f = fixture()
    const tasks = createOrbBackgroundTasks(f.options)
    await tasks.submit({ callerSessionId: 'orb-1', task: 'draft', cwd: '/local/work' })
    await expect(tasks.submit({ callerSessionId: 'orb-1', workerSessionId: 'worker-1', task: 'revise', cwd: '/elsewhere' })).rejects.toThrow('cwd differs')
    f.sessions.get('worker-1')!.origin = 'subagent'
    await expect(tasks.submit({ callerSessionId: 'orb-1', workerSessionId: 'worker-1', task: 'revise' })).rejects.toThrow('not a standard Session')
    delete f.sessions.get('worker-1')!.origin
    f.setOwned('orb-1', false)
    await expect(tasks.submit({ callerSessionId: 'orb-1', workerSessionId: 'worker-1', task: 'revise' })).rejects.toThrow('not an owned')
    f.setOwned('orb-1', true)
    expect(await tasks.submit({ callerSessionId: 'orb-1', workerSessionId: 'worker-1', task: 'revise' })).toEqual({ sessionId: 'worker-1', created: false })
    expect(f.enqueue).toHaveBeenCalledTimes(2)
    await tasks.close()
  })

  it('rechecks NAS mode after Session creation before it queues a prompt', async () => {
    const f = fixture()
    f.create.mockImplementation(async (input) => {
      f.sessions.set('worker-1', { preset: input.preset, running: false })
      f.setAuthority({ home: '/local/harness', mode: 'nas' })
      return 'worker-1'
    })
    const tasks = createOrbBackgroundTasks(f.options)
    await expect(tasks.submit({ callerSessionId: 'orb-1', task: 'draft' })).rejects.toThrow('active local data directory')
    expect(f.enqueue).not.toHaveBeenCalled()
    f.setAuthority({ home: '/local/harness', mode: 'local' })
    expect(await tasks.list('orb-1')).toEqual([{ sessionId: 'worker-1', task: 'draft', status: 'idle' }])
    await tasks.close()
  })

  it('settles in-flight requests without cancelling an accepted background Session', async () => {
    const f = fixture()
    let finish: (() => void) | undefined
    f.enqueue.mockImplementation(async (input) => {
      await new Promise<void>((resolve) => { finish = resolve })
      f.sessions.get(input.sessionId)!.running = true
    })
    const tasks = createOrbBackgroundTasks(f.options)
    const submitting = tasks.submit({ callerSessionId: 'orb-1', task: 'draft' })
    await vi.waitFor(() => { expect(finish).toBeTypeOf('function') })
    const closing = tasks.close()
    finish?.()
    await submitting
    await closing
    expect(f.stop).not.toHaveBeenCalled()
    await expect(tasks.list('orb-1')).rejects.toThrow('controller is closed')
  })
})

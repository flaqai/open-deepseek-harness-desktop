import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  inspectDesktopQuit, installDesktopQuitInspectionRoute, mayExposeDesktopQuitInspection,
} from '../src/desktop-quit-inspection.ts'

type Agent = { id: string; status: 'idle' | 'running'; inbox: { nextTurn: object[]; nextStep: object[] } }

let ctx: Context
let agents: Agent[]
let jobs: Array<{ status: 'running' | 'stopping' | 'completed'; owner?: string }>
let reminders: Array<{ status: 'active' | 'inactive' }>
let catalogError: Error | undefined

beforeEach(() => {
  ctx = new Context()
  agents = []
  jobs = []
  reminders = []
  catalogError = undefined
  ctx.provide('agents', { list: () => agents } as never)
  ctx.provide('jobs', { list: (owner?: string) => jobs.filter(job => job.owner === owner) } as never)
  ctx.provide('schedule', { catalog: async () => {
    if (catalogError !== undefined) throw catalogError
    return reminders
  } } as never)
})

afterEach(async () => { await ctx.fiber.dispose() })

function agent(id: string, status: 'idle' | 'running' = 'idle'): Agent {
  return { id, status, inbox: { nextTurn: [], nextStep: [] } }
}

describe('community Desktop local Host quit inspection', () => {
  it('exposes no route to ordinary Web, NAS, or all-interface binds', () => {
    expect(mayExposeDesktopQuitInspection('1234', '127.0.0.1', false)).toBe(true)
    expect(mayExposeDesktopQuitInspection(undefined, '127.0.0.1', false)).toBe(false)
    expect(mayExposeDesktopQuitInspection('not-a-pid', '127.0.0.1', false)).toBe(false)
    expect(mayExposeDesktopQuitInspection('1234', '127.0.0.1', true)).toBe(false)
    expect(mayExposeDesktopQuitInspection('1234', '0.0.0.0', false)).toBe(false)
  })

  it('reads active reminders from the whole persisted catalog, even for unloaded Sessions', async () => {
    reminders.push({ status: 'inactive' }, { status: 'active' })
    expect(await inspectDesktopQuit(ctx)).toEqual({ activeTasks: false, scheduledTasks: true })
  })

  it.each(['running', 'nextTurn', 'nextStep', 'ownedJob', 'unownedJob'] as const)(
    'counts %s as interruptible work', async (kind) => {
      const live = agent('session-1', kind === 'running' ? 'running' : 'idle')
      if (kind === 'nextTurn' || kind === 'nextStep') live.inbox[kind].push({ queued: true })
      if (kind === 'ownedJob') jobs.push({ status: 'stopping', owner: live.id })
      if (kind === 'unownedJob') jobs.push({ status: 'running' })
      agents.push(live)
      expect(await inspectDesktopQuit(ctx)).toEqual({ activeTasks: true, scheduledTasks: false })
    },
  )

  it('does not count inactive reminders or completed jobs', async () => {
    agents.push(agent('session-1'))
    jobs.push({ status: 'completed', owner: 'session-1' })
    reminders.push({ status: 'inactive' })
    expect(await inspectDesktopQuit(ctx)).toEqual({ activeTasks: false, scheduledTasks: false })
  })

  it('treats the shipped disabled Schedule row as having no armed reminders', async () => {
    const noSchedule = new Context()
    noSchedule.provide('agents', { list: () => [] } as never)
    noSchedule.provide('jobs', { list: () => [] } as never)
    try {
      expect(await inspectDesktopQuit(noSchedule)).toEqual({ activeTasks: false, scheduledTasks: false })
    } finally { await noSchedule.fiber.dispose() }
  })

  it('rejects a missing or failing task service instead of reporting an idle Host', async () => {
    const missing = new Context()
    try {
      await expect(inspectDesktopQuit(missing)).rejects.toThrow('required task services are unavailable')
    } finally { await missing.fiber.dispose() }
    catalogError = new Error('catalog unreadable')
    await expect(inspectDesktopQuit(ctx)).rejects.toThrow('catalog unreadable')
  })

  it('registers only exact GET and returns an error on failed inspection', async () => {
    const unregister = vi.fn()
    let route: { fetch(): Promise<Response> } | undefined
    const register = vi.fn((input: unknown) => {
      route = input as { fetch(): Promise<Response> }
      return unregister
    })
    ctx.provide('connection', { fetch: { register } } as never)
    const mounted = ctx.plugin((pluginCtx) => { installDesktopQuitInspectionRoute(pluginCtx) })
    await mounted.await()
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      path: '/api/desktop.quit-inspection', methods: ['GET'], requestBody: 'buffered',
    }))
    expect(route).toBeDefined()
    const healthy = await route!.fetch()
    expect(healthy.headers.get('Cache-Control')).toBe('no-store')
    expect(await healthy.json()).toEqual({ activeTasks: false, scheduledTasks: false })
    catalogError = new Error('catalog unreadable')
    const failed = await route!.fetch()
    expect(failed.status).toBe(503)
    expect(await failed.json()).toEqual({ error: 'inspection_unavailable' })
    await mounted.dispose()
    expect(unregister).toHaveBeenCalledOnce()
  })
})

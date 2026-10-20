import { renameSync } from 'node:fs'
import * as fs from 'node:fs'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, expect, it, vi } from 'vitest'
import { HarnessSupervisor } from '../src/supervisor.ts'

const injected = vi.hoisted(() => ({ failures: [] as string[], attempts: 0,
  gate: undefined as Promise<void> | undefined, entered: undefined as (() => void) | undefined }))

vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>()
  return { ...actual, renameSync: (...args: Parameters<typeof renameSync>) => {
    injected.attempts++
    const code = injected.failures.shift()
    if (code !== undefined) throw Object.assign(new Error(code), { code })
    actual.renameSync(...args)
  } }
})
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>()
  return { ...actual, rename: async (...args: Parameters<typeof actual.rename>) => {
    injected.attempts++
    injected.entered?.()
    await injected.gate
    const code = injected.failures.shift()
    if (code !== undefined) throw Object.assign(new Error(code), { code })
    return actual.rename(...args)
  } }
})

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  injected.failures = []
  injected.attempts = 0
  injected.gate = undefined
  injected.entered = undefined
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-restart-state-'))
  roots.push(root)
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const done = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
  const ready = vi.fn()
  const failed = vi.fn()
  const launch = vi.fn(() => ({ containment: 'windows-job', handle: {
    stdout, stderr, stdin: undefined, done: done.promise, waitForExit: async () => true,
    terminate: () => { done.resolve({ exitCode: 0, signal: null }) },
  } }))
  const supervisor = new HarnessSupervisor({ launch: { command: 'node', args: [] },
    environment: {}, logPath: join(root, 'harness.log'), onReady: ready,
    onDiagnosticReady: () => {}, onState: () => {}, onFailure: failed,
    managedRuntime: { register: () => 'owner', preserve: async () => {}, stopAll: async () => {},
      stop: async () => {}, stopRecovered: async () => {}, list: () => [], launch },
  })
  const state = async () => {
    const directory = (await readdir(root)).find(name => name.startsWith('.desktop-web-restart-'))!
    return JSON.parse(await readFile(join(root, directory, 'state.json'), 'utf8')) as { phase: string; generation: number }
  }
  return { supervisor, stdout, ready, failed, launch, state }
}

it('retries transient Windows readiness replacement without announcing failure', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  const value = await fixture()
  try {
    await value.supervisor.start()
    injected.failures.push('EPERM', 'EBUSY', 'EACCES')
    value.stdout.write('dsh web: http://127.0.0.1:43129\n')
    await vi.waitFor(() => { expect(value.ready).toHaveBeenCalledTimes(1) })
    expect(value.failed).not.toHaveBeenCalled()
    expect(await value.state()).toMatchObject({ phase: 'ready', generation: 1 })
    expect(injected.attempts).toBe(5)
  } finally { await value.supervisor.stop() }
})

it('reports persistent Windows replacement failure and never announces readiness', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  const value = await fixture()
  try {
    await value.supervisor.start()
    injected.failures.push(...Array.from({ length: 9 }, () => 'EPERM'))
    value.stdout.write('dsh web: http://127.0.0.1:43129\n')
    await vi.waitFor(() => { expect(value.failed).toHaveBeenCalledTimes(1) }, { timeout: 3000 })
    expect(value.ready).not.toHaveBeenCalled()
    expect(injected.attempts).toBeGreaterThanOrEqual(10)
    await vi.waitFor(async () => { expect(await value.state()).toMatchObject({ phase: 'stopped' }) })
  } finally { await value.supervisor.stop() }
})

it('waits for an initial write during stop and never spawns its stale generation', async () => {
  const value = await fixture()
  const release = Promise.withResolvers<undefined>()
  injected.entered = vi.fn()
  injected.gate = release.promise
  try {
    const starting = value.supervisor.start()
    await vi.waitFor(() => { expect(injected.entered).toHaveBeenCalled() })
    await value.supervisor.start()
    const stopping = value.supervisor.stop()
    expect(value.launch).not.toHaveBeenCalled()
    release.resolve(undefined)
    await Promise.all([starting, stopping])
    expect(value.launch).not.toHaveBeenCalled()
    expect(await value.state()).toMatchObject({ phase: 'stopped', generation: 2 })
  } finally { release.resolve(undefined); await value.supervisor.stop() }
})

it('serializes overlapping ready and stop writes and does not publish stale readiness', async () => {
  const value = await fixture()
  const release = Promise.withResolvers<undefined>()
  try {
    await value.supervisor.start()
    injected.entered = vi.fn()
    injected.gate = release.promise
    value.stdout.write('dsh web: http://127.0.0.1:43129\n')
    await vi.waitFor(() => { expect(injected.entered).toHaveBeenCalled() })
    const stopping = value.supervisor.stop()
    release.resolve(undefined)
    await stopping
    expect(value.ready).not.toHaveBeenCalled()
    expect(await value.state()).toMatchObject({ phase: 'stopped', generation: 2 })
  } finally { release.resolve(undefined); await value.supervisor.stop() }
})

it('ignores a readiness marker arriving after stop has already fenced the child generation', async () => {
  const value = await fixture()
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  try {
    await value.supervisor.start()
    injected.entered = () => { entered.resolve(undefined) }
    injected.gate = release.promise
    const stopping = value.supervisor.stop()
    await entered.promise
    value.stdout.write('dsh web: http://127.0.0.1:43129\n')
    release.resolve(undefined)
    await stopping
    expect(value.ready).not.toHaveBeenCalled()
    expect(injected.attempts).toBe(2)
    expect(await value.state()).toMatchObject({ phase: 'stopped', generation: 2 })
  } finally { release.resolve(undefined); await value.supervisor.stop() }
})

it('reports an asynchronous resume preparation exception without leaving an unhandled startup rejection', async () => {
  const value = await fixture()
  try {
    await value.supervisor.start()
    await value.supervisor.stop()
    vi.spyOn(fs, 'mkdirSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('EACCES: log directory is unavailable'), { code: 'EACCES' })
    })
    expect(value.supervisor.resume()).toBe(true)
    await vi.waitFor(() => { expect(value.failed).toHaveBeenCalledTimes(1) })
    expect(value.failed).toHaveBeenCalledWith({ message: 'Harness could not start: EACCES: log directory is unavailable' })
    expect(value.launch).toHaveBeenCalledTimes(1)
    expect(await value.state()).toMatchObject({ phase: 'failed' })
  } finally { await value.supervisor.stop() }
})

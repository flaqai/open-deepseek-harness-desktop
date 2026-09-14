import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProfileTransactionManager } from '../src/profile-transaction-manager.ts'

const homes: string[] = []
const managers: ProfileTransactionManager[] = []
afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.dispose()
  vi.useRealTimers()
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})
function fixture(phase = 'prepared', producerPid = 99999999, failActivation = false, resumePreparation?: (id: string) => Promise<boolean>) {
  const home = mkdtempSync(join(tmpdir(), 'desktop-transaction-'))
  homes.push(home)
  const id = randomUUID()
  const directory = join(home, 'plugin-transactions', 'web')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'pending.json'), JSON.stringify({ id, phase, producerPid }))
  const lockRoot = join(home, 'plugin-snapshots', 'v1')
  mkdirSync(lockRoot, { recursive: true })
  const lock = join(lockRoot, '.profile-plugin-mutation.web.lock')
  writeFileSync(lock, JSON.stringify({ pid: process.pid, token: id }))
  const calls: string[] = []
  const onError = vi.fn()
  const onRollback = vi.fn()
  const manager = new ProfileTransactionManager({
    home,
    ...(resumePreparation === undefined ? {} : { resumePreparation }),
    command: async (args, token) => {
      calls.push(`${args.join(' ')}:${token ?? 'new-lock'}`)
      if (failActivation && args[1] === 'activate') throw new Error('activation interrupted')
    },
    stopHarness: async () => { calls.push('stop') },
    resumeHarness: () => { calls.push('resume') },
    onActivation: () => { calls.push('activation') },
    onCommit: async () => { calls.push('first-start-complete') },
    onError,
    onRollback,
  })
  managers.push(manager)
  return { home, id, lock, manager, calls, onError, onRollback }
}

describe('desktop plugin activation ownership', () => {
  it('resumes matching dead-owner preparation but rolls back rejected fingerprints and never resumes live owners', async () => {
    const resume = vi.fn(async () => true)
    const f = fixture('preparing', 99999999, false, resume)
    writeFileSync(f.lock, JSON.stringify({ pid: 99999999 }))
    await f.manager.recoverBeforeStartup()
    expect(resume).toHaveBeenCalledWith(f.id)
    expect(f.calls).toEqual([])
    const g = fixture('preparing', 99999999, false, async () => false)
    writeFileSync(g.lock, JSON.stringify({ pid: 99999999 }))
    await g.manager.recoverBeforeStartup()
    expect(g.calls).toEqual([`transaction rollback ${g.id}:new-lock`])
    resume.mockClear()
    await fixture('preparing', process.pid, false, resume).manager.recoverBeforeStartup()
    expect(resume).not.toHaveBeenCalled()
  })
  it('does not roll back a cold launch after 30 seconds or spend its budget before launch', async () => {
    const f = fixture('prepared', process.pid)
    await f.manager.activatePrepared(f.id, false)
    vi.useFakeTimers()
    await vi.advanceTimersByTimeAsync(240_000)
    expect(f.calls.some(call => call.includes('rollback'))).toBe(false)
    f.manager.harnessStarting()
    await vi.advanceTimersByTimeAsync(150_000)
    f.manager.serverReady()
    await vi.advanceTimersByTimeAsync(45_000)
    expect(f.calls.some(call => call.includes('rollback'))).toBe(false)
    const settled = f.manager.waitForSettlement(f.id)
    f.manager.ready()
    await expect(settled).resolves.toBe(true)
    expect(f.calls.at(-1)).toBe('first-start-complete')
    expect(f.calls.findIndex(call => call.includes('transaction commit'))).toBeLessThan(f.calls.indexOf('first-start-complete'))
    await vi.advanceTimersByTimeAsync(240_000)
    expect(f.calls.some(call => call.includes('rollback'))).toBe(false)
  })

  it('rolls back a server that never becomes ready with an explicit timeout reason', async () => {
    const f = fixture('prepared', process.pid)
    await f.manager.activatePrepared(f.id, false)
    vi.useFakeTimers()
    f.manager.harnessStarting()
    await vi.advanceTimersByTimeAsync(179_000)
    f.manager.harnessStarting()
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(f.manager.waitForSettlement(f.id)).resolves.toBe(false)
    expect(f.onRollback).toHaveBeenCalledWith(new Error(
      'desktop: plugin activation timed out waiting 180 seconds for the Harness server',
    ))
  })

  it('bounds renderer readiness independently without extending it on repeated URL signals', async () => {
    const f = fixture('prepared', process.pid)
    await f.manager.activatePrepared(f.id, false)
    vi.useFakeTimers()
    f.manager.harnessStarting()
    f.manager.serverReady()
    await vi.advanceTimersByTimeAsync(59_000)
    f.manager.serverReady()
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(f.manager.waitForSettlement(f.id)).resolves.toBe(false)
    expect(f.onRollback).toHaveBeenCalledWith(new Error(
      'desktop: plugin activation timed out waiting 60 seconds for client and event-dispatch readiness',
    ))
  })

  it('activates the startup batch without launching a second Host and waits for normal readiness', async () => {
    const f = fixture('prepared', process.pid)
    await f.manager.activatePrepared(f.id, false)
    expect(f.calls).toEqual(['activation', 'stop', `transaction activate ${f.id}:${f.id}`])
    const settled = f.manager.waitForSettlement(f.id)
    f.manager.ready()
    await expect(settled).resolves.toBe(true)
    expect(f.calls).toContain(`transaction commit ${f.id}:${f.id}`)
  })
  it('reports rollback instead of install success to a managed mutation caller', async () => {
    const f = fixture('prepared', process.pid)
    await f.manager.activatePrepared(f.id, true)
    const settled = f.manager.waitForSettlement(f.id)
    f.manager.failed()
    await expect(settled).resolves.toBe(false)
  })
  it('rejects direct activation after rollback so first startup cannot continue with an incomplete Profile', async () => {
    const f = fixture('prepared', process.pid, true)
    await expect(f.manager.activatePrepared(f.id, false)).rejects.toThrow('activation interrupted')
    await expect(f.manager.waitForSettlement(f.id)).resolves.toBe(false)
    expect(f.calls).not.toContain('first-start-complete')
    expect(f.onRollback).toHaveBeenCalledOnce()
  })
  it('rejects an unrelated prepared ID without stopping Harness', async () => {
    const f = fixture('prepared', process.pid)
    await expect(f.manager.activatePrepared(randomUUID(), true)).rejects.toThrow('not owned')
    expect(f.calls).toEqual([])
  })
  it('keeps the restored Harness running after an activation error is successfully rolled back', async () => {
    const f = fixture('prepared', 99999999, true)
    f.manager.start()
    await expect.poll(() => f.calls).toContain('resume')
    expect(f.calls.slice(-4)).toEqual(['stop', `transaction rollback ${f.id}:${f.id}`, `snapshot end-restore-lease:${f.id}`, 'resume'])
    expect(f.onRollback).toHaveBeenCalledOnce()
    expect(f.onError).not.toHaveBeenCalled()
  })
  it('stops Harness before activation and commits only after explicit normal readiness', async () => {
    const f = fixture()
    f.manager.start()
    await expect.poll(() => f.calls).toContain('resume')
    expect(f.calls.slice(0, 4)).toEqual(['activation', 'stop', `transaction activate ${f.id}:${f.id}`, 'resume'])
    expect(f.calls.some(call => call.includes('commit'))).toBe(false)
    f.manager.ready()
    await expect.poll(() => f.calls).toContain(`snapshot end-restore-lease:${f.id}`)
    await expect.poll(() => f.calls.at(-1)).toBe('first-start-complete')
    expect(f.calls.at(-3)).toBe(`transaction commit ${f.id}:${f.id}`)
    expect(f.onError).not.toHaveBeenCalled()
  })

  it('rolls back a failed candidate before resuming and releasing its lease', async () => {
    const f = fixture()
    f.manager.start()
    await expect.poll(() => f.calls).toContain('resume')
    f.manager.failed()
    await expect.poll(() => f.calls.filter(call => call === 'resume').length).toBe(2)
    expect(f.calls.slice(-4)).toEqual(['stop', `transaction rollback ${f.id}:${f.id}`, `snapshot end-restore-lease:${f.id}`, 'resume'])
  })

  it('does not stop a still-running producer or reclaim a live worker at startup', async () => {
    const f = fixture('prepared', process.pid)
    await f.manager.recoverBeforeStartup()
    f.manager.start()
    await new Promise(resolve => setTimeout(resolve, 600))
    expect(f.calls).toEqual([])
    const g = fixture('activating')
    writeFileSync(g.lock, JSON.stringify({ pid: 99999999, workerPid: process.pid }))
    await g.manager.recoverBeforeStartup()
    expect(g.calls).toEqual([])
  })

  it('recovers an interrupted activation with a new lock before ordinary startup', async () => {
    const f = fixture('checking-startup')
    writeFileSync(f.lock, JSON.stringify({ pid: 99999999 }))
    await f.manager.recoverBeforeStartup()
    expect(f.calls).toEqual([`transaction rollback ${f.id}:new-lock`])
  })
})

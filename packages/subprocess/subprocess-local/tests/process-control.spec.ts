import { describe, expect, it, vi } from 'vitest'
import { DesktopProcessObserver } from '../src/process-control.ts'
import type { ProcessIdentity, ProcessInspector } from '../src/process-inspector.ts'

function bench() {
  let tree: ProcessIdentity[] = [{ pid: 101, started: 'a' }, { pid: 102, started: 'b' }]
  const alive = new Map(tree.map(identity => [identity.pid, identity.started]))
  const signals: number[] = []
  const inspector: ProcessInspector = {
    foregroundPgid: () => undefined,
    isStdinWaiting: () => false,
    snapshot: () => ({
      tree: pid => tree.filter(identity => pid === 101 || identity.pid === pid),
      session: () => [],
      alive: identity => alive.get(identity.pid) === identity.started,
    }),
    isAlive: identity => alive.get(identity.pid) === identity.started,
    signalGroup: () => { throw new Error('not an owned group') },
    signalProcess: (identity) => {
      if (alive.get(identity.pid) !== identity.started) return
      signals.push(identity.pid)
      alive.delete(identity.pid)
    },
  }
  return { observer: new DesktopProcessObserver(inspector), inspector, alive, signals, orphan: () => { tree = [] } }
}

describe('desktop legacy process observation', () => {
  it('retains an observed orphan and never signals a reused PID', async () => {
    const b = bench()
    b.observer.register(101, 'Harness')
    b.orphan()
    b.alive.set(101, 'different-process')
    await b.observer.stopAll(1, 1)
    expect(b.signals).toEqual([102])
    expect(b.alive.get(101)).toBe('different-process')
    expect(b.observer.list()[0]?.phase).toBe('stopped')
  })

  it('blocks registration during cleanup and permits a failed cleanup to be retried', async () => {
    const b = bench()
    const original = b.inspector.signalProcess.bind(b.inspector)
    b.inspector.signalProcess = vi.fn()
    b.observer.register(101, 'CLI')
    await expect(b.observer.stopAll(1, 1)).rejects.toThrow('remain alive')
    expect(() => b.observer.register(101, 'late')).toThrow('registration is closed')
    expect(b.observer.list()[0]?.phase).toBe('failed')
    b.inspector.signalProcess = original
    await expect(b.observer.stopAll(1, 1)).resolves.toBeUndefined()
  })

  it('fails closed when the process table cannot be inspected', async () => {
    const b = bench()
    b.observer.register(101, 'Harness')
    const original = b.inspector.snapshot.bind(b.inspector)
    b.inspector.snapshot = () => { throw new Error('permission denied') }
    await expect(b.observer.stopAll(1, 1)).rejects.toThrow('permission denied')
    expect(b.signals).toEqual([])
    b.inspector.snapshot = original
    await b.observer.stopAll(1, 1)
  })

  it('restores only exact live identities from a redacted recovery journal', async () => {
    const b = bench()
    expect(b.observer.restoreRecoveryJournal({
      schema: 'open-dsh-desktop/process-recovery/v2',
      records: [{
        id: 'old-generation', label: 'Harness',
        root: { pid: 101, started: 'a' },
        identities: [{ pid: 101, started: 'a' }, { pid: 102, started: 'reused' }],
      }],
    })).toBe(1)
    expect(b.observer.recoveryJournal()).toEqual({
      schema: 'open-dsh-desktop/process-recovery/v2',
      records: [{
        id: 'old-generation', label: 'Harness', root: { pid: 101, started: 'a' },
        identities: [{ pid: 101, started: 'a' }],
      }],
    })
    b.orphan()
    await b.observer.stopAll(1, 1)
    expect(b.signals).toEqual([101])
  })

  it('stops one observed task without closing admission for later work', async () => {
    const b = bench()
    const id = b.observer.register(101, 'first task')
    await b.observer.stopOne(id, 1, 1)
    b.alive.set(101, 'a')
    expect(() => b.observer.register(101, 'second task')).not.toThrow()
    await b.observer.stopAll(1, 1)
  })

  it('preserves an exact authorized identity while stopping its observed siblings', async () => {
    const b = bench()
    b.observer.register(101, 'Harness')
    b.observer.excludeIdentities([{ pid: 102, started: 'b' }])
    await b.observer.stopAll(1, 1)
    expect(b.signals).toEqual([101])
    expect(b.alive.get(102)).toBe('b')
  })

  it('rejects malformed recovery data before adopting any process', () => {
    const b = bench()
    expect(() => b.observer.restoreRecoveryJournal({
      schema: 'open-dsh-desktop/process-recovery/v2',
      records: [{
        id: 'x', label: 'Harness', root: { pid: 101, started: 'a' },
        identities: [{ pid: -1, started: 'a' }],
      }],
    })).toThrow('invalid recovered process identity')
    expect(b.observer.list()).toEqual([])
  })

  it('rejects a journal without an explicit recovery root', () => {
    const b = bench()
    expect(() => b.observer.restoreRecoveryJournal({
      schema: 'open-dsh-desktop/process-recovery/v2',
      records: [{ id: 'x', label: 'Harness', identities: [{ pid: 101, started: 'a' }] }],
    })).toThrow('invalid process recovery record')
  })
})

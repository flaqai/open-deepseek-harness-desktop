import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DesktopProfileMutation,
  DesktopProfileMutationRolledBackError,
  type DesktopProfileMutationOptions,
} from '../src/desktop-profile-mutation/index.ts'

interface Fixture {
  readonly home: string
  readonly environment: NodeJS.ProcessEnv
  readonly calls: string[]
  readonly mutations: DesktopProfileMutation
}

const fixtures: Fixture[] = []

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.mutations.dispose().catch(() => {})
    rmSync(fixture.home, { recursive: true, force: true })
  }
})

function createFixture(overrides: Partial<DesktopProfileMutationOptions> = {}): Fixture {
  const home = mkdtempSync(join(tmpdir(), 'desktop-profile-mutation-'))
  const transactionDirectory = join(home, 'plugin-transactions', 'web')
  const lockDirectory = join(home, 'plugin-snapshots', 'v1')
  mkdirSync(transactionDirectory, { recursive: true })
  mkdirSync(lockDirectory, { recursive: true })
  const pendingPath = join(transactionDirectory, 'pending.json')
  const lockPath = join(lockDirectory, '.profile-plugin-mutation.web.lock')
  const environment: NodeJS.ProcessEnv = { DSH_HOME: home }
  const calls: string[] = []
  const options: DesktopProfileMutationOptions = {
    home,
    ownerPid: process.pid,
    environment,
    commands: {
      run: async (_commandEnvironment, args, operation) => {
        calls.push(`${operation}:${args.join(' ')}`)
        if (args[0] === 'transaction' && args[1] === 'prepare') {
          const id = args[2]
          if (id === undefined) throw new Error('missing transaction id')
          writeFileSync(pendingPath, JSON.stringify({ id, phase: 'prepared', producerPid: process.pid }))
          writeFileSync(lockPath, JSON.stringify({ pid: process.pid, token: id }))
          return `dsh:plugin-snapshot-json ${JSON.stringify({ id })}\n`
        }
        if (args[0] === 'transaction' && (args[1] === 'commit' || args[1] === 'rollback')) {
          rmSync(pendingPath, { force: true })
        }
        if (args[0] === 'snapshot' && args[1] === 'end-restore-lease') rmSync(lockPath, { force: true })
        return 'dsh:plugin-snapshot-json {}\n'
      },
    },
    harness: {
      available: () => true,
      stop: async () => { calls.push('harness:stop') },
      resume: () => { calls.push('harness:resume') },
      suspendForRecovery: async () => { calls.push('harness:suspend-recovery') },
    },
    timeouts: { preparationMs: 300_000, profileCheckMs: 15_000, snapshotMs: 15_000, installMs: 600_000 },
    isFirstStart: () => false,
    canResumeFirstStart: async () => false,
    onFirstStartCommit: async () => { calls.push('first-start:commit') },
    runSnapshot: async (args) => {
      calls.push(`snapshot:${args.join(' ')}`)
      return { snapshotId: '11111111-1111-4111-8111-111111111111' }
    },
    cancelBootableSnapshot: () => { calls.push('bootable:cancel') },
    restartBootableSnapshotWindow: (reason) => { calls.push(`bootable:restart:${reason}`) },
    onCandidatePreparation: () => { calls.push('candidate:preparing') },
    onActivation: () => { calls.push('candidate:activating') },
    log: (message) => { calls.push(`log:${message}`) },
    onRollback: (error) => { calls.push(`rollback:${error instanceof Error ? error.message : String(error)}`) },
    onRecoveryRequired: (error) => { calls.push(`recovery-required:${error instanceof Error ? error.message : String(error)}`) },
    ...overrides,
  }
  const fixture = { home, environment, calls, mutations: new DesktopProfileMutation(options) }
  fixtures.push(fixture)
  return fixture
}

describe('Desktop Profile mutation interface', () => {
  it('hides the candidate and resolves a managed mutation only after ordinary readiness commits it', async () => {
    const fixture = createFixture()
    const result = fixture.mutations.applyManaged({
      operation: 'managed-test',
      expectedPackages: ['dsh-test'],
      run: async (context) => {
        expect(context.home).not.toBe(fixture.home)
        await context.write({ kind: 'add', packageSpecs: ['dsh-test@1.0.0'], exact: true,
          operation: 'managed-add', timeoutMs: 60_000 })
        return 'installed'
      },
    })

    await vi.waitFor(() => { expect(fixture.calls).toContain('harness:resume') })
    let settled = false
    void result.finally(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    fixture.mutations.observeHarness({ type: 'starting' })
    fixture.mutations.observeHarness({ type: 'server-ready' })
    fixture.mutations.observeHarness({ type: 'normal-ready' })

    await expect(result).resolves.toBe('installed')
    expect(fixture.environment.DSH_HOME).toBe(fixture.home)
    expect(fixture.calls).toEqual(expect.arrayContaining([
      'managed-add:add --save-exact dsh-test@1.0.0',
      'profile-transaction:snapshot end-restore-lease',
      'bootable:restart:managed-test settled',
    ]))
    expect(fixture.calls.some(call => call.startsWith('profile-transaction:transaction commit '))).toBe(true)
  })

  it('keeps one startup candidate while an isolated step restores its safety point', async () => {
    const fixture = createFixture()
    const failure = new Error('plugin write failed')

    await expect(fixture.mutations.applyAtStartup({
      operation: 'bundled-plugin:dsh-test',
      run: async () => { throw failure },
    })).rejects.toBe(failure)

    expect(fixture.mutations.hasCandidate).toBe(true)
    expect(fixture.calls).toEqual(expect.arrayContaining([
      'snapshot:create-safety',
      'snapshot:restore-files 11111111-1111-4111-8111-111111111111',
      'bundled-plugin:dsh-test:rollback:install --offline --frozen-lockfile',
      'snapshot:settle-safety 11111111-1111-4111-8111-111111111111',
    ]))
    await fixture.mutations.abortStartup()
    expect(fixture.mutations.hasCandidate).toBe(false)
  })

  it('keeps safety snapshots for first-start writes but not candidate preparation itself', async () => {
    const fixture = createFixture({ isFirstStart: () => true })

    await fixture.mutations.prepareStartup()
    expect(fixture.calls).not.toContain('snapshot:create-safety')

    await fixture.mutations.applyAtStartup({
      operation: 'first-start-write',
      run: async (context) => {
        await context.write({ kind: 'doctor-repair', operation: 'first-start-repair', timeoutMs: 60_000 })
      },
    })

    expect(fixture.calls).toEqual(expect.arrayContaining([
      'snapshot:create-safety',
      'first-start-repair:doctor --repair',
      'snapshot:settle-safety 11111111-1111-4111-8111-111111111111',
    ]))
  })

  it('reports activation failure as a completed rollback instead of mutation success', async () => {
    const fixture = createFixture()
    const result = fixture.mutations.applyManaged({
      operation: 'managed-failure',
      run: async () => 'write-complete',
    })
    await vi.waitFor(() => { expect(fixture.calls).toContain('harness:resume') })

    fixture.mutations.observeHarness({ type: 'starting' })
    fixture.mutations.observeHarness({ type: 'failed', error: new Error('startup failed') })

    await expect(result).rejects.toBeInstanceOf(DesktopProfileMutationRolledBackError)
    expect(fixture.calls).toEqual(expect.arrayContaining([
      'harness:stop',
      'harness:resume',
      'rollback:startup failed',
    ]))
  })

  it('uses the active Profile directly when recovery runs without a resident Harness', async () => {
    const fixture = createFixture({
      harness: {
        available: () => false,
        stop: async () => {},
        resume: () => {},
        suspendForRecovery: async () => { fixture.calls.push('harness:suspend-recovery') },
      },
    })

    await fixture.mutations.stageRecovery({
      operation: 'recovery-remove',
      run: async (context) => {
        expect(context.home).toBe(fixture.home)
        await context.write({ kind: 'remove', packageName: 'dsh-test', operation: 'recovery-remove', timeoutMs: 60_000 })
      },
    })

    expect(fixture.mutations.hasCandidate).toBe(false)
    expect(fixture.calls).toContain('recovery-remove:remove dsh-test')
  })
})

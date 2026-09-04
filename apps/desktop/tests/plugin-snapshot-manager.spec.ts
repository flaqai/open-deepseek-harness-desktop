import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  PluginSnapshotManager,
  type PluginSnapshotRestoreSnapshot,
  type PluginSnapshotSummary,
} from '../src/plugin-snapshot-manager.ts'

const TARGET_ID = '11111111-1111-4111-8111-111111111111'
const SAFETY_ID = '22222222-2222-4222-8222-222222222222'

function target(): PluginSnapshotSummary {
  return {
    snapshotId: TARGET_ID,
    kind: 'bootable',
    trigger: 'successful-startup',
    createdAt: '2026-09-01T00:00:00.000Z',
    packages: [],
    bundles: [],
    offlineState: 'best-effort',
    difference: { added: [], removed: [], changed: [], versionChanges: [] },
  }
}

function fixture(options: { offlineFails?: boolean; journalPath?: string } = {}) {
  const events: PluginSnapshotRestoreSnapshot[] = []
  const restoreFiles = vi.fn(async () => {})
  const installProfile = vi.fn(async (offline: boolean) => {
    if (offline && options.offlineFails === true && installProfile.mock.calls.length === 1) {
      throw new Error('ERR_PNPM_NO_OFFLINE_TARBALL')
    }
  })
  const settleSafety = vi.fn(async () => {})
  const beginMutationLease = vi.fn(async () => {})
  const endMutationLease = vi.fn(async () => {})
  const resumeHarness = vi.fn()
  const manager = new PluginSnapshotManager({
    listSnapshots: async () => [target()],
    createSnapshot: async kind => ({ snapshotId: kind === 'safety' ? SAFETY_ID : TARGET_ID, kind }),
    removeSnapshot: async () => {},
    restoreFiles,
    settleSafety,
    beginMutationLease,
    endMutationLease,
    suspendHarness: async () => {},
    resumeHarness,
    installProfile,
    doctorHealthy: async () => true,
    onStatus: (event) => { events.push(event) },
    verificationTimeoutMs: 100_000,
    ...(options.journalPath === undefined ? {} : { journalPath: options.journalPath }),
  })
  return {
    manager, events, restoreFiles, installProfile, settleSafety,
    beginMutationLease, endMutationLease, resumeHarness,
  }
}

describe('PluginSnapshotManager', () => {
  it('commits a restore only after both desktop readiness markers', async () => {
    const f = fixture()
    f.manager.startRestore(TARGET_ID, false)
    await vi.waitFor(() => {
      expect(f.events.at(-1)?.phase).toBe('verifying-startup')
    })
    await expect(f.manager.reportReadiness('client')).resolves.toBe(false)
    expect(f.events.at(-1)?.phase).toBe('verifying-startup')
    await expect(f.manager.reportReadiness('event-dispatch')).resolves.toBe(true)
    expect(f.events.at(-1)?.phase).toBe('succeeded')
    expect(f.restoreFiles).toHaveBeenCalledWith(TARGET_ID)
    expect(f.settleSafety).toHaveBeenCalledWith(SAFETY_ID)
    expect(f.beginMutationLease).toHaveBeenCalledOnce()
    expect(f.endMutationLease).toHaveBeenCalledOnce()
  })

  it('rolls back before requesting explicit network permission', async () => {
    const f = fixture({ offlineFails: true })
    f.manager.startRestore(TARGET_ID, false)
    await vi.waitFor(() => {
      expect(f.events.at(-1)?.phase).toBe('needs-network')
    })
    expect(f.restoreFiles.mock.calls.map(call => call[0])).toEqual([TARGET_ID, SAFETY_ID])
    expect(f.installProfile).toHaveBeenCalledTimes(2)
    expect(f.endMutationLease).toHaveBeenCalledOnce()
    expect(f.resumeHarness).toHaveBeenCalledOnce()
  })

  it('undoes a snapshot that makes Harness fail during startup', async () => {
    const f = fixture()
    f.manager.startRestore(TARGET_ID, false)
    await vi.waitFor(() => {
      expect(f.events.at(-1)?.phase).toBe('verifying-startup')
    })
    await expect(f.manager.handleHarnessFailure('code 1')).resolves.toBe(true)
    expect(f.events.at(-1)?.phase).toBe('rolled-back')
    expect(f.restoreFiles.mock.calls.map(call => call[0])).toEqual([TARGET_ID, SAFETY_ID])
  })

  it('recovers an interrupted restore journal before ordinary startup', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-snapshot-journal-'))
    const journalPath = join(directory, 'restore.json')
    writeFileSync(journalPath, JSON.stringify({
      schema: 'dsh/profile-plugin-snapshot-restore/v1',
      operation: {
        operationId: '33333333-3333-4333-8333-333333333333',
        snapshotId: TARGET_ID,
        phase: 'checking',
      },
      safetySnapshotId: SAFETY_ID,
    }))
    try {
      const f = fixture({ journalPath })
      await f.manager.recoverPending()
      expect(f.events.at(-1)?.phase).toBe('rolled-back')
      expect(f.restoreFiles).toHaveBeenCalledWith(SAFETY_ID)
      expect(f.settleSafety).toHaveBeenCalledWith(SAFETY_ID)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects an interrupted journal from another schema', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-snapshot-journal-schema-'))
    const journalPath = join(directory, 'restore.json')
    writeFileSync(journalPath, JSON.stringify({
      schema: 'dsh/profile-plugin-snapshot-restore/v999',
      operation: {
        operationId: '33333333-3333-4333-8333-333333333333',
        snapshotId: TARGET_ID,
        phase: 'checking',
      },
      safetySnapshotId: SAFETY_ID,
    }))
    try {
      const f = fixture({ journalPath })
      await expect(f.manager.recoverPending()).rejects.toThrow('journal schema')
      expect(f.restoreFiles).not.toHaveBeenCalled()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('retains one immutable history record when a restore settles', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-snapshot-history-'))
    try {
      const f = fixture({ journalPath: join(directory, 'restore.json') })
      f.manager.startRestore(TARGET_ID, false)
      await vi.waitFor(() => { expect(f.events.at(-1)?.phase).toBe('verifying-startup') })
      await f.manager.reportReadiness('client')
      await f.manager.reportReadiness('event-dispatch')
      expect(f.events.at(-1)?.phase).toBe('succeeded')
      expect(readdirSync(join(directory, 'restore-history'))).toHaveLength(1)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

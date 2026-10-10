import { randomUUID } from 'node:crypto'
import * as filesystem from 'node:fs'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
vi.mock('node:fs', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs')>(),
}))
import {
  createProfilePluginSnapshot,
  acquireProfilePluginMutationLock,
  assertProfilePluginMutationLease,
  beginProfilePluginMutationLease,
  endProfilePluginMutationLease,
  finalizeProfilePluginSnapshot,
  listProfilePluginSnapshots,
  removeProfilePluginSnapshot,
  restoreProfilePluginSnapshotFiles,
  settleProfilePluginSafetySnapshot,
} from '../src/profile-plugin-snapshot.ts'

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'dsh-plugin-snapshot-'))
  const profileDir = join(home, 'profiles', 'web')
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'fixture',
    dependencies: { alpha: '1.0.0' },
    dsh: { profile: { bundles: ['dsh-base', 'alpha'] } },
  }))
  writeFileSync(join(profileDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
  writeFileSync(join(profileDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\nallowBuilds:\n  alpha: false\n')
  return { home, profileDir }
}

describe('Profile plugin snapshots', () => {
  it('restores the home configuration byte for byte without changing credentials', () => {
    const { home } = fixture()
    try {
      const patch = join(home, 'cordis.patch.yml')
      const original = '# keep comments\nplugins: []\n'
      writeFileSync(patch, original)
      writeFileSync(join(home, 'credentials.json'), '{"keep":"private"}')
      const snapshot = createProfilePluginSnapshot({ home, profile: 'web', kind: 'manual', trigger: 'manual' })
      expect(snapshot.files.some(file => file.relativePath === 'cordis.patch.yml' && file.existed)).toBe(true)
      writeFileSync(patch, 'plugins: []\n')
      restoreProfilePluginSnapshotFiles({ home, profile: 'web', snapshotId: snapshot.snapshotId })
      expect(readFileSync(patch, 'utf8')).toBe(original)
      expect(readFileSync(join(home, 'credentials.json'), 'utf8')).toBe('{"keep":"private"}')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('publishes only complete owners and refuses a concurrent contender', () => {
    const { home } = fixture()
    const originalLink = filesystem.linkSync
    let observed = false
    const publish = vi.spyOn(filesystem, 'linkSync').mockImplementation((source, destination) => {
      originalLink(source, destination)
      observed = true
      expect(JSON.parse(readFileSync(destination, 'utf8'))).toMatchObject({ pid: process.pid })
      expect(() => acquireProfilePluginMutationLock({ home, profile: 'web', waitMs: 0 }))
        .toThrow('another process is changing Profile web')
    })
    try {
      const release = acquireProfilePluginMutationLock({ home, profile: 'web', waitMs: 0 })
      expect(observed).toBe(true)
      release()
      expect(readdirSync(join(home, 'plugin-snapshots', 'v1'))).toEqual([])
    } finally {
      publish.mockRestore()
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('retains the current owner when lease publication fails', () => {
    const { home } = fixture()
    const release = acquireProfilePluginMutationLock({ home, profile: 'web', waitMs: 0 })
    const lock = join(home, 'plugin-snapshots', 'v1', '.profile-plugin-mutation.web.lock')
    const previous = readFileSync(lock, 'utf8')
    const rename = vi.spyOn(filesystem, 'renameSync').mockImplementation(() => { throw new Error('disk failure') })
    try {
      expect(() => { beginProfilePluginMutationLease({ home, profile: 'web', ownerPid: process.pid, token: randomUUID() }) })
        .toThrow('disk failure')
      expect(readFileSync(lock, 'utf8')).toBe(previous)
      expect(readdirSync(join(home, 'plugin-snapshots', 'v1'))).toEqual(['.profile-plugin-mutation.web.lock'])
    } finally {
      rename.mockRestore()
      release()
      rmSync(home, { recursive: true, force: true })
    }
  })

  it.each(['', '{', 'null', '{"pid":0}', '{"pid":"123"}',
    '{"pid":2147483647,"token":42}', '{"pid":2147483647,"operationKind":false}',
  ])('preserves an uncertain owner: %j', (source) => {
    const { home } = fixture()
    const root = join(home, 'plugin-snapshots', 'v1')
    const lock = join(root, '.profile-plugin-mutation.web.lock')
    try {
      mkdirSync(root, { recursive: true })
      writeFileSync(lock, source)
      expect(() => acquireProfilePluginMutationLock({ home, profile: 'web', waitMs: 0 }))
        .toThrow('lock is unreadable or corrupt')
      expect(() => { assertProfilePluginMutationLease({ home, profile: 'web', token: randomUUID() }) })
        .toThrow('lock is unreadable or corrupt')
      expect(readFileSync(lock, 'utf8')).toBe(source)
      expect(readdirSync(root)).toEqual(['.profile-plugin-mutation.web.lock'])
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('reports a missing lease without exposing a JSON or filesystem exception', () => {
    const { home } = fixture()
    try {
      mkdirSync(join(home, 'plugin-snapshots', 'v1'), { recursive: true })
      expect(() => { assertProfilePluginMutationLease({ home, profile: 'web', token: randomUUID() }) })
        .toThrow('no active lock')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
  it.runIf(process.platform !== 'win32')('refuses a symlinked snapshot root', () => {
    const { home } = fixture()
    const outside = mkdtempSync(join(tmpdir(), 'dsh-plugin-snapshot-outside-'))
    try {
      mkdirSync(join(home, 'plugin-snapshots'), { recursive: true })
      symlinkSync(outside, join(home, 'plugin-snapshots', 'v1'), 'dir')
      expect(() => createProfilePluginSnapshot({
        home, profile: 'web', kind: 'manual', trigger: 'manual',
      })).toThrow('snapshot root is unsafe')
    } finally {
      rmSync(home, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it.runIf(process.platform !== 'win32')('refuses managed Profile files reached through an escaping symlink', () => {
    const { home, profileDir } = fixture()
    const outside = mkdtempSync(join(tmpdir(), 'dsh-plugin-profile-outside-'))
    try {
      writeFileSync(join(outside, 'package.json'), '{"name":"outside"}\n')
      writeFileSync(join(outside, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
      writeFileSync(join(outside, 'pnpm-workspace.yaml'), 'packages: []\n')
      rmSync(profileDir, { recursive: true, force: true })
      symlinkSync(outside, profileDir, 'dir')
      expect(() => createProfilePluginSnapshot({
        home, profile: 'web', kind: 'manual', trigger: 'manual',
      })).toThrow('physically escapes its root')
    } finally {
      rmSync(home, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it.runIf(process.platform !== 'win32')('refuses a snapshot payload redirected outside its directory', () => {
    const { home } = fixture()
    const outside = mkdtempSync(join(tmpdir(), 'dsh-plugin-payload-outside-'))
    try {
      const record = createProfilePluginSnapshot({
        home, profile: 'web', kind: 'manual', trigger: 'manual',
      })
      const payload = join(
        home, 'plugin-snapshots', 'v1', record.snapshotId,
        'files', 'profiles', 'web', 'package.json',
      )
      const outsidePayload = join(outside, 'package.json')
      writeFileSync(outsidePayload, '{"name":"forged"}\n')
      rmSync(payload)
      symlinkSync(outsidePayload, payload, 'file')

      expect(() => restoreProfilePluginSnapshotFiles({
        home, profile: 'web', snapshotId: record.snapshotId,
      })).toThrow('physically escapes its root')
    } finally {
      rmSync(home, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('captures, compares, and restores only managed plugin-stack files', () => {
    const { home, profileDir } = fixture()
    try {
      const compatibilityOverrides = join(home, 'quarantine', 'host-version-overrides.json')
      mkdirSync(join(home, 'quarantine'), { recursive: true })
      writeFileSync(compatibilityOverrides, '{"schema":1,"approvals":[{"packageName":"alpha"}]}\n')
      const record = createProfilePluginSnapshot({
        home,
        profile: 'web',
        kind: 'manual',
        trigger: 'manual',
        label: 'Known good',
      })
      writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
        name: 'fixture',
        dependencies: { alpha: '2.0.0', beta: '1.0.0' },
        dsh: { profile: { bundles: ['dsh-base', 'alpha', 'beta'] } },
      }))
      writeFileSync(compatibilityOverrides, '{"schema":1,"approvals":[]}\n')
      expect(listProfilePluginSnapshots({ home, profile: 'web' })[0]?.difference).toEqual({
        added: ['beta'],
        removed: [],
        changed: ['alpha'],
        versionChanges: [{
          name: 'alpha',
          currentVersion: '2.0.0',
          snapshotVersion: '1.0.0',
          direction: 'downgrade',
        }],
      })
      restoreProfilePluginSnapshotFiles({ home, profile: 'web', snapshotId: record.snapshotId })
      expect(JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))).toMatchObject({
        dependencies: { alpha: '1.0.0' },
        dsh: { profile: { bundles: ['dsh-base', 'alpha'] } },
      })
      expect(readFileSync(join(profileDir, 'pnpm-workspace.yaml'), 'utf8')).toContain('alpha: false')
      expect(readFileSync(compatibilityOverrides, 'utf8'))
        .toBe('{"schema":1,"approvals":[{"packageName":"alpha"}]}\n')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('uses schema-4 installedVersion when restoring a snapshot version hold', () => {
    const { home } = fixture()
    const state = join(home, 'bundled-plugins')
    try {
      mkdirSync(state, { recursive: true })
      writeFileSync(join(state, 'alpha.seeded.json'), JSON.stringify({
        schema: 4,
        seedId: 'alpha',
        packageName: 'alpha',
        handledBundledVersion: '2.0.0',
        installedVersion: '1.0.0',
        state: 'installed',
        ownership: 'desktop-registry',
      }))
      const record = createProfilePluginSnapshot({
        home, profile: 'web', kind: 'manual', trigger: 'manual',
      })
      writeFileSync(join(state, 'alpha.seeded.json'), JSON.stringify({
        schema: 4,
        handledBundledVersion: '2.0.0',
        installedVersion: '2.0.0',
        state: 'installed',
        ownership: 'desktop-archive',
      }))

      restoreProfilePluginSnapshotFiles({ home, profile: 'web', snapshotId: record.snapshotId })

      expect(JSON.parse(readFileSync(join(state, 'snapshot-version-hold.json'), 'utf8')))
        .toMatchObject({ schema: 1, versions: [{ seedId: 'alpha', version: '1.0.0' }] })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('drops unchanged automatic snapshots and retains changed ones', () => {
    const { home, profileDir } = fixture()
    try {
      const unchanged = createProfilePluginSnapshot({
        home, profile: 'web', kind: 'automatic', trigger: 'plugin-update',
      })
      expect(finalizeProfilePluginSnapshot({
        home, profile: 'web', snapshotId: unchanged.snapshotId,
      })).toBeUndefined()

      const changed = createProfilePluginSnapshot({
        home, profile: 'web', kind: 'automatic', trigger: 'plugin-remove',
      })
      writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
        name: 'fixture', dependencies: {}, dsh: { profile: { bundles: ['dsh-base'] } },
      }))
      expect(finalizeProfilePluginSnapshot({
        home, profile: 'web', snapshotId: changed.snapshotId,
      })?.snapshotId).toBe(changed.snapshotId)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('reuses an identical retained snapshot before writing another automatic payload', () => {
    const { home } = fixture()
    try {
      const retained = createProfilePluginSnapshot({
        home, profile: 'web', kind: 'automatic', trigger: 'plugin-update',
      })
      const duplicate = createProfilePluginSnapshot({
        home, profile: 'web', kind: 'automatic', trigger: 'diagnostic-repair',
      })

      expect(duplicate.snapshotId).toBe(retained.snapshotId)
      expect(duplicate.deduplicated).toBe(true)
      expect(listProfilePluginSnapshots({ home, profile: 'web' })).toHaveLength(1)
      expect(finalizeProfilePluginSnapshot({
        home,
        profile: 'web',
        snapshotId: duplicate.snapshotId,
        preserveIfUnchanged: duplicate.deduplicated === true,
      })?.snapshotId).toBe(retained.snapshotId)
      expect(listProfilePluginSnapshots({ home, profile: 'web' })).toHaveLength(1)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('reuses an identical bootable point and only advances its verification time', () => {
    const { home } = fixture()
    try {
      const retained = createProfilePluginSnapshot({
        home, profile: 'web', kind: 'bootable', trigger: 'successful-startup',
        now: () => new Date('2026-09-04T00:00:00.000Z'),
      })
      const duplicate = createProfilePluginSnapshot({
        home, profile: 'web', kind: 'bootable', trigger: 'successful-startup',
        now: () => new Date('2026-09-05T00:00:00.000Z'),
      })

      expect(duplicate).toMatchObject({
        snapshotId: retained.snapshotId,
        deduplicated: true,
        createdAt: '2026-09-04T00:00:00.000Z',
        lastVerifiedAt: '2026-09-05T00:00:00.000Z',
      })
      expect(listProfilePluginSnapshots({ home, profile: 'web' })).toEqual([
        expect.objectContaining({
          snapshotId: retained.snapshotId,
          lastVerifiedAt: '2026-09-05T00:00:00.000Z',
        }),
      ])
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('retains the previous successful startup as an automatic rollback point after a changed startup', () => {
    const { home, profileDir } = fixture()
    try {
      const old = createProfilePluginSnapshot({ home, profile: 'web', kind: 'bootable', trigger: 'successful-startup' })
      const automatic = createProfilePluginSnapshot({ home, profile: 'web', kind: 'automatic', trigger: 'plugin-update' })
      expect(automatic.snapshotId).toBe(old.snapshotId)
      writeFileSync(join(profileDir, 'package.json'), '{"dependencies":{"alpha":"2.0.0"}}')
      const current = createProfilePluginSnapshot({ home, profile: 'web', kind: 'bootable', trigger: 'successful-startup' })
      expect(listProfilePluginSnapshots({ home, profile: 'web' })).toEqual(expect.arrayContaining([
        expect.objectContaining({ snapshotId: old.snapshotId, kind: 'automatic' }),
        expect.objectContaining({ snapshotId: current.snapshotId, kind: 'bootable' }),
      ]))
      expect(readFileSync(join(home, 'plugin-snapshots', 'v1', old.snapshotId, 'files', 'profiles', 'web', 'package.json'), 'utf8')).toContain('1.0.0')
    } finally { rmSync(home, { recursive: true, force: true }) }
  })

  it('does not deduplicate against an identical snapshot with a damaged payload', () => {
    const { home } = fixture()
    try {
      const damaged = createProfilePluginSnapshot({
        home, profile: 'web', kind: 'automatic', trigger: 'plugin-update',
      })
      writeFileSync(join(
        home,
        'plugin-snapshots',
        'v1',
        damaged.snapshotId,
        'files',
        'profiles',
        'web',
        'package.json',
      ), 'damaged')

      const replacement = createProfilePluginSnapshot({
        home, profile: 'web', kind: 'automatic', trigger: 'diagnostic-repair',
      })
      expect(replacement.snapshotId).not.toBe(damaged.snapshotId)
      expect(replacement.deduplicated).toBeUndefined()
      expect(listProfilePluginSnapshots({ home, profile: 'web' })).toEqual([
        expect.objectContaining({ snapshotId: replacement.snapshotId }),
      ])
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('protects restore safety points until the journal settles', () => {
    const { home } = fixture()
    try {
      const safety = createProfilePluginSnapshot({
        home, profile: 'web', kind: 'safety', trigger: 'restore-safety',
      })
      expect(() => removeProfilePluginSnapshot({
        home, profile: 'web', snapshotId: safety.snapshotId,
      })).toThrow('cannot be removed')
      expect(settleProfilePluginSafetySnapshot({
        home, profile: 'web', snapshotId: safety.snapshotId,
      })).toBe(true)
      expect(listProfilePluginSnapshots({ home, profile: 'web' })).toEqual([])
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('protects the last successful startup point from manual deletion', () => {
    const { home } = fixture()
    try {
      const bootable = createProfilePluginSnapshot({
        home, profile: 'web', kind: 'bootable', trigger: 'successful-startup',
      })
      expect(() => removeProfilePluginSnapshot({
        home, profile: 'web', snapshotId: bootable.snapshotId,
      })).toThrow('last successful startup')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('verifies every payload before changing active files', () => {
    const { home, profileDir } = fixture()
    try {
      const record = createProfilePluginSnapshot({
        home, profile: 'web', kind: 'manual', trigger: 'manual',
      })
      const snapshotPackage = join(
        home, 'plugin-snapshots', 'v1', record.snapshotId, 'files', 'profiles', 'web', 'package.json',
      )
      writeFileSync(snapshotPackage, 'tampered')
      const active = readFileSync(join(profileDir, 'package.json'), 'utf8')
      expect(() => restoreProfilePluginSnapshotFiles({
        home, profile: 'web', snapshotId: record.snapshotId,
      })).toThrow('checksum mismatch')
      expect(readFileSync(join(profileDir, 'package.json'), 'utf8')).toBe(active)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('holds a startup batch lock across short-lived plugin commands', () => {
    const { home } = fixture()
    const token = randomUUID()
    try {
      beginProfilePluginMutationLease({ home, profile: 'web', ownerPid: process.pid, token })
      expect(() => acquireProfilePluginMutationLock({ home, profile: 'web', waitMs: 0 }))
        .toThrow('another process is changing Profile web')
      endProfilePluginMutationLease({ home, profile: 'web', token })
      const release = acquireProfilePluginMutationLock({ home, profile: 'web', waitMs: 0 })
      release()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('cleans a dead legacy PID-only lock and replaces it with a token-owned v2 lock', () => {
    const { home } = fixture()
    const lock = join(home, 'plugin-snapshots', 'v1', '.profile-plugin-mutation.web.lock')
    try {
      mkdirSync(join(home, 'plugin-snapshots', 'v1'), { recursive: true })
      writeFileSync(lock, JSON.stringify({ pid: 2_147_483_647 }))
      const release = acquireProfilePluginMutationLock({
        home, profile: 'web', waitMs: 0, operationKind: 'legacy-upgrade-test',
      })
      expect(JSON.parse(readFileSync(lock, 'utf8'))).toMatchObject({
        schema: 'dsh/profile-plugin-mutation-lock/v2',
        pid: process.pid,
        operationKind: 'legacy-upgrade-test',
      })
      release()
      expect(existsSync(lock)).toBe(false)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('does not remove a lock whose owner token changed before release', () => {
    const { home } = fixture()
    try {
      const release = acquireProfilePluginMutationLock({
        home, profile: 'web', waitMs: 0, operationKind: 'test-operation',
      })
      const lock = join(home, 'plugin-snapshots', 'v1', '.profile-plugin-mutation.web.lock')
      const owner = JSON.parse(readFileSync(lock, 'utf8')) as Record<string, unknown>
      expect(owner).toMatchObject({
        schema: 'dsh/profile-plugin-mutation-lock/v2',
        pid: process.pid,
        operationKind: 'test-operation',
      })
      writeFileSync(lock, JSON.stringify({ ...owner, token: randomUUID() }))
      release()
      expect(existsSync(lock)).toBe(true)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('leaves a replaced malformed lock in place without failing cleanup', () => {
    const { home } = fixture()
    try {
      const release = acquireProfilePluginMutationLock({ home, profile: 'web', waitMs: 0 })
      const lock = join(home, 'plugin-snapshots', 'v1', '.profile-plugin-mutation.web.lock')
      writeFileSync(lock, '{')
      expect(release).not.toThrow()
      expect(readFileSync(lock, 'utf8')).toBe('{')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('promotes an acquired CLI lock to a desktop-owned lease without an unlocked gap', () => {
    const { home } = fixture()
    const token = randomUUID()
    try {
      acquireProfilePluginMutationLock({ home, profile: 'web', waitMs: 0 })
      beginProfilePluginMutationLease({ home, profile: 'web', ownerPid: process.pid, token })
      expect(() => acquireProfilePluginMutationLock({ home, profile: 'web', waitMs: 0 }))
        .toThrow('another process is changing Profile web')
      endProfilePluginMutationLease({ home, profile: 'web', token })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

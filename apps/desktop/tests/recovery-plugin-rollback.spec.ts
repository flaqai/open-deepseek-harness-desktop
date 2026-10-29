import { describe, expect, it } from 'vitest'
import { recoveryPluginRollbackTarget } from '../src/recovery-plugins.ts'
import type { PluginSnapshotSummary } from '../src/plugin-snapshot-manager.ts'

function snapshot(version: string, date: string, kind: PluginSnapshotSummary['kind'] = 'automatic', source = 'registry'): PluginSnapshotSummary {
  return { snapshotId: date, kind, trigger: 'plugin-update', createdAt: date,
    packages: [{ name: 'example', version, source }], bundles: [], offlineState: 'best-effort',
    difference: { added: [], removed: [], changed: [], versionChanges: [] } }
}

describe('recovery plugin rollback target', () => {
  const plugin = { packageName: 'example', version: '2.0.0', source: 'registry', status: 'normal' } as const
  it('chooses the most recent retained lower version, not the largest registry version', () => {
    const snapshots = [snapshot('1.9.0', '2026-10-01'), snapshot('1.5.0', '2026-10-02'),
      snapshot('2.0.0', '2026-10-03'), snapshot('3.0.0', '2026-10-04'), snapshot('1.8.0', '2026-10-05', 'safety')]
    expect(recoveryPluginRollbackTarget(plugin, snapshots)).toEqual({ version: '1.5.0', packageSpec: 'example@1.5.0' })
  })
  it('does not guess registry identities for local, git or absent history', () => {
    expect(recoveryPluginRollbackTarget(plugin, [])).toBeUndefined()
    expect(recoveryPluginRollbackTarget(plugin, [snapshot('1.0.0', '2026-10-01', 'manual', 'local')])).toBeUndefined()
    expect(recoveryPluginRollbackTarget(plugin, [snapshot('1.0.0', '2026-10-01', 'manual', 'git')])).toBeUndefined()
    expect(recoveryPluginRollbackTarget({ packageName: 'example', source: 'registry', status: 'normal' }, [snapshot('1.0.0', '2026-10-01')])).toBeUndefined()
  })
  it('supports prerelease versions with an exact specifier', () => {
    const history = snapshot('2.0.0-alpha.1', '2026-10-01')
    expect(recoveryPluginRollbackTarget(plugin, [history])).toEqual({ version: '2.0.0-alpha.1', packageSpec: 'example@2.0.0-alpha.1' })
  })
})

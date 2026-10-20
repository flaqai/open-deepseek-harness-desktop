import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('desktop startup plugin snapshot timing', () => {
  it('configures a newly installed bridge inside the upgrade candidate, never the active Profile', () => {
    const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
    const upgrade = source.slice(source.indexOf('} else if (presetUpgradeNeeded) {'), source.indexOf('if (legacySchedulePending) {', source.indexOf('} else if (presetUpgradeNeeded) {')))
    expect(upgrade).toContain('configureNewAgentsAnywhere(dshHome, desktopMutations.mutationHome)')
    expect(upgrade).not.toContain('configureNewAgentsAnywhere(dshHome, dshHome)')
  })

  it('provisions presets once for a new or upgraded desktop version, not on every launch', () => {
    const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
    expect(source).toContain('} else if (firstStartPending) {')
    expect(source).toContain('await seedBundledPluginsBatch(')
    expect(source.includes('} else if (presetUpgradeNeeded) {')).toBe(true)
    expect(source.includes('await presetVersionGate.markAttempted(app.getVersion())')).toBe(true)
    expect(source.includes('await bundledPluginInstaller.seedStartup(')).toBe(true)
    expect(source.includes('await presetVersionGate.shouldAttempt(app.getVersion())')).toBe(true)
  })

  it('does not create a snapshot before seeding and retains one only after readiness', () => {
    const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
    const seed = source.indexOf('await bundledPluginInstaller.seedStartup(')
    const supervisor = source.indexOf('supervisor.start()')
    const postReadiness = source.indexOf("appendDesktopStartupLog('Scheduling bootable plugin snapshot after 30 stable seconds.')")

    expect(source).not.toContain('begin-startup-seed')
    expect(seed).toBeGreaterThan(-1)
    expect(supervisor).toBeGreaterThan(seed)
    expect(postReadiness).toBeGreaterThan(-1)
    expect(source).toContain("harnessEnvironment.DSH_PLUGIN_SNAPSHOT_BATCH = '1'")
    expect(source).toContain('const readinessComplete = reportedDesktopReadiness.size === 2')
    expect(source).toContain('BOOTABLE_SNAPSHOT_DELAY_MS = 30_000')
    expect(source).toContain('bootableSnapshotTimer = setTimeout')
    expect(source).toContain('await manager.markBootable()')
    expect(source).toContain('cancelBootableSnapshot()')
    const readiness = source.slice(source.indexOf('ipcMain.on(DESKTOP_IPC.readiness'), source.indexOf('ipcMain.handle(DESKTOP_IPC.releasesGet'))
    expect(readiness.indexOf('supervisor?.isDiagnosticMode === true')).toBeLessThan(readiness.indexOf('manager.reportReadiness(phase)'))
    expect(readiness).toContain('Diagnostic Profile readiness does not verify the active Profile or its plugin snapshots.')
  })
})

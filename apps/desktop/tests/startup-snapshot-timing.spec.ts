import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('desktop startup plugin snapshot timing', () => {
  it('does not create a snapshot before seeding and retains one only after readiness', () => {
    const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
    const seed = source.indexOf('await bundledPluginInstaller.seedStartup')
    const supervisor = source.indexOf('supervisor.start()')
    const postReadiness = source.indexOf("appendDesktopStartupLog('Creating post-readiness plugin snapshot.')")

    expect(source).not.toContain('begin-startup-seed')
    expect(seed).toBeGreaterThan(-1)
    expect(supervisor).toBeGreaterThan(seed)
    expect(postReadiness).toBeGreaterThan(-1)
    expect(source).toContain("harnessEnvironment.DSH_PLUGIN_SNAPSHOT_BATCH = '1'")
    expect(source).toContain('const readinessComplete = reportedDesktopReadiness.size === 2')
    expect(source).toContain('await manager.markBootable()')
  })
})

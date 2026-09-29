import { describe, expect, it } from 'vitest'
import { orbRuntimeStatus, ORB_OFFICIAL_PACKAGES, type OrbRuntimeFacts } from '../src/orb-runtime-status.ts'

const base: OrbRuntimeFacts = {
  mode: 'local', authorBackendAvailable: false, plugins: [], inventoryKnown: true, screen: 'unknown', accessibility: 'unknown', activeTasks: 'unknown',
  pendingRestart: false, selectionEnabled: false, selectionShortcutReady: false, observationActive: false,
}

describe('floating-ball runtime status', () => {
  it('does not advertise unfinished author-style, selection, or background capability', () => {
    expect(orbRuntimeStatus(base)).toMatchObject({
      backendAvailability: { orb: 'unsupported', 'official-native': 'not-installed', 'official-mcp': 'not-installed' },
      taskInspection: 'unknown', selectionAvailable: false, backgroundAvailable: false,
    })
  })

  it('requires an installed and healthy official plugin', () => {
    const plugin = { packageName: ORB_OFFICIAL_PACKAGES['official-native'], version: '0.1.7-rc.1', source: 'registry' as const, status: 'normal' as const }
    expect(orbRuntimeStatus({ ...base, plugins: [plugin] }).backendAvailability['official-native']).toBe('ready')
    expect(orbRuntimeStatus({ ...base, plugins: [{ ...plugin, status: 'attention' }] }).backendAvailability['official-native']).toBe('not-installed')
    expect(orbRuntimeStatus({ ...base, plugins: [{ packageName: plugin.packageName, source: plugin.source, status: plugin.status }] }).backendAvailability['official-native']).toBe('not-installed')
    expect(orbRuntimeStatus({ ...base, inventoryKnown: false }).backendAvailability['official-native']).toBe('unknown')
  })

  it('advertises author backend only with a live local native transport', () => {
    expect(orbRuntimeStatus({ ...base, authorBackendAvailable: true }).backendAvailability.orb).toBe('ready')
    expect(orbRuntimeStatus({ ...base, mode: 'nas', authorBackendAvailable: true }).backendAvailability.orb).toBe('unsupported')
  })

  it('advertises background Sessions only for a live local Host', () => {
    expect(orbRuntimeStatus({ ...base, backgroundHostAvailable: true }).backgroundAvailable).toBe(true)
    expect(orbRuntimeStatus({ ...base, mode: 'nas', backgroundHostAvailable: true }).backgroundAvailable).toBe(false)
  })

  it('suppresses every local entry in NAS mode and reports an unconfirmed task check', () => {
    expect(orbRuntimeStatus({ ...base, mode: 'nas', selectionEnabled: true, selectionShortcutReady: true,
      observationActive: true, activeTasks: true })).toMatchObject({
      backendAvailability: { 'official-native': 'unsupported' }, activeTasks: 1,
      selectionAvailable: false, observationActive: false,
    })
  })
})

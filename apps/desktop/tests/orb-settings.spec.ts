import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createOrbSettingsStore, DEFAULT_ORB_SETTINGS, normalizeOrbSettings, parseOrbSettingsPatch,
} from '../src/orb-settings.ts'

describe('per-home orb settings', () => {
  it('rejects unknown fields and unrecognized Computer Use backends', () => {
    expect(() => parseOrbSettingsPatch({ path: '/tmp/file' })).toThrow()
    expect(() => parseOrbSettingsPatch({ backend: 'arbitrary' })).toThrow()
    expect(() => parseOrbSettingsPatch({ visible: 'yes' })).toThrow()
    expect(parseOrbSettingsPatch({ backend: 'official-native', visible: true })).toEqual({ backend: 'official-native', visible: true })
  })

  it('defaults missing or invalid persisted fields', () => {
    expect(normalizeOrbSettings(null)).toEqual(DEFAULT_ORB_SETTINGS)
    expect(normalizeOrbSettings({ visible: true, backend: 'invalid', anchor: 'left' })).toMatchObject({
      visible: true, backend: 'orb', anchor: 'left',
    })
  })

  it('isolates two DSH_HOME settings and writes without exposing another home', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-orb-settings-'))
    try {
      const first = createOrbSettingsStore(join(directory, 'first'))
      const second = createOrbSettingsStore(join(directory, 'second'))
      first.write({ ...DEFAULT_ORB_SETTINGS, visible: true, backend: 'official-mcp' })
      expect(first.read()).toMatchObject({ visible: true, backend: 'official-mcp' })
      expect(second.read()).toEqual(DEFAULT_ORB_SETTINGS)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createOrbSettingsStore, DEFAULT_ORB_SETTINGS, initialOrbBackend, nasOrbSettingsHome, normalizeOrbSettings,
  parseNasOrbSettingsPatch, parseOrbSettingsPatch,
} from '../src/orb-settings.ts'

describe('per-home orb settings', () => {
  it('rejects unknown fields and unrecognized Computer Use backends', () => {
    expect(() => parseOrbSettingsPatch({ path: '/tmp/file' })).toThrow()
    expect(() => parseOrbSettingsPatch({ backend: 'arbitrary' })).toThrow()
    expect(() => parseOrbSettingsPatch({ visible: 'yes' })).toThrow()
    expect(parseOrbSettingsPatch({ backend: 'official-native', visible: true })).toEqual({ backend: 'official-native', visible: true })
  })

  it('allows NAS chat presentation settings but never local Computer Use or selection settings', () => {
    expect(parseNasOrbSettingsPatch({ visible: true, avatar: 'minimal', anchor: 'left' }))
      .toEqual({ visible: true, avatar: 'minimal', anchor: 'left' })
    expect(() => parseNasOrbSettingsPatch({ selectionToolbar: true })).toThrow('local-only')
    expect(() => parseNasOrbSettingsPatch({ backend: 'official-native' })).toThrow('local-only')
  })

  it('defaults missing or invalid persisted fields', () => {
    expect(normalizeOrbSettings(null)).toEqual(DEFAULT_ORB_SETTINGS)
    expect(normalizeOrbSettings({ visible: true, backend: 'invalid', anchor: 'left' })).toMatchObject({
      visible: true, backend: 'orb', anchor: 'left',
    })
  })

  it('recognizes only a community-managed existing official provider', () => {
    const native = "# BEGIN community-desktop:computer-use\n- insert:\n    - name: '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native'\n# END community-desktop:computer-use"
    const mcp = native.replace('cua-driver-native', 'cua-driver-mcp')
    expect(initialOrbBackend(native)).toBe('official-native')
    expect(initialOrbBackend(mcp)).toBe('official-mcp')
    expect(initialOrbBackend("# user's note: @deepseek-ai/dsh-experimental-computer-use-cua-driver-native")).toBe('orb')
    expect(initialOrbBackend(undefined)).toBe('orb')
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

  it('isolates NAS presentation state by server identity without using a raw ID as a path', () => {
    const root = '/desktop/user-data'
    const first = nasOrbSettingsHome(root, 'server-one', 'https://nas.example.com')
    expect(first).toBe(nasOrbSettingsHome(root, 'server-one', 'https://nas.example.com'))
    expect(first).not.toBe(nasOrbSettingsHome(root, 'server-two', 'https://nas.example.com'))
    expect(first).not.toBe(nasOrbSettingsHome(root, 'server-one', 'https://changed.example.com'))
    const hostile = nasOrbSettingsHome(root, '../../escape', 'https://nas.example.com')
    expect(dirname(hostile)).toBe(join(root, 'nas-orb'))
    expect(basename(hostile)).toMatch(/^[a-f0-9]{64}$/u)
  })

  it('keeps an existing official Profile provider for homes without orb preferences', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-orb-existing-provider-'))
    try {
      const profile = join(directory, 'profiles', 'web')
      mkdirSync(profile, { recursive: true })
      writeFileSync(join(profile, 'cordis.patch.yml'), [
        '# BEGIN community-desktop:computer-use',
        '- insert:',
        "    - name: '@deepseek-ai/dsh-experimental-computer-use-cua-driver-mcp'",
        '# END community-desktop:computer-use',
      ].join('\n'))
      expect(createOrbSettingsStore(directory).read().backend).toBe('official-mcp')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('stages one backend switch without changing the active setting', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-orb-pending-'))
    try {
      const store = createOrbSettingsStore(directory)
      expect(store.readPendingBackend()).toBeUndefined()
      store.writePendingBackend('official-native')
      expect(store.readPendingBackend()).toBe('official-native')
      expect(store.read().backend).toBe('orb')
      store.clearPendingBackend()
      expect(store.readPendingBackend()).toBeUndefined()
      store.writePendingBackend('orb')
      expect(store.readPendingBackend()).toBe('orb')
      store.clearPendingBackend()
      writeFileSync(join(directory, '.desktop-orb', 'pending-backend-v1.json'), '{"backend":"other"}')
      expect(() => store.readPendingBackend()).toThrow('malformed pending floating-ball backend')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DOWNLOAD_NETWORK_SETTINGS, DownloadNetworkSettingsStore, npmRegistryUrl,
  type SecretEncryption,
} from '../src/download-network-settings.ts'

const encryption: SecretEncryption = {
  available: () => true,
  encrypt: value => Buffer.from(`sealed:${value}`),
  decrypt: value => value.toString().replace(/^sealed:/u, ''),
}

describe('download network settings', () => {
  it('defaults desktop-controlled npm downloads to npmmirror', () => {
    const store = new DownloadNetworkSettingsStore(join(mkdtempSync(join(tmpdir(), 'dsh-network-')), 'settings.json'), encryption)
    expect(store.read()).toEqual(DEFAULT_DOWNLOAD_NETWORK_SETTINGS)
    expect(store.read().npm.registry).toBe('npmmirror')
  })

  it('migrates the removed existing-registry default without replacing explicit sources', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-network-'))
    const legacyPath = join(directory, 'legacy.json')
    writeFileSync(legacyPath, JSON.stringify({
      schema: 'open-dsh-desktop/download-network/v1', revision: 2,
      application: { source: 'github', proxy: { mode: 'system' } },
      npm: { registry: 'existing', proxy: { mode: 'existing' } },
      github: { download: 'original', proxy: { mode: 'existing' } },
    }))
    expect(new DownloadNetworkSettingsStore(legacyPath, encryption).read().npm.registry).toBe('npmmirror')

    const explicitPath = join(directory, 'explicit.json')
    writeFileSync(explicitPath, JSON.stringify({
      schema: 'open-dsh-desktop/download-network/v1', revision: 3,
      application: { source: 'github', proxy: { mode: 'system' } },
      npm: { registry: 'npmjs', proxy: { mode: 'existing' } },
      github: { download: 'original', proxy: { mode: 'existing' } },
    }))
    expect(new DownloadNetworkSettingsStore(explicitPath, encryption).read().npm.registry).toBe('npmjs')
  })

  it('persists redacted credentials with strict per-target validation', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'dsh-network-')), 'settings.json')
    const store = new DownloadNetworkSettingsStore(path, encryption)
    const settings = store.update({
      target: 'npm',
      npm: {
        registry: 'custom', registryUrl: 'https://registry.example.test/',
        proxy: { mode: 'custom', url: 'http://127.0.0.1:7890', username: 'user' }, password: 'secret',
      },
    })
    expect(settings.npm).toEqual({
      registry: 'custom', registryUrl: 'https://registry.example.test',
      proxy: { mode: 'custom', url: 'http://127.0.0.1:7890', username: 'user', passwordSet: true },
    })
    expect(store.password('npm')).toBe('secret')
    expect(readFileSync(path, 'utf8')).not.toContain('"secret"')
    expect(() => store.update({ target: 'npm', npm: {
      registry: 'custom', registryUrl: 'http://unsafe.test', proxy: { mode: 'direct' },
    } })).toThrow(/HTTPS/u)
    expect(() => store.update({ target: 'npm', npm: {
      registry: 'existing', proxy: { mode: 'existing' },
    } })).toThrow(/registry is invalid/u)
  })

  it('retains a password in memory when secure encryption is unavailable', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'dsh-network-')), 'settings.json')
    const store = new DownloadNetworkSettingsStore(path, { ...encryption, available: () => false })
    expect(store.update({ target: 'github', github: {
      download: 'original', proxy: { mode: 'custom', url: 'https://proxy.example.test' }, password: 'session-only',
    } }).github.proxy.passwordSet).toBe(true)
    expect(readFileSync(path, 'utf8')).not.toContain('session-only')
    expect(store.password('github')).toBe('session-only')
  })

  it('resolves only explicitly selected npm registries', () => {
    expect(npmRegistryUrl({ registry: 'npmmirror', proxy: { mode: 'direct', passwordSet: false } })).toBe('https://registry.npmmirror.com')
    expect(npmRegistryUrl({ registry: 'npmjs', proxy: { mode: 'direct', passwordSet: false } })).toBe('https://registry.npmjs.org')
  })

  it('retains bounded operation revisions across later saves', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'dsh-network-')), 'settings.json')
    const store = new DownloadNetworkSettingsStore(path, encryption)
    store.update({ target: 'npm', npm: {
      registry: 'npmmirror', proxy: { mode: 'custom', url: 'https://proxy.old.test' }, password: 'old-secret',
    } })
    const operationRevision = store.read().revision
    store.update({ target: 'npm', npm: {
      registry: 'npmjs', proxy: { mode: 'custom', url: 'https://proxy.new.test' }, password: 'new-secret',
    } })
    expect(store.operationSnapshot(operationRevision)).toMatchObject({
      settings: { revision: operationRevision, npm: { registry: 'npmmirror', proxy: { url: 'https://proxy.old.test' } } },
      passwords: { npm: 'old-secret' },
    })
  })
})

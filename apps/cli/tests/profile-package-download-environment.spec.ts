import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { profilePackageDownloadEnvironment } from '../src/profile-package-manager.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh package network '))
  roots.push(root)
  return root
}

describe('profile package download environment', () => {
  it('applies the live desktop registry and operation proxy without changing its input', () => {
    const file = join(temporaryRoot(), 'settings.json')
    writeFileSync(file, JSON.stringify({ revision: 7, npm: { registry: 'npmmirror' } }))
    const input = { DSH_DESKTOP_DOWNLOAD_NETWORK_FILE: file, DSH_DESKTOP_PACKAGE_PROXY_URL: 'http://plugins:token@127.0.0.1:3210' }
    expect(profilePackageDownloadEnvironment(input)).toMatchObject({
      npm_config_registry: 'https://registry.npmmirror.com',
      npm_config_https_proxy: 'http://plugins-7:token@127.0.0.1:3210',
      HTTPS_PROXY: 'http://plugins-7:token@127.0.0.1:3210',
      NO_PROXY: '',
    })
    expect(input).not.toHaveProperty('npm_config_registry')
  })

  it.each(['direct', 'custom'])('makes pnpm use the explicit %s desktop operation route instead of stale global YAML proxies', (mode) => {
    const root = temporaryRoot()
    const config = join(root, 'pnpm')
    mkdirSync(config)
    const configuration = 'proxy: http://127.0.0.1:9\nhttpProxy: http://127.0.0.1:9\nhttpsProxy: http://127.0.0.1:9\nnoProxy: "*"\nregistry: https://private.example.test\n'
    writeFileSync(join(config, 'config.yaml'), configuration)
    const settings = join(root, 'settings.json')
    writeFileSync(settings, JSON.stringify({ revision: 7, npm: { registry: 'npmmirror', proxy: { mode } } }))
    const operation = 'http://plugins-7:token@127.0.0.1:3210'
    const env = profilePackageDownloadEnvironment({
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: root, USERPROFILE: root,
      XDG_CONFIG_HOME: root, DSH_DESKTOP_DOWNLOAD_NETWORK_FILE: settings,
      DSH_DESKTOP_PACKAGE_PROXY_URL: 'http://plugins:token@127.0.0.1:3210',
      PNPM_CONFIG_HTTPS_PROXY: 'http://127.0.0.1:8', pnpm_config_https_proxy: 'http://127.0.0.1:7',
    })
    const pnpm = new URL('../../desktop/node_modules/pnpm/bin/pnpm.mjs', import.meta.url)
    const result = spawnSync(process.execPath, [fileURLToPath(pnpm), 'config', 'list', '--json'], {
      cwd: root, env, encoding: 'utf8', timeout: 15_000,
    })
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    const effective = JSON.parse(result.stdout) as Record<string, unknown>
    for (const name of ['proxy', 'httpProxy', 'httpsProxy']) {
      expect(new URL(String(effective[name])).href).toBe(new URL(operation).href)
    }
    expect(String(effective.noProxy).trim()).toBe('')
    expect(new URL(String(effective.registry)).href).toBe('https://registry.npmmirror.com/')
    expect(readFileSync(join(config, 'config.yaml'), 'utf8')).toBe(configuration)
  })

  it('preserves pnpm global proxy settings when the desktop keeps existing npm routing', () => {
    const root = temporaryRoot()
    const config = join(root, 'pnpm')
    mkdirSync(config)
    const configuration = 'proxy: http://private-proxy.example.test:8080\nhttpsProxy: http://private-proxy.example.test:8080\nregistry: https://registry.npmjs.org\n'
    writeFileSync(join(config, 'config.yaml'), configuration)
    const settings = join(root, 'settings.json')
    writeFileSync(settings, JSON.stringify({ revision: 7, npm: { registry: 'npmmirror', proxy: { mode: 'existing' } } }))
    const env = profilePackageDownloadEnvironment({
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: root, USERPROFILE: root,
      XDG_CONFIG_HOME: root, DSH_DESKTOP_DOWNLOAD_NETWORK_FILE: settings,
      DSH_DESKTOP_PACKAGE_PROXY_URL: 'http://plugins:token@127.0.0.1:3210',
    })
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../desktop/node_modules/pnpm/bin/pnpm.mjs', import.meta.url)),
      'config', 'list', '--json'], { cwd: root, env, encoding: 'utf8', timeout: 15_000 })
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    const effective = JSON.parse(result.stdout) as Record<string, unknown>
    expect(effective.proxy).toBe('http://private-proxy.example.test:8080')
    expect(effective.httpsProxy).toBe('http://private-proxy.example.test:8080')
    expect(new URL(String(effective.registry)).href).toBe('https://registry.npmmirror.com/')
    expect(readFileSync(join(config, 'config.yaml'), 'utf8')).toBe(configuration)
  })

  it('preserves inherited registry settings when the settings file is unreadable or unchanged', () => {
    const input = { DSH_DESKTOP_DOWNLOAD_NETWORK_FILE: '/missing/settings.json', npm_config_registry: 'https://private.example.test' }
    expect(profilePackageDownloadEnvironment(input).npm_config_registry).toBe(input.npm_config_registry)
  })

  it('retains non-desktop registry, authentication, store and build-policy environment entries', () => {
    const input = {
      pnpm_config_registry: 'https://private.example.test', PNPM_CONFIG_HTTPS_PROXY: 'http://private-proxy.example.test:8080',
      npm_config_store_dir: '/private/store', PNPM_CONFIG_STRICT_DEP_BUILDS: 'true',
      PNPM_CONFIG__AUTH: '{"fixture":"private-registry-credentials"}',
    }
    expect(profilePackageDownloadEnvironment(input)).toEqual(input)
  })
})

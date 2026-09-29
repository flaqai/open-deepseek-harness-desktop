import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  configureExperimentalCapability,
  resolveSystemChromiumExecutable,
  setComputerUseBackend,
} from '../src/experimental-capability.ts'
import { runPlugin } from '../src/plugin.ts'

function fixture(patch = '# user comment\n[]\n'): { home: string; patch: string } {
  const home = mkdtempSync(join(tmpdir(), 'dsh-capability-'))
  const profile = join(home, 'profiles', 'web')
  mkdirSync(profile, { recursive: true })
  const filename = join(profile, 'cordis.patch.yml')
  writeFileSync(filename, patch)
  vi.stubEnv('DSH_HOME', home)
  return { home, patch: filename }
}

afterEach(() => { vi.unstubAllEnvs() })

const installedMacChrome = {
  platform: 'darwin' as const,
  env: {},
  exists: (candidate: string) => candidate === '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
}

describe('experimental capability composition', () => {
  it('selects an installed stable Chrome instead of Playwright Chrome for Testing', () => {
    const executable = resolveSystemChromiumExecutable(installedMacChrome)
    expect(executable).toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
  })

  it('finds a Linux Chromium executable from PATH', () => {
    const executable = resolveSystemChromiumExecutable({
      platform: 'linux',
      env: { PATH: '/usr/local/bin:/usr/bin' },
      exists: candidate => candidate === '/usr/bin/chromium',
    })
    expect(executable).toBe('/usr/bin/chromium')
  })

  it('fails explicitly instead of falling back to a browser download', () => {
    expect(() => resolveSystemChromiumExecutable({
      platform: 'darwin',
      env: {},
      exists: () => false,
    })).toThrow('system Chrome or Chromium')
  })

  it('turns an empty user layer into a parseable visible Playwright composition', () => {
    const target = fixture()
    expect(configureExperimentalCapability('web', 'browser-use-playwright-visible', installedMacChrome)).toBe(true)
    const text = readFileSync(target.patch, 'utf8')
    expect(text).toContain('# user comment')
    expect(text).toContain("name: '@deepseek-ai/dsh-browser-use'")
    expect(text).toContain("name: '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp'")
    expect(text).toContain('headless: false')
    expect(text).toContain(`executablePath: ${JSON.stringify('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')}`)
    expect(text).not.toMatch(/^\[\]\s*\n-/mu)
  })

  it('replaces its browser block without removing unrelated user and computer rows', () => {
    const target = fixture('- insert:\n    - id: user-row\n      name: user-plugin\n')
    configureExperimentalCapability('web', 'browser-use-playwright-visible', installedMacChrome)
    configureExperimentalCapability('web', 'computer-use-native')
    configureExperimentalCapability('web', 'browser-use-devtools-visible', installedMacChrome)
    const text = readFileSync(target.patch, 'utf8')
    expect(text).toContain('id: user-row')
    expect(text).toContain('computer-use-cua-driver-native')
    expect(text).toContain('browser-use-chrome-devtools-mcp')
    expect(text).not.toContain('browser-use-playwright-mcp')
    expect(text.match(/BEGIN community-desktop:browser-use/gu)).toHaveLength(1)
  })

  it('switches official providers within one managed block and preserves user YAML', () => {
    const target = fixture('# user comment\n- insert:\n    - id: user-row\n      name: user-plugin\n')
    expect(setComputerUseBackend('web', 'official-native')).toBe(true)
    expect(setComputerUseBackend('web', 'official-native')).toBe(false)
    expect(setComputerUseBackend('web', 'official-mcp')).toBe(true)
    const text = readFileSync(target.patch, 'utf8')
    expect(text).toContain('# user comment\n- insert:\n    - id: user-row\n      name: user-plugin')
    expect(text).toContain("name: '@deepseek-ai/dsh-experimental-computer-use-cua-driver-mcp'")
    expect(text).not.toContain('computer-use-cua-driver-native')
    expect(text.match(/^# BEGIN community-desktop:computer-use$/gmu)).toHaveLength(1)
    expect(text.match(/^# END community-desktop:computer-use$/gmu)).toHaveLength(1)
  })

  it('turns off Computer Use without removing browser or user entries', () => {
    const target = fixture('# user comment\n- insert:\n    - id: user-row\n      name: user-plugin\n')
    configureExperimentalCapability('web', 'browser-use-playwright-visible', installedMacChrome)
    setComputerUseBackend('web', 'official-native')
    expect(setComputerUseBackend('web', 'off')).toBe(true)
    expect(setComputerUseBackend('web', 'off')).toBe(false)
    const text = readFileSync(target.patch, 'utf8')
    expect(text).toContain('id: user-row')
    expect(text).toContain('browser-use-playwright-mcp')
    expect(text).not.toContain('community-desktop:computer-use')
  })

  it('returns an empty parseable patch after disabling a sole Computer Use block', () => {
    const target = fixture()
    setComputerUseBackend('web', 'official-native')
    expect(setComputerUseBackend('web', 'off')).toBe(true)
    expect(readFileSync(target.patch, 'utf8')).toBe('# user comment\n[]\n')
  })

  it('leaves a Profile with no Computer Use block byte-for-byte unchanged', () => {
    const target = fixture('# user comment\n[]\n')
    expect(setComputerUseBackend('web', 'off')).toBe(false)
    expect(readFileSync(target.patch, 'utf8')).toBe('# user comment\n[]\n')
  })

  it.each([
    '# BEGIN community-desktop:computer-use\n[]\n',
    '# END community-desktop:computer-use\n[]\n',
    '# BEGIN community-desktop:computer-use\n# BEGIN community-desktop:computer-use\n# END community-desktop:computer-use\n[]\n',
    '# END community-desktop:computer-use\n# BEGIN community-desktop:computer-use\n[]\n',
    '# BEGIN community-desktop:computer-use extra\n# END community-desktop:computer-use\n[]\n',
  ])('rejects malformed markers before touching the patch', (patch) => {
    const target = fixture(patch)
    expect(() => setComputerUseBackend('web', 'off')).toThrow('malformed community Desktop computer-use composition block')
    expect(readFileSync(target.patch, 'utf8')).toBe(patch)
  })

  it('accepts only closed Computer Use choices through the CLI command', () => {
    const target = fixture()
    vi.stubEnv('DSH_PLUGIN_SNAPSHOT_BATCH', '1')
    expect(runPlugin('web', ['set-computer-use-backend', 'official-native'])).toBe(0)
    expect(readFileSync(target.patch, 'utf8')).toContain('computer-use-cua-driver-native')
    expect(() => runPlugin('web', ['set-computer-use-backend', 'orb'])).toThrow('invalid Computer Use backend')
    expect(() => runPlugin('web', ['set-computer-use-backend', 'official-native', 'extra'])).toThrow('invalid Computer Use backend')
    expect(runPlugin('web', ['set-computer-use-backend', 'off'])).toBe(0)
    expect(readFileSync(target.patch, 'utf8')).toBe('# user comment\n[]\n')
  })
})

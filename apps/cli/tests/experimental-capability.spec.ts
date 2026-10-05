import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  configureExperimentalCapability,
  resolveSystemChromiumExecutable,
} from '../src/experimental-capability.ts'

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

})

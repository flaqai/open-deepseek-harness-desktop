import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolvePnpmCommand, runPlugin } from '../src/plugin.ts'
import { resolvePnpmInvocation, runProfilePackageManager } from '../src/profile-package-manager.ts'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('profile plugin package manager', () => {
  it('uses pnpm from PATH when the host provides no executable', () => {
    expect(resolvePnpmCommand({})).toBe('pnpm')
  })

  it('uses a host-owned absolute pnpm executable', () => {
    const executable = process.platform === 'win32' ? 'C:\\runtime\\pnpm.cmd' : '/runtime/bin/pnpm'
    expect(resolvePnpmCommand({ DSH_PNPM_BIN: executable })).toBe(executable)
  })

  it('runs a packaged pnpm entry through Node without shell interpolation', () => {
    const entry = process.platform === 'win32'
      ? 'C:\\Program Files\\DeepSeek Harness\\resources\\runtime\\pnpm\\pnpm.mjs'
      : '/Applications/DeepSeek Harness/resources/runtime/pnpm/pnpm.mjs'
    expect(resolvePnpmInvocation({ DSH_PNPM_BIN: entry }, ['add', 'C:\\Plugin Archives\\market.tgz']))
      .toEqual({
        command: process.execPath,
        args: [entry, 'add', 'C:\\Plugin Archives\\market.tgz'],
        shell: false,
      })
  })

  it('preserves spaces in real packaged pnpm arguments', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-pnpm-entry with spaces-'))
    const entry = join(root, 'pnpm entry.mjs')
    const archive = join(root, 'plugin archives', 'market.tgz')
    writeFileSync(entry, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))\n')
    vi.stubEnv('DSH_PNPM_BIN', entry)
    try {
      expect(runProfilePackageManager(root, ['add', '--save-exact', archive])).toEqual({
        exitCode: 0,
        diagnostic: JSON.stringify(['add', '--save-exact', archive]),
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects a relative host override', () => {
    expect(() => resolvePnpmCommand({ DSH_PNPM_BIN: 'runtime/pnpm' }))
      .toThrow('DSH_PNPM_BIN must be an absolute path')
  })

  it('keeps an inspect-only doctor invocation read-only for a missing profile', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-plugin-doctor-'))
    vi.stubEnv('DSH_HOME', home)
    try {
      expect(runPlugin('web', ['doctor'])).toBe(1)
      expect(existsSync(join(home, 'profiles', 'web', 'package.json'))).toBe(false)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

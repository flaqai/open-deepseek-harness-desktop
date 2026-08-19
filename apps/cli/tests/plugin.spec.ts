import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolvePnpmCommand, runPlugin } from '../src/plugin.ts'

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

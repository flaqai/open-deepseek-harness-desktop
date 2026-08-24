import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolvePnpmCommand, runPlugin } from '../src/plugin.ts'
import { normalizePnpmDiagnostic, resolvePnpmInvocation, runProfilePackageManager } from '../src/profile-package-manager.ts'

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

  it('appends a reporter-independent Git prepare approval hint', () => {
    const raw = JSON.stringify({
      err: {
        code: 'ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED',
        message: 'Failed to prepare git-hosted package: The git-hosted package "@dsh-external/dsh-client-ui-skin-maid-atelier@0.0.1" needs to execute build scripts but is not in the "allowBuilds" allowlist.',
      },
    })
    expect(normalizePnpmDiagnostic(raw)).toContain(
      'dsh: The git-hosted package "@dsh-external/dsh-client-ui-skin-maid-atelier@0.0.1" needs to execute build scripts but is not in the "allowBuilds" allowlist.',
    )
  })

  it('preserves the approval hint through the package-manager subprocess bridge', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-pnpm-git-prepare-'))
    const entry = join(root, 'pnpm failure.mjs')
    const output = JSON.stringify({
      err: {
        code: 'ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED',
        message: 'The git-hosted package "@dsh-external/dsh-client-ui-skin-maid-atelier@0.0.1" needs to execute build scripts but is not in the "allowBuilds" allowlist.',
      },
    })
    writeFileSync(entry, `process.stderr.write(${JSON.stringify(output)}); process.exit(1)\n`)
    vi.stubEnv('DSH_PNPM_BIN', entry)
    try {
      expect(runProfilePackageManager(root, ['add', 'github:example/plugin'])).toMatchObject({
        exitCode: 1,
        diagnostic: expect.stringContaining('dsh: The git-hosted package "@dsh-external/dsh-client-ui-skin-maid-atelier@0.0.1" needs to execute build scripts'),
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('surfaces a real local Git prepare block in a market-readable form', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-pnpm-real-git-prepare-'))
    const source = join(root, 'source')
    const profile = join(root, 'profile')
    try {
      writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true }))
      writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - source\n  - profile\n')
      mkdirSync(source, { recursive: true })
      mkdirSync(profile, { recursive: true })
      writeFileSync(join(source, 'package.json'), JSON.stringify({
        name: 'dsh-fixture-git-prepare',
        version: '1.0.0',
        scripts: { prepare: 'node -e "process.exit(0)"' },
      }))
      writeFileSync(join(profile, 'package.json'), JSON.stringify({ private: true }))
      for (const args of [
        ['init'],
        ['add', 'package.json'],
        ['-c', 'user.name=DSH test', '-c', 'user.email=dsh-test@example.invalid', 'commit', '-m', 'fixture'],
      ]) {
        const git = spawnSync('git', args, { cwd: source, encoding: 'utf8' })
        expect(git.status, git.stderr).toBe(0)
      }
      const pnpm = join(process.cwd(), 'apps', 'desktop', 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
      vi.stubEnv('DSH_PNPM_BIN', pnpm)
      const result = runProfilePackageManager(profile, ['add', `git+file://${source}`, '--reporter=ndjson'])
      expect(result.exitCode).toBe(1)
      expect(result.diagnostic).toContain('ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED')
      expect(result.diagnostic).toContain(
        'dsh: The git-hosted package "dsh-fixture-git-prepare@1.0.0" needs to execute build scripts',
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('does not fabricate a package name from an incomplete Git prepare error', () => {
    const raw = 'ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED: fetch failed before package metadata was available'
    expect(normalizePnpmDiagnostic(raw)).toBe(raw)
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

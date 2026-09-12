import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { allowProfilePackageBuild, createProfilePluginSnapshot } from '@deepseek-ai/dsh-app-boot'
import { resolvePnpmCommand, runPlugin } from '../src/plugin.ts'
import {
  DESKTOP_BUNDLED_PLUGINS_DIR_ENV,
  resolveDesktopBundledPluginArgs,
} from '../src/desktop-bundled-plugin.ts'
import {
  extractGitPrepareBuildKey,
  extractIgnoredBuildKey,
  isWindowsPnpmRenameContention,
  normalizePnpmDiagnostic,
  resolvePnpmInvocation,
  runProfilePackageManager,
  windowsPnpmRenameRetryDelay,
} from '../src/profile-package-manager.ts'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('profile plugin package manager', () => {
  it('hides both pnpm subprocess windows', () => {
    const source = readFileSync(new URL('../src/profile-package-manager.ts', import.meta.url), 'utf8')
    expect(source.match(/windowsHide: true/gu)).toHaveLength(2)
  })

  it('restores an absent bundled version locally while leaving explicit updates online', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-bundled-plugin-'))
    const resources = join(root, 'bundled-plugins')
    const profile = join(root, 'profile')
    const archive = join(resources, 'sidebar.tgz')
    const bytes = Buffer.from('verified bundled sidebar')
    mkdirSync(resources, { recursive: true })
    mkdirSync(profile, { recursive: true })
    writeFileSync(archive, bytes)
    writeFileSync(join(resources, 'manifest.json'), JSON.stringify({
      schema: 2,
      plugins: [
        {
          packageName: 'dsh-better-sidebar',
          version: '0.16.1',
          profile: 'web',
          installPolicy: 'startup',
          registrySpec: 'dsh-better-sidebar@0.16.1',
          archive: 'sidebar.tgz',
          integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
        },
        {
          packageName: 'diagnostic-only',
          version: '1.0.0',
          profile: 'web',
          installPolicy: 'diagnostic',
          archive: 'sidebar.tgz',
          integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
        },
      ],
    }))
    const environment = { [DESKTOP_BUNDLED_PLUGINS_DIR_ENV]: resources }
    try {
      expect(resolveDesktopBundledPluginArgs('web', profile, [
        'add', 'dsh-better-sidebar',
      ], environment)).toEqual(['add', archive])
      expect(resolveDesktopBundledPluginArgs('web', profile, [
        'add', '--save-exact', 'dsh-better-sidebar@0.16.1',
      ], environment)).toEqual(['add', '--save-exact', archive])
      expect(resolveDesktopBundledPluginArgs('web', profile, [
        'add', 'dsh-better-sidebar@0.17.0',
      ], environment)).toEqual(['add', 'dsh-better-sidebar@0.17.0'])
      expect(resolveDesktopBundledPluginArgs('web', profile, [
        'add', 'dsh-better-sidebar@latest',
      ], environment)).toEqual(['add', 'dsh-better-sidebar@latest'])
      expect(resolveDesktopBundledPluginArgs('web', profile, [
        'add', 'diagnostic-only',
      ], environment)).toEqual(['add', 'diagnostic-only'])

      writeFileSync(join(profile, 'package.json'), JSON.stringify({
        dependencies: { 'dsh-better-sidebar': '0.16.1' },
      }))
      expect(resolveDesktopBundledPluginArgs('web', profile, [
        'add', 'dsh-better-sidebar',
      ], environment)).toEqual(['add', 'dsh-better-sidebar'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('refuses a modified bundled archive instead of silently falling back to the registry', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-bundled-integrity-'))
    const resources = join(root, 'bundled-plugins')
    const profile = join(root, 'profile')
    mkdirSync(resources, { recursive: true })
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(resources, 'plugin.tgz'), 'modified')
    writeFileSync(join(resources, 'manifest.json'), JSON.stringify({
      schema: 2,
      plugins: [{
        packageName: 'fixture-plugin', version: '1.0.0', profile: 'web', installPolicy: 'startup',
        archive: 'plugin.tgz', integrity: `sha512-${Buffer.alloc(64).toString('base64')}`,
      }],
    }))
    try {
      expect(() => resolveDesktopBundledPluginArgs(
        'web', profile, ['add', 'fixture-plugin'],
        { [DESKTOP_BUNDLED_PLUGINS_DIR_ENV]: resources },
      )).toThrow(/integrity mismatch/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

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
    vi.stubEnv('DSH_HOME', root)
    try {
      expect(runProfilePackageManager(root, ['add', '--save-exact', archive])).toEqual({
        exitCode: 0,
        diagnostic: JSON.stringify(['--store-dir', join(root, '.pnpm-store'), 'add', '--save-exact', archive]),
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('retries only pnpm temporary-directory rename contention on Windows', () => {
    const diagnostic = String.raw`ERR_PNPM_EPERM: [importPackage C:\Users\测试\AppData\Roaming\desktop\profiles\web\node_modules\mime-types] EPERM: operation not permitted, rename 'C:\Users\测试\AppData\Roaming\desktop\profiles\web\node_modules\mime-types_tmp_10020_7' -> 'C:\Users\测试\AppData\Roaming\desktop\profiles\web\node_modules\mime-types'`
    expect(isWindowsPnpmRenameContention(diagnostic, 'win32')).toBe(true)
    expect(isWindowsPnpmRenameContention(diagnostic, 'darwin')).toBe(false)
    expect(windowsPnpmRenameRetryDelay(diagnostic, 0, 'win32')).toBe(500)
    expect(windowsPnpmRenameRetryDelay(diagnostic, 1, 'win32')).toBe(1_500)
    expect(windowsPnpmRenameRetryDelay(diagnostic, 2, 'win32')).toBe(3_000)
    expect(windowsPnpmRenameRetryDelay(diagnostic, 3, 'win32')).toBeUndefined()
    expect(windowsPnpmRenameRetryDelay(diagnostic, -1, 'win32')).toBeUndefined()
    expect(isWindowsPnpmRenameContention(
      'ERR_PNPM_EPERM EPERM: operation not permitted, open C:\\profile\\package.json',
      'win32',
    )).toBe(false)
    expect(isWindowsPnpmRenameContention(
      String.raw`ERR_PNPM_EPERM EPERM: operation not permitted, rename 'C:\profile\node_modules\mime-types' -> 'C:\profile\node_modules\mime-types-old'`,
      'win32',
    )).toBe(false)
  })

  it('retains a network diagnosis from a failing packaged pnpm process', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-pnpm-network-'))
    const entry = join(root, 'pnpm.mjs')
    try {
      writeFileSync(entry, "process.stderr.write('UND_ERR_CONNECT_TIMEOUT'); process.exitCode = 1\n")
      vi.stubEnv('DSH_PNPM_BIN', entry)
      const result = runProfilePackageManager(root, ['add', '@fixture/plugin'])
      expect(result.exitCode).toBe(1)
      expect(result.diagnostic).toContain('UND_ERR_CONNECT_TIMEOUT')
      expect(result.diagnostic).toMatch(/pnpm network connect-timeout after \d+ ms/u)
      expect(result.diagnostic).toContain('effective route unverified')
    } finally {
      vi.unstubAllEnvs()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('recovers when a packaged pnpm retry clears Windows rename contention', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-pnpm-windows-rename-'))
    const entry = join(root, 'pnpm retry.mjs')
    const countFile = join(root, 'attempts.txt')
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
    writeFileSync(entry, [
      "import { existsSync, readFileSync, writeFileSync } from 'node:fs'",
      `const countFile = ${JSON.stringify(countFile)}`,
      "const attempts = existsSync(countFile) ? Number(readFileSync(countFile, 'utf8')) + 1 : 1",
      'writeFileSync(countFile, String(attempts))',
      'if (attempts === 1) {',
      String.raw`  process.stderr.write("ERR_PNPM_EPERM: [importPackage C:\\Users\\测试\\profile\\node_modules\\mime-types] EPERM: operation not permitted, rename 'C:\\Users\\测试\\profile\\node_modules\\mime-types_tmp_4321_1' -> 'C:\\Users\\测试\\profile\\node_modules\\mime-types'")`,
      '  process.exit(1)',
      '}',
      "process.stdout.write('installed')",
    ].join('\n'))
    vi.stubEnv('DSH_PNPM_BIN', entry)
    try {
      Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
      const result = runProfilePackageManager(root, ['add', '@fixture/plugin'])
      expect(result.exitCode).toBe(0)
      expect(result.diagnostic).toContain('retrying in 500 ms (1/3)')
      expect(result.diagnostic).toContain('installed')
      expect(readFileSync(countFile, 'utf8')).toBe('2')
    } finally {
      if (platformDescriptor !== undefined) Object.defineProperty(process, 'platform', platformDescriptor)
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
    expect(extractGitPrepareBuildKey(JSON.stringify({
      code: 'ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED',
      hint: 'Add the package.\nallowBuilds:\n  @dsh-external/dsh-client-ui-skin-maid-atelier@git+https://example.invalid/skin.git#commit: true',
    }))).toBe('@dsh-external/dsh-client-ui-skin-maid-atelier@git+https://example.invalid/skin.git#commit')
  })

  it('preserves the approval hint through the package-manager subprocess bridge', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-pnpm-git-prepare-'))
    const entry = join(root, 'pnpm failure.mjs')
    const output = JSON.stringify({
      err: {
        code: 'ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED',
        message: 'The git-hosted package "@dsh-external/dsh-client-ui-skin-maid-atelier@0.0.1" needs to execute build scripts but is not in the "allowBuilds" allowlist.',
        hint: 'Add the package.\nallowBuilds:\n  @dsh-external/dsh-client-ui-skin-maid-atelier@github:example/skin#commit: true',
      },
    })
    writeFileSync(entry, `process.stderr.write(${JSON.stringify(output + 'x'.repeat(70 * 1024))}); process.exit(1)\n`)
    vi.stubEnv('DSH_PNPM_BIN', entry)
    try {
      const result = runProfilePackageManager(root, ['add', 'github:example/plugin'])
      expect(result.exitCode).toBe(1)
      expect(result.diagnostic).toContain(
        'dsh: The git-hosted package "@dsh-external/dsh-client-ui-skin-maid-atelier@0.0.1" needs to execute build scripts',
      )
      expect(extractGitPrepareBuildKey(result.diagnostic ?? ''))
        .toBe('@dsh-external/dsh-client-ui-skin-maid-atelier@github:example/skin#commit')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('keeps a real Git prepare blocked until the exact retained key is explicitly allowed', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-pnpm-real-git-prepare-'))
    const source = join(root, 'source')
    const profile = join(root, 'profile')
    try {
      mkdirSync(source, { recursive: true })
      mkdirSync(profile, { recursive: true })
      writeFileSync(join(source, 'package.json'), JSON.stringify({
        name: 'dsh-fixture-git-prepare',
        version: '1.0.0',
        scripts: { prepare: 'node -e "process.exit(0)"' },
      }))
      writeFileSync(join(profile, 'package.json'), JSON.stringify({ private: true }))
      writeFileSync(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\n# keep user settings\nnodeLinker: hoisted\n')
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
      vi.stubEnv('DSH_HOME', root)
      const args = ['add', `git+file://${source}`, '--reporter=ndjson']
      const blocked = runProfilePackageManager(profile, args)
      expect(blocked.exitCode).toBe(1)
      const key = extractGitPrepareBuildKey(blocked.diagnostic ?? '')
      expect(key).toBeTruthy()
      expect(readFileSync(join(profile, 'pnpm-workspace.yaml'), 'utf8')).not.toContain('allowBuilds:')

      expect(allowProfilePackageBuild(profile, key!)).toBe('added')
      const retried = runProfilePackageManager(profile, args)
      expect(retried.exitCode, retried.diagnostic).toBe(0)
      expect(readFileSync(join(profile, 'pnpm-workspace.yaml'), 'utf8')).toContain('# keep user settings')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('does not fabricate a package name from an incomplete Git prepare error', () => {
    const raw = 'ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED: fetch failed before package metadata was available'
    expect(normalizePnpmDiagnostic(raw)).toBe(raw)
  })

  it('retains only one unambiguous ignored-build package for explicit approval', () => {
    const single = '{"code":"ERR_PNPM_IGNORED_BUILDS","message":"Ignored build scripts: node-pty"}'
    const multiple = '{"code":"ERR_PNPM_IGNORED_BUILDS","message":"Ignored build scripts: node-pty, esbuild"}'
    expect(extractIgnoredBuildKey(single)).toBe('node-pty')
    expect(normalizePnpmDiagnostic(single)).toContain('dsh: pnpm allowBuilds key "node-pty"')
    expect(extractIgnoredBuildKey(multiple)).toBeUndefined()
    expect(normalizePnpmDiagnostic(multiple)).not.toContain('dsh: pnpm allowBuilds key')
  })

  it('records one explicit registry build approval without invoking pnpm', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-plugin-build-approval-'))
    vi.stubEnv('DSH_HOME', home)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      expect(runPlugin('web', ['approve-build', 'node-pty'])).toBe(0)
      expect(readFileSync(join(home, 'profiles', 'web', 'pnpm-workspace.yaml'), 'utf8'))
        .toContain('node-pty: true')
      expect(runPlugin('web', ['approve-build', 'node-pty'])).toBe(0)
      expect(runPlugin('web', ['approve-build', 'node-pty@1.1.0'])).toBe(1)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('records one exact Git build key without accepting an arbitrary value', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-plugin-git-build-approval-'))
    vi.stubEnv('DSH_HOME', home)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      const key = 'fixture-plugin@git+https://example.invalid/fixture-plugin.git#commit'
      expect(runPlugin('web', ['approve-build-key', key])).toBe(0)
      expect(readFileSync(join(home, 'profiles', 'web', 'pnpm-workspace.yaml'), 'utf8'))
        .toContain(`${key}: true`)
      expect(runPlugin('web', ['approve-build-key', 'not an exact key'])).toBe(1)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
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

  it('reports an explicit Host compatibility mismatch in inspect-only doctor mode', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-plugin-doctor-compatibility-'))
    const profileDir = join(home, 'profiles', 'web')
    const pluginDir = join(profileDir, 'node_modules', 'fixture-plugin')
    mkdirSync(pluginDir, { recursive: true })
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-web',
      dependencies: { 'fixture-plugin': '1.0.0' },
      dsh: { profile: { bundles: ['fixture-plugin'] } },
    }))
    writeFileSync(join(pluginDir, 'package.json'), JSON.stringify({
      name: 'fixture-plugin',
      version: '1.0.0',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }))
    writeFileSync(join(pluginDir, 'cordis.patch.yml'), '[]\n')
    writeFileSync(join(pluginDir, 'compatibility.json'), JSON.stringify({
      schemaVersion: 1,
      supportedHosts: [{ version: '0.0.0' }],
    }))
    vi.stubEnv('DSH_HOME', home)
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      expect(runPlugin('web', ['doctor'])).toBe(2)
      expect(JSON.parse(String(stdout.mock.calls.at(-1)?.[0]))).toMatchObject({
        status: 'failed',
        hostCompatibilityIssues: [{
          packageName: 'fixture-plugin',
          supportedHostVersions: ['0.0.0'],
        }],
        issues: [{
          code: 'profile.host-version-incompatible',
          attribution: { rootPackage: 'fixture-plugin' },
        }],
      })
      expect(existsSync(join(pluginDir, 'package.json'))).toBe(true)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('returns a Session API advisory without a repair-triggering exit or Profile writes', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-plugin-doctor-session-api-'))
    const profile = join(home, 'profiles', 'web')
    const plugin = join(profile, 'node_modules', 'fixture-plugin')
    mkdirSync(plugin, { recursive: true })
    const manifest = JSON.stringify({ name: 'fixture', dependencies: { 'fixture-plugin': '1.0.0' },
      dsh: { profile: { bundles: ['fixture-plugin'] } } })
    writeFileSync(join(profile, 'package.json'), manifest)
    writeFileSync(join(plugin, 'package.json'), JSON.stringify({ name: 'fixture-plugin', version: '1.0.0',
      peerDependencies: { '@deepseek-ai/dsh-session': '*' }, dsh: { bundle: { patch: './cordis.patch.yml' } } }))
    writeFileSync(join(plugin, 'cordis.patch.yml'), '[]\n')
    writeFileSync(join(plugin, 'index.js'), 'for (const event of session.events) {}')
    vi.stubEnv('DSH_HOME', home)
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      expect(runPlugin('web', ['doctor'])).toBe(0)
      expect(JSON.parse(String(stdout.mock.calls.at(-1)?.[0]))).toMatchObject({
        status: 'healthy', issues: [{ code: 'profile.session-api-incompatible', severity: 'warning' }],
      })
      expect(readFileSync(join(profile, 'package.json'), 'utf8')).toBe(manifest)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('persists a guarded client Loader quarantine through the internal doctor command', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-plugin-client-loader-quarantine-'))
    const profileDir = join(home, 'profiles', 'web')
    const pluginDir = join(profileDir, 'node_modules', 'dsh-font')
    const pnpmEntry = join(home, 'pnpm-empty-success.mjs')
    mkdirSync(pluginDir, { recursive: true })
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-web',
      private: true,
      dependencies: { 'dsh-font': '1.1.0' },
      dsh: { profile: { bundles: ['dsh-font'] } },
    }))
    writeFileSync(join(pluginDir, 'package.json'), JSON.stringify({
      name: 'dsh-font',
      version: '1.1.0',
      dsh: { bundle: { patch: './dsh.bundle.yml' } },
    }))
    writeFileSync(join(pluginDir, 'dsh.bundle.yml'), '[]\n')
    writeFileSync(pnpmEntry, 'process.exit(0)\n')
    vi.stubEnv('DSH_HOME', home)
    vi.stubEnv('DSH_PNPM_BIN', pnpmEntry)
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      expect(runPlugin('web', [
        'doctor', '--quarantine-client-module',
        'dsh-font', '71626ed6', '@deepseek-ai/dsh-client-runtime/client',
      ])).toBe(11)
      expect(JSON.parse(String(stdout.mock.calls.at(-1)?.[0]))).toMatchObject({
        status: 'quarantined',
        quarantined: [{ packageName: 'dsh-font', reason: 'client-module-unavailable' }],
      })
      expect(JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))).toMatchObject({
        dependencies: {},
        dsh: { profile: { bundles: [] } },
      })
      expect(existsSync(pluginDir)).toBe(false)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('rejects a versioned package in the internal client Loader quarantine command', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-plugin-client-loader-reject-'))
    vi.stubEnv('DSH_HOME', home)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      expect(runPlugin('web', [
        'doctor', '--quarantine-client-module',
        'dsh-font@1.1.0', '71626ed6', '@deepseek-ai/dsh-client-runtime/client',
      ])).toBe(1)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('quarantines a scoped package with a missing unscoped Loader module immediately after add', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-plugin-scoped-loader-mismatch-'))
    const pnpmEntry = join(home, 'pnpm-scoped-loader-mismatch.mjs')
    const packageName = '@dsh-diagnostic-lab/scoped-loader-mismatch'
    writeFileSync(pnpmEntry, `
      import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
      import { dirname, join } from 'node:path'
      const profileDir = process.cwd()
      const manifestPath = join(profileDir, 'package.json')
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      const packageName = ${JSON.stringify(packageName)}
      const packageDir = join(profileDir, 'node_modules', packageName)
      if (process.argv.includes('add')) {
        manifest.dependencies = { ...manifest.dependencies, [packageName]: '1.0.0' }
        mkdirSync(packageDir, { recursive: true })
        writeFileSync(join(packageDir, 'package.json'), JSON.stringify({
          name: packageName,
          version: '1.0.0',
          dsh: { bundle: { patch: './cordis.patch.yml' } },
        }))
        writeFileSync(join(packageDir, 'cordis.patch.yml'), '- insert:\\n  - id: diagnostic-scoped-loader-mismatch\\n    name: diagnostic-scoped-loader-mismatch\\n')
      } else if (manifest.dependencies?.[packageName] === undefined) {
        rmSync(packageDir, { recursive: true, force: true })
      }
      mkdirSync(dirname(manifestPath), { recursive: true })
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\\n')
    `)
    vi.stubEnv('DSH_HOME', home)
    vi.stubEnv('DSH_PNPM_BIN', pnpmEntry)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      expect(runPlugin('web', ['add', `${packageName}@1.0.0`])).toBe(0)
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining('loader-module-unresolvable'))
      const quarantineState = JSON.parse(readFileSync(join(home, 'quarantine', 'profile-plugins.json'), 'utf8')) as unknown
      const profileState = JSON.parse(readFileSync(join(home, 'profiles', 'web', 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>
        dsh?: { profile?: { bundles?: string[] } }
      }
      expect(quarantineState)
        .toMatchObject({ plugins: [{ packageName, reason: 'loader-module-unresolvable' }] })
      expect(profileState.dependencies).toEqual({})
      expect(profileState.dsh?.profile?.bundles).not.toContain(packageName)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('quarantines an aggregate Loader with a missing published dependency immediately after add', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-plugin-loader-dependency-'))
    const pnpmEntry = join(home, 'pnpm-loader-dependency.mjs')
    const packageName = '@dsh-diagnostic-lab/loader-dependency-unavailable'
    writeFileSync(pnpmEntry, `
      import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
      import { dirname, join } from 'node:path'
      const profileDir = process.cwd()
      const manifestPath = join(profileDir, 'package.json')
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      const packageName = ${JSON.stringify(packageName)}
      const packageDir = join(profileDir, 'node_modules', packageName)
      if (process.argv.includes('add')) {
        manifest.dependencies = { ...manifest.dependencies, [packageName]: '1.0.0' }
        mkdirSync(packageDir, { recursive: true })
        writeFileSync(join(packageDir, 'package.json'), JSON.stringify({
          name: packageName,
          version: '1.0.0',
          type: 'module',
          exports: './index.js',
          dsh: { bundle: { patch: './cordis.patch.yml' } },
        }))
        writeFileSync(join(packageDir, 'index.js'), 'import "@deepseek-ai/dsh-diagnostic-missing-host"\\nexport function apply() {}\\n')
        writeFileSync(join(packageDir, 'cordis.patch.yml'), '- insert:\\n  - id: diagnostic-loader-dependency-unavailable\\n    name: "' + packageName + '"\\n')
      } else if (manifest.dependencies?.[packageName] === undefined) {
        rmSync(packageDir, { recursive: true, force: true })
      }
      mkdirSync(dirname(manifestPath), { recursive: true })
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\\n')
    `)
    vi.stubEnv('DSH_HOME', home)
    vi.stubEnv('DSH_PNPM_BIN', pnpmEntry)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      expect(runPlugin('web', ['add', `${packageName}@1.0.0`])).toBe(0)
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining('loader-dependency-unavailable'))
      const quarantineState = JSON.parse(readFileSync(join(home, 'quarantine', 'profile-plugins.json'), 'utf8')) as unknown
      const report = JSON.parse(readFileSync(join(home, 'profile-health', 'web.json'), 'utf8')) as unknown
      expect(quarantineState).toMatchObject({
        plugins: [{ packageName, reason: 'loader-dependency-unavailable' }],
      })
      expect(report).toMatchObject({
        issues: [{
          code: 'loader.dependency-unavailable',
          attribution: {
            rootPackage: packageName,
            missingModule: '@deepseek-ai/dsh-diagnostic-missing-host',
          },
        }],
      })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('rejects a registry add when pnpm exits zero without materializing the requested plugin', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-plugin-empty-success-'))
    const pnpmEntry = join(home, 'pnpm-empty-success.mjs')
    writeFileSync(pnpmEntry, 'process.exit(0)\n')
    vi.stubEnv('DSH_HOME', home)
    vi.stubEnv('DSH_PNPM_BIN', pnpmEntry)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      expect(runPlugin('web', ['add', '@fixture/dsh-plugin@1.2.3'])).toBe(1)
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining(
        'plugin install verification failed: dependency "@fixture/dsh-plugin" was not written',
      ))
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('creates a renderer-safe manual snapshot with desktop runtime metadata', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-plugin-snapshot-cli-'))
    const profileDir = join(home, 'profiles', 'web')
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-web',
      private: true,
      dependencies: { alpha: '1.0.0' },
      dsh: { profile: { bundles: ['alpha'] } },
    }))
    writeFileSync(join(profileDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    writeFileSync(join(profileDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
    vi.stubEnv('DSH_HOME', home)
    vi.stubEnv('DSH_DESKTOP_APPLICATION_VERSION', '0.1.2-alpha.4')
    vi.stubEnv('DSH_DESKTOP_PNPM_VERSION', '11.7.0')
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      expect(runPlugin('web', ['snapshot', 'create', 'Known good'])).toBe(0)
      const snapshotId = readdirSync(join(home, 'plugin-snapshots', 'v1'))
        .find(entry => /^[0-9a-f-]{36}$/u.test(entry))
      expect(snapshotId).toBeDefined()
      if (snapshotId === undefined) throw new Error('manual snapshot directory was not created')
      const record = JSON.parse(readFileSync(
        join(home, 'plugin-snapshots', 'v1', snapshotId, 'snapshot.json'),
        'utf8',
      )) as unknown
      expect(record).toMatchObject({
        label: 'Known good',
        applicationVersion: '0.1.2-alpha.4',
        pnpmVersion: '11.7.0',
        packages: [{ name: 'alpha', source: 'registry', version: '1.0.0' }],
      })
      expect(stdout).toHaveBeenCalledWith(expect.stringContaining('dsh:plugin-snapshot-json'))
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('finalizes a desktop startup snapshot before releasing its mutation lease', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-plugin-startup-lease-'))
    const profileDir = join(home, 'profiles', 'web')
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-web',
      private: true,
      dependencies: { alpha: '1.0.0' },
      dsh: { profile: { bundles: ['alpha'] } },
    }))
    writeFileSync(join(profileDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    writeFileSync(join(profileDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
    vi.stubEnv('DSH_HOME', home)
    vi.stubEnv('DSH_PLUGIN_SNAPSHOT_LEASE_TOKEN', '12345678-1234-4123-8123-123456789abc')
    vi.stubEnv('DSH_PLUGIN_SNAPSHOT_LEASE_OWNER_PID', String(process.pid))
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      expect(runPlugin('web', ['snapshot', 'begin-startup-seed'])).toBe(0)
      const snapshotId = readdirSync(join(home, 'plugin-snapshots', 'v1'))
        .find(entry => /^[0-9a-f-]{36}$/u.test(entry))
      expect(snapshotId).toBeDefined()
      if (snapshotId === undefined) throw new Error('startup snapshot directory was not created')
      expect(runPlugin('web', ['snapshot', 'finalize', snapshotId])).toBe(0)
      expect(existsSync(join(
        home,
        'plugin-snapshots',
        'v1',
        '.profile-plugin-mutation.web.lock',
      ))).toBe(false)
      expect(stdout).toHaveBeenCalledWith(expect.stringContaining(`\"snapshotId\":\"${snapshotId}\"`))
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('preserves a reused startup snapshot when the seed batch makes no change', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-plugin-startup-deduplicated-'))
    const profileDir = join(home, 'profiles', 'web')
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-web',
      private: true,
      dependencies: { alpha: '1.0.0' },
      dsh: { profile: { bundles: ['alpha'] } },
    }))
    writeFileSync(join(profileDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    writeFileSync(join(profileDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
    vi.stubEnv('DSH_HOME', home)
    vi.stubEnv('DSH_PLUGIN_SNAPSHOT_LEASE_TOKEN', '22345678-1234-4123-8123-123456789abc')
    vi.stubEnv('DSH_PLUGIN_SNAPSHOT_LEASE_OWNER_PID', String(process.pid))
    const retained = createProfilePluginSnapshot({
      home, profile: 'web', kind: 'automatic', trigger: 'plugin-update',
    })
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      expect(runPlugin('web', ['snapshot', 'begin-startup-seed'])).toBe(0)
      expect(stdout).toHaveBeenCalledWith(expect.stringContaining('"deduplicated":true'))
      expect(runPlugin('web', [
        'snapshot', 'finalize', retained.snapshotId, '--preserve-if-unchanged',
      ])).toBe(0)
      expect(existsSync(join(
        home, 'plugin-snapshots', 'v1', retained.snapshotId, 'snapshot.json',
      ))).toBe(true)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

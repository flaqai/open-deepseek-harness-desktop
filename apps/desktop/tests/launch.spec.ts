import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  acceptsHarnessInvocationExit,
  resolveDevelopmentLaunchOptions,
  resolveHarnessInvocation,
  resolveHarnessLaunch,
  resolveRuntimePathEnvironment,
} from '../src/launch.ts'

describe('desktop Harness launch', () => {
  it('accepts only explicit signal-free lifecycle exit codes', () => {
    expect(acceptsHarnessInvocationExit(0, null, [0])).toBe(true)
    expect(acceptsHarnessInvocationExit(11, null, [0, 10, 11])).toBe(true)
    expect(acceptsHarnessInvocationExit(1, null, [0, 10, 11])).toBe(false)
    expect(acceptsHarnessInvocationExit(null, 'SIGTERM', [0, 10, 11])).toBe(false)
  })

  it('pins development plugin mutations to the checkout pnpm entry', () => {
    expect(resolveDevelopmentLaunchOptions('/checkout')).toEqual({
      packageManagerBin: join('/checkout', 'apps', 'desktop', 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'),
    })
  })

  it('uses explicit executable overrides without a shell', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-launch-'))
    const harnessBin = join(root, 'bin.js')
    writeFileSync(harnessBin, '')
    expect(resolveHarnessLaunch({
      DSH_DESKTOP_DSH_BIN: harnessBin,
      DSH_DESKTOP_NODE_BIN: '/opt/node/bin/node',
    })).toEqual({
      command: '/opt/node/bin/node',
      args: ['--expose-internals', harnessBin, 'web', '--host', '127.0.0.1', '--port', '0', '--no-open'],
    })
  })

  it('fails before spawning when the Harness launcher is absent', () => {
    expect(() => resolveHarnessLaunch({}, { harnessBin: '/does/not/exist/dsh.js' }))
      .toThrow('Harness launcher not found')
  })

  it('resolves structured plugin lifecycle invocations through the same runtime', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-plugin-launch-'))
    const harnessBin = join(root, 'bin.js')
    writeFileSync(harnessBin, '')
    expect(resolveHarnessInvocation({}, ['plugin', '--profile', 'web', 'remove', 'dshmarket'], {
      harnessBin,
      nodeCommand: '/runtime/node',
    }).args).toEqual(['--expose-internals', harnessBin, 'plugin', '--profile', 'web', 'remove', 'dshmarket'])
  })

  it('passes the selected independent Harness home to lifecycle invocations', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-home-launch-'))
    const harnessBin = join(root, 'bin.js')
    writeFileSync(harnessBin, '')
    expect(resolveHarnessInvocation({ DSH_HOME: '/desktop/dsh-home' }, ['plugin', '--profile', 'web', 'add', 'x'], {
      harnessBin,
    }).environment).toEqual({ DSH_HOME: '/desktop/dsh-home' })
  })

  it('forwards only desktop-owned snapshot, bundled-plugin, and proxy metadata', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-snapshot-launch-'))
    const harnessBin = join(root, 'bin.js')
    writeFileSync(harnessBin, '')
    expect(resolveHarnessInvocation({
      DSH_HOME: '/desktop/dsh-home',
      DSH_DESKTOP_APPLICATION_VERSION: '0.1.2-alpha.4',
      DSH_DESKTOP_PNPM_VERSION: '11.28.5',
      DSH_DESKTOP_CODEX_PROXY: 'http://system.example:8080/',
      DSH_DESKTOP_BUNDLED_PLUGINS_DIR: '/desktop/bundled plugins',
      DSH_PLUGIN_SNAPSHOT_LEASE_TOKEN: 'lease-token',
      DSH_PLUGIN_SNAPSHOT_LEASE_OWNER_PID: '1234',
      DSH_PLUGIN_SNAPSHOT_BATCH: '1',
      HTTPS_PROXY: 'http://127.0.0.1:7890/',
      NO_PROXY: '127.0.0.1,localhost,::1',
      DSH_UNTRUSTED_RENDERER_VALUE: 'must-not-cross',
    }, ['plugin', '--profile', 'web', 'snapshot', 'begin-startup-seed'], {
      harnessBin,
    }).environment).toEqual({
      DSH_HOME: '/desktop/dsh-home',
      DSH_DESKTOP_APPLICATION_VERSION: '0.1.2-alpha.4',
      DSH_DESKTOP_PNPM_VERSION: '11.28.5',
      DSH_DESKTOP_CODEX_PROXY: 'http://system.example:8080/',
      DSH_DESKTOP_BUNDLED_PLUGINS_DIR: '/desktop/bundled plugins',
      DSH_PLUGIN_SNAPSHOT_LEASE_TOKEN: 'lease-token',
      DSH_PLUGIN_SNAPSHOT_LEASE_OWNER_PID: '1234',
      DSH_PLUGIN_SNAPSHOT_BATCH: '1',
      HTTPS_PROXY: 'http://127.0.0.1:7890/',
      NO_PROXY: '127.0.0.1,localhost,::1',
    })
  })

  it('uses the packaged Windows Node executable without Electron compatibility flags', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-packaged-launch-'))
    const harnessBin = join(root, 'bin.js')
    writeFileSync(harnessBin, '')
    expect(resolveHarnessLaunch({}, {
      harnessBin,
      nodeCommand: 'C:\\Program Files\\DeepSeek Harness\\resources\\runtime\\win32-x64\\node.exe',
    })).toEqual({
      command: 'C:\\Program Files\\DeepSeek Harness\\resources\\runtime\\win32-x64\\node.exe',
      args: ['--expose-internals', harnessBin, 'web', '--host', '127.0.0.1', '--port', '0', '--no-open'],
    })
  })

  it('pins the packaged plugin manager and lifecycle PATH to the embedded runtime', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-embedded-runtime-'))
    const harnessBin = join(root, 'bin.js')
    writeFileSync(harnessBin, '')
    expect(resolveHarnessLaunch({ PATH: '/usr/bin:/bin' }, {
      harnessBin,
      nodeCommand: '/runtime/bin/node',
      packageManagerBin: '/runtime/bin/pnpm',
      runtimeBinPath: '/runtime/bin',
    })).toEqual({
      command: '/runtime/bin/node',
      args: ['--expose-internals', harnessBin, 'web', '--host', '127.0.0.1', '--port', '0', '--no-open'],
      environment: {
        DSH_PNPM_BIN: '/runtime/bin/pnpm',
        PATH: `/runtime/bin${process.platform === 'win32' ? ';' : ':'}/usr/bin:/bin`,
      },
    })
  })

  it('preserves the inherited Windows Path spelling and guarantees system executables', () => {
    expect(resolveRuntimePathEnvironment({
      Path: 'C:\\Program Files\\Git\\cmd;C:\\Users\\test user\\AppData\\Local\\Programs\\Cursor\\bin',
      SystemRoot: 'C:\\WINDOWS',
    }, 'D:\\DeepSeek Harness\\resources\\runtime\\win32-x64', 'win32')).toEqual({
      Path: [
        'D:\\DeepSeek Harness\\resources\\runtime\\win32-x64',
        'C:\\WINDOWS\\System32',
        'C:\\WINDOWS',
        'C:\\WINDOWS\\System32\\Wbem',
        'C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0',
        'C:\\Program Files\\Git\\cmd',
        'C:\\Users\\test user\\AppData\\Local\\Programs\\Cursor\\bin',
      ].join(';'),
    })
  })

  it('provides Windows system paths when the inherited PATH is absent', () => {
    expect(resolveRuntimePathEnvironment({
      SystemRoot: 'C:\\Windows',
    }, 'D:\\应用\\runtime', 'win32')).toEqual({
      PATH: [
        'D:\\应用\\runtime',
        'C:\\Windows\\System32',
        'C:\\Windows',
        'C:\\Windows\\System32\\Wbem',
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0',
      ].join(';'),
    })
  })

  it('deduplicates Windows system paths without changing inherited PATH key casing', () => {
    expect(resolveRuntimePathEnvironment({
      PATH: 'C:\\Windows\\System32;C:\\WINDOWS;C:\\Windows\\System32\\Wbem',
      SystemRoot: 'C:\\WINDOWS\\',
    }, 'D:\\runtime', 'win32')).toEqual({
      PATH: [
        'D:\\runtime',
        'C:\\WINDOWS\\System32',
        'C:\\WINDOWS',
        'C:\\WINDOWS\\System32\\Wbem',
        'C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0',
      ].join(';'),
    })
  })

  it('overwrites every inherited Windows PATH spelling with one resolved value', () => {
    const resolved = resolveRuntimePathEnvironment({
      PATH: 'C:\\tools-a',
      Path: 'C:\\tools-b',
      SYSTEMROOT: 'C:\\Windows',
    }, 'D:\\runtime', 'win32')
    expect(resolved.PATH).toBe(resolved.Path)
    expect(resolved.PATH).toContain('C:\\tools-a')
    expect(resolved.PATH).toContain('C:\\tools-b')
  })

  it('passes a packaged pnpm JavaScript entry without composing a command string', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-windows-runtime-'))
    const harnessBin = join(root, 'bin.js')
    writeFileSync(harnessBin, '')
    const pnpmEntry = 'C:\\Program Files\\DeepSeek Harness\\resources\\runtime\\win32-x64\\node_modules\\pnpm\\bin\\pnpm.mjs'
    expect(resolveHarnessLaunch({}, {
      harnessBin,
      nodeCommand: 'C:\\Program Files\\DeepSeek Harness\\resources\\runtime\\win32-x64\\node.exe',
      packageManagerBin: pnpmEntry,
    }).environment).toEqual({ DSH_PNPM_BIN: pnpmEntry })
  })
})

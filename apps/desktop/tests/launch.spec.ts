import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  acceptsHarnessInvocationExit,
  resolveDevelopmentLaunchOptions,
  resolveHarnessInvocation,
  resolveHarnessLaunch,
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
      args: [harnessBin, 'web', '--host', '127.0.0.1', '--port', '0', '--no-open'],
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
    }).args).toEqual([harnessBin, 'plugin', '--profile', 'web', 'remove', 'dshmarket'])
  })

  it('passes the selected independent Harness home to lifecycle invocations', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-home-launch-'))
    const harnessBin = join(root, 'bin.js')
    writeFileSync(harnessBin, '')
    expect(resolveHarnessInvocation({ DSH_HOME: '/desktop/dsh-home' }, ['plugin', '--profile', 'web', 'add', 'x'], {
      harnessBin,
    }).environment).toEqual({ DSH_HOME: '/desktop/dsh-home' })
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
      args: [harnessBin, 'web', '--host', '127.0.0.1', '--port', '0', '--no-open'],
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
      args: [harnessBin, 'web', '--host', '127.0.0.1', '--port', '0', '--no-open'],
      environment: {
        DSH_PNPM_BIN: '/runtime/bin/pnpm',
        PATH: `/runtime/bin${process.platform === 'win32' ? ';' : ':'}/usr/bin:/bin`,
      },
    })
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

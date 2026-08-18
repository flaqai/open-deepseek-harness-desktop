import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveHarnessInvocation, resolveHarnessLaunch } from '../src/launch.ts'

describe('desktop Harness launch', () => {
  it('uses explicit executable overrides without a shell', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-launch-'))
    const harnessBin = join(root, 'bin.js')
    writeFileSync(harnessBin, '')
    expect(resolveHarnessLaunch({
      DSH_DESKTOP_DSH_BIN: harnessBin,
      DSH_DESKTOP_NODE_BIN: '/opt/node/bin/node',
    })).toEqual({
      command: '/opt/node/bin/node',
      args: [harnessBin, 'web', '--host', '127.0.0.1', '--port', '0'],
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

  it('uses the packaged Electron executable as a Node carrier', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-packaged-launch-'))
    const harnessBin = join(root, 'bin.js')
    writeFileSync(harnessBin, '')
    expect(resolveHarnessLaunch({}, {
      harnessBin,
      nodeCommand: 'C:\\Program Files\\DeepSeek Harness\\DeepSeek Harness.exe',
      electronNodeMode: true,
    })).toEqual({
      command: 'C:\\Program Files\\DeepSeek Harness\\DeepSeek Harness.exe',
      args: ['--expose-internals', harnessBin, 'web', '--host', '127.0.0.1', '--port', '0'],
      environment: { ELECTRON_RUN_AS_NODE: '1' },
    })
  })

  it('exposes the packaged production closure through NODE_PATH', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-packaged-modules-'))
    const harnessBin = join(root, 'bin.js')
    writeFileSync(harnessBin, '')
    expect(resolveHarnessLaunch({}, {
      harnessBin,
      nodeCommand: 'DeepSeek Harness.exe',
      electronNodeMode: true,
      dependenciesPath: 'C:\\Program Files\\DeepSeek Harness\\resources\\harness-runtime\\runtime-dependencies',
    }).environment).toEqual({
      ELECTRON_RUN_AS_NODE: '1',
      NODE_PATH: 'C:\\Program Files\\DeepSeek Harness\\resources\\harness-runtime\\runtime-dependencies',
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
      args: [harnessBin, 'web', '--host', '127.0.0.1', '--port', '0'],
      environment: {
        DSH_PNPM_BIN: '/runtime/bin/pnpm',
        PATH: `/runtime/bin${process.platform === 'win32' ? ';' : ':'}/usr/bin:/bin`,
      },
    })
  })
})

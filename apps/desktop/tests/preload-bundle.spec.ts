import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'tsdown'
import { expect, it, vi } from 'vitest'
import configs from '../tsdown.preload.config.ts'

it('boots every bundled preload before DOM globals are available with only Electron available to sandbox require', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'dsh-preload-bundle-'))
  try {
    if (!Array.isArray(configs)) throw new Error('Expected separate preload build configurations')
    for (const config of configs) {
      const entries = Array.isArray(config.entry) ? config.entry : [config.entry]
      if (!entries.every((entry): entry is string => typeof entry === 'string')) {
        throw new Error('Expected preload entry paths')
      }
      await build({
        ...config,
        config: false,
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        entry: entries.map(entry => entry.replace(/^lib\//u, 'src/').replace(/\.js$/u, '.ts')),
        outDir,
        logLevel: 'silent',
      })
    }
    for (const name of ['preload', 'data-home-preload', 'titlebar-preload']) {
      const addEventListener = vi.fn()
      const exposeInMainWorld = vi.fn()
      const invoke = vi.fn(() => Promise.resolve({ error: '' }))
      const require = vi.fn((id: string) => {
        if (id !== 'electron') throw new Error(`Sandbox cannot require ${id}`)
        return { contextBridge: { exposeInMainWorld }, ipcRenderer: { invoke } }
      })
      runInNewContext(await readFile(join(outDir, `${name}.cjs`), 'utf8'), {
        require, window: { addEventListener }, location: { protocol: 'dsh-app:', hostname: 'app' },
        process: { platform: 'darwin', argv: [] },
      }, { timeout: 1000 })
      expect(require).toHaveBeenCalledWith('electron')
      expect(addEventListener).toHaveBeenCalledWith('DOMContentLoaded', expect.any(Function), { once: true })
      if (name === 'preload') {
        expect(exposeInMainWorld).toHaveBeenCalledWith('deepSeekHarnessDesktop', expect.any(Object))
        const shortcuts = exposeInMainWorld.mock.calls.find(([name]) => name === 'dshDesktop')?.[1] as {
          protocolVersion: number
          shortcuts: { get(definitions: readonly object[]): Promise<object> }
        }
        expect(shortcuts.protocolVersion).toBe(1)
        await shortcuts.shortcuts.get([])
        expect(invoke).toHaveBeenCalledWith('dsh:desktop:shortcuts:get', [])
        const exposed = exposeInMainWorld.mock.calls.find(([name]) => name === 'deepSeekHarnessDesktop')?.[1] as {
          shell: { openLogDirectory(): Promise<{ error: string }> }
        }
        expect(Object.keys(exposed)).toEqual([
          'menu', 'shell', 'releases', 'nas', 'desktopWeb', 'workspaceRuntimes', 'icons', 'downloadNetwork',
          'bundledPlugins', 'externalTools', 'importedPlugins', 'diagnosticLab', 'pluginSnapshots', 'startupDiagnostics', 'processes',
          'chatBackground',
        ])
        expect(exposed).not.toHaveProperty('invoke')
        expect(exposed).not.toHaveProperty('send')
        expect(Object.isFrozen(exposed)).toBe(true)
        await expect(exposed.shell.openLogDirectory()).resolves.toEqual({ error: '' })
        expect(invoke).toHaveBeenCalledWith('dsh:desktop:log-directory:open')

        const remoteExposeInMainWorld = vi.fn()
        const remoteRequire = vi.fn((id: string) => {
          if (id !== 'electron') throw new Error(`Sandbox cannot require ${id}`)
          return { contextBridge: { exposeInMainWorld: remoteExposeInMainWorld }, ipcRenderer: { invoke } }
        })
        runInNewContext(await readFile(join(outDir, `${name}.cjs`), 'utf8'), {
          require: remoteRequire,
          window: { addEventListener: vi.fn() },
          location: { protocol: 'https:', hostname: 'nas.example.test' },
          process: { platform: 'darwin', argv: ['--dsh-nas-runtime'] },
        }, { timeout: 1000 })
        const remoteShortcuts = remoteExposeInMainWorld.mock.calls.find(([name]) => name === 'dshDesktop')?.[1] as Record<string, unknown>
        expect(Object.keys(remoteShortcuts)).toEqual(['protocolVersion', 'keyboard', 'shortcuts'])
        const remoteExposed = remoteExposeInMainWorld.mock.calls.find(([name]) => name === 'deepSeekHarnessDesktop')?.[1] as {
          shell: Record<string, unknown>
        } & Record<string, unknown>
        expect(Object.keys(remoteExposed)).toEqual(['menu', 'shell', 'releases', 'nas', 'desktopWeb', 'workspaceRuntimes'])
        expect(Object.keys(remoteExposed.shell)).toEqual([
          'getCapabilities', 'getPreferences', 'updatePreferences', 'onPreferences', 'restart', 'reportReadiness',
        ])
        expect(remoteExposed.shell).not.toHaveProperty('openLog')
        expect(remoteExposed.shell).not.toHaveProperty('openLogDirectory')
        expect(remoteExposed.shell).not.toHaveProperty('openSettingsDocument')
        expect(remoteExposed.shell).not.toHaveProperty('getCommandLine')
        expect(remoteExposed.shell).not.toHaveProperty('enterRecoveryMode')
        expect(remoteExposed).not.toHaveProperty('icons')
        expect(remoteExposed).not.toHaveProperty('downloadNetwork')
        const remoteWorkspaceRuntimes = remoteExposed.workspaceRuntimes as {
          get(): Promise<{ capabilities: { office: { phase: string }; ptc: { phase: string } } }>
          start(capability: string): Promise<never>
        }
        await expect(remoteWorkspaceRuntimes.get()).resolves.toMatchObject({
          capabilities: { office: { phase: 'nas-unavailable' }, ptc: { phase: 'nas-unavailable' } },
        })
        await expect(remoteWorkspaceRuntimes.start('office')).rejects.toThrow(/local runtime/u)
      }
    }
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
}, 20_000)

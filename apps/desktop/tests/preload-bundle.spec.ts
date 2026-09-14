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
        require, window: { addEventListener }, process: { platform: 'darwin', argv: [] },
      }, { timeout: 1000 })
      expect(require).toHaveBeenCalledWith('electron')
      expect(addEventListener).toHaveBeenCalledWith('DOMContentLoaded', expect.any(Function), { once: true })
      if (name === 'preload') {
        expect(exposeInMainWorld).toHaveBeenCalledWith('deepSeekHarnessDesktop', expect.any(Object))
        const exposed = exposeInMainWorld.mock.calls[0]?.[1] as {
          shell: { openLogDirectory(): Promise<{ error: string }> }
        }
        await expect(exposed.shell.openLogDirectory()).resolves.toEqual({ error: '' })
        expect(invoke).toHaveBeenCalledWith('dsh:desktop:log-directory:open')
      }
    }
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
}, 20_000)

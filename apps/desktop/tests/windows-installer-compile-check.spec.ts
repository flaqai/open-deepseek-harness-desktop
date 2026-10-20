import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execute = promisify(execFile)
const compileScript = fileURLToPath(new URL('../scripts/windows-installer-compile-check.mjs', import.meta.url))

describe.skipIf(process.env.DSH_TEST_NSIS_COMPILE !== '1')('production Windows installer compilation', () => {
  it('compiles the installer and embedded uninstaller without launching either', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-nsis-compile-'))
    try {
      const result = await execute(process.execPath, [compileScript, directory], {
        timeout: 180_000, maxBuffer: 4 * 1024 * 1024,
      })
      expect(result.stdout).toContain('compile-only-windows-x64.exe')
      const report = JSON.parse(result.stdout.slice(result.stdout.lastIndexOf('\n{') + 1)) as { installers: string[] }
      const executable = report.installers.find(file => file.endsWith('.exe'))
      expect(executable).toBeDefined()
      if (!executable) throw new Error('NSIS compilation did not emit an installer')
      expect((await readFile(executable)).subarray(0, 2).toString()).toBe('MZ')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }, 190_000)
})

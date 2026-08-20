import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { revealHarnessLog } from '../src/log-reveal.ts'

describe('Harness log reveal', () => {
  it('reveals an existing fixed log and opens only the parent when absent', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-log-reveal-'))
    const logPath = join(directory, 'harness.log')
    const shell = { showItemInFolder: vi.fn(), openPath: vi.fn(() => Promise.resolve('')) }
    try {
      expect(await revealHarnessLog(logPath, shell)).toEqual({ kind: 'directory', error: '' })
      expect(shell.openPath).toHaveBeenCalledWith(directory)
      writeFileSync(logPath, 'ready\n', 'utf8')
      expect(await revealHarnessLog(logPath, shell)).toEqual({ kind: 'file', error: '' })
      expect(shell.showItemInFolder).toHaveBeenCalledWith(logPath)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

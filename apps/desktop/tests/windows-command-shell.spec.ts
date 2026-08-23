import { describe, expect, it } from 'vitest'
import { requiresWindowsCommandShell } from '../scripts/windows-command-shell.mjs'

describe('Windows command shell selection', () => {
  it('uses the shell only for Windows command-script launchers', () => {
    expect(requiresWindowsCommandShell('win32', 'pnpm.cmd')).toBe(true)
    expect(requiresWindowsCommandShell('win32', 'setup.BAT')).toBe(true)
    expect(requiresWindowsCommandShell('win32', 'node.exe')).toBe(false)
    expect(requiresWindowsCommandShell('darwin', 'pnpm.cmd')).toBe(false)
  })
})

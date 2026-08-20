/** Safe reveal behavior for the desktop Harness log. */

import { existsSync } from 'node:fs'
import { dirname } from 'node:path'

/** Result returned through the preload bridge. */
export interface OpenLogResult {
  kind: 'file' | 'directory'
  error: string
}

/** Minimal Electron shell operations used to reveal a known log path. */
export interface LogRevealShell {
  showItemInFolder(path: string): void
  openPath(path: string): Promise<string>
}

/** Reveal the fixed Harness log, falling back to its parent directory. */
export async function revealHarnessLog(logPath: string, shell: LogRevealShell): Promise<OpenLogResult> {
  if (existsSync(logPath)) {
    shell.showItemInFolder(logPath)
    return { kind: 'file', error: '' }
  }
  return { kind: 'directory', error: await shell.openPath(dirname(logPath)) }
}

/** Stable Windows command shims for the Electron-hosted Node and bundled pnpm. */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface WindowsRuntimeTools {
  readonly directory: string
  readonly nodeCommand: string
  readonly packageManagerBin: string
}

function quoteBatch(value: string): string {
  if (/[\r\n"]/u.test(value)) throw new TypeError('desktop: unsafe path for Windows runtime shim')
  return `"${value}"`
}

/** Materialize non-shell-facing launchers used by pnpm lifecycle subprocesses. */
export async function ensureWindowsRuntimeTools(
  directory: string,
  electronExecutable: string,
  pnpmEntry: string,
): Promise<WindowsRuntimeTools> {
  await mkdir(directory, { recursive: true })
  const nodeCommand = join(directory, 'node.cmd')
  const packageManagerBin = join(directory, 'pnpm.cmd')
  const prefix = '@echo off\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n'
  await writeFile(nodeCommand, `${prefix}${quoteBatch(electronExecutable)} --expose-internals %*\r\n`)
  await writeFile(packageManagerBin, `${prefix}${quoteBatch(electronExecutable)} --expose-internals ${quoteBatch(pnpmEntry)} %*\r\n`)
  return { directory, nodeCommand, packageManagerBin }
}

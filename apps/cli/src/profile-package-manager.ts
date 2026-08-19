/** Host-selected pnpm execution for profile dependency maintenance. */

import { spawnSync } from 'node:child_process'
import { isAbsolute } from 'node:path'
import type { ProfilePackageManagerResult } from '@deepseek-ai/dsh-app-boot'

const NAME = 'dsh'

/**
 * Resolve the pnpm executable selected by the host process.
 * @param environment - environment inherited by the CLI.
 * @returns the configured absolute executable or the ordinary PATH name.
 */
export function resolvePnpmCommand(environment: NodeJS.ProcessEnv): string {
  const configured = environment.DSH_PNPM_BIN?.trim()
  if (configured === undefined || configured.length === 0) return 'pnpm'
  if (!isAbsolute(configured)) {
    throw new Error(`${NAME}: DSH_PNPM_BIN must be an absolute path, received ${configured}`)
  }
  return configured
}

/**
 * Run pnpm in one profile and retain bounded diagnostics for automatic repair.
 * @param profileDir - profile working directory.
 * @param args - exact pnpm arguments.
 * @returns exit code and combined output; an absent executable reports code 127.
 */
export function runProfilePackageManager(
  profileDir: string,
  args: readonly string[],
): ProfilePackageManagerResult {
  const pnpmCommand = resolvePnpmCommand(process.env)
  const result = spawnSync(pnpmCommand, [...args], {
    cwd: profileDir,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    shell: process.platform === 'win32',
  })
  if (result.error !== undefined) {
    const code = (result.error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      const location = pnpmCommand === 'pnpm' ? 'on PATH' : `at ${pnpmCommand}`
      return { exitCode: 127, diagnostic: `${NAME}: pnpm not found ${location}` }
    }
    throw result.error
  }
  const diagnostic = [result.stdout, result.stderr].filter(value => value.trim() !== '').join('\n').trim()
  return {
    exitCode: result.status ?? 1,
    ...(diagnostic === '' ? {} : { diagnostic: diagnostic.slice(-64 * 1024) }),
  }
}

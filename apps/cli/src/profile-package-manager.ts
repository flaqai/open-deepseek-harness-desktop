/** Host-selected pnpm execution for profile dependency maintenance. */

import { spawnSync } from 'node:child_process'
import { extname, isAbsolute } from 'node:path'
import type { ProfilePackageManagerResult } from '@deepseek-ai/dsh-app-boot'

const NAME = 'dsh'

/**
 * Recover pnpm's human-readable Git prepare diagnostic when an NDJSON reporter
 * has JSON-escaped it. Third-party callers can then recognize the existing
 * pnpm approval flow without needing to parse a reporter-specific envelope.
 */
export function normalizePnpmDiagnostic(diagnostic: string): string {
  if (!diagnostic.includes('ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED')) return diagnostic
  const readable = diagnostic.replaceAll('\\"', '"')
  const match = /The git-hosted package "([^"\r\n]+)" needs to execute build scripts/.exec(readable)
  if (match === null) return diagnostic
  const canonical = `The git-hosted package "${match[1]}" needs to execute build scripts but is not in the "allowBuilds" allowlist.`
  // Keep pnpm's raw output for support, but append one plain line. This is
  // intentionally a compatibility bridge in DSH, not a change to dshmarket.
  return diagnostic.includes(canonical) ? diagnostic : `${diagnostic}\n${NAME}: ${canonical}`
}

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

/** Exact process invocation for one pnpm operation. */
export interface PnpmInvocation {
  readonly command: string
  readonly args: string[]
  readonly shell: boolean
}

/**
 * Resolve pnpm without interpolating packaged paths into a Windows shell command.
 * @param environment - Environment carrying an optional host-owned pnpm entry.
 * @param args - Arguments forwarded to pnpm.
 * @returns Executable, argument vector, and whether an ordinary Windows shim needs a shell.
 */
export function resolvePnpmInvocation(environment: NodeJS.ProcessEnv, args: readonly string[]): PnpmInvocation {
  const pnpmCommand = resolvePnpmCommand(environment)
  if (extname(pnpmCommand).toLowerCase() === '.mjs') {
    return { command: process.execPath, args: [pnpmCommand, ...args], shell: false }
  }
  return {
    command: pnpmCommand,
    args: [...args],
    shell: process.platform === 'win32',
  }
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
  const invocation = resolvePnpmInvocation(process.env, args)
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: profileDir,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    shell: invocation.shell,
  })
  if (result.error !== undefined) {
    const code = (result.error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      const location = invocation.command === 'pnpm' ? 'on PATH' : `at ${invocation.command}`
      return { exitCode: 127, diagnostic: `${NAME}: pnpm not found ${location}` }
    }
    throw result.error
  }
  const diagnostic = normalizePnpmDiagnostic([result.stdout, result.stderr].filter(value => value.trim() !== '').join('\n').trim())
  return {
    exitCode: result.status ?? 1,
    ...(diagnostic === '' ? {} : { diagnostic: diagnostic.slice(-64 * 1024) }),
  }
}

/** Host-selected pnpm execution for profile dependency maintenance. */

import { spawnSync } from 'node:child_process'
import { extname, isAbsolute } from 'node:path'
import { allowProfilePackageBuild, type ProfilePackageManagerResult } from '@deepseek-ai/dsh-app-boot'

const NAME = 'dsh'

function diagnosticStrings(value: unknown, output: string[]): void {
  if (typeof value === 'string') {
    output.push(value)
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) diagnosticStrings(entry, output)
    return
  }
  if (value === null || typeof value !== 'object') return
  for (const entry of Object.values(value)) diagnosticStrings(entry, output)
}

/**
 * Read the exact dependency path from pnpm's Git prepare allowBuilds hint.
 * @param diagnostic - Combined pnpm output, including an optional NDJSON reporter envelope.
 * @returns The exact allowBuilds key, or undefined for unrelated and incomplete failures.
 */
export function extractGitPrepareBuildKey(diagnostic: string): string | undefined {
  const retained = /^dsh: pnpm allowBuilds key (".*")$/mu.exec(diagnostic)
  if (retained?.[1] !== undefined) {
    try {
      const value: unknown = JSON.parse(retained[1])
      if (typeof value === 'string') return value
    } catch {
      // Continue with pnpm's reporter payload when a retained line is malformed.
    }
  }
  if (!diagnostic.includes('ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED')) return undefined
  const candidates = [diagnostic, diagnostic.replaceAll('\\n', '\n').replaceAll('\\"', '"')]
  for (const line of diagnostic.split(/\r?\n/u)) {
    try {
      diagnosticStrings(JSON.parse(line) as unknown, candidates)
    } catch {
      // A reporter may mix ordinary text with NDJSON; only complete JSON lines add candidates.
    }
  }
  for (const candidate of candidates) {
    const match = /allowBuilds:\s*\r?\n\s+(.+?):\s*true(?=\r?\n|["},]|$)/u.exec(candidate)
    if (match?.[1] !== undefined) return match[1].trim()
  }
  return undefined
}

/**
 * Recover pnpm's human-readable Git prepare diagnostic when an NDJSON reporter
 * has JSON-escaped it. Third-party callers can then recognize the existing
 * pnpm approval flow without needing to parse a reporter-specific envelope.
 */
export function normalizePnpmDiagnostic(diagnostic: string): string {
  if (!diagnostic.includes('ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED')) return diagnostic
  const readable = diagnostic.replaceAll('\\"', '"')
  const match = /The git-hosted package "([^"\r\n]+)" needs to execute build scripts/.exec(readable)
  const canonical = match === null
    ? undefined
    : `The git-hosted package "${match[1]}" needs to execute build scripts but is not in the "allowBuilds" allowlist.`
  const packageBuildKey = extractGitPrepareBuildKey(diagnostic)
  const retained = packageBuildKey === undefined
    ? undefined
    : `${NAME}: pnpm allowBuilds key ${JSON.stringify(packageBuildKey)}`
  const additions = [
    ...(canonical === undefined || diagnostic.includes(canonical) ? [] : [`${NAME}: ${canonical}`]),
    ...(retained === undefined || diagnostic.includes(retained) ? [] : [retained]),
  ]
  // Append bounded, reporter-independent facts before the caller keeps the
  // diagnostic tail; large pnpm stacks must not discard the exact retry key.
  return additions.length === 0 ? diagnostic : `${diagnostic}\n${additions.join('\n')}`
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

/**
 * Run an explicit profile operation and retry one Git add after recording pnpm's exact build key.
 * @param profileDir - Profile working directory and owner of pnpm-workspace.yaml.
 * @param args - Exact pnpm arguments.
 * @returns The first result, or the single retry result with a concise approval diagnostic.
 */
export function runProfilePackageManagerWithGitBuildApproval(
  profileDir: string,
  args: readonly string[],
): ProfilePackageManagerResult {
  const first = runProfilePackageManager(profileDir, args)
  if (first.exitCode === 0 || args[0] !== 'add' || first.diagnostic === undefined) return first
  const packageBuildKey = extractGitPrepareBuildKey(first.diagnostic)
  if (packageBuildKey === undefined) return first
  let allowance
  try {
    allowance = allowProfilePackageBuild(profileDir, packageBuildKey)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { exitCode: first.exitCode, diagnostic: `${first.diagnostic}\n${NAME}: ${message}` }
  }
  if (allowance !== 'added') return first
  const retry = runProfilePackageManager(profileDir, args)
  const approval = `${NAME}: allowed reviewed Git build ${JSON.stringify(packageBuildKey)} in ${profileDir} and retried installation`
  return {
    exitCode: retry.exitCode,
    diagnostic: [
      approval,
      ...(retry.exitCode === 0 ? [] : [first.diagnostic]),
      ...(retry.diagnostic === undefined ? [] : [retry.diagnostic]),
    ].join('\n'),
  }
}

/** Host-selected pnpm execution for profile dependency maintenance. */

import { spawnSync } from 'node:child_process'
import { dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { existsSync, readFileSync } from 'node:fs'
import { rebindProfilePnpmStore } from './profile-pnpm-store.ts'
import type { ProfilePackageManagerResult } from '@deepseek-ai/dsh-app-boot'
import { packageNetworkDiagnostic } from './package-network-diagnostic.ts'
import { profilePackageManagerLeaseEnvironment } from './profile-package-manager-lease.ts'

const NAME = 'dsh'
const WINDOWS_PNPM_RENAME_RETRY_DELAYS_MS = [500, 1_500, 3_000] as const

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
 * Read one unambiguous registry package from pnpm's strict ignored-builds error.
 * Multiple blocked packages deliberately return undefined so the UI cannot
 * turn one confirmation into a broader build-script grant.
 * @param diagnostic - Combined pnpm reporter output.
 * @returns One exact registry package name, or undefined when the failure is ambiguous.
 */
export function extractIgnoredBuildKey(diagnostic: string): string | undefined {
  if (!diagnostic.includes('ERR_PNPM_IGNORED_BUILDS')) return undefined
  const candidates = [diagnostic, diagnostic.replaceAll('\\n', '\n').replaceAll('\\"', '"')]
  for (const line of diagnostic.split(/\r?\n/u)) {
    try {
      diagnosticStrings(JSON.parse(line) as unknown, candidates)
    } catch {
      // A reporter may mix ordinary text with NDJSON.
    }
  }
  for (const candidate of candidates) {
    const listed = /Ignored build scripts:\s*([^\r\n"}]+)/u.exec(candidate)?.[1]
    if (listed === undefined) continue
    const names = listed.split(',').map(value => value.trim()).filter(Boolean)
    if (names.length !== 1) return undefined
    const [name] = names
    if (name === undefined) continue
    if (/^(?:@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)$/iu.test(name)) {
      return name
    }
  }
  return undefined
}

/**
 * Recover pnpm's human-readable Git prepare diagnostic when an NDJSON reporter
 * has JSON-escaped it. Third-party callers can then recognize the existing
 * pnpm approval flow without needing to parse a reporter-specific envelope.
 */
export function normalizePnpmDiagnostic(diagnostic: string): string {
  if (!diagnostic.includes('ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED')
    && !diagnostic.includes('ERR_PNPM_IGNORED_BUILDS')) return diagnostic
  const readable = diagnostic.replaceAll('\\"', '"')
  const match = /The git-hosted package "([^"\r\n]+)" needs to execute build scripts/.exec(readable)
  const canonical = match === null
    ? undefined
    : `The git-hosted package "${match[1]}" needs to execute build scripts but is not in the "allowBuilds" allowlist.`
  const packageBuildKey = extractGitPrepareBuildKey(diagnostic) ?? extractIgnoredBuildKey(diagnostic)
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
 * Recognize pnpm's transient Windows directory-swap failure without treating
 * an ordinary permission error as recoverable.
 * @param diagnostic - Combined pnpm output.
 * @param platform - Platform that executed pnpm.
 * @returns Whether pnpm failed while renaming its own temporary node_modules directory.
 */
export function isWindowsPnpmRenameContention(
  diagnostic: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== 'win32') return false
  return /ERR_PNPM_EPERM/iu.test(diagnostic)
    && /EPERM:\s*operation not permitted,\s*rename/iu.test(diagnostic)
    && /node_modules[\\/]/iu.test(diagnostic)
    && /_tmp_\d+_\d+(?:[\\/'"\s]|$)/iu.test(diagnostic)
}

/**
 * Select the next bounded delay for a transient Windows pnpm rename failure.
 * @param diagnostic - Combined pnpm output.
 * @param completedRetries - Number of retries already attempted.
 * @param platform - Platform that executed pnpm.
 * @returns Delay before the next retry, or undefined when the failure is not retryable or the budget is exhausted.
 */
export function windowsPnpmRenameRetryDelay(
  diagnostic: string,
  completedRetries: number,
  platform: NodeJS.Platform = process.platform,
): number | undefined {
  if (!isWindowsPnpmRenameContention(diagnostic, platform)) return undefined
  if (!Number.isInteger(completedRetries) || completedRetries < 0) return undefined
  return WINDOWS_PNPM_RENAME_RETRY_DELAYS_MS[completedRetries]
}

function waitSynchronously(delayMs: number): void {
  const signal = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))
  Atomics.wait(signal, 0, 0, delayMs)
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

/** Resolve desktop-owned package download settings for one pnpm operation. */
export function profilePackageDownloadEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const resolved = { ...environment }
  const networkFile = environment.DSH_DESKTOP_DOWNLOAD_NETWORK_FILE?.trim()
  let networkRevision: number | undefined
  if (networkFile !== undefined && networkFile !== '') {
    try {
      const raw = JSON.parse(readFileSync(networkFile, 'utf8')) as { revision?: unknown; npm?: { registry?: unknown; registryUrl?: unknown } }
      if (Number.isSafeInteger(raw.revision) && Number(raw.revision) >= 0) networkRevision = Number(raw.revision)
      const registry = raw.npm?.registry === 'npmjs' ? 'https://registry.npmjs.org'
        : raw.npm?.registry === 'npmmirror' ? 'https://registry.npmmirror.com'
          : raw.npm?.registry === 'custom' && typeof raw.npm.registryUrl === 'string' ? raw.npm.registryUrl : undefined
      if (registry !== undefined) resolved.npm_config_registry = registry
    } catch {
      // The desktop validates and atomically replaces this file. Preserve the inherited registry if it cannot be read.
    }
  }
  const packageProxy = environment.DSH_DESKTOP_PACKAGE_PROXY_URL?.trim()
  if (packageProxy !== undefined && packageProxy !== '') {
    let operationProxy = packageProxy
    if (networkRevision !== undefined) {
      const parsed = new URL(packageProxy)
      parsed.username = `plugins-${networkRevision}`
      operationProxy = parsed.href.replace(/\/$/u, '')
    }
    resolved.npm_config_proxy = operationProxy
    resolved.npm_config_https_proxy = operationProxy
    resolved.npm_config_noproxy = ''
    resolved.HTTP_PROXY = operationProxy
    resolved.HTTPS_PROXY = operationProxy
    resolved.NO_PROXY = ''
  }
  return resolved
}

/**
 * Run pnpm in one profile and retain bounded diagnostics for automatic repair.
 * Package-manager subprocesses stay hidden on Windows because desktop callers
 * invoke this path without an attached terminal.
 * @param profileDir - profile working directory.
 * @param args - exact pnpm arguments.
 * @returns exit code and combined output; an absent executable reports code 127.
 */
export function runProfilePackageManager(
  profileDir: string,
  args: readonly string[],
): ProfilePackageManagerResult {
  const packageEnvironment = profilePackageDownloadEnvironment(process.env)
  const tracked = profilePackageManagerLeaseEnvironment(profileDir, packageEnvironment)
  const storeDir = tracked.pnpm_config_store_dir ?? join(resolveDshHome(), '.pnpm-store')
  const invocation = resolvePnpmInvocation(packageEnvironment, ['--store-dir', storeDir, ...args])
  const inherited = Object.fromEntries(Object.entries(tracked)
    .filter(([key]) => !/^(?:pnpm|npm)_config_store_dir$/iu.test(key)))
  const environment = {
    ...inherited, pnpm_config_store_dir: storeDir, npm_config_store_dir: storeDir,
  }
  if (existsSync(join(profileDir, 'node_modules', '.modules.yaml'))) {
    const probe = resolvePnpmInvocation(environment, ['--store-dir', storeDir, 'store', 'path', '--silent'])
    const result = spawnSync(probe.command, probe.args, {
      cwd: profileDir, env: environment, encoding: 'utf8', maxBuffer: 64 * 1024,
      timeout: 15_000, shell: probe.shell, windowsHide: true,
    })
    if (result.error !== undefined || result.status !== 0) {
      return { exitCode: result.status || 1, diagnostic: 'dsh: could not resolve the configuration-local pnpm store; existing dependencies were preserved' }
    }
    const versionedStore = result.stdout.trim()
    if (resolve(dirname(versionedStore)) !== resolve(storeDir)) {
      return { exitCode: 1, diagnostic: 'dsh: pnpm resolved a store outside the configuration directory; existing dependencies were preserved' }
    }
    rebindProfilePnpmStore(profileDir, versionedStore)
  }
  const recoveryDiagnostics: string[] = []
  let completedRetries = 0
  while (true) {
    const startedAt = performance.now()
    const result = spawnSync(invocation.command, invocation.args, {
      cwd: profileDir,
      env: environment,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      shell: invocation.shell,
      windowsHide: true,
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
    const delayMs = result.status === 0
      ? undefined
      : windowsPnpmRenameRetryDelay(diagnostic, completedRetries)
    if (delayMs !== undefined) {
      completedRetries += 1
      recoveryDiagnostics.push(
        `${NAME}: pnpm hit transient Windows node_modules rename contention; retrying in ${String(delayMs)} ms (${String(completedRetries)}/${String(WINDOWS_PNPM_RENAME_RETRY_DELAYS_MS.length)})`,
      )
      waitSynchronously(delayMs)
      continue
    }
    if (result.status !== 0 && isWindowsPnpmRenameContention(diagnostic) && completedRetries > 0) {
      recoveryDiagnostics.push(
        `${NAME}: Windows kept the pnpm node_modules destination locked after ${String(completedRetries)} retries`,
      )
    }
    const networkHint = result.status === 0
      ? undefined
      : packageNetworkDiagnostic(diagnostic, performance.now() - startedAt, process.env)
    const retainedDiagnostic = [diagnostic, ...recoveryDiagnostics, networkHint].filter(Boolean).join('\n')
    return {
      exitCode: result.status ?? 1,
      ...(retainedDiagnostic === '' ? {} : { diagnostic: retainedDiagnostic.slice(-64 * 1024) }),
    }
  }
}

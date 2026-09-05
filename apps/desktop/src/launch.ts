/** Resolve the local Harness process used by the Electron host. */

import { existsSync } from 'node:fs'
import { join, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Executable and arguments for one Harness child process. */
export interface HarnessLaunch {
  command: string
  args: string[]
  environment?: NodeJS.ProcessEnv
  cwd?: string
}

/** Environment variables accepted by {@link resolveHarnessLaunch}. */
export interface DesktopLaunchEnvironment {
  [key: string]: string | undefined
  DSH_HOME?: string
  DSH_DESKTOP_DSH_BIN?: string
  DSH_DESKTOP_NODE_BIN?: string
  PATH?: string
}

/** Desktop-owned values a bounded CLI child must receive in addition to DSH_HOME. */
const HARNESS_INVOCATION_ENVIRONMENT = [
  'DSH_DESKTOP_CODEX_PROXY',
  'DSH_DESKTOP_APPLICATION_VERSION',
  'DSH_DESKTOP_PNPM_VERSION',
  'DSH_DESKTOP_BUNDLED_PLUGINS_DIR',
  'DSH_PLUGIN_SNAPSHOT_LEASE_TOKEN',
  'DSH_PLUGIN_SNAPSHOT_LEASE_OWNER_PID',
  'DSH_PLUGIN_SNAPSHOT_BATCH',
  'DSH_PROFILE_SAFE_MODE_ON_FAILURE',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
] as const

function environmentEntries(
  environment: DesktopLaunchEnvironment,
  name: string,
  platform: NodeJS.Platform,
): Array<[string, string]> {
  const matches: Array<[string, string]> = []
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) continue
    const matchesName = platform === 'win32'
      ? key.toUpperCase() === name.toUpperCase()
      : key === name
    if (matchesName) matches.push([key, value])
  }
  return matches
}

function windowsPathIdentity(entry: string): string {
  const unquoted = entry.trim().replace(/^"|"$/gu, '')
  return win32.normalize(unquoted).replace(/[\\/]+$/u, '').toLowerCase()
}

function uniqueWindowsPathEntries(entries: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const entry of entries) {
    if (entry.trim() === '') continue
    const identity = windowsPathIdentity(entry)
    if (seen.has(identity)) continue
    seen.add(identity)
    result.push(entry)
  }
  return result
}

/**
 * Build the PATH override used by packaged runtime and plugin child processes.
 * @param environment - Environment inherited by the Electron host.
 * @param runtimeBinPath - Embedded runtime directory that must take precedence.
 * @param platform - Target process platform whose environment rules apply.
 * @returns PATH entries keyed to overwrite every inherited spelling of PATH.
 */
export function resolveRuntimePathEnvironment(
  environment: DesktopLaunchEnvironment,
  runtimeBinPath: string,
  platform: NodeJS.Platform,
): NodeJS.ProcessEnv {
  const pathEntries = environmentEntries(environment, 'PATH', platform)
  if (platform !== 'win32') {
    const inheritedPath = pathEntries[0]?.[1]
    return {
      PATH: inheritedPath === undefined || inheritedPath.length === 0
        ? runtimeBinPath
        : `${runtimeBinPath}:${inheritedPath}`,
    }
  }

  const systemRoot = environmentEntries(environment, 'SystemRoot', platform)[0]?.[1]
    ?? environmentEntries(environment, 'WINDIR', platform)[0]?.[1]
  const normalizedSystemRoot = systemRoot?.trim().replace(/[\\/]+$/u, '')
  const systemEntries = normalizedSystemRoot === undefined || normalizedSystemRoot === ''
    ? []
    : [
      win32.join(normalizedSystemRoot, 'System32'),
      normalizedSystemRoot,
      win32.join(normalizedSystemRoot, 'System32', 'Wbem'),
      win32.join(normalizedSystemRoot, 'System32', 'WindowsPowerShell', 'v1.0'),
    ]
  const inheritedEntries = pathEntries.flatMap(([, value]) => value.split(';'))
  const value = uniqueWindowsPathEntries([
    runtimeBinPath,
    ...systemEntries,
    ...inheritedEntries,
  ]).join(';')
  const keys = pathEntries.length === 0 ? ['PATH'] : pathEntries.map(([key]) => key)
  return Object.fromEntries(keys.map(key => [key, value]))
}

/** Desktop-host-selected defaults for source and packaged launches. */
export interface DesktopLaunchOptions {
  /** Built Harness entry to execute. */
  harnessBin?: string
  /** Node-compatible executable used when no environment override exists. */
  nodeCommand?: string
  /** Host-owned pnpm executable or JavaScript entry used for profile plugin management. */
  packageManagerBin?: string
  /** Directory prepended to PATH for plugin lifecycle scripts. */
  runtimeBinPath?: string
}

/**
 * Decide whether one bounded CLI invocation completed with an expected code.
 * @param code - Child-process exit code, or null when terminated by a signal.
 * @param signal - Child-process termination signal, if any.
 * @param acceptedCodes - Explicit success-like codes owned by that command.
 * @returns True only for a signal-free exit whose code is explicitly accepted.
 */
export function acceptsHarnessInvocationExit(
  code: number | null,
  signal: NodeJS.Signals | null,
  acceptedCodes: readonly number[],
): boolean {
  return signal === null && code !== null && acceptedCodes.includes(code)
}

/**
 * Pin source-mode profile mutations to the checkout's pnpm major and store.
 * @param sourceRoot - Repository root containing the Desktop workspace package.
 * @returns Launch options shared by Harness and plugin lifecycle children.
 */
export function resolveDevelopmentLaunchOptions(sourceRoot: string): DesktopLaunchOptions {
  return {
    packageManagerBin: join(sourceRoot, 'apps', 'desktop', 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'),
  }
}

/**
 * Resolve a built Harness launcher without consulting the user's shell.
 * @param environment - Desktop-only launch overrides.
 * @param checkoutBin - Built checkout launcher used during development.
 * @returns A direct process launch with no shell interpolation.
 */
export function resolveHarnessLaunch(
  environment: DesktopLaunchEnvironment,
  options: DesktopLaunchOptions = {},
): HarnessLaunch {
  return resolveHarnessInvocation(
    environment,
    ['web', '--host', '127.0.0.1', '--port', '0', '--no-open'],
    options,
  )
}

/** Resolve an arbitrary structured Harness CLI invocation with desktop runtime defaults. */
export function resolveHarnessInvocation(
  environment: DesktopLaunchEnvironment,
  invocationArgs: readonly string[],
  options: DesktopLaunchOptions = {},
): HarnessLaunch {
  const harnessBin = environment.DSH_DESKTOP_DSH_BIN
    ?? options.harnessBin
    ?? fileURLToPath(new URL('../../cli/lib/bin.js', import.meta.url))
  if (!existsSync(harnessBin)) {
    throw new Error(`desktop: Harness launcher not found at ${harnessBin}; run pnpm run build first or set DSH_DESKTOP_DSH_BIN`)
  }
  const command = environment.DSH_DESKTOP_NODE_BIN ?? options.nodeCommand ?? 'node'
  const launch: HarnessLaunch = {
    command,
    args: [harnessBin, ...invocationArgs],
  }
  const launchEnvironment: NodeJS.ProcessEnv = {}
  if (environment.DSH_HOME !== undefined && environment.DSH_HOME.trim() !== '') {
    launchEnvironment.DSH_HOME = environment.DSH_HOME
  }
  for (const name of HARNESS_INVOCATION_ENVIRONMENT) {
    for (const [key, value] of environmentEntries(environment, name, process.platform)) {
      launchEnvironment[key] = value
    }
  }
  if (options.packageManagerBin !== undefined) launchEnvironment.DSH_PNPM_BIN = options.packageManagerBin
  if (options.runtimeBinPath !== undefined) {
    Object.assign(
      launchEnvironment,
      resolveRuntimePathEnvironment(environment, options.runtimeBinPath, process.platform),
    )
  }
  if (Object.keys(launchEnvironment).length > 0) {
    launch.environment = launchEnvironment
  }
  return launch
}

/** Resolve the local Harness process used by the Electron host. */

import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Executable and arguments for one Harness child process. */
export interface HarnessLaunch {
  command: string
  args: string[]
  environment?: NodeJS.ProcessEnv
}

/** Environment variables accepted by {@link resolveHarnessLaunch}. */
export interface DesktopLaunchEnvironment {
  DSH_HOME?: string
  DSH_DESKTOP_DSH_BIN?: string
  DSH_DESKTOP_NODE_BIN?: string
  PATH?: string
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
  if (options.packageManagerBin !== undefined) launchEnvironment.DSH_PNPM_BIN = options.packageManagerBin
  if (options.runtimeBinPath !== undefined) {
    launchEnvironment.PATH = environment.PATH === undefined || environment.PATH.length === 0
      ? options.runtimeBinPath
      : `${options.runtimeBinPath}${delimiter}${environment.PATH}`
  }
  if (Object.keys(launchEnvironment).length > 0) {
    launch.environment = launchEnvironment
  }
  return launch
}

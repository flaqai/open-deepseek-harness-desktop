/** Resolve the local Harness process used by the Electron host. */

import { existsSync } from 'node:fs'
import { delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Executable and arguments for one Harness child process. */
export interface HarnessLaunch {
  command: string
  args: string[]
  environment?: NodeJS.ProcessEnv
}

/** Environment variables accepted by {@link resolveHarnessLaunch}. */
export interface DesktopLaunchEnvironment {
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
 * Resolve a built Harness launcher without consulting the user's shell.
 * @param environment - Desktop-only launch overrides.
 * @param checkoutBin - Built checkout launcher used during development.
 * @returns A direct process launch with no shell interpolation.
 */
export function resolveHarnessLaunch(
  environment: DesktopLaunchEnvironment,
  options: DesktopLaunchOptions = {},
): HarnessLaunch {
  return resolveHarnessInvocation(environment, ['web', '--host', '127.0.0.1', '--port', '0'], options)
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

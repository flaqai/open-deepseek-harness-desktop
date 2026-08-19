/**
 * `dsh plugin --profile <name> <args...>` — profile plugin management as a
 * thin pnpm forwarder: initialize the profile on first use, run
 * `pnpm <args...>` in the profile directory, then reconcile the
 * `dsh.profile.bundles` layer list against the installed state (a dependency
 * resolving to a package that declares `dsh.bundle` joins the layer stack; a
 * removed or bundle-less dependency leaves it). Reconciling by installed
 * state, not by dependency diff, means `update` activates a package that
 * gained its `dsh.bundle` declaration in a newer version.
 * @module @deepseek-ai/dsh/plugin
 */

import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  DEFAULT_PROFILE_BUNDLES,
  healProfilesModuleFallback,
  initProfile,
  inspectProfileDependencies,
  inspectOrphanedProfileBundles,
  PROFILE_TEMPLATES,
  readProfileManifest,
  repairProfileDependencies,
  retryQuarantinedProfilePlugin,
  resolveBundleDir,
  resolveProfileDir,
  writeProfileManifest,
  type ProfileManifest,
  type ProfileRepairReport,
} from '@deepseek-ai/dsh-app-boot'
import { INSTALL_ANCHOR } from './install-anchor.ts'
import { runProfilePackageManager } from './profile-package-manager.ts'

export { resolvePnpmCommand } from './profile-package-manager.ts'

const NAME = 'dsh'

/**
 * Whether a resolved dependency exports a profile patch, i.e. is a bundle.
 * @param packageName - the dependency's package name.
 * @param profileDir - the profile directory (resolution anchor).
 * @returns true when the package manifest declares `dsh.bundle`.
 */
function exportsPatch(packageName: string, profileDir: string): boolean {
  let dir: string
  try {
    dir = resolveBundleDir(NAME, packageName, INSTALL_ANCHOR, profileDir)
  } catch {
    return false // pnpm reported success yet the package is unresolvable — treat as plain
  }
  const manifest = readProfileManifest(NAME, dir)
  return manifest.dsh?.bundle?.patch !== undefined
}

/**
 * Reconcile `dsh.profile.bundles` against the installed state: pnpm has
 * already written the real installed names (so a git/path/tarball/alias spec
 * on the command line reconciles by its true package name) and materialized
 * the packages. A dependency that resolves to a `dsh.bundle`-declaring
 * package joins the layer stack (appended in dependency order); a
 * dependency-listed name that no longer does — removed, or the installed
 * version dropped the declaration — leaves it. In-box bundles from the
 * profile template are not dependencies and are never touched. Warns once
 * per newly-added bundle-less dependency (a plain library is fine; the
 * warning is orientation).
 */
function reconcilePlugins(before: ProfileManifest, profileDir: string): void {
  const after = readProfileManifest(NAME, profileDir)
  const beforeDeps = new Set(Object.keys(before.dependencies ?? {}))
  const dependencies = Object.keys(after.dependencies ?? {})
  const plugins = after.dsh?.profile?.bundles ?? []
  let changed = false
  for (const packageName of dependencies) {
    const isBundle = exportsPatch(packageName, profileDir)
    if (isBundle && !plugins.includes(packageName)) {
      plugins.push(packageName)
      changed = true
    } else if (!isBundle && !beforeDeps.has(packageName)) {
      process.stderr.write(
        `${NAME}: warning: ${packageName} declares no dsh.bundle — installed as a plain dependency, not a profile layer `
        + '(a later update that gains one activates it automatically)\n',
      )
    }
  }
  const dependencySet = new Set(dependencies)
  for (const packageName of [...plugins]) {
    // Only dependency-managed entries are subject to removal; template
    // bundles (dsh-base and friends) are not dependencies.
    const wasDependency = beforeDeps.has(packageName) || dependencySet.has(packageName)
    const stillBundle = dependencySet.has(packageName) && exportsPatch(packageName, profileDir)
    if (wasDependency && !stillBundle) {
      plugins.splice(plugins.indexOf(packageName), 1)
      changed = true
    }
  }
  if (!changed) return
  after.dsh = { ...after.dsh, profile: { ...after.dsh?.profile, bundles: plugins } }
  writeProfileManifest(profileDir, after)
}

/**
 * Rewrite relative filesystem specs against the user's invoking directory.
 * pnpm runs with cwd = the profile directory, so a bare `.` or `../plugin`
 * (or their `file:`/`link:` forms) would silently resolve inside the profile
 * — `add .` from a plugin checkout would self-link the profile. Absolute
 * specs, registry names, and every other pnpm argument pass through
 * untouched.
 * @param argument - one pnpm argument, verbatim from argv.
 * @param cwd - the directory `dsh` was invoked from.
 * @returns the argument with a relative path spec anchored to `cwd`.
 */
function anchorPathSpec(argument: string, cwd: string): string {
  const match = /^(?<prefix>(?:file|link):)?(?<path>\.{1,2}(?:[/\\].*)?)$/.exec(argument)
  if (match?.groups?.path === undefined) return argument
  // A bare path stays bare and a prefixed spec keeps its prefix: pnpm's
  // link-vs-copy semantics differ between `file:` and a plain directory
  // path, and the anchor must not change which one the user asked for.
  const prefix = match.groups.prefix ?? ''
  return `${prefix}${resolve(cwd, match.groups.path)}`
}

/**
 * Run one `dsh plugin` invocation: init if needed, forward to pnpm, reconcile.
 * @param profile - the profile name.
 * @param args - pnpm arguments with relative path specs anchored to the invoking directory.
 * @returns the pnpm exit code.
 */
export function runPlugin(profile: string, args: readonly string[]): number {
  const dir = resolveProfileDir(profile)
  if (args[0] === 'doctor') {
    const repair = args.length === 2 && args[1] === '--repair'
    const retryId = args.length === 3 && args[1] === '--retry' ? args[2] : undefined
    if (args.length !== 1 && !repair && retryId === undefined) {
      process.stderr.write(`${NAME}: usage: dsh plugin --profile ${profile} doctor [--repair | --retry <quarantine-id>]\n`)
      return 1
    }
    const mutatesProfile = repair || retryId !== undefined
    if (!existsSync(join(dir, 'package.json'))) {
      if (!mutatesProfile) {
        process.stderr.write(`${NAME}: profile ${profile} is not initialized at ${dir}\n`)
        return 1
      }
      initProfile(dir, PROFILE_TEMPLATES[profile] ?? DEFAULT_PROFILE_BUNDLES)
      process.stderr.write(`${NAME}: initialized profile ${profile} at ${dir}\n`)
    }
    if (mutatesProfile) healProfilesModuleFallback(INSTALL_ANCHOR)
    let outcome: ProfileRepairReport
    if (retryId !== undefined) {
      outcome = retryQuarantinedProfilePlugin({
        binName: NAME,
        profile,
        installAnchor: INSTALL_ANCHOR,
        runPackageManager: pnpmArgs => runProfilePackageManager(dir, pnpmArgs),
      }, retryId)
    } else if (repair) {
      outcome = repairProfileDependencies({
        binName: NAME,
        profile,
        installAnchor: INSTALL_ANCHOR,
        runPackageManager: pnpmArgs => runProfilePackageManager(dir, pnpmArgs),
      })
    } else {
      const orphanedBundles = inspectOrphanedProfileBundles({
        binName: NAME,
        profile,
        installAnchor: INSTALL_ANCHOR,
      })
      outcome = {
        schema: 'dsh/profile-dependency-repair/v1' as const,
        profile,
        status: 'healthy' as const,
        conflicts: inspectProfileDependencies({ binName: NAME, profile, installAnchor: INSTALL_ANCHOR }),
        ...(orphanedBundles.length === 0 ? {} : { orphanedBundles }),
        quarantined: [],
      }
    }
    const normalized = !mutatesProfile
      && (outcome.conflicts.length > 0 || (outcome.orphanedBundles?.length ?? 0) > 0)
      ? { ...outcome, status: 'failed' as const }
      : outcome
    process.stdout.write(`${JSON.stringify(normalized, undefined, 2)}\n`)
    if (!mutatesProfile) return normalized.status === 'healthy' ? 0 : 2
    if (normalized.status === 'repaired') return 10
    if (normalized.status === 'quarantined') return 11
    return normalized.status === 'healthy' ? 0 : 1
  }
  const initialized = !existsSync(join(dir, 'package.json'))
  initProfile(dir, PROFILE_TEMPLATES[profile] ?? DEFAULT_PROFILE_BUNDLES)
  if (initialized) process.stderr.write(`${NAME}: initialized profile ${profile} at ${dir}\n`)
  healProfilesModuleFallback(INSTALL_ANCHOR)
  const preflight = repairProfileDependencies({
    binName: NAME,
    profile,
    installAnchor: INSTALL_ANCHOR,
    runPackageManager: pnpmArgs => runProfilePackageManager(dir, pnpmArgs),
  })
  if (preflight.status === 'failed') {
    process.stderr.write(`${NAME}: plugin dependency preflight failed: ${preflight.diagnostic ?? 'unknown error'}\n`)
    return 1
  }
  if (preflight.status === 'repaired' || preflight.status === 'quarantined') {
    process.stderr.write(`${NAME}: profile dependency health ${JSON.stringify(preflight)}\n`)
  }
  const before = readProfileManifest(NAME, dir)
  // Windows resolves pnpm through its .cmd shim, which spawn() refuses
  // without a shell since the CVE-2024-27980 hardening.
  const result = runProfilePackageManager(
    dir,
    args.map(argument => anchorPathSpec(argument, process.cwd())),
  )
  if (result.diagnostic !== undefined) process.stderr.write(`${result.diagnostic}\n`)
  const exitCode = result.exitCode ?? 1
  if (exitCode === 0) {
    reconcilePlugins(before, dir)
    const dependencyHealth = repairProfileDependencies({
      binName: NAME,
      profile,
      installAnchor: INSTALL_ANCHOR,
      runPackageManager: pnpmArgs => runProfilePackageManager(dir, pnpmArgs),
    })
    if (dependencyHealth.status === 'failed') {
      process.stderr.write(`${NAME}: plugin dependency repair failed: ${dependencyHealth.diagnostic ?? 'unknown error'}\n`)
      return 1
    }
    if (dependencyHealth.status === 'repaired' || dependencyHealth.status === 'quarantined') {
      process.stderr.write(`${NAME}: profile dependency health ${JSON.stringify(dependencyHealth)}\n`)
    }
  } else {
    // pnpm's own diagnostics name pnpm-workspace.yaml without saying WHICH
    // one; the profile owns it, and the commonest failure here is pnpm ≥10
    // blocking a git dependency's prepare (build) script until allowlisted.
    process.stderr.write(`${NAME}: pnpm failed in profile directory ${dir}\n`)
    if (args.some(argument => /^git\+|^github:|\.git(?:#|$)/.test(argument))) {
      process.stderr.write(
        `${NAME}: git-hosted plugins build on install via their prepare script, which pnpm blocks until allowed — `
        + `add the exact key pnpm printed above under allowBuilds in ${join(dir, 'pnpm-workspace.yaml')}, then re-run\n`,
      )
    }
  }
  return exitCode
}

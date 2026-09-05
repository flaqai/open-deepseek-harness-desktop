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
  allowProfilePackageBuild,
  allowProfileRegistryPackageBuild,
  acquireProfilePluginMutationLock,
  assertProfilePluginMutationLease,
  beginProfilePluginMutationLease,
  classifyProfileDiagnostic,
  createProfilePluginSnapshot,
  createProfileDiagnosticReport,
  DEFAULT_PROFILE_BUNDLES,
  endProfilePluginMutationLease,
  finalizeProfilePluginSnapshot,
  initProfile,
  inspectProfileDependencies,
  inspectOrphanedProfileBundles,
  inspectUnresolvableProfileBundleEntries,
  listProfilePluginSnapshots,
  inspectQuarantineRemovalResidue,
  orphanedBundleDiagnostic,
  PROFILE_TEMPLATES,
  profileDependencyConflictDiagnostic,
  quarantineRemovalResidueDiagnostic,
  quarantineProfilePluginAfterLoadFailure,
  removeProfilePluginSnapshot,
  readProfileManifest,
  readProfileDiagnosticReport,
  repairProfileDependencies,
  retryQuarantinedProfilePlugin,
  restoreProfilePluginSnapshotFiles,
  resolveBundleDir,
  resolveProfileDir,
  writeProfileManifest,
  writeProfileDiagnosticReport,
  settleProfilePluginSafetySnapshot,
  withAutomaticProfilePluginSnapshot,
  type ProfileManifest,
  type ProfileDiagnostic,
  type ProfilePluginSnapshotTrigger,
  type ProfileRepairReport,
} from '@deepseek-ai/dsh-app-boot'
import { INSTALL_ANCHOR } from './install-anchor.ts'
import { resolveDesktopBundledPluginArgs } from './desktop-bundled-plugin.ts'
import { runProfilePackageManager } from './profile-package-manager.ts'

export { resolvePnpmCommand } from './profile-package-manager.ts'

const NAME = 'dsh'
const REGISTRY_ADD_SPEC = /^(?<name>(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*))(?:@[a-z0-9][a-z0-9._+~-]*)?$/iu
const REGISTRY_PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/iu
const SNAPSHOT_JSON_MARKER = 'dsh:plugin-snapshot-json '

function writeSnapshotJson(value: unknown): void {
  process.stdout.write(`${SNAPSHOT_JSON_MARKER}${JSON.stringify(value)}\n`)
}

function snapshotRuntimeMetadata(): { readonly applicationVersion?: string; readonly pnpmVersion?: string } {
  const applicationVersion = process.env.DSH_DESKTOP_APPLICATION_VERSION?.trim()
  const pnpmVersion = process.env.DSH_DESKTOP_PNPM_VERSION?.trim()
  return {
    ...(applicationVersion === undefined || applicationVersion === '' ? {} : { applicationVersion }),
    ...(pnpmVersion === undefined || pnpmVersion === '' ? {} : { pnpmVersion }),
  }
}

function withSnapshotMutation<T>(profile: string, operation: () => T): T {
  const leaseToken = process.env.DSH_PLUGIN_SNAPSHOT_LEASE_TOKEN
  if (leaseToken !== undefined) {
    assertProfilePluginMutationLease({ profile, token: leaseToken })
    return operation()
  }
  const release = acquireProfilePluginMutationLock({ profile, waitMs: 30_000 })
  try {
    return operation()
  } finally {
    release()
  }
}

/** Initialize one named profile with the official template shape. */
function initializeProfile(dir: string, profile: string): void {
  const template = PROFILE_TEMPLATES[profile]
  initProfile(
    dir,
    template?.bundles ?? DEFAULT_PROFILE_BUNDLES,
    template?.patchReload,
  )
}

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

function addedPackageSpec(args: readonly string[]): string | undefined {
  if (args[0] !== 'add') return undefined
  let candidate: string | undefined
  for (const argument of args.slice(1)) {
    if (argument === '--') continue
    if (!argument.startsWith('-')) candidate = argument
  }
  return candidate
}

/** Resolve the package identity for a registry add that can be verified locally. */
function addedRegistryPackageName(args: readonly string[]): string | undefined {
  const packageSpec = addedPackageSpec(args)
  if (packageSpec === undefined) return undefined
  return REGISTRY_ADD_SPEC.exec(packageSpec)?.groups?.name
}

/**
 * Refuse a false-successful registry add. A package-manager exit code alone is
 * insufficient: the selected Profile must declare the dependency, materialize
 * its package, and activate its bundle declaration when one exists.
 */
function verifyRegistryPackageInstall(profileDir: string, packageName: string): string | undefined {
  const profile = readProfileManifest(NAME, profileDir)
  if (profile.dependencies?.[packageName] === undefined) {
    return `dependency ${JSON.stringify(packageName)} was not written to the selected Profile`
  }
  const packageDir = join(profileDir, 'node_modules', ...packageName.split('/'))
  let installed: ProfileManifest
  try {
    installed = readProfileManifest(NAME, packageDir)
  } catch {
    return `dependency ${JSON.stringify(packageName)} is declared but not materialized in the selected Profile`
  }
  if (installed.name !== packageName) {
    return `dependency ${JSON.stringify(packageName)} resolved to unexpected package ${JSON.stringify(installed.name)}`
  }
  if (installed.dsh?.bundle?.patch !== undefined
    && !profile.dsh?.profile?.bundles?.includes(packageName)) {
    return `plugin ${JSON.stringify(packageName)} was installed but not added to dsh.profile.bundles`
  }
  return undefined
}

/**
 * Run one `dsh plugin` invocation: init if needed, forward to pnpm, reconcile.
 * @param profile - the profile name.
 * @param args - pnpm arguments with relative path specs anchored to the invoking directory.
 * @returns the pnpm exit code.
 */
function runPluginWithoutSnapshot(profile: string, args: readonly string[]): number {
  const dir = resolveProfileDir(profile)
  if (args[0] === 'snapshot') {
    const command = args[1]
    try {
      if (command === 'list' && args.length === 2) {
        writeSnapshotJson(listProfilePluginSnapshots({ profile }))
        return 0
      }
      if (command === 'create' && args.length >= 2 && args.length <= 3) {
        const record = withSnapshotMutation(profile, () => createProfilePluginSnapshot({
          profile,
          kind: 'manual',
          trigger: 'manual',
          ...snapshotRuntimeMetadata(),
          ...(args[2] === undefined ? {} : { label: args[2] }),
        }))
        writeSnapshotJson(record)
        return 0
      }
      if (command === 'mark-bootable' && args.length === 2) {
        const record = withSnapshotMutation(profile, () => createProfilePluginSnapshot({
          profile,
          kind: 'bootable',
          trigger: 'successful-startup',
          ...snapshotRuntimeMetadata(),
        }))
        writeSnapshotJson(record)
        return 0
      }
      if (command === 'create-safety' && args.length === 2) {
        const record = withSnapshotMutation(profile, () => createProfilePluginSnapshot({
          profile,
          kind: 'safety',
          trigger: 'restore-safety',
          ...snapshotRuntimeMetadata(),
        }))
        writeSnapshotJson(record)
        return 0
      }
      if (command === 'begin-startup-seed' && args.length === 2) {
        const release = acquireProfilePluginMutationLock({ profile, waitMs: 30_000 })
        let leased = false
        const token = process.env.DSH_PLUGIN_SNAPSHOT_LEASE_TOKEN
        const ownerPid = Number(process.env.DSH_PLUGIN_SNAPSHOT_LEASE_OWNER_PID)
        try {
          const record = createProfilePluginSnapshot({
            profile,
            kind: 'automatic',
            trigger: 'startup-seed',
            ...snapshotRuntimeMetadata(),
          })
          if (token === undefined) throw new Error('dsh: startup seed snapshot lease token is unavailable')
          beginProfilePluginMutationLease({ profile, token, ownerPid })
          leased = true
          writeSnapshotJson(record)
          return 0
        } finally {
          if (!leased) release()
        }
      }
      if (command === 'begin-restore-lease' && args.length === 2) {
        const release = acquireProfilePluginMutationLock({ profile, waitMs: 30_000 })
        let leased = false
        const token = process.env.DSH_PLUGIN_SNAPSHOT_LEASE_TOKEN
        const ownerPid = Number(process.env.DSH_PLUGIN_SNAPSHOT_LEASE_OWNER_PID)
        try {
          if (token === undefined) throw new Error('dsh: restore lease token is unavailable')
          beginProfilePluginMutationLease({ profile, token, ownerPid })
          leased = true
          writeSnapshotJson({ leased: true })
          return 0
        } finally {
          if (!leased) release()
        }
      }
      if (command === 'end-restore-lease' && args.length === 2) {
        const token = process.env.DSH_PLUGIN_SNAPSHOT_LEASE_TOKEN
        if (token === undefined) throw new Error('dsh: restore lease token is unavailable')
        endProfilePluginMutationLease({ profile, token })
        writeSnapshotJson({ leased: false })
        return 0
      }
      if (command === 'finalize' && (args.length === 3 || args.length === 4) && args[2] !== undefined) {
        const snapshotId = args[2]
        const preserveIfUnchanged = args[3] === '--preserve-if-unchanged'
        if (args.length === 4 && !preserveIfUnchanged) {
          throw new Error(`dsh: unsupported plugin snapshot finalize option ${JSON.stringify(args[3])}`)
        }
        const token = process.env.DSH_PLUGIN_SNAPSHOT_LEASE_TOKEN
        if (token === undefined) throw new Error('dsh: startup seed snapshot lease token is unavailable')
        let record: ReturnType<typeof finalizeProfilePluginSnapshot>
        try {
          record = withSnapshotMutation(profile, () => finalizeProfilePluginSnapshot({
            profile, snapshotId, preserveIfUnchanged,
          }))
        } finally {
          endProfilePluginMutationLease({ profile, token })
        }
        writeSnapshotJson({ retained: record !== undefined, snapshotId })
        return 0
      }
      if (command === 'restore-files' && args.length === 3 && args[2] !== undefined) {
        const snapshotId = args[2]
        const result = withSnapshotMutation(profile, () => restoreProfilePluginSnapshotFiles({
          profile, snapshotId,
        }))
        writeSnapshotJson(result)
        return 0
      }
      if (command === 'remove' && args.length === 3 && args[2] !== undefined) {
        const snapshotId = args[2]
        withSnapshotMutation(profile, () => removeProfilePluginSnapshot({ profile, snapshotId }))
        writeSnapshotJson({ removed: true, snapshotId })
        return 0
      }
      if (command === 'settle-safety' && args.length === 3 && args[2] !== undefined) {
        const snapshotId = args[2]
        withSnapshotMutation(profile, () => settleProfilePluginSafetySnapshot({ profile, snapshotId }))
        writeSnapshotJson({ settled: true, snapshotId })
        return 0
      }
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      return 1
    }
    process.stderr.write(
      `${NAME}: usage: dsh plugin --profile ${profile} snapshot `
      + '<list | create [label] | mark-bootable | create-safety | begin-startup-seed '
      + '| begin-restore-lease | end-restore-lease | finalize <id> [--preserve-if-unchanged] '
      + '| restore-files <id> | remove <id> | settle-safety <id>>\n',
    )
    return 1
  }
  if (args[0] === 'approve-build-key') {
    if (args.length !== 2 || args[1] === undefined) {
      process.stderr.write(`${NAME}: usage: dsh plugin --profile ${profile} approve-build-key <exact-package-key>\n`)
      return 1
    }
    initializeProfile(dir, profile)
    try {
      const result = allowProfilePackageBuild(dir, args[1])
      if (result === 'denied') {
        process.stderr.write(`${NAME}: pnpm build remains explicitly denied for ${JSON.stringify(args[1])} in ${dir}\n`)
        return 1
      }
      process.stderr.write(`${NAME}: pnpm build ${result} for exact key ${JSON.stringify(args[1])} in ${dir}\n`)
      return 0
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      return 1
    }
  }
  if (args[0] === 'approve-build') {
    if (args.length !== 2 || args[1] === undefined) {
      process.stderr.write(`${NAME}: usage: dsh plugin --profile ${profile} approve-build <package-name>\n`)
      return 1
    }
    initializeProfile(dir, profile)
    try {
      const result = allowProfileRegistryPackageBuild(dir, args[1])
      if (result === 'denied') {
        process.stderr.write(`${NAME}: pnpm build remains explicitly denied for ${JSON.stringify(args[1])} in ${dir}\n`)
        return 1
      }
      process.stderr.write(`${NAME}: pnpm build ${result} for ${JSON.stringify(args[1])} in ${dir}\n`)
      return 0
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      return 1
    }
  }
  if (args[0] === 'doctor') {
    const repair = args.length === 2 && args[1] === '--repair'
    const retryId = args.length === 3 && args[1] === '--retry' ? args[2] : undefined
    const clientLoadFailure = args.length === 5 && args[1] === '--quarantine-client-module'
      && args[2] !== undefined && args[3] !== undefined && args[4] !== undefined
      ? { packageName: args[2], entryId: args[3], requestedModule: args[4] }
      : undefined
    if (args.length !== 1 && !repair && retryId === undefined && clientLoadFailure === undefined) {
      process.stderr.write(
        `${NAME}: usage: dsh plugin --profile ${profile} doctor `
        + '[--repair | --retry <quarantine-id> | --quarantine-client-module <package> <entry-id> <requested-module>]\n',
      )
      return 1
    }
    const mutatesProfile = repair || retryId !== undefined || clientLoadFailure !== undefined
    if (!existsSync(join(dir, 'package.json'))) {
      if (!mutatesProfile) {
        process.stderr.write(`${NAME}: profile ${profile} is not initialized at ${dir}\n`)
        return 1
      }
      initializeProfile(dir, profile)
      process.stderr.write(`${NAME}: initialized profile ${profile} at ${dir}\n`)
    }
    let outcome: ProfileRepairReport
    if (clientLoadFailure !== undefined) {
      const { packageName, entryId, requestedModule } = clientLoadFailure
      if (!REGISTRY_PACKAGE_NAME.test(packageName)
        || !/^[A-Za-z0-9._~-]{1,128}$/u.test(entryId)
        || !/^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)(?:\/[a-z0-9._~/-]+)?$/iu.test(requestedModule)) {
        process.stderr.write(`${NAME}: invalid client module quarantine attribution\n`)
        return 1
      }
      const issue = classifyProfileDiagnostic({
        source: 'loader',
        phase: 'import',
        attribution: { entryId, moduleName: packageName, rootPackage: packageName },
        value: `failed to import loader entry ${entryId} (${packageName}): client-modules: require(${JSON.stringify(requestedModule)}) missed the module table — not a platform seed word, not a materialized module, and no registered package factory`,
      })
      outcome = quarantineProfilePluginAfterLoadFailure({
        binName: NAME,
        profile,
        installAnchor: INSTALL_ANCHOR,
        runPackageManager: pnpmArgs => runProfilePackageManager(dir, pnpmArgs),
      }, packageName, issue)
    } else if (retryId !== undefined) {
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
      const conflicts = inspectProfileDependencies({ binName: NAME, profile, installAnchor: INSTALL_ANCHOR })
      const quarantineRemovalResidue = inspectQuarantineRemovalResidue({
        binName: NAME,
        profile,
        installAnchor: INSTALL_ANCHOR,
      })
      const loaderFailures = inspectUnresolvableProfileBundleEntries({
        binName: NAME,
        profile,
        installAnchor: INSTALL_ANCHOR,
      })
      outcome = {
        schema: 'dsh/profile-dependency-repair/v1' as const,
        diagnosticSchema: 'dsh/profile-diagnostic/v2' as const,
        profile,
        status: 'healthy' as const,
        conflicts,
        ...(orphanedBundles.length === 0 ? {} : { orphanedBundles }),
        quarantined: [],
        issues: [
          ...conflicts.map(conflict => profileDependencyConflictDiagnostic(
            conflict.rootPackage,
            conflict.dependencyChain,
          )),
          ...orphanedBundles.map(bundle => orphanedBundleDiagnostic(bundle.packageName)),
          ...quarantineRemovalResidue.map(residue => quarantineRemovalResidueDiagnostic(
            residue.packageName,
            residue.staleComponents,
          )),
          ...loaderFailures.map(failure => classifyProfileDiagnostic({
            source: 'profile',
            phase: 'import',
            value: `failed to import loader entry ${failure.entryId} (${failure.moduleName}): ERR_MODULE_NOT_FOUND`,
            attribution: {
              rootPackage: failure.rootPackage,
              entryId: failure.entryId,
              moduleName: failure.moduleName,
            },
          })),
        ],
      }
    }
    const normalized = !mutatesProfile
      && (outcome.conflicts.length > 0
        || (outcome.orphanedBundles?.length ?? 0) > 0
        || (outcome.issues?.length ?? 0) > 0)
      ? { ...outcome, status: 'failed' as const }
      : outcome
    process.stdout.write(`${JSON.stringify(normalized, undefined, 2)}\n`)
    if (!mutatesProfile) return normalized.status === 'healthy' ? 0 : 2
    if (normalized.status === 'repaired') return 10
    if (normalized.status === 'quarantined') return 11
    return normalized.status === 'healthy' ? 0 : 1
  }
  const initialized = !existsSync(join(dir, 'package.json'))
  initializeProfile(dir, profile)
  if (initialized) process.stderr.write(`${NAME}: initialized profile ${profile} at ${dir}\n`)
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
  let packageManagerArgs: readonly string[]
  try {
    packageManagerArgs = resolveDesktopBundledPluginArgs(profile, dir, args)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
  // A host-provided pnpm.mjs is executed by the current Node process without a
  // shell; ordinary Windows pnpm.cmd discovery retains its compatibility path.
  const result = runProfilePackageManager(
    dir,
    packageManagerArgs.map(argument => anchorPathSpec(argument, process.cwd())),
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
    const packageName = addedRegistryPackageName(args)
    const quarantinedAfterInstall = packageName !== undefined
      && dependencyHealth.quarantined.some(record => record.packageName === packageName)
    const verificationFailure = packageName === undefined || quarantinedAfterInstall
      ? undefined
      : verifyRegistryPackageInstall(dir, packageName)
    if (verificationFailure !== undefined) {
      process.stderr.write(`${NAME}: plugin install verification failed: ${verificationFailure}\n`)
      return 1
    }
  } else {
    const packageSpec = addedPackageSpec(args)
    const issue = classifyProfileDiagnostic({
      source: 'pnpm',
      phase: 'install',
      value: result.diagnostic ?? `pnpm exited with ${String(exitCode)}`,
      ...(packageSpec === undefined ? {} : { attribution: { rootPackage: packageSpec } }),
    })
    let retainedIssues: ProfileDiagnostic[] = []
    try {
      retainedIssues = [...readProfileDiagnosticReport(profile)?.issues ?? []]
    } catch {
      // A fresh structured report replaces only the unreadable diagnostic record.
    }
    const issueKey = `${issue.code}\0${issue.attribution?.rootPackage ?? ''}`
    const issues = [
      ...retainedIssues.filter(candidate => `${candidate.code}\0${candidate.attribution?.rootPackage ?? ''}` !== issueKey),
      issue,
    ]
    writeProfileDiagnosticReport(createProfileDiagnosticReport(profile, issues))
    process.stderr.write(`${NAME}: pnpm failed in profile directory ${dir}\n`)
  }
  return exitCode
}

function pluginMutationTrigger(args: readonly string[]): ProfilePluginSnapshotTrigger {
  if (args[0] === 'approve-build' || args[0] === 'approve-build-key') return 'build-approval'
  if (args[0] === 'doctor') {
    return args[1] === '--retry' ? 'quarantine-retry' : 'diagnostic-repair'
  }
  if (args[0] === 'add') return 'plugin-add'
  if (args[0] === 'remove' || args[0] === 'uninstall' || args[0] === 'rm') return 'plugin-remove'
  if (args[0] === 'update' || args[0] === 'up') return 'plugin-update'
  if (args[0] === 'install' || args[0] === 'i') return 'plugin-install'
  return 'other-plugin-mutation'
}

function pluginInvocationMutates(args: readonly string[]): boolean {
  if (args.length === 0) return false
  if (args[0] === 'snapshot') return false
  if (args[0] === 'doctor') return args.length > 1
  return !['list', 'ls', 'why', 'outdated'].includes(args[0] ?? '')
}

/**
 * Run one Profile package operation with a crash-safe pre-change rollback point.
 * @param profile - Profile selected by the CLI parser.
 * @param args - pnpm or Doctor arguments.
 * @returns Process exit code.
 */
export function runPlugin(profile: string, args: readonly string[]): number {
  const leaseToken = process.env.DSH_PLUGIN_SNAPSHOT_LEASE_TOKEN
  if (leaseToken !== undefined && pluginInvocationMutates(args)) {
    assertProfilePluginMutationLease({ profile, token: leaseToken })
    return runPluginWithoutSnapshot(profile, args)
  }
  if (!pluginInvocationMutates(args) || process.env.DSH_PLUGIN_SNAPSHOT_BATCH === '1') {
    return runPluginWithoutSnapshot(profile, args)
  }
  return withAutomaticProfilePluginSnapshot({
    profile,
    trigger: pluginMutationTrigger(args),
    ...snapshotRuntimeMetadata(),
  }, () => runPluginWithoutSnapshot(profile, args))
}

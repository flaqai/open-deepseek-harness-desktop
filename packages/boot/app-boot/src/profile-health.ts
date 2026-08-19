/** Profile dependency identity checks, convergence, and quarantine persistence. */

import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { satisfies, validRange } from 'semver'
import { isMap, parseDocument, YAMLMap } from 'yaml'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  PROFILES_DIR,
  readProfileManifest,
  resolveProfileDir,
  writeProfileManifest,
  type ProfileManifest,
} from './profile.ts'

/** Version of durable quarantine records written under the Harness home. */
export const PROFILE_QUARANTINE_SCHEMA = 1 as const

/** Host packages whose runtime identities must be shared by every profile plugin. */
export const SHARED_HOST_PACKAGES = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-attachment',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-tools',
] as const

const sharedHostPackages = new Set<string>(SHARED_HOST_PACKAGES)
const PROFILE_WORKSPACE_FILENAME = 'pnpm-workspace.yaml'
const PROFILE_LOCKFILE_FILENAME = 'pnpm-lock.yaml'
const QUARANTINE_DIRECTORY = 'quarantine'
const QUARANTINE_FILENAME = 'profile-plugins.json'
const PROFILE_HEALTH_DIRECTORY = 'profile-health'
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/iu
const MINIMUM_RELEASE_AGE_ERROR = 'ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION'
const MINIMUM_RELEASE_AGE_OVERRIDE = '--config.minimumReleaseAge=0'

interface PackageManifest extends ProfileManifest {
  version?: string
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

/** One installed edge that resolves an identity-sensitive package away from the Host copy. */
export interface ProfileDependencyConflict {
  readonly profile: string
  readonly rootPackage: string
  readonly dependencyChain: readonly string[]
  readonly dependency: string
  readonly declaredRange: string
  readonly declaredIn: 'dependencies' | 'optionalDependencies'
  readonly hostVersion: string
  readonly hostPath: string
  readonly resolvedPath: string
  readonly compatible: boolean
}

/** A third-party Loader bundle that is still active but no longer managed by the profile manifest. */
export interface OrphanedProfileBundle {
  readonly profile: string
  readonly packageName: string
  readonly bundleIndex: number
  readonly installedVersion?: string
  readonly resolvedPath?: string
}

/** Durable information required to explain or retry an automatically isolated plugin. */
export interface QuarantinedProfilePlugin {
  readonly quarantineId: string
  readonly profile: string
  readonly packageName: string
  readonly packageSpec: string
  readonly installedVersion?: string
  readonly bundleIndex: number | null
  readonly quarantinedAt: string
  readonly reason: 'incompatible-host-dependency' | 'convergence-failed' | 'orphaned-bundle'
  readonly conflicts: readonly ProfileDependencyConflict[]
}

interface ProfileQuarantineFile {
  schema: typeof PROFILE_QUARANTINE_SCHEMA
  plugins: QuarantinedProfilePlugin[]
}

/** Observable result of one dependency-health repair attempt. */
export interface ProfileRepairReport {
  readonly schema: 'dsh/profile-dependency-repair/v1'
  readonly profile: string
  readonly status: 'healthy' | 'repaired' | 'quarantined' | 'failed'
  readonly conflicts: readonly ProfileDependencyConflict[]
  readonly orphanedBundles?: readonly OrphanedProfileBundle[]
  readonly quarantined: readonly QuarantinedProfilePlugin[]
  readonly diagnostic?: string
}

function profileRepairReportPath(home: string, profile: string): string {
  return join(home, PROFILE_HEALTH_DIRECTORY, `${profile}.json`)
}

/**
 * Read the last material repair result retained for a client notification.
 * @param profile - profile name.
 * @param home - Harness home; defaults to {@link resolveDshHome}.
 * @returns the retained result, or `undefined` before any material repair.
 */
export function readLastProfileRepairReport(
  profile: string,
  home: string = resolveDshHome(),
): ProfileRepairReport | undefined {
  const path = profileRepairReportPath(home, profile)
  if (!existsSync(path)) return undefined
  const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<ProfileRepairReport>
  if (value.schema !== 'dsh/profile-dependency-repair/v1' || value.profile !== profile) {
    throw new Error(`dsh: unsupported profile dependency repair report ${path}`)
  }
  return value as ProfileRepairReport
}

/**
 * Clear the retained repair notification without changing plugin state.
 * @param profile - profile name.
 * @param home - Harness home; defaults to {@link resolveDshHome}.
 * @returns true when a retained report existed.
 */
export function clearLastProfileRepairReport(
  profile: string,
  home: string = resolveDshHome(),
): boolean {
  const path = profileRepairReportPath(home, profile)
  if (!existsSync(path)) return false
  rmFile(path)
  return true
}

/** Package-manager completion consumed by {@link repairProfileDependencies}. */
export interface ProfilePackageManagerResult {
  readonly exitCode: number | null
  readonly diagnostic?: string
}

/** Inputs for profile inspection and repair. */
export interface ProfileDependencyOptions {
  /** Diagnostic prefix for durable manifest failures. */
  readonly binName: string
  /** Profile name under the Harness home. */
  readonly profile: string
  /** Absolute package.json of the running Harness installation. */
  readonly installAnchor: string
  /** Harness home; defaults to {@link resolveDshHome}. */
  readonly home?: string
}

/** Repair inputs, including the caller-owned package-manager execution. */
export interface ProfileRepairOptions extends ProfileDependencyOptions {
  /** Run pnpm in the profile after managed files change. */
  readonly runPackageManager: (args: readonly string[]) => ProfilePackageManagerResult
  /** Clock used by durable quarantine records. */
  readonly now?: () => Date
}

/** Retry inputs share the repair runner and clock because a restored plugin is re-inspected before activation. */
export type ProfileQuarantineRetryOptions = ProfileRepairOptions

/** Resolve a package directory through Node's lookup without requiring a package.json export. */
function packageDirFromAnchor(anchor: string, packageName: string): string | undefined {
  for (const searchPath of createRequire(anchor).resolve.paths(packageName) ?? []) {
    const candidate = join(searchPath, packageName)
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  return undefined
}

function readPackageManifest(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
}

function canonical(path: string): string {
  return realpathSync.native(path)
}

function hostPackages(installAnchor: string, home: string): Map<string, { path: string; version: string }> {
  const result = new Map<string, { path: string; version: string }>()
  for (const packageName of SHARED_HOST_PACKAGES) {
    // The maintained flat fallback is authoritative for packages that belong
    // to the app's transitive runtime closure but are not directly resolvable
    // from the CLI package itself. Repair callers heal it before inspection;
    // inspect-only doctor remains read-only and consumes the existing links.
    const fallback = join(home, PROFILES_DIR, 'node_modules', packageName)
    const path = existsSync(join(fallback, 'package.json'))
      ? fallback
      : packageDirFromAnchor(installAnchor, packageName)
    if (path === undefined) {
      throw new Error(`dsh: shared Host package ${packageName} is unavailable from ${installAnchor}`)
    }
    const manifest = readPackageManifest(join(path, 'package.json'))
    if (manifest.version === undefined) {
      throw new Error(`dsh: shared Host package ${packageName} has no version in ${path}`)
    }
    result.set(packageName, { path: canonical(path), version: manifest.version })
  }
  return result
}

function rangeAcceptsHost(range: string, version: string): boolean {
  return validRange(range) !== null && satisfies(version, range, { includePrerelease: true })
}

/**
 * Inspect installed profile dependencies for duplicate identity-sensitive Host packages.
 * @param options - profile, installation anchor, and optional Harness home.
 * @returns every installed conflicting edge, in deterministic traversal order.
 */
export function inspectProfileDependencies(options: ProfileDependencyOptions): ProfileDependencyConflict[] {
  const home = options.home ?? resolveDshHome()
  const profileDir = resolveProfileDir(options.profile, home)
  const profileManifest = readProfileManifest(options.binName, profileDir)
  const hosts = hostPackages(options.installAnchor, home)
  const conflicts: ProfileDependencyConflict[] = []

  interface PendingPackage {
    rootPackage: string
    packageDir: string
    chain: string[]
  }

  const queue: PendingPackage[] = []
  for (const rootPackage of Object.keys(profileManifest.dependencies ?? {}).sort()) {
    const packageDir = packageDirFromAnchor(join(profileDir, 'package.json'), rootPackage)
    if (packageDir === undefined) continue
    const packagePath = canonical(packageDir)
    const host = hosts.get(rootPackage)
    if (host !== undefined && packagePath !== host.path) {
      const declaredRange = profileManifest.dependencies?.[rootPackage]
      if (declaredRange !== undefined) {
        conflicts.push({
          profile: options.profile,
          rootPackage,
          dependencyChain: [rootPackage],
          dependency: rootPackage,
          declaredRange,
          declaredIn: 'dependencies',
          hostVersion: host.version,
          hostPath: host.path,
          resolvedPath: packagePath,
          compatible: rangeAcceptsHost(declaredRange, host.version),
        })
      }
      continue
    }
    queue.push({ rootPackage, packageDir: packagePath, chain: [rootPackage] })
  }
  const visited = new Set<string>()
  for (let current = queue.shift(); current !== undefined; current = queue.shift()) {
    const packageDir = canonical(current.packageDir)
    const visitKey = `${current.rootPackage}\0${packageDir}`
    if (visited.has(visitKey)) continue
    visited.add(visitKey)
    const manifestPath = join(packageDir, 'package.json')
    const manifest = readPackageManifest(manifestPath)
    const groups = [
      ['dependencies', manifest.dependencies ?? {}],
      ['optionalDependencies', manifest.optionalDependencies ?? {}],
    ] as const
    for (const [declaredIn, dependencies] of groups) {
      for (const dependency of Object.keys(dependencies).sort()) {
        const declaredRange = dependencies[dependency]
        if (declaredRange === undefined) continue
        const resolved = packageDirFromAnchor(manifestPath, dependency)
        if (resolved === undefined) continue
        const resolvedPath = canonical(resolved)
        const host = hosts.get(dependency)
        if (sharedHostPackages.has(dependency) && host !== undefined && resolvedPath !== host.path) {
          conflicts.push({
            profile: options.profile,
            rootPackage: current.rootPackage,
            dependencyChain: [...current.chain, dependency],
            dependency,
            declaredRange,
            declaredIn,
            hostVersion: host.version,
            hostPath: host.path,
            resolvedPath,
            compatible: rangeAcceptsHost(declaredRange, host.version),
          })
        }
        if (!sharedHostPackages.has(dependency)) {
          queue.push({
            rootPackage: current.rootPackage,
            packageDir: resolvedPath,
            chain: [...current.chain, dependency],
          })
        }
      }
    }
  }
  return conflicts
}

/**
 * Find third-party Loader bundles that are still composed but cannot be managed or removed by pnpm.
 * Built-in `@deepseek-ai/*` layers intentionally come from the Host installation and are excluded.
 * @param options - profile, installation anchor, and optional Harness home.
 * @returns orphaned third-party bundles in Loader order.
 */
export function inspectOrphanedProfileBundles(options: ProfileDependencyOptions): OrphanedProfileBundle[] {
  const home = options.home ?? resolveDshHome()
  const profileDir = resolveProfileDir(options.profile, home)
  const manifest = readProfileManifest(options.binName, profileDir)
  const dependencies = manifest.dependencies ?? {}
  const bundles = manifest.dsh?.profile?.bundles ?? []
  const issues: OrphanedProfileBundle[] = []
  for (const [bundleIndex, packageName] of bundles.entries()) {
    if (packageName.startsWith('@deepseek-ai/') || dependencies[packageName] !== undefined) continue
    const packageDir = packageDirFromAnchor(join(profileDir, 'package.json'), packageName)
    if (packageDir === undefined) {
      issues.push({ profile: options.profile, packageName, bundleIndex })
      continue
    }
    const resolvedPath = canonical(packageDir)
    const version = readPackageManifest(join(resolvedPath, 'package.json')).version
    issues.push({
      profile: options.profile,
      packageName,
      bundleIndex,
      ...(version === undefined ? {} : { installedVersion: version }),
      resolvedPath,
    })
  }
  return issues
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(temporary, content, { flag: 'wx' })
  renameSync(temporary, path)
}

function rmFile(path: string): void {
  unlinkSync(path)
}

function normalizedLinkPath(path: string): string {
  return path.split(sep).join('/')
}

/** Merge Harness-owned convergence overrides while preserving unrelated YAML nodes and comments. */
function writeSharedHostOverrides(profileDir: string): void {
  const workspacePath = join(profileDir, PROFILE_WORKSPACE_FILENAME)
  const source = readFileSync(workspacePath, 'utf8')
  const document = parseDocument(source)
  if (document.errors.length > 0) {
    throw new Error(`dsh: cannot update ${workspacePath}: ${document.errors.map(error => error.message).join('; ')}`)
  }
  let overrides = document.get('overrides', true)
  if (overrides === undefined) {
    overrides = new YAMLMap()
    document.set('overrides', overrides)
  }
  if (!isMap(overrides)) throw new Error(`dsh: ${workspacePath} overrides must be a YAML mapping`)
  for (const packageName of SHARED_HOST_PACKAGES) {
    const target = normalizedLinkPath(join('..', 'node_modules', packageName))
    overrides.set(packageName, `link:${target}`)
  }
  const rendered = document.toString()
  if (rendered !== source) atomicWrite(workspacePath, rendered)
}

/** Disable pnpm peer-dependent deduplication, whose diamond resolver cannot handle this linked Host graph. */
function writeProfilePnpmCompatibility(profileDir: string): void {
  const workspacePath = join(profileDir, PROFILE_WORKSPACE_FILENAME)
  const source = readFileSync(workspacePath, 'utf8')
  const document = parseDocument(source)
  if (document.errors.length > 0) {
    throw new Error(`dsh: cannot update ${workspacePath}: ${document.errors.map(error => error.message).join('; ')}`)
  }
  document.set('dedupePeerDependents', false)
  const rendered = document.toString()
  if (rendered !== source) atomicWrite(workspacePath, rendered)
}

/** Remove importer entries whose dependency declarations no longer exist in the profile manifest. */
function pruneStaleLockfileImporter(profileDir: string): string[] {
  const lockfilePath = join(profileDir, PROFILE_LOCKFILE_FILENAME)
  if (!existsSync(lockfilePath)) return []
  const source = readFileSync(lockfilePath, 'utf8')
  const document = parseDocument(source)
  if (document.errors.length > 0) {
    throw new Error(`dsh: cannot update ${lockfilePath}: ${document.errors.map(error => error.message).join('; ')}`)
  }
  const importer = document.getIn(['importers', '.'], true)
  if (importer === undefined) return []
  if (!isMap(importer)) throw new Error(`dsh: ${lockfilePath} root importer must be a YAML mapping`)

  const manifest = readPackageManifest(join(profileDir, 'package.json'))
  const groups = [
    ['dependencies', manifest.dependencies ?? {}],
    ['optionalDependencies', manifest.optionalDependencies ?? {}],
    ['devDependencies', manifest.devDependencies ?? {}],
  ] as const
  const removed: string[] = []
  for (const [groupName, declarations] of groups) {
    const group = importer.get(groupName, true)
    if (group === undefined) continue
    if (!isMap(group)) throw new Error(`dsh: ${lockfilePath} importer ${groupName} must be a YAML mapping`)
    for (const item of [...group.items]) {
      const packageName = String(item.key)
      if (declarations[packageName] !== undefined) continue
      group.delete(packageName)
      removed.push(packageName)
    }
    if (group.items.length === 0) importer.delete(groupName)
  }
  if (removed.length > 0) atomicWrite(lockfilePath, document.toString())
  return removed
}

function quarantineFilePath(home: string): string {
  return join(home, QUARANTINE_DIRECTORY, QUARANTINE_FILENAME)
}

function readQuarantineFile(home: string): ProfileQuarantineFile {
  const path = quarantineFilePath(home)
  if (!existsSync(path)) return { schema: PROFILE_QUARANTINE_SCHEMA, plugins: [] }
  const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<ProfileQuarantineFile>
  if (value.schema !== PROFILE_QUARANTINE_SCHEMA || !Array.isArray(value.plugins)) {
    throw new Error(`dsh: unsupported profile quarantine file ${path}`)
  }
  return value as ProfileQuarantineFile
}

/**
 * List durable plugin quarantine records.
 * @param home - Harness home; defaults to {@link resolveDshHome}.
 * @returns records in persistence order.
 */
export function listQuarantinedProfilePlugins(home: string = resolveDshHome()): readonly QuarantinedProfilePlugin[] {
  return readQuarantineFile(home).plugins
}

/**
 * Remove one durable quarantine record without reinstalling its plugin.
 * @param quarantineId - opaque id from {@link QuarantinedProfilePlugin}.
 * @param home - Harness home; defaults to {@link resolveDshHome}.
 * @returns true when a record was removed.
 */
export function clearQuarantinedProfilePlugin(
  quarantineId: string,
  home: string = resolveDshHome(),
): boolean {
  const state = readQuarantineFile(home)
  const plugins = state.plugins.filter(plugin => plugin.quarantineId !== quarantineId)
  if (plugins.length === state.plugins.length) return false
  atomicWrite(quarantineFilePath(home), `${JSON.stringify({ ...state, plugins }, undefined, 2)}\n`)
  return true
}

/**
 * Remove an inactive quarantined plugin from its profile and discard its record.
 * @param quarantineId - opaque id from {@link QuarantinedProfilePlugin}.
 * @param home - Harness home; defaults to {@link resolveDshHome}.
 * @returns true when the quarantined plugin was removed.
 */
export function uninstallQuarantinedProfilePlugin(
  quarantineId: string,
  home: string = resolveDshHome(),
): boolean {
  const record = findQuarantinedProfilePlugin(quarantineId, home)
  if (record === undefined) return false
  if (!PACKAGE_NAME.test(record.packageName)) {
    throw new Error(`dsh: invalid quarantined package name ${JSON.stringify(record.packageName)}`)
  }

  const profileDir = resolveProfileDir(record.profile, home)
  const manifest = readProfileManifest('dsh', profileDir)
  const activeDependency = manifest.dependencies?.[record.packageName] !== undefined
  const activeBundle = manifest.dsh?.profile?.bundles?.includes(record.packageName) === true
  if (activeDependency || activeBundle) {
    throw new Error(`dsh: cannot uninstall active quarantined plugin ${record.packageName}`)
  }

  const nodeModulesDir = resolve(profileDir, 'node_modules')
  const packageDir = resolve(nodeModulesDir, record.packageName)
  const packageRelative = relative(nodeModulesDir, packageDir)
  if (packageRelative === '' || packageRelative === '..' || packageRelative.startsWith(`..${sep}`)) {
    throw new Error(`dsh: quarantined package path escapes profile ${record.packageName}`)
  }
  rmSync(packageDir, { recursive: true, force: true })
  return clearQuarantinedProfilePlugin(quarantineId, home)
}

function findQuarantinedProfilePlugin(
  quarantineId: string,
  home: string,
): QuarantinedProfilePlugin | undefined {
  return readQuarantineFile(home).plugins.find(record => record.quarantineId === quarantineId)
}

function persistQuarantines(home: string, records: readonly QuarantinedProfilePlugin[]): void {
  if (records.length === 0) return
  const state = readQuarantineFile(home)
  const keys = new Set(records.map(record => `${record.profile}\0${record.packageName}`))
  const plugins = state.plugins.filter(record => !keys.has(`${record.profile}\0${record.packageName}`))
  plugins.push(...records)
  atomicWrite(quarantineFilePath(home), `${JSON.stringify({ ...state, plugins }, undefined, 2)}\n`)
}

function installedVersion(profileDir: string, packageName: string): string | undefined {
  const packageDir = packageDirFromAnchor(join(profileDir, 'package.json'), packageName)
  if (packageDir === undefined) return undefined
  return readPackageManifest(join(packageDir, 'package.json')).version
}

function quarantineRecords(
  profile: string,
  profileDir: string,
  manifest: ProfileManifest,
  roots: ReadonlySet<string>,
  conflicts: readonly ProfileDependencyConflict[],
  now: Date,
  orphanedRoots: ReadonlySet<string> = new Set(),
): QuarantinedProfilePlugin[] {
  const bundles = manifest.dsh?.profile?.bundles ?? []
  return [...roots].sort().map((packageName) => {
    const version = installedVersion(profileDir, packageName)
    return {
      quarantineId: randomUUID(),
      profile,
      packageName,
      packageSpec: manifest.dependencies?.[packageName] ?? packageName,
      ...(version === undefined ? {} : { installedVersion: version }),
      bundleIndex: bundles.indexOf(packageName) < 0 ? null : bundles.indexOf(packageName),
      quarantinedAt: now.toISOString(),
      reason: orphanedRoots.has(packageName)
        ? 'orphaned-bundle'
        : conflicts.some(conflict => conflict.rootPackage === packageName && !conflict.compatible)
          ? 'incompatible-host-dependency'
          : 'convergence-failed',
      conflicts: conflicts.filter(conflict => conflict.rootPackage === packageName),
    }
  })
}

function withoutRoots(manifest: ProfileManifest, roots: ReadonlySet<string>): ProfileManifest {
  const dependencies = Object.fromEntries(
    Object.entries(manifest.dependencies ?? {}).filter(([name]) => !roots.has(name)),
  )
  const bundles = (manifest.dsh?.profile?.bundles ?? []).filter(name => !roots.has(name))
  return {
    ...manifest,
    dependencies,
    dsh: { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } },
  }
}

function withRestoredPlugin(manifest: ProfileManifest, record: QuarantinedProfilePlugin): ProfileManifest {
  const dependencies = { ...manifest.dependencies, [record.packageName]: record.packageSpec }
  const bundles = [...(manifest.dsh?.profile?.bundles ?? [])]
  if (record.bundleIndex !== null && !bundles.includes(record.packageName)) {
    bundles.splice(Math.min(record.bundleIndex, bundles.length), 0, record.packageName)
  }
  return {
    ...manifest,
    dependencies,
    dsh: { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } },
  }
}

function report(
  profile: string,
  status: ProfileRepairReport['status'],
  conflicts: readonly ProfileDependencyConflict[],
  quarantined: readonly QuarantinedProfilePlugin[] = [],
  diagnostic?: string,
  orphanedBundles: readonly OrphanedProfileBundle[] = [],
): ProfileRepairReport {
  return {
    schema: 'dsh/profile-dependency-repair/v1',
    profile,
    status,
    conflicts,
    ...(orphanedBundles.length === 0 ? {} : { orphanedBundles }),
    quarantined,
    ...(diagnostic === undefined ? {} : { diagnostic }),
  }
}

function retainMaterialReport(home: string, value: ProfileRepairReport): ProfileRepairReport {
  if (value.status !== 'healthy') {
    atomicWrite(profileRepairReportPath(home, value.profile), `${JSON.stringify(value, undefined, 2)}\n`)
  }
  return value
}

function releaseAgeBlocked(result: ProfilePackageManagerResult): boolean {
  const diagnostic = result.diagnostic ?? ''
  return diagnostic.includes(MINIMUM_RELEASE_AGE_ERROR)
    || diagnostic.toLowerCase().includes('minimum release age')
}

function cleanupInstallArgs(blocked: ProfilePackageManagerResult): readonly string[] {
  return releaseAgeBlocked(blocked)
    ? ['install', MINIMUM_RELEASE_AGE_OVERRIDE]
    : ['install']
}

function recoverableQuarantines(
  binName: string,
  profile: string,
  profileDir: string,
  home: string,
  now: Date,
): QuarantinedProfilePlugin[] {
  const retained = readLastProfileRepairReport(profile, home)
  if (retained === undefined || retained.status === 'healthy' || retained.status === 'repaired') return []
  const manifest = readProfileManifest(binName, profileDir)
  const durable = new Set(readQuarantineFile(home).plugins.map(record => `${record.profile}\0${record.packageName}`))
  const candidates = retained.quarantined.length > 0
    ? retained.quarantined
    : (retained.orphanedBundles ?? []).map((orphan): QuarantinedProfilePlugin => ({
      quarantineId: randomUUID(),
      profile,
      packageName: orphan.packageName,
      packageSpec: orphan.packageName,
      ...(orphan.installedVersion === undefined ? {} : { installedVersion: orphan.installedVersion }),
      bundleIndex: orphan.bundleIndex,
      quarantinedAt: now.toISOString(),
      reason: 'orphaned-bundle',
      conflicts: retained.conflicts.filter(conflict => conflict.rootPackage === orphan.packageName),
    }))
  return candidates.filter((record) => {
    if (record.profile !== profile || durable.has(`${record.profile}\0${record.packageName}`)) return false
    if (manifest.dependencies?.[record.packageName] !== undefined
      || manifest.dsh?.profile?.bundles?.includes(record.packageName) === true) return false
    return existsSync(join(profileDir, 'node_modules', record.packageName, 'package.json'))
  })
}

function retainedPluginDirectories(
  profileDir: string,
  records: readonly QuarantinedProfilePlugin[],
): QuarantinedProfilePlugin[] {
  return records.filter(record => existsSync(join(profileDir, 'node_modules', record.packageName)))
}

function profilePackageDirectory(profileDir: string, packageName: string): string {
  if (!PACKAGE_NAME.test(packageName)) {
    throw new Error(`dsh: invalid profile package name ${JSON.stringify(packageName)}`)
  }
  const nodeModulesDir = resolve(profileDir, 'node_modules')
  const packageDir = resolve(nodeModulesDir, packageName)
  const packageRelative = relative(nodeModulesDir, packageDir)
  if (packageRelative === '' || packageRelative === '..' || packageRelative.startsWith(`..${sep}`)) {
    throw new Error(`dsh: profile package path escapes node_modules ${packageName}`)
  }
  return packageDir
}

function removeInterruptedQuarantineResidue(
  options: ProfileDependencyOptions,
  home: string,
  profileDir: string,
  records: readonly QuarantinedProfilePlugin[],
): void {
  const manifest = readProfileManifest(options.binName, profileDir)
  for (const record of records) {
    if (manifest.dependencies?.[record.packageName] !== undefined
      || manifest.dsh?.profile?.bundles?.includes(record.packageName) === true) {
      throw new Error(`dsh: cannot remove active quarantined plugin ${record.packageName}`)
    }
    rmSync(profilePackageDirectory(profileDir, record.packageName), { recursive: true, force: true })
  }

  const hosts = hostPackages(options.installAnchor, home)
  for (const packageName of SHARED_HOST_PACKAGES) {
    const host = hosts.get(packageName)
    if (host === undefined) continue
    const profileCopy = profilePackageDirectory(profileDir, packageName)
    if (existsSync(profileCopy) && canonical(profileCopy) === host.path) continue
    rmSync(profileCopy, { recursive: true, force: true })
    mkdirSync(dirname(profileCopy), { recursive: true })
    symlinkSync(host.path, profileCopy, process.platform === 'win32' ? 'junction' : 'dir')
  }
}

function recoverInterruptedQuarantine(
  options: ProfileRepairOptions,
  home: string,
  profileDir: string,
): ProfileRepairReport | undefined {
  const pending = recoverableQuarantines(
    options.binName,
    options.profile,
    profileDir,
    home,
    (options.now ?? (() => new Date()))(),
  )
  if (pending.length === 0) return undefined
  const retained = readLastProfileRepairReport(options.profile, home)
  const cleanup = options.runPackageManager(cleanupInstallArgs({
    exitCode: 1,
    ...(retained?.diagnostic === undefined ? {} : { diagnostic: retained.diagnostic }),
  }))
  if (cleanup.exitCode !== 0) {
    try {
      removeInterruptedQuarantineResidue(options, home, profileDir, pending)
    } catch (error) {
      return retainMaterialReport(home, report(
        options.profile,
        'failed',
        retained?.conflicts ?? [],
        [],
        error instanceof Error ? error.message : String(error),
        retained?.orphanedBundles ?? [],
      ))
    }
  }
  const residue = retainedPluginDirectories(profileDir, pending)
  const remainingConflicts = inspectProfileDependencies({ ...options, home })
  if (residue.length > 0 || remainingConflicts.length > 0) {
    return retainMaterialReport(home, report(
      options.profile,
      'failed',
      remainingConflicts,
      [],
      `profile quarantine cleanup retained ${[
        ...residue.map(record => record.packageName),
        ...remainingConflicts.map(conflict => conflict.dependency),
      ].join(', ')}`,
      retained?.orphanedBundles ?? [],
    ))
  }
  persistQuarantines(home, pending)
  return retainMaterialReport(home, report(
    options.profile,
    'quarantined',
    retained?.conflicts ?? [],
    pending,
    cleanup.exitCode === 0
      ? undefined
      : `pnpm cleanup failed; inactive plugin residue was removed directly\n${cleanup.diagnostic ?? ''}`.trim(),
    retained?.orphanedBundles ?? [],
  ))
}

/**
 * Converge compatible shared dependencies and quarantine root plugins when convergence cannot make the profile healthy.
 * @param options - profile inputs plus the caller-owned pnpm runner.
 * @returns a complete repair outcome; `failed` means callers must not boot the profile.
 */
export function repairProfileDependencies(options: ProfileRepairOptions): ProfileRepairReport {
  const home = options.home ?? resolveDshHome()
  const profileDir = resolveProfileDir(options.profile, home)
  writeProfilePnpmCompatibility(profileDir)
  const prunedLockfileDependencies = pruneStaleLockfileImporter(profileDir)
  const initial = inspectProfileDependencies({ ...options, home })
  const initialOrphans = inspectOrphanedProfileBundles({ ...options, home })
  if (initial.length === 0 && initialOrphans.length === 0) {
    const recovered = recoverInterruptedQuarantine(options, home, profileDir)
    if (recovered !== undefined) return recovered
    if (prunedLockfileDependencies.length > 0) {
      return retainMaterialReport(home, report(
        options.profile,
        'repaired',
        [],
        [],
        `removed stale lockfile dependencies: ${prunedLockfileDependencies.join(', ')}`,
      ))
    }
    return report(options.profile, 'healthy', [])
  }

  writeSharedHostOverrides(profileDir)
  const originalManifest = readProfileManifest(options.binName, profileDir)
  const now = (options.now ?? (() => new Date()))()
  const quarantined: QuarantinedProfilePlugin[] = []
  const incompatibleRoots = new Set(initial.filter(conflict => !conflict.compatible).map(conflict => conflict.rootPackage))
  const orphanedRoots = new Set(initialOrphans.map(issue => issue.packageName))
  for (const root of orphanedRoots) incompatibleRoots.add(root)
  if (incompatibleRoots.size > 0) {
    quarantined.push(...quarantineRecords(
      options.profile,
      profileDir,
      originalManifest,
      incompatibleRoots,
      initial,
      now,
      orphanedRoots,
    ))
    writeProfileManifest(profileDir, withoutRoots(originalManifest, incompatibleRoots))
  }

  const firstInstall = options.runPackageManager(['install'])
  if (firstInstall.exitCode === 0) {
    const remaining = inspectProfileDependencies({ ...options, home })
    const remainingOrphans = inspectOrphanedProfileBundles({ ...options, home })
    if (remaining.length === 0
      && remainingOrphans.length === 0
      && retainedPluginDirectories(profileDir, quarantined).length === 0) {
      persistQuarantines(home, quarantined)
      return retainMaterialReport(
        home,
        report(
          options.profile,
          quarantined.length === 0 ? 'repaired' : 'quarantined',
          initial,
          quarantined,
          undefined,
          initialOrphans,
        ),
      )
    }
    const remainingRoots = new Set(remaining.map(conflict => conflict.rootPackage))
    for (const issue of remainingOrphans) remainingRoots.add(issue.packageName)
    const beforeQuarantine = readProfileManifest(options.binName, profileDir)
    const extra = quarantineRecords(
      options.profile,
      profileDir,
      beforeQuarantine,
      remainingRoots,
      remaining,
      now,
      new Set(remainingOrphans.map(issue => issue.packageName)),
    )
    writeProfileManifest(profileDir, withoutRoots(beforeQuarantine, remainingRoots))
    const removalInstall = options.runPackageManager(['install'])
    if (removalInstall.exitCode === 0
      && inspectProfileDependencies({ ...options, home }).length === 0
      && inspectOrphanedProfileBundles({ ...options, home }).length === 0
      && retainedPluginDirectories(profileDir, [...quarantined, ...extra]).length === 0) {
      quarantined.push(...extra)
      persistQuarantines(home, quarantined)
      return retainMaterialReport(home, report(
        options.profile,
        'quarantined',
        initial,
        quarantined,
        undefined,
        initialOrphans,
      ))
    }
    writeProfileManifest(profileDir, originalManifest)
    return retainMaterialReport(home, report(
      options.profile,
      'failed',
      initial,
      quarantined,
      removalInstall.diagnostic ?? 'profile remained conflicted after quarantine',
      initialOrphans,
    ))
  }

  const fallbackRoots = new Set(initial.map(conflict => conflict.rootPackage))
  for (const issue of initialOrphans) fallbackRoots.add(issue.packageName)
  const fallbackRecords = quarantineRecords(
    options.profile,
    profileDir,
    originalManifest,
    fallbackRoots,
    initial,
    now,
    orphanedRoots,
  )
  writeProfileManifest(profileDir, withoutRoots(originalManifest, fallbackRoots))
  const fallbackInstall = options.runPackageManager(cleanupInstallArgs(firstInstall))
  if (fallbackInstall.exitCode === 0
    && inspectProfileDependencies({ ...options, home }).length === 0
    && inspectOrphanedProfileBundles({ ...options, home }).length === 0
    && retainedPluginDirectories(profileDir, fallbackRecords).length === 0) {
    persistQuarantines(home, fallbackRecords)
    return retainMaterialReport(
      home,
      report(options.profile, 'quarantined', initial, fallbackRecords, firstInstall.diagnostic, initialOrphans),
    )
  }
  writeProfileManifest(profileDir, originalManifest)
  return retainMaterialReport(home, report(
    options.profile,
    'failed',
    initial,
    [],
    fallbackInstall.diagnostic ?? firstInstall.diagnostic ?? 'profile dependency repair failed',
    initialOrphans,
  ))
}

/**
 * Restore one quarantined plugin at its original dependency spec and bundle position, then run the ordinary repair policy.
 * A failed retry rolls the profile back to its known-clean manifest and verifies that rollback before returning.
 * @param options - profile inputs plus the caller-owned pnpm runner.
 * @param quarantineId - durable record selected by the caller.
 * @returns the repair result; `failed` retains the quarantine and leaves the plugin inactive.
 */
export function retryQuarantinedProfilePlugin(
  options: ProfileQuarantineRetryOptions,
  quarantineId: string,
): ProfileRepairReport {
  const home = options.home ?? resolveDshHome()
  const record = findQuarantinedProfilePlugin(quarantineId, home)
  if (record === undefined) {
    return retainMaterialReport(home, report(
      options.profile,
      'failed',
      [],
      [],
      `unknown quarantine record ${quarantineId}`,
    ))
  }
  if (record.profile !== options.profile) {
    return retainMaterialReport(home, report(
      options.profile,
      'failed',
      [],
      [],
      `quarantine record ${quarantineId} belongs to profile ${record.profile}`,
    ))
  }

  const profileDir = resolveProfileDir(options.profile, home)
  const cleanManifest = readProfileManifest(options.binName, profileDir)
  if (cleanManifest.dependencies?.[record.packageName] !== undefined) {
    return retainMaterialReport(home, report(
      options.profile,
      'failed',
      record.conflicts,
      [],
      `cannot retry ${record.packageName}: the profile already declares that dependency`,
    ))
  }

  const rollback = (diagnostic: string): ProfileRepairReport => {
    writeProfileManifest(profileDir, cleanManifest)
    const rollbackInstall = options.runPackageManager(['install'])
    const rollbackConflicts = rollbackInstall.exitCode === 0
      ? inspectProfileDependencies({ ...options, home })
      : record.conflicts
    const suffix = rollbackInstall.exitCode === 0 && rollbackConflicts.length === 0
      ? ''
      : `; rollback failed: ${rollbackInstall.diagnostic ?? 'profile remains conflicted'}`
    return retainMaterialReport(home, report(
      options.profile,
      'failed',
      record.conflicts,
      [],
      `${diagnostic}${suffix}`,
    ))
  }

  writeProfileManifest(profileDir, withRestoredPlugin(cleanManifest, record))
  const install = options.runPackageManager(['install'])
  if (install.exitCode !== 0) return rollback(install.diagnostic ?? `failed to restore ${record.packageName}`)

  const outcome = repairProfileDependencies({ ...options, home })
  if (outcome.status === 'failed') {
    return rollback(outcome.diagnostic ?? `failed to repair ${record.packageName}`)
  }
  const requarantined = outcome.quarantined.some(item => item.packageName === record.packageName)
  if (!requarantined) clearQuarantinedProfilePlugin(quarantineId, home)
  if (outcome.status === 'healthy') clearLastProfileRepairReport(options.profile, home)
  return outcome
}

/** Profile dependency identity checks, convergence, and quarantine persistence. */

import { randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire, isBuiltin } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { satisfies, valid, validRange } from 'semver'
import { isMap, parseDocument, YAMLMap } from 'yaml'
import { initSync as initEsmLexer, parse as parseEsmImports } from 'es-module-lexer'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  composeEntries,
  DEFAULT_PROFILE_BUNDLES,
  loadProfile,
  PROFILE_TEMPLATES,
  PROFILES_DIR,
  readProfileManifest,
  resolveProfileLoaderModule,
  resolveProfileDir,
  writeProfileManifest,
  type ProfileManifest,
} from './profile.ts'
import {
  classifyProfileDiagnostic,
  clearProfileDiagnosticReport,
  createProfileDiagnosticReport,
  extractProfileBuildApprovalKey,
  orphanedBundleDiagnostic,
  profileLoaderEntryCollisionDiagnostic,
  profileHostCompatibilityDiagnostic,
  profileDependencyConflictDiagnostic,
  quarantinedPluginDiagnostic,
  readProfileDiagnosticReport,
  sanitizeProfileDiagnostic,
  writeProfileDiagnosticReport,
  type ProfileDiagnostic,
} from './profile-diagnostics.ts'

/** Version of durable quarantine records written under the Harness home. */
export const PROFILE_QUARANTINE_SCHEMA = 1 as const

/** Host packages whose runtime identities must be shared by every profile plugin. */
export const SHARED_HOST_PACKAGES = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-attachment',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-scope',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-tools',
] as const

const sharedHostPackages = new Set<string>(SHARED_HOST_PACKAGES)
const PROFILE_WORKSPACE_FILENAME = 'pnpm-workspace.yaml'
const PROFILE_LOCKFILE_FILENAME = 'pnpm-lock.yaml'
const QUARANTINE_DIRECTORY = 'quarantine'
const QUARANTINE_FILENAME = 'profile-plugins.json'
const PROFILE_HEALTH_DIRECTORY = 'profile-health'
const PLUGIN_COMPATIBILITY_FILENAME = 'compatibility.json'
const MAX_PLUGIN_COMPATIBILITY_BYTES = 64 * 1024
const MAX_SUPPORTED_HOSTS = 32
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/iu
const DIST_TAG = /^[a-z0-9][a-z0-9._-]{0,63}$/iu

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

/** An active plugin whose valid package-owned declaration excludes the running Harness version. */
export interface ProfileHostCompatibilityIssue {
  readonly profile: string
  readonly packageName: string
  readonly installedVersion?: string
  readonly hostVersion: string
  readonly supportedHostVersions: readonly string[]
  readonly recommendedHostVersion?: string
  readonly previewTag?: string
}

/** A uniquely attributable Loader entry whose declared module cannot resolve from the active Profile. */
export interface UnresolvableProfileBundleEntry {
  readonly profile: string
  readonly rootPackage: string
  readonly entryId: string
  readonly moduleName: string
  readonly patchPath: string
  readonly missingModule?: string
  readonly importerPackage?: string
  readonly failureKind?: 'loader-module' | 'loader-dependency'
}

/** A final Loader row that can be proven to originate from one active external bundle. */
export interface ProfileBundleEntryOwnership {
  readonly profile: string
  readonly rootPackage: string
  readonly entryId: string
  readonly moduleName: string
  readonly patchPath: string
}

/** An external Bundle entry whose id is already owned by a shipped Profile layer. */
export interface ProfileLoaderEntryCollision extends ProfileBundleEntryOwnership {
  readonly installationPackage: string
  readonly installationModuleName: string
  readonly installationPatchPath: string
}

/** Closed reason set persisted with each automatically isolated plugin. */
export type ProfileQuarantineReason =
  | 'incompatible-host-version'
  | 'incompatible-host-dependency'
  | 'convergence-failed'
  | 'orphaned-bundle'
  | 'build-script-blocked'
  | 'client-module-unavailable'
  | 'loader-module-unresolvable'
  | 'loader-dependency-unavailable'
  | 'loader-entry-collision'
  | 'loader-lifecycle-failed'

/** Durable information required to explain or retry an automatically isolated plugin. */
export interface QuarantinedProfilePlugin {
  readonly quarantineId: string
  readonly profile: string
  readonly packageName: string
  readonly packageSpec: string
  readonly installedVersion?: string
  readonly bundleIndex: number | null
  readonly quarantinedAt: string
  readonly reason: ProfileQuarantineReason
  readonly hostCompatibility?: ProfileHostCompatibilityIssue
  readonly buildApprovalKey?: string
  readonly conflicts: readonly ProfileDependencyConflict[]
}

/** Derived Profile state left after an inactive quarantined plugin was physically removed. */
export interface QuarantineRemovalResidue {
  readonly profile: string
  readonly packageName: string
  readonly quarantineId: string
  readonly staleComponents: readonly (
    | 'repair-report'
    | 'diagnostic-report'
    | 'lockfile-importer'
    | 'package-directory'
  )[]
}

interface ProfileQuarantineFile {
  schema: typeof PROFILE_QUARANTINE_SCHEMA
  plugins: QuarantinedProfilePlugin[]
}

/** Observable result of one dependency-health repair attempt. */
export interface ProfileRepairReport {
  readonly schema: 'dsh/profile-dependency-repair/v1'
  readonly diagnosticSchema?: 'dsh/profile-diagnostic/v2'
  readonly profile: string
  readonly status: 'healthy' | 'repaired' | 'quarantined' | 'failed'
  readonly conflicts: readonly ProfileDependencyConflict[]
  readonly orphanedBundles?: readonly OrphanedProfileBundle[]
  readonly hostCompatibilityIssues?: readonly ProfileHostCompatibilityIssue[]
  readonly quarantined: readonly QuarantinedProfilePlugin[]
  readonly diagnostic?: string
  readonly issues?: readonly ProfileDiagnostic[]
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

/** Resolve only a package physically owned by one package.json directory. */
function directPackageDir(anchor: string, packageName: string): string | undefined {
  const candidate = join(dirname(anchor), 'node_modules', packageName)
  return existsSync(join(candidate, 'package.json')) ? candidate : undefined
}

function readPackageManifest(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
}

interface PluginCompatibilityDeclaration {
  readonly supportedHostVersions: readonly string[]
  readonly recommendedHostVersion?: string
  readonly previewTag?: string
}

function parsePluginCompatibilityDeclaration(value: unknown): PluginCompatibilityDeclaration | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== 1 || !Array.isArray(record.supportedHosts)
    || record.supportedHosts.length === 0 || record.supportedHosts.length > MAX_SUPPORTED_HOSTS) return undefined

  const supportedHostVersions: string[] = []
  const seen = new Set<string>()
  for (const item of record.supportedHosts) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return undefined
    const versionValue = (item as Record<string, unknown>).version
    if (typeof versionValue !== 'string') return undefined
    const version = valid(versionValue)
    if (version === null || seen.has(version)) return undefined
    seen.add(version)
    supportedHostVersions.push(version)
  }

  const recommendedHostValue = record.recommendedHost
  const recommendedHostVersion = recommendedHostValue === undefined
    ? undefined
    : typeof recommendedHostValue === 'string'
      ? valid(recommendedHostValue) ?? undefined
      : undefined
  if (recommendedHostValue !== undefined
    && (recommendedHostVersion === undefined || !seen.has(recommendedHostVersion))) return undefined

  const previewTagValue = record.previewTag
  const previewTag = previewTagValue === undefined
    ? undefined
    : typeof previewTagValue === 'string' && DIST_TAG.test(previewTagValue)
      ? previewTagValue
      : undefined
  if (previewTagValue !== undefined && previewTag === undefined) return undefined

  return {
    supportedHostVersions,
    ...(recommendedHostVersion === undefined ? {} : { recommendedHostVersion }),
    ...(previewTag === undefined ? {} : { previewTag }),
  }
}

function readPluginCompatibilityDeclaration(packageDir: string): PluginCompatibilityDeclaration | undefined {
  const path = join(packageDir, PLUGIN_COMPATIBILITY_FILENAME)
  if (!existsSync(path)) return undefined
  try {
    const stats = lstatSync(path)
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_PLUGIN_COMPATIBILITY_BYTES) return undefined
    return parsePluginCompatibilityDeclaration(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return undefined
  }
}

/**
 * Inspect valid package-owned Harness compatibility declarations without executing plugin code.
 * Missing, malformed, oversized, symlinked, or unknown declarations remain compatible-by-default;
 * only a valid schema-v1 declaration that excludes the current Host produces an issue.
 * @param options - Profile and running installation identity.
 * @returns Active external bundles that explicitly exclude the running Harness version.
 */
export function inspectProfileHostCompatibility(
  options: ProfileDependencyOptions,
): ProfileHostCompatibilityIssue[] {
  const home = options.home ?? resolveDshHome()
  const hostVersionValue = readPackageManifest(options.installAnchor).version
  const hostVersion = typeof hostVersionValue === 'string' ? valid(hostVersionValue) : null
  if (hostVersion === null) return []

  const profileDir = resolveProfileDir(options.profile, home)
  const manifest = readProfileManifest(options.binName, profileDir)
  const installationOwned = new Set(PROFILE_TEMPLATES[options.profile]?.bundles ?? DEFAULT_PROFILE_BUNDLES)
  const issues: ProfileHostCompatibilityIssue[] = []
  for (const packageName of manifest.dsh?.profile?.bundles ?? []) {
    if (installationOwned.has(packageName) || manifest.dependencies?.[packageName] === undefined
      || !PACKAGE_NAME.test(packageName)) continue
    const packageDir = directPackageDir(join(profileDir, 'package.json'), packageName)
    if (packageDir === undefined) continue
    const declaration = readPluginCompatibilityDeclaration(packageDir)
    if (declaration === undefined || declaration.supportedHostVersions.includes(hostVersion)) continue
    const installedVersionValue = readPackageManifest(join(packageDir, 'package.json')).version
    issues.push({
      profile: options.profile,
      packageName,
      ...(typeof installedVersionValue === 'string' ? { installedVersion: installedVersionValue } : {}),
      hostVersion,
      supportedHostVersions: declaration.supportedHostVersions,
      ...(declaration.recommendedHostVersion === undefined
        ? {}
        : { recommendedHostVersion: declaration.recommendedHostVersion }),
      ...(declaration.previewTag === undefined ? {} : { previewTag: declaration.previewTag }),
    })
  }
  return issues
}

/**
 * Flag potential legacy Session API use without executing or quarantining external code.
 * The bounded lexical check is advisory: source text alone cannot establish receiver types.
 * @param options - Profile identity and optional isolated configuration home.
 * @returns At most one warning per active external bundle, with package-relative evidence.
 */
export function inspectProfileLegacySessionApi(
  options: Pick<ProfileDependencyOptions, 'binName' | 'profile' | 'home'>,
): ProfileDiagnostic[] {
  const dir = resolveProfileDir(options.profile, options.home ?? resolveDshHome())
  if (!existsSync(join(dir, 'package.json'))) return []
  const manifest = readProfileManifest(options.binName, dir)
  const issues: ProfileDiagnostic[] = []
  const installationOwned = new Set(PROFILE_TEMPLATES[options.profile]?.bundles ?? DEFAULT_PROFILE_BUNDLES)
  let totalBytes = 0
  for (const packageName of new Set(manifest.dsh?.profile?.bundles ?? [])) {
    if (totalBytes >= 8 * 1024 * 1024) break
    if (installationOwned.has(packageName) || !PACKAGE_NAME.test(packageName)
      || manifest.dependencies?.[packageName] === undefined) continue
    const root = directPackageDir(join(dir, 'package.json'), packageName)
    if (root === undefined) continue
    let metadata: PackageManifest
    try { metadata = readPackageManifest(join(root, 'package.json')) } catch { continue }
    const peers = metadata.peerDependencies as Record<string, unknown> | undefined
    if (peers?.['@deepseek-ai/dsh-session'] === undefined) continue
    const pending = [root]
    let bytes = 0
    let entries = 0
    let found = false
    while (pending.length > 0 && bytes < 2 * 1024 * 1024 && entries < 256 && !found) {
      const directory = pending.pop()
      if (directory === undefined) break
      // An optional advisory scan must not prevent diagnosis after a concurrent uninstall.
      let children: string[]
      try { children = readdirSync(directory) } catch { continue }
      for (const name of children) {
        if (++entries > 256) break
        const path = join(directory, name)
        let entry: ReturnType<typeof lstatSync>
        try { entry = lstatSync(path) } catch { continue }
        if (entry.isDirectory() && !['node_modules', 'vendor', 'tests', '.git'].includes(name)) {
          pending.push(path)
        } else if (entry.isFile() && /\.[cm]?js$/u.test(name)) {
          const size = entry.size
          if (size > 256 * 1024 || bytes + size > 2 * 1024 * 1024 || totalBytes + size > 8 * 1024 * 1024) continue
          bytes += size
          totalBytes += size
          let source: string
          try { source = readFileSync(path, 'utf8') } catch { continue }
          if (!/for\s*\([^)]*\bof\s+(?:\w+\.)?session\.events\s*\)/u.test(source)) continue
          const issue = classifyProfileDiagnostic({
            source: 'profile', phase: 'preflight', attribution: { rootPackage: packageName },
            value: `Possible legacy Session.events API in ${relative(root, path).split(sep).join('/')}. Opening a conversation may fail. Review or update this plugin; if affected, disable or uninstall it. The current Session API uses snapshotEvents(). Static evidence is not proof of a runtime failure.`,
          })
          issues.push({ ...issue, severity: 'warning' })
          found = true
          break
        }
      }
    }
  }
  return issues
}

/**
 * Flag external bundles that subscribe to `agent/pre-step` and directly assign
 * a text field in the same shipped module. Agent input is deeply frozen before
 * publication, so this pattern can fail every turn before a model request.
 * Source evidence remains advisory because a lexical scan cannot prove the
 * receiver identity; it never mutates or quarantines the plugin.
 * @param options - Profile identity and optional isolated configuration home.
 * @returns At most one warning per active external bundle.
 */
export function inspectProfileImmutableAgentInputMutation(
  options: Pick<ProfileDependencyOptions, 'binName' | 'profile' | 'home'>,
): ProfileDiagnostic[] {
  const dir = resolveProfileDir(options.profile, options.home ?? resolveDshHome())
  if (!existsSync(join(dir, 'package.json'))) return []
  const manifest = readProfileManifest(options.binName, dir)
  const issues: ProfileDiagnostic[] = []
  const installationOwned = new Set(PROFILE_TEMPLATES[options.profile]?.bundles ?? DEFAULT_PROFILE_BUNDLES)
  let totalBytes = 0
  for (const packageName of new Set(manifest.dsh?.profile?.bundles ?? [])) {
    if (totalBytes >= 8 * 1024 * 1024) break
    if (installationOwned.has(packageName) || !PACKAGE_NAME.test(packageName)
      || manifest.dependencies?.[packageName] === undefined) continue
    const root = directPackageDir(join(dir, 'package.json'), packageName)
    if (root === undefined) continue
    const pending = [root]
    let bytes = 0
    let entries = 0
    let found = false
    while (pending.length > 0 && bytes < 2 * 1024 * 1024 && entries < 256 && !found) {
      const directory = pending.pop()
      if (directory === undefined) break
      let children: string[]
      try { children = readdirSync(directory) } catch { continue }
      for (const name of children) {
        if (++entries > 256) break
        const path = join(directory, name)
        let entry: ReturnType<typeof lstatSync>
        try { entry = lstatSync(path) } catch { continue }
        if (entry.isDirectory() && !['node_modules', 'vendor', 'tests', '.git'].includes(name)) {
          pending.push(path)
        } else if (entry.isFile() && /\.[cm]?js$/u.test(name)) {
          const size = entry.size
          if (size > 256 * 1024 || bytes + size > 2 * 1024 * 1024 || totalBytes + size > 8 * 1024 * 1024) continue
          bytes += size
          totalBytes += size
          let source: string
          try { source = readFileSync(path, 'utf8') } catch { continue }
          if (!/["']agent\/pre-step["']/u.test(source)
            || !/\b[A-Za-z_$][\w$]*\s*\.\s*(?:text|content|messages)\s*=(?!=)/u.test(source)) continue
          const issue = classifyProfileDiagnostic({
            source: 'profile', phase: 'preflight', attribution: { rootPackage: packageName },
            value: `Possible immutable agent input mutation in ${relative(root, path).split(sep).join('/')}. The plugin subscribes to agent/pre-step and assigns a frozen message field. Opening any conversation may fail. Update, disable, or uninstall the plugin. Static evidence is not proof of a runtime failure.`,
          })
          issues.push({ ...issue, severity: 'warning' })
          found = true
          break
        }
      }
    }
  }
  return issues
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
 * Find Loader bundles that are still composed but cannot be managed or removed by pnpm.
 * Only the active profile template's installation-owned layers are excluded;
 * separately installed official plugins remain dependency-managed like every other plugin.
 * @param options - profile, installation anchor, and optional Harness home.
 * @returns orphaned third-party bundles in Loader order.
 */
export function inspectOrphanedProfileBundles(options: ProfileDependencyOptions): OrphanedProfileBundle[] {
  const home = options.home ?? resolveDshHome()
  const profileDir = resolveProfileDir(options.profile, home)
  const manifest = readProfileManifest(options.binName, profileDir)
  const dependencies = manifest.dependencies ?? {}
  const bundles = manifest.dsh?.profile?.bundles ?? []
  const installationOwned = new Set(PROFILE_TEMPLATES[options.profile]?.bundles ?? DEFAULT_PROFILE_BUNDLES)
  const issues: OrphanedProfileBundle[] = []
  for (const [bundleIndex, packageName] of bundles.entries()) {
    if (installationOwned.has(packageName) || dependencies[packageName] !== undefined) continue
    const packageDir = directPackageDir(join(profileDir, 'package.json'), packageName)
      ?? directPackageDir(options.installAnchor, packageName)
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

function nestedLoaderEntries(entries: readonly EntryOptions[]): EntryOptions[] {
  const result: EntryOptions[] = []
  const visit = (entry: EntryOptions): void => {
    result.push(entry)
    if (Array.isArray(entry.config)) {
      for (const child of entry.config as EntryOptions[]) visit(child)
    }
  }
  for (const entry of entries) visit(entry)
  return result
}

function insertedLoaderEntries(patches: readonly PatchOptions[]): EntryOptions[] {
  return patches.flatMap((patch) => {
    const insert = (patch as PatchOptions & { insert?: EntryOptions[] }).insert
    return Array.isArray(insert) ? nestedLoaderEntries(insert) : []
  })
}

function enabledInsertedLoaderEntries(patches: readonly PatchOptions[]): EntryOptions[] {
  const result: EntryOptions[] = []
  const visit = (entry: EntryOptions): void => {
    if (entry.disabled === true) return
    result.push(entry)
    if (Array.isArray(entry.config)) {
      for (const child of entry.config as EntryOptions[]) visit(child)
    }
  }
  for (const patch of patches) {
    const insert = (patch as PatchOptions & { insert?: EntryOptions[] }).insert
    if (Array.isArray(insert)) for (const entry of insert) visit(entry)
  }
  return result
}

/**
 * Find directly enabled external Bundle rows that reuse an entry id reserved
 * by the active Profile's installation-owned layers.
 * @param options - Profile identity, installation anchor, and optional Harness home.
 * @returns Unambiguous external owners safe to quarantine before Loader activation.
 */
export function inspectProfileLoaderEntryCollisions(
  options: ProfileDependencyOptions,
): ProfileLoaderEntryCollision[] {
  const home = options.home ?? resolveDshHome()
  let profile: ReturnType<typeof loadProfile>
  try {
    profile = loadProfile(options.binName, options.profile, options.installAnchor, home)
  } catch {
    return []
  }
  const manifest = readProfileManifest(options.binName, profile.dir)
  const dependencies = manifest.dependencies ?? {}
  const bundles = new Set(manifest.dsh?.profile?.bundles ?? [])
  const installationOwned = new Set(PROFILE_TEMPLATES[options.profile]?.bundles ?? DEFAULT_PROFILE_BUNDLES)
  const shippedById = new Map<string, {
    packageName: string
    moduleName: string
    patchPath: string
  }>()
  for (const layer of profile.layers) {
    if (!installationOwned.has(layer.packageName)) continue
    for (const entry of enabledInsertedLoaderEntries(layer.patches)) {
      if (typeof entry.id !== 'string' || typeof entry.name !== 'string') continue
      shippedById.set(entry.id, {
        packageName: layer.packageName,
        moduleName: entry.name,
        patchPath: layer.patchPath,
      })
    }
  }
  const collisions = new Map<string, ProfileLoaderEntryCollision>()
  for (const layer of profile.layers) {
    if (installationOwned.has(layer.packageName)
      || dependencies[layer.packageName] === undefined
      || !bundles.has(layer.packageName)) continue
    for (const entry of enabledInsertedLoaderEntries(layer.patches)) {
      if (typeof entry.id !== 'string' || typeof entry.name !== 'string') continue
      const shipped = shippedById.get(entry.id)
      if (shipped === undefined) continue
      const collision: ProfileLoaderEntryCollision = {
        profile: options.profile,
        rootPackage: layer.packageName,
        entryId: entry.id,
        moduleName: entry.name,
        patchPath: layer.patchPath,
        installationPackage: shipped.packageName,
        installationModuleName: shipped.moduleName,
        installationPatchPath: shipped.patchPath,
      }
      collisions.set(`${collision.rootPackage}\0${collision.entryId}`, collision)
    }
  }
  return [...collisions.values()]
}

function loaderModuleDiagnostic(issue: UnresolvableProfileBundleEntry): ProfileDiagnostic {
  const dependencyFailure = issue.failureKind === 'loader-dependency' && issue.missingModule !== undefined
  return {
    diagnosticId: randomUUID(),
    code: dependencyFailure ? 'loader.dependency-unavailable' : 'profile.module-resolution',
    source: dependencyFailure ? 'loader' : 'profile',
    phase: 'import',
    severity: 'blocked',
    attribution: {
      rootPackage: issue.rootPackage,
      entryId: issue.entryId,
      moduleName: issue.moduleName,
      ...(issue.missingModule === undefined ? {} : { missingModule: issue.missingModule }),
      ...(issue.importerPackage === undefined ? {} : { importerPackage: issue.importerPackage }),
      configKind: 'profile-patch',
    },
    actions: ['repair', 'isolate', 'export'],
    evidence: [dependencyFailure
      ? `Loader module ${issue.moduleName} imports unavailable dependency ${issue.missingModule ?? '<unknown>'}`
      : `Loader module ${issue.moduleName} from bundle patch ${issue.patchPath} cannot be resolved`],
  }
}

function packageNameFromSpecifier(specifier: string): string | undefined {
  const segments = specifier.split('/')
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]
}

initEsmLexer()

function unavailableStaticLoaderDependency(profileDir: string, entryUrl: string): string | undefined {
  let entryPath: string
  try {
    entryPath = fileURLToPath(entryUrl)
  } catch {
    return undefined
  }
  let source: string
  try {
    source = readFileSync(entryPath, 'utf8')
  } catch {
    return undefined
  }
  // Static ESM imports link before plugin code runs. Keep this preflight
  // deliberately bounded to the Loader entry itself: it catches incomplete
  // published adapters without crawling or executing arbitrary plugin code.
  if (Buffer.byteLength(source) > 2 * 1024 * 1024) return undefined
  const request = createRequire(entryPath)
  const [imports] = parseEsmImports(source, entryPath)
  for (const imported of imports) {
    // d === -1 is a static import/export-from. Dynamic imports are a runtime
    // concern because their branch may never execute for this configuration.
    const specifier = imported.d === -1 ? imported.n : undefined
    if (specifier === undefined || specifier.startsWith('.') || specifier.startsWith('/')
      || specifier.startsWith('file:') || specifier.startsWith('node:') || isBuiltin(specifier)) continue
    try {
      request.resolve(specifier)
      continue
    } catch {
      if (resolveProfileLoaderModule(profileDir, specifier) !== undefined) continue
      return specifier
    }
  }
  return undefined
}

function profileBundleEntryOwnership(
  options: ProfileDependencyOptions,
): { profile: ReturnType<typeof loadProfile>; ownership: ProfileBundleEntryOwnership[] } | undefined {
  const home = options.home ?? resolveDshHome()
  let profile: ReturnType<typeof loadProfile>
  try {
    profile = loadProfile(options.binName, options.profile, options.installAnchor, home)
  } catch {
    return undefined
  }
  const manifest = readProfileManifest(options.binName, profile.dir)
  const dependencies = manifest.dependencies ?? {}
  const bundles = new Set(manifest.dsh?.profile?.bundles ?? [])
  const installationOwned = new Set(PROFILE_TEMPLATES[options.profile]?.bundles ?? DEFAULT_PROFILE_BUNDLES)
  const userTargetedIds = new Set(profile.patches.flatMap(patch => (
    typeof patch.id === 'string' ? [patch.id] : []
  )))
  const homePatchPath = join(home, 'cordis.patch.yml')
  const homePatchSource = existsSync(homePatchPath) ? readFileSync(homePatchPath, 'utf8') : ''
  const origins = new Map<string, Array<{ rootPackage: string; patchPath: string }>>()
  for (const layer of profile.layers) {
    if (installationOwned.has(layer.packageName)
      || dependencies[layer.packageName] === undefined
      || !bundles.has(layer.packageName)) continue
    for (const entry of insertedLoaderEntries(layer.patches)) {
      if (typeof entry.id !== 'string' || typeof entry.name !== 'string') continue
      const key = `${entry.id}\0${entry.name}`
      const candidates = origins.get(key) ?? []
      candidates.push({ rootPackage: layer.packageName, patchPath: layer.patchPath })
      origins.set(key, candidates)
    }
  }
  const ownership: ProfileBundleEntryOwnership[] = []
  for (const entry of nestedLoaderEntries(composeEntries([
    profile.layers.flatMap(layer => layer.patches),
    profile.patches,
  ]))) {
    if (typeof entry.id !== 'string' || typeof entry.name !== 'string'
      || userTargetedIds.has(entry.id)
      || new RegExp(`^\\s*-\\s+id:\\s*["']?${entry.id.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}["']?\\s*$`, 'mu')
        .test(homePatchSource)) continue
    const candidates = origins.get(`${entry.id}\0${entry.name}`) ?? []
    if (candidates.length !== 1) continue
    const [candidate] = candidates
    if (candidate === undefined) continue
    ownership.push({
      profile: options.profile,
      rootPackage: candidate.rootPackage,
      entryId: entry.id,
      moduleName: entry.name,
      patchPath: candidate.patchPath,
    })
  }
  return { profile, ownership }
}

/**
 * Resolve one final Loader row back to its unique directly enabled bundle.
 * @param options - Profile identity, installation anchor, and optional Harness home.
 * @param entryId - Final Loader entry id from the failure chain.
 * @param moduleName - Final Loader module from the failure chain.
 * @returns Unique external Bundle owner, or undefined when proof is incomplete.
 */
export function inspectProfileBundleEntryOwnership(
  options: ProfileDependencyOptions,
  entryId: string,
  moduleName: string,
): ProfileBundleEntryOwnership | undefined {
  return profileBundleEntryOwnership(options)?.ownership.find(entry => (
    entry.entryId === entryId && entry.moduleName === moduleName
  ))
}

/**
 * Inspect final Loader entries for a missing bare module that can be proven to
 * originate from exactly one directly enabled external bundle. User-targeted
 * rows and ambiguous duplicate declarations are intentionally excluded.
 * @param options - Profile identity, installation anchor, and optional Harness home.
 * @returns Safe-to-quarantine module failures in Loader order.
 */
export function inspectUnresolvableProfileBundleEntries(
  options: ProfileDependencyOptions,
): UnresolvableProfileBundleEntry[] {
  const owned = profileBundleEntryOwnership(options)
  if (owned === undefined) {
    // Other Profile diagnostics own unreadable manifests, missing bundle
    // patches, and malformed YAML. This classifier only claims a fully
    // composed entry whose bare module alone is missing.
    return []
  }
  const issues: UnresolvableProfileBundleEntry[] = []
  for (const entry of owned.ownership) {
    if (entry.moduleName.startsWith('cordis:') || entry.moduleName.startsWith('file:')
      || entry.moduleName.startsWith('.') || entry.moduleName.startsWith('/')) continue
    const resolved = resolveProfileLoaderModule(owned.profile.dir, entry.moduleName)
    if (resolved === undefined) {
      issues.push({ ...entry, failureKind: 'loader-module' })
      continue
    }
    const missingModule = unavailableStaticLoaderDependency(owned.profile.dir, resolved)
    if (missingModule !== undefined) {
      const importerPackage = packageNameFromSpecifier(entry.moduleName)
      issues.push({
        ...entry,
        failureKind: 'loader-dependency',
        missingModule,
        ...(importerPackage === undefined ? {} : { importerPackage }),
      })
    }
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

/**
 * Disable peer-dependent deduplication for the linked Host graph, creating missing workspace settings.
 * Custom profiles need not supply this file; unreadable or malformed existing settings still stop repair.
 */
function writeProfilePnpmCompatibility(profileDir: string): void {
  const workspacePath = join(profileDir, PROFILE_WORKSPACE_FILENAME)
  let source: string
  try {
    source = readFileSync(workspacePath, 'utf8')
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
    source = ''
  }
  const document = parseDocument(source)
  if (document.errors.length > 0) {
    throw new Error(`dsh: cannot update ${workspacePath}: ${document.errors.map(error => error.message).join('; ')}`)
  }
  document.set('dedupePeerDependents', false)
  const rendered = document.toString()
  if (rendered !== source) atomicWrite(workspacePath, rendered)
}

function staleLockfileImporterDependencies(profileDir: string, remove: boolean): string[] {
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
      const packageName = String((item as { readonly key: unknown }).key)
      if (declarations[packageName] !== undefined) continue
      if (remove) group.delete(packageName)
      removed.push(packageName)
    }
    if (remove && group.items.length === 0) importer.delete(groupName)
  }
  if (remove && removed.length > 0) atomicWrite(lockfilePath, document.toString())
  return removed
}

/** Remove importer entries whose dependency declarations no longer exist in the profile manifest. */
function pruneStaleLockfileImporter(profileDir: string): string[] {
  return staleLockfileImporterDependencies(profileDir, true)
}

/** Replace undeclared profile-local Host packages left by another installation with the running installation. */
function repairUnmanagedSharedHostResidue(
  options: ProfileDependencyOptions,
  home: string,
  profileDir: string,
): string[] {
  const manifest = readPackageManifest(join(profileDir, 'package.json'))
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ])
  const hosts = hostPackages(options.installAnchor, home)
  const repaired: string[] = []
  for (const packageName of SHARED_HOST_PACKAGES) {
    if (declared.has(packageName)) continue
    const profileCopy = profilePackageDirectory(profileDir, packageName)
    if (!existsSync(join(profileCopy, 'package.json'))) continue
    const host = hosts.get(packageName)
    if (host === undefined || canonical(profileCopy) === host.path) continue
    rmSync(profileCopy, { recursive: true, force: true })
    mkdirSync(dirname(profileCopy), { recursive: true })
    symlinkSync(host.path, profileCopy, process.platform === 'win32' ? 'junction' : 'dir')
    repaired.push(packageName)
  }
  return repaired
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
 * Remove stale quarantine metadata after a plugin is fully restored to its Profile.
 * @param options - Profile identity and optional Harness home.
 * @param activePackageNames - package roots proven active by the current Loader.
 * @returns package names whose obsolete quarantine records were removed.
 */
export function reconcileRestoredQuarantinedProfilePlugins(
  options: Pick<ProfileDependencyOptions, 'binName' | 'profile' | 'home'>,
  activePackageNames: ReadonlySet<string>,
): string[] {
  const home = options.home ?? resolveDshHome()
  const state = readQuarantineFile(home)
  if (!state.plugins.some(record => record.profile === options.profile)) return []
  const profileDir = resolveProfileDir(options.profile, home)
  let manifest: ProfileManifest
  try {
    manifest = readProfileManifest(options.binName, profileDir)
  } catch {
    // Reconciliation is optional: unreadable Profile state cannot prove restoration.
    return []
  }
  const restored = state.plugins.filter(record => (
    record.profile === options.profile
    && activePackageNames.has(record.packageName)
    && manifest.dependencies?.[record.packageName] !== undefined
    && manifest.dsh?.profile?.bundles?.includes(record.packageName) === true
    && existsSync(join(profilePackageDirectory(profileDir, record.packageName), 'package.json'))
  ))
  if (restored.length === 0) return []

  for (const record of restored) reconcileRemovedQuarantineReports(record, home)
  const restoredIds = new Set(restored.map(record => record.quarantineId))
  atomicWrite(quarantineFilePath(home), `${JSON.stringify({
    ...state,
    plugins: state.plugins.filter(record => !restoredIds.has(record.quarantineId)),
  }, undefined, 2)}\n`)
  return restored.map(record => record.packageName)
}

function issueBelongsToPlugin(issue: ProfileDiagnostic, packageName: string): boolean {
  return issue.attribution?.rootPackage === packageName
    || (issue.attribution?.rootPackage === undefined && issue.attribution?.moduleName === packageName)
}

/**
 * Find derived quarantine state whose plugin is no longer active, installed, or durably quarantined.
 * @param options - Profile identity and optional Harness home.
 * @returns Repairable residue records without local filesystem paths.
 */
export function inspectQuarantineRemovalResidue(
  options: ProfileDependencyOptions,
): QuarantineRemovalResidue[] {
  const home = options.home ?? resolveDshHome()
  const retained = readLastProfileRepairReport(options.profile, home)
  if (retained === undefined || retained.quarantined.length === 0) return []
  const profileDir = resolveProfileDir(options.profile, home)
  const manifest = readProfileManifest(options.binName, profileDir)
  const durablePackages = new Set(readQuarantineFile(home).plugins.map(record => (
    `${record.profile}\0${record.packageName}`
  )))
  const staleLockfileDependencies = new Set(staleLockfileImporterDependencies(profileDir, false))
  const diagnostics = readProfileDiagnosticReport(options.profile, home)

  return retained.quarantined.flatMap((record) => {
    if (record.profile !== options.profile
      || durablePackages.has(`${record.profile}\0${record.packageName}`)
      || manifest.dependencies?.[record.packageName] !== undefined
      || manifest.dsh?.profile?.bundles?.includes(record.packageName) === true
      || existsSync(join(profilePackageDirectory(profileDir, record.packageName), 'package.json'))) return []
    const packageDirectory = profilePackageDirectory(profileDir, record.packageName)
    const staleComponents: QuarantineRemovalResidue['staleComponents'][number][] = ['repair-report']
    if (diagnostics?.issues.some(issue => issueBelongsToPlugin(issue, record.packageName)) === true) {
      staleComponents.push('diagnostic-report')
    }
    if (staleLockfileDependencies.has(record.packageName)) staleComponents.push('lockfile-importer')
    if (existsSync(packageDirectory)) staleComponents.push('package-directory')
    return [{
      profile: record.profile,
      packageName: record.packageName,
      quarantineId: record.quarantineId,
      staleComponents,
    }]
  })
}

function reconcileRemovedQuarantineReports(record: QuarantinedProfilePlugin, home: string): void {
  const retained = readLastProfileRepairReport(record.profile, home)
  if (retained !== undefined) {
    const conflicts = retained.conflicts.filter(conflict => conflict.rootPackage !== record.packageName)
    const orphanedBundles = (retained.orphanedBundles ?? [])
      .filter(bundle => bundle.packageName !== record.packageName)
    const quarantined = retained.quarantined.filter(candidate => candidate.quarantineId !== record.quarantineId)
    const issues = (retained.issues ?? []).filter(issue => !issueBelongsToPlugin(issue, record.packageName))
    if (conflicts.length === 0 && orphanedBundles.length === 0 && quarantined.length === 0 && issues.length === 0) {
      clearLastProfileRepairReport(record.profile, home)
    } else {
      const status = quarantined.length > 0
        ? 'quarantined'
        : retained.status === 'failed' || conflicts.length > 0 || orphanedBundles.length > 0
          ? 'failed'
          : 'repaired'
      atomicWrite(profileRepairReportPath(home, record.profile), `${JSON.stringify({
        ...retained,
        status,
        conflicts,
        orphanedBundles,
        quarantined,
        issues,
      }, undefined, 2)}\n`)
    }
  }

  const diagnostics = readProfileDiagnosticReport(record.profile, home)
  if (diagnostics === undefined) return
  const issues = diagnostics.issues.filter(issue => !issueBelongsToPlugin(issue, record.packageName))
  if (issues.length === 0) {
    clearProfileDiagnosticReport(record.profile, home)
    return
  }
  writeProfileDiagnosticReport({
    ...diagnostics,
    generatedAt: new Date().toISOString(),
    issues,
  }, home)
}

function repairQuarantineRemovalResidue(
  options: ProfileDependencyOptions,
  home: string,
  profileDir: string,
  residue: readonly QuarantineRemovalResidue[],
): string[] {
  if (residue.length === 0) return []
  const records = readLastProfileRepairReport(options.profile, home)?.quarantined ?? []
  const repaired: string[] = []
  for (const item of residue) {
    const record = records.find(candidate => candidate.quarantineId === item.quarantineId)
    if (record === undefined) continue
    rmSync(profilePackageDirectory(profileDir, item.packageName), { recursive: true, force: true })
    reconcileRemovedQuarantineReports(record, home)
    repaired.push(item.packageName)
  }
  return repaired
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

  pruneStaleLockfileImporter(profileDir)
  const nodeModulesDir = resolve(profileDir, 'node_modules')
  const packageDir = resolve(nodeModulesDir, record.packageName)
  const packageRelative = relative(nodeModulesDir, packageDir)
  if (packageRelative === '' || packageRelative === '..' || packageRelative.startsWith(`..${sep}`)) {
    throw new Error(`dsh: quarantined package path escapes profile ${record.packageName}`)
  }
  rmSync(packageDir, { recursive: true, force: true })
  reconcileRemovedQuarantineReports(record, home)
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
  const packageDir = directPackageDir(join(profileDir, 'package.json'), packageName)
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
  hostCompatibilityIssues: readonly ProfileHostCompatibilityIssue[] = [],
): QuarantinedProfilePlugin[] {
  const bundles = manifest.dsh?.profile?.bundles ?? []
  return [...roots].sort().map((packageName) => {
    const version = installedVersion(profileDir, packageName)
    const hostCompatibility = hostCompatibilityIssues.find(issue => issue.packageName === packageName)
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
        : hostCompatibility !== undefined
          ? 'incompatible-host-version'
          : conflicts.some(conflict => conflict.rootPackage === packageName && !conflict.compatible)
            ? 'incompatible-host-dependency'
            : 'convergence-failed',
      ...(hostCompatibility === undefined ? {} : { hostCompatibility }),
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
  hostCompatibilityIssues: readonly ProfileHostCompatibilityIssue[] = [],
): ProfileRepairReport {
  const base: ProfileRepairReport = {
    schema: 'dsh/profile-dependency-repair/v1',
    diagnosticSchema: 'dsh/profile-diagnostic/v2',
    profile,
    status,
    conflicts,
    ...(orphanedBundles.length === 0 ? {} : { orphanedBundles }),
    ...(hostCompatibilityIssues.length === 0 ? {} : { hostCompatibilityIssues }),
    quarantined,
    ...(diagnostic === undefined ? {} : { diagnostic }),
  }
  return { ...base, issues: diagnosticsForRepair(base) }
}

function diagnosticsForRepair(value: ProfileRepairReport): ProfileDiagnostic[] {
  const issues: ProfileDiagnostic[] = [
    ...value.conflicts.map(conflict => profileDependencyConflictDiagnostic(
      conflict.rootPackage,
      conflict.dependencyChain,
    )),
    ...(value.orphanedBundles ?? []).map(bundle => orphanedBundleDiagnostic(bundle.packageName)),
    ...(value.hostCompatibilityIssues ?? []).map(issue => profileHostCompatibilityDiagnostic(
      issue.packageName,
      issue.hostVersion,
      issue.supportedHostVersions,
      issue.recommendedHostVersion,
    )),
    ...value.quarantined.map(record => quarantinedPluginDiagnostic(
      record.packageName,
      record.reason,
      record.hostCompatibility,
    )),
  ]
  if (value.diagnostic !== undefined) {
    issues.push(classifyProfileDiagnostic({
      source: 'profile',
      phase: 'repair',
      value: value.diagnostic,
    }))
  }
  return deduplicateDiagnostics(issues)
}

function retainMaterialReport(home: string, value: ProfileRepairReport): ProfileRepairReport {
  if (value.status !== 'healthy') {
    atomicWrite(profileRepairReportPath(home, value.profile), `${JSON.stringify(value, undefined, 2)}\n`)
  }
  if (value.status === 'healthy' || value.status === 'repaired') {
    clearProfileDiagnosticReport(value.profile, home)
  } else {
    const issues = (value.issues ?? diagnosticsForRepair(value)).map(issue => ({
      ...issue,
      evidence: issue.evidence.map(evidence => sanitizeProfileDiagnostic(evidence, home)),
    }))
    writeProfileDiagnosticReport(createProfileDiagnosticReport(value.profile, issues), home)
  }
  return value
}

/**
 * Deactivate one directly configured external bundle after its Loader import proves unusable.
 * The operation retains the original dependency spec and bundle position for an explicit retry.
 * @param options - profile inputs plus the caller-owned package-manager runner.
 * @param packageName - exact direct dependency and active bundle attributed by the Loader error.
 * @param issue - structured import failure retained for Diagnostics.
 * @param reason - Proven Loader failure class persisted for targeted recovery guidance.
 * @returns a quarantined report, or a failed report after restoring the original manifest.
 */
export function quarantineProfilePluginAfterLoadFailure(
  options: ProfileRepairOptions,
  packageName: string,
  issue: ProfileDiagnostic,
  reason: Extract<ProfileQuarantineReason, 'client-module-unavailable' | 'loader-module-unresolvable' | 'loader-dependency-unavailable' | 'loader-entry-collision' | 'loader-lifecycle-failed'> = 'client-module-unavailable',
): ProfileRepairReport {
  const home = options.home ?? resolveDshHome()
  const profileDir = resolveProfileDir(options.profile, home)
  if (!PACKAGE_NAME.test(packageName)) {
    return retainMaterialReport(home, report(
      options.profile,
      'failed',
      [],
      [],
      `invalid Loader-attributed package name ${JSON.stringify(packageName)}`,
    ))
  }

  const originalManifest = readProfileManifest(options.binName, profileDir)
  const packageSpec = originalManifest.dependencies?.[packageName]
  const bundleIndex = originalManifest.dsh?.profile?.bundles?.indexOf(packageName) ?? -1
  if (packageSpec === undefined || bundleIndex < 0) {
    return retainMaterialReport(home, report(
      options.profile,
      'failed',
      [],
      [],
      `cannot quarantine Loader import failure for ${packageName}: it is not a direct active Profile bundle`,
    ))
  }

  const version = installedVersion(profileDir, packageName)
  const record: QuarantinedProfilePlugin = {
    quarantineId: randomUUID(),
    profile: options.profile,
    packageName,
    packageSpec,
    ...(version === undefined ? {} : { installedVersion: version }),
    bundleIndex,
    quarantinedAt: (options.now ?? (() => new Date()))().toISOString(),
    reason,
    conflicts: [],
  }
  writeProfileManifest(profileDir, withoutRoots(originalManifest, new Set([packageName])))

  const removal = options.runPackageManager(['install'])
  let cleanupDiagnostic = removal.exitCode === 0 ? undefined : removal.diagnostic
  try {
    if (retainedPluginDirectories(profileDir, [record]).length > 0) {
      removeInterruptedQuarantineResidue(options, home, profileDir, [record])
      cleanupDiagnostic = [
        cleanupDiagnostic,
        removal.exitCode === 0
          ? 'inactive plugin residue was removed directly'
          : 'pnpm cleanup failed; inactive plugin residue was removed directly',
      ].filter(Boolean).join('\n')
    }
    const remainingConflicts = inspectProfileDependencies({ ...options, home })
    const remainingOrphans = inspectOrphanedProfileBundles({ ...options, home })
    const remainingCollisions = inspectProfileLoaderEntryCollisions({ ...options, home })
      .filter(collision => collision.rootPackage === packageName)
    const remainingResidue = retainedPluginDirectories(profileDir, [record])
    if (remainingConflicts.length === 0 && remainingOrphans.length === 0
      && remainingCollisions.length === 0 && remainingResidue.length === 0) {
      persistQuarantines(home, [record])
      const retainedIssue: ProfileDiagnostic = {
        ...issue,
        attribution: { ...issue.attribution, rootPackage: packageName },
      }
      return retainMaterialReport(home, {
        ...report(options.profile, 'quarantined', [], [record], cleanupDiagnostic),
        issues: [retainedIssue],
      })
    }
    cleanupDiagnostic = `profile remained unhealthy after quarantining ${packageName}: ${[
      ...remainingConflicts.map(conflict => conflict.dependency),
      ...remainingOrphans.map(orphan => orphan.packageName),
      ...remainingCollisions.map(collision => `${collision.rootPackage}:${collision.entryId}`),
      ...remainingResidue.map(residue => residue.packageName),
    ].join(', ')}`
  } catch (error) {
    cleanupDiagnostic = error instanceof Error ? error.message : String(error)
  }

  writeProfileManifest(profileDir, originalManifest)
  const rollback = options.runPackageManager(['install'])
  const rollbackDiagnostic = rollback.exitCode === 0
    ? cleanupDiagnostic
    : `${cleanupDiagnostic}; rollback failed: ${rollback.diagnostic ?? 'package manager failed'}`
  return retainMaterialReport(home, report(
    options.profile,
    'failed',
    [],
    [],
    rollbackDiagnostic,
  ))
}

function deduplicateDiagnostics(issues: readonly ProfileDiagnostic[]): ProfileDiagnostic[] {
  const seen = new Set<string>()
  return issues.filter((issue) => {
    const key = `${issue.code}\0${issue.attribution?.rootPackage ?? ''}\0${issue.attribution?.entryId ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function markBuildScriptBlocked(
  records: readonly QuarantinedProfilePlugin[],
  result: ProfilePackageManagerResult,
): QuarantinedProfilePlugin[] {
  if (!result.diagnostic?.includes('ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED')
    && !result.diagnostic?.includes('ERR_PNPM_IGNORED_BUILDS')) return [...records]
  const buildApprovalKey = extractProfileBuildApprovalKey(result.diagnostic)
  return records.map(record => ({
    ...record,
    reason: 'build-script-blocked',
    ...(buildApprovalKey === undefined ? {} : { buildApprovalKey }),
  }))
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
  const cleanup = options.runPackageManager(['install'])
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
  const quarantineRemovalResidue = inspectQuarantineRemovalResidue({ ...options, home })
  writeProfilePnpmCompatibility(profileDir)
  const repairedQuarantineRemoval = repairQuarantineRemovalResidue(
    options,
    home,
    profileDir,
    quarantineRemovalResidue,
  )
  const prunedLockfileDependencies = pruneStaleLockfileImporter(profileDir)
  const repairedHostResidue = repairUnmanagedSharedHostResidue(options, home, profileDir)
  const initial = inspectProfileDependencies({ ...options, home })
  const initialOrphans = inspectOrphanedProfileBundles({ ...options, home })
  const initialHostCompatibility = inspectProfileHostCompatibility({ ...options, home })
  if (initial.length === 0 && initialOrphans.length === 0 && initialHostCompatibility.length === 0) {
    const loaderCollisions = inspectProfileLoaderEntryCollisions({ ...options, home })
    const loaderFailures = inspectUnresolvableProfileBundleEntries({ ...options, home })
    let loaderOutcome: ProfileRepairReport | undefined
    const quarantinedRoots = new Set<string>()
    for (const collision of loaderCollisions) {
      if (quarantinedRoots.has(collision.rootPackage)) continue
      loaderOutcome = quarantineProfilePluginAfterLoadFailure(
        options,
        collision.rootPackage,
        profileLoaderEntryCollisionDiagnostic(
          collision.rootPackage,
          collision.entryId,
          collision.moduleName,
          collision.installationPackage,
          collision.installationModuleName,
        ),
        'loader-entry-collision',
      )
      if (loaderOutcome.status !== 'quarantined') return loaderOutcome
      quarantinedRoots.add(collision.rootPackage)
    }
    for (const failure of loaderFailures) {
      if (quarantinedRoots.has(failure.rootPackage)) continue
      loaderOutcome = quarantineProfilePluginAfterLoadFailure(
        options,
        failure.rootPackage,
        loaderModuleDiagnostic(failure),
        failure.failureKind === 'loader-dependency'
          ? 'loader-dependency-unavailable'
          : 'loader-module-unresolvable',
      )
      if (loaderOutcome.status !== 'quarantined') return loaderOutcome
      quarantinedRoots.add(failure.rootPackage)
    }
    if (loaderOutcome !== undefined) return loaderOutcome
    const recovered = recoverInterruptedQuarantine(options, home, profileDir)
    if (recovered !== undefined) return recovered
    if (prunedLockfileDependencies.length > 0
      || repairedHostResidue.length > 0
      || repairedQuarantineRemoval.length > 0) {
      const diagnostics = [
        ...(repairedQuarantineRemoval.length === 0
          ? []
          : [`removed stale quarantine state: ${repairedQuarantineRemoval.join(', ')}`]),
        ...(prunedLockfileDependencies.length === 0
          ? []
          : [`removed stale lockfile dependencies: ${prunedLockfileDependencies.join(', ')}`]),
        ...(repairedHostResidue.length === 0
          ? []
          : [`relinked unmanaged Host packages: ${repairedHostResidue.join(', ')}`]),
      ]
      return retainMaterialReport(home, report(
        options.profile,
        'repaired',
        [],
        [],
        diagnostics.join('\n'),
      ))
    }
    return retainMaterialReport(home, report(options.profile, 'healthy', []))
  }

  writeSharedHostOverrides(profileDir)
  const originalManifest = readProfileManifest(options.binName, profileDir)
  const now = (options.now ?? (() => new Date()))()
  const quarantined: QuarantinedProfilePlugin[] = []
  const incompatibleRoots = new Set(initial.filter(conflict => !conflict.compatible).map(conflict => conflict.rootPackage))
  const orphanedRoots = new Set(initialOrphans.map(issue => issue.packageName))
  for (const root of orphanedRoots) incompatibleRoots.add(root)
  for (const issue of initialHostCompatibility) incompatibleRoots.add(issue.packageName)
  if (incompatibleRoots.size > 0) {
    quarantined.push(...quarantineRecords(
      options.profile,
      profileDir,
      originalManifest,
      incompatibleRoots,
      initial,
      now,
      orphanedRoots,
      initialHostCompatibility,
    ))
    writeProfileManifest(profileDir, withoutRoots(originalManifest, incompatibleRoots))
  }

  const firstInstall = options.runPackageManager(['install'])
  if (firstInstall.exitCode === 0) {
    const remaining = inspectProfileDependencies({ ...options, home })
    const remainingOrphans = inspectOrphanedProfileBundles({ ...options, home })
    const remainingHostCompatibility = inspectProfileHostCompatibility({ ...options, home })
    if (remaining.length === 0
      && remainingOrphans.length === 0
      && remainingHostCompatibility.length === 0
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
          initialHostCompatibility,
        ),
      )
    }
    const remainingRoots = new Set(remaining.map(conflict => conflict.rootPackage))
    for (const issue of remainingOrphans) remainingRoots.add(issue.packageName)
    for (const issue of remainingHostCompatibility) remainingRoots.add(issue.packageName)
    const beforeQuarantine = readProfileManifest(options.binName, profileDir)
    const extra = quarantineRecords(
      options.profile,
      profileDir,
      beforeQuarantine,
      remainingRoots,
      remaining,
      now,
      new Set(remainingOrphans.map(issue => issue.packageName)),
      remainingHostCompatibility,
    )
    writeProfileManifest(profileDir, withoutRoots(beforeQuarantine, remainingRoots))
    const removalInstall = options.runPackageManager(['install'])
    if (removalInstall.exitCode === 0
      && inspectProfileDependencies({ ...options, home }).length === 0
      && inspectOrphanedProfileBundles({ ...options, home }).length === 0
      && inspectProfileHostCompatibility({ ...options, home }).length === 0
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
        initialHostCompatibility,
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
      initialHostCompatibility,
    ))
  }

  const fallbackRoots = new Set(initial.map(conflict => conflict.rootPackage))
  for (const issue of initialOrphans) fallbackRoots.add(issue.packageName)
  for (const issue of initialHostCompatibility) fallbackRoots.add(issue.packageName)
  const fallbackRecords = quarantineRecords(
    options.profile,
    profileDir,
    originalManifest,
    fallbackRoots,
    initial,
    now,
    orphanedRoots,
    initialHostCompatibility,
  )
  writeProfileManifest(profileDir, withoutRoots(originalManifest, fallbackRoots))
  const fallbackInstall = options.runPackageManager(['install'])
  const fallbackRecordsWithReason = markBuildScriptBlocked(fallbackRecords, firstInstall)
  if (fallbackInstall.exitCode === 0
    && inspectProfileDependencies({ ...options, home }).length === 0
    && inspectOrphanedProfileBundles({ ...options, home }).length === 0
    && inspectProfileHostCompatibility({ ...options, home }).length === 0
    && retainedPluginDirectories(profileDir, fallbackRecordsWithReason).length === 0) {
    persistQuarantines(home, fallbackRecordsWithReason)
    return retainMaterialReport(
      home,
      report(
        options.profile,
        'quarantined',
        initial,
        fallbackRecordsWithReason,
        firstInstall.diagnostic,
        initialOrphans,
        initialHostCompatibility,
      ),
    )
  }
  // The manifest already deactivated every implicated root. A blocked lifecycle
  // script must not force the whole application to remain unavailable: remove
  // only those inactive package directories, retain their ordinary quarantine
  // records, and let the client explain/retry them through Diagnostics.
  try {
    removeInterruptedQuarantineResidue(options, home, profileDir, fallbackRecordsWithReason)
    const remainingConflicts = inspectProfileDependencies({ ...options, home })
    const remainingOrphans = inspectOrphanedProfileBundles({ ...options, home })
    const remainingHostCompatibility = inspectProfileHostCompatibility({ ...options, home })
    if (remainingConflicts.length === 0
      && remainingOrphans.length === 0
      && remainingHostCompatibility.length === 0
      && retainedPluginDirectories(profileDir, fallbackRecordsWithReason).length === 0) {
      persistQuarantines(home, fallbackRecordsWithReason)
      return retainMaterialReport(home, report(
        options.profile,
        'quarantined',
        initial,
        fallbackRecordsWithReason,
        `pnpm cleanup failed; inactive plugin residue was removed directly\n${fallbackInstall.diagnostic ?? firstInstall.diagnostic ?? ''}`.trim(),
        initialOrphans,
        initialHostCompatibility,
      ))
    }
  } catch {
    // Restore the original manifest below and retain the package-manager
    // diagnostic when even the bounded inactive-root fallback is unsafe.
  }
  writeProfileManifest(profileDir, originalManifest)
  return retainMaterialReport(home, report(
    options.profile,
    'failed',
    initial,
    [],
    fallbackInstall.diagnostic ?? firstInstall.diagnostic ?? 'profile dependency repair failed',
    initialOrphans,
    initialHostCompatibility,
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
  if (outcome.status === 'healthy') {
    clearLastProfileRepairReport(options.profile, home)
    clearProfileDiagnosticReport(options.profile, home)
  }
  return outcome
}

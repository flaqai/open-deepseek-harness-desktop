/** One-time, removable installation of plugins shipped with the desktop app. */

import { createHash } from 'node:crypto'
import { appendFile, copyFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { isMap, parseDocument } from 'yaml'

export interface BundledPluginManifestEntry {
  readonly seedId: string
  readonly packageName: string
  readonly version: string
  readonly profile: string
  readonly installPolicy: 'startup' | 'manual' | 'diagnostic'
  /** Exact npm or Git spec used first so ordinary installs remain updateable. */
  readonly registrySpec?: string
  /** Reviewed registry packages whose lifecycle scripts this bundled entry requires. */
  readonly approvedBuilds?: readonly string[]
  readonly archive: string
  readonly integrity: string
}

export interface SeedBundledPluginOptions {
  readonly entry: BundledPluginManifestEntry
  readonly resourcesDirectory: string
  readonly dshHome: string
  readonly install: (archivePath: string, entry: BundledPluginManifestEntry) => Promise<void>
  /** Merge reviewed lifecycle approvals before adopting or installing a dependency. */
  readonly prepare?: (entry: BundledPluginManifestEntry) => Promise<void>
  /** Explicit UI installs may replace a tombstone left by an earlier uninstall. */
  readonly force?: boolean
  /** Development migration for schema-1 markers produced before DSH_HOME reached the installer. */
  readonly repairLegacyMarker?: boolean
  /** Milestone updates for a desktop-owned progress surface. */
  readonly onProgress?: (progress: BundledPluginSeedProgress) => void
}

export type SeedBundledPluginResult = 'installed' | 'already-seeded' | 'already-installed'

/** Coarse installation milestones that remain truthful across package-manager implementations. */
export type BundledPluginSeedStage = 'verifying' | 'extracting' | 'configuring'

/** Point-in-time milestone emitted while one bundled plugin is being prepared. */
export interface BundledPluginSeedProgress {
  readonly stage: BundledPluginSeedStage
  readonly progress: number
}

/**
 * Persist a preset installation failure before the Harness supervisor starts.
 * @param logPath - Desktop Harness log path.
 * @param error - Installation failure to render.
 * @returns Completion after the diagnostic is durable.
 */
export async function appendBundledPluginFailure(logPath: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  await mkdir(dirname(logPath), { recursive: true })
  await appendFile(logPath, `[bundled-plugin] ${message}\n`)
}

/** Reject malformed packaged metadata before it can become an install allowlist. */
export function assertBundledPluginManifestEntry(entry: unknown): asserts entry is BundledPluginManifestEntry {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    throw new TypeError('desktop: invalid bundled plugin manifest entry')
  }
  const candidate = entry as Record<string, unknown>
  const approvedBuilds = candidate.approvedBuilds
  const seedLabel = typeof candidate.seedId === 'string' ? candidate.seedId : '<unknown>'
  if (typeof candidate.seedId !== 'string'
    || !/^[a-z0-9][a-z0-9._-]*$/iu.test(candidate.seedId)
    || typeof candidate.packageName !== 'string'
    || !/^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/iu.test(candidate.packageName)
    || typeof candidate.profile !== 'string'
    || !/^[a-z0-9][a-z0-9._-]*$/iu.test(candidate.profile)
    || typeof candidate.version !== 'string'
    || !/^[a-z0-9][a-z0-9.+-]*$/iu.test(candidate.version)
    || typeof candidate.archive !== 'string'
    || basename(candidate.archive) !== candidate.archive
    || (candidate.installPolicy !== 'startup'
      && candidate.installPolicy !== 'manual'
      && candidate.installPolicy !== 'diagnostic')
    || (candidate.registrySpec !== undefined && (
      typeof candidate.registrySpec !== 'string'
      || !/^\S+$/u.test(candidate.registrySpec)
      || candidate.registrySpec.length > 512
    ))
    || (approvedBuilds !== undefined && (
      !Array.isArray(approvedBuilds)
      || approvedBuilds.length > 16
      || new Set(approvedBuilds).size !== approvedBuilds.length
      || approvedBuilds.some(packageName => (
        typeof packageName !== 'string'
        || !/^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/iu.test(packageName)
      ))
    ))
    || typeof candidate.integrity !== 'string'
    || !candidate.integrity.startsWith('sha512-')) {
    throw new TypeError(`desktop: invalid bundled plugin manifest entry ${seedLabel}`)
  }
}

function githubRepositoryIdentity(spec: string | undefined): string | undefined {
  if (spec === undefined) return undefined
  const normalized = spec.trim().replace(/^git\+/u, '')
  const shorthand = /^github:(?<repository>[^#]+)(?:#(?<fragment>.*))?$/iu.exec(normalized)
  const url = /^(?:https?|git|ssh):\/\/(?:git@)?github\.com[/:](?<repository>[^#]+)(?:#(?<fragment>.*))?$/iu.exec(normalized)
    ?? /^git@github\.com:(?<repository>[^#]+)(?:#(?<fragment>.*))?$/iu.exec(normalized)
  const match = shorthand ?? url
  const repository = match?.groups?.repository?.replace(/\.git$/iu, '').replace(/^\/+|\/+$/gu, '')
  if (repository === undefined || repository.split('/').length !== 2) return undefined
  const path = /(?:^|&)path:\/?(?<path>[^&]+)(?:&|$)/u.exec(match?.groups?.fragment ?? '')?.groups?.path
  return `github:${repository.toLowerCase()}${path === undefined ? '' : `#path:${path.replace(/\/+$/gu, '').toLowerCase()}`}`
}

function dependencyMatchesBundledEntry(
  dependencyName: string,
  dependencySpec: unknown,
  entry: BundledPluginManifestEntry,
): boolean {
  if (dependencyName === entry.packageName) return true
  if (typeof dependencySpec !== 'string') return false
  if (dependencySpec.startsWith(`npm:${entry.packageName}@`)) return true
  const expectedRepository = githubRepositoryIdentity(entry.registrySpec)
  return expectedRepository !== undefined && githubRepositoryIdentity(dependencySpec) === expectedRepository
}

interface BundledDependencyState {
  readonly present: boolean
  readonly desktopOwned: boolean
}

function pathIsWithin(parent: string, candidate: string): boolean {
  const path = relative(resolve(parent), resolve(candidate))
  return path === '' || (!path.startsWith('..') && !path.startsWith('/') && !path.startsWith('\\'))
}

async function bundledDependencyState(
  packagePath: string,
  stateDirectory: string,
  entry: BundledPluginManifestEntry,
): Promise<BundledDependencyState> {
  try {
    const manifest = JSON.parse(await readFile(packagePath, 'utf8')) as {
      dependencies?: Record<string, unknown>
      devDependencies?: Record<string, unknown>
    }
    const dependency = Object.entries({ ...manifest.devDependencies, ...manifest.dependencies })
      .find(([dependencyName, dependencySpec]) => (
        dependencyMatchesBundledEntry(dependencyName, dependencySpec, entry)
      ))
    if (dependency === undefined) return { present: false, desktopOwned: false }
    const [dependencyName, dependencySpec] = dependency
    const filePath = typeof dependencySpec === 'string' && dependencySpec.startsWith('file:')
      ? resolve(dirname(packagePath), dependencySpec.slice('file:'.length))
      : undefined
    return {
      present: true,
      desktopOwned: dependencyName === entry.packageName
        && filePath !== undefined
        && pathIsWithin(stateDirectory, filePath),
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { present: false, desktopOwned: false }
    throw error
  }
}

async function markerExists(path: string): Promise<boolean> {
  try {
    await readFile(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

interface BundledPluginSeedMarker {
  readonly schema: number
  readonly version?: string
}

async function readSeedMarker(path: string): Promise<BundledPluginSeedMarker | undefined> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as { schema?: unknown; version?: unknown }
    const version = typeof value.version === 'string' ? value.version : undefined
    return {
      schema: typeof value.schema === 'number' ? value.schema : 0,
      ...(version === undefined ? {} : { version }),
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    return { schema: 0 }
  }
}

async function snapshotVersionHeld(
  dshHome: string,
  entry: BundledPluginManifestEntry,
  marker: BundledPluginSeedMarker,
): Promise<boolean> {
  if (marker.version === undefined) return false
  try {
    const value = JSON.parse(await readFile(
      join(dshHome, 'bundled-plugins', 'snapshot-version-hold.json'),
      'utf8',
    )) as { schema?: unknown; versions?: Array<{ seedId?: unknown; version?: unknown }> }
    return value.schema === 1 && Array.isArray(value.versions) && value.versions.some(version => (
      version.seedId === entry.seedId && version.version === marker.version
    ))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    return false
  }
}

/**
 * Check the durable uninstall-aware seed marker for one packaged entry.
 * @param dshHome - Harness home directory that owns bundled-plugin state.
 * @param entry - Exact allowlisted packaged plugin.
 * @returns Whether startup or a prior deferred install has already handled the entry.
 */
export async function hasBundledPluginSeedMarker(
  dshHome: string,
  entry: BundledPluginManifestEntry,
): Promise<boolean> {
  assertBundledPluginManifestEntry(entry)
  return markerExists(join(dshHome, 'bundled-plugins', `${entry.seedId}.seeded.json`))
}

/**
 * Detect the development-only legacy marker format that may have been written
 * even though the plugin command targeted a different Harness home.
 * @param dshHome - Harness home directory that owns bundled-plugin state.
 * @param entry - Exact allowlisted packaged plugin.
 * @returns Whether an existing marker predates schema 2.
 */
export async function hasLegacyBundledPluginSeedMarker(
  dshHome: string,
  entry: BundledPluginManifestEntry,
): Promise<boolean> {
  assertBundledPluginManifestEntry(entry)
  const marker = await readSeedMarker(join(dshHome, 'bundled-plugins', `${entry.seedId}.seeded.json`))
  return marker !== undefined && marker.schema < 2
}

/** Return true when startup can trust an exact durable marker without invoking pnpm. */
export async function bundledPluginSeedIsSettled(
  dshHome: string,
  entry: BundledPluginManifestEntry,
  repairLegacyMarker = false,
): Promise<boolean> {
  assertBundledPluginManifestEntry(entry)
  const marker = await readSeedMarker(join(dshHome, 'bundled-plugins', `${entry.seedId}.seeded.json`))
  if (marker === undefined) return false
  if (repairLegacyMarker && marker.schema < 2) return false
  if (await snapshotVersionHeld(dshHome, entry, marker)) return true
  if (marker.schema < 2 || marker.version !== entry.version) return false
  const approvedBuilds = entry.approvedBuilds ?? []
  if (approvedBuilds.length === 0) return true
  try {
    const source = await readFile(join(
      dshHome, 'profiles', entry.profile, 'pnpm-workspace.yaml',
    ), 'utf8')
    const document = parseDocument(source)
    if (document.errors.length > 0) return false
    const allowBuilds = document.get('allowBuilds', true)
    if (!isMap(allowBuilds)) return false
    return approvedBuilds.every((packageName) => {
      const value = allowBuilds.get(packageName)
      return value === true || value === false
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/**
 * Check whether dependency health deliberately removed this plugin from the active profile.
 * A deferred installer must not undo quarantine automatically; an explicit user install may.
 *
 * @param dshHome - Harness home directory that owns quarantine state.
 * @param entry - allowlisted packaged plugin being considered for deferred installation.
 * @returns Whether a matching durable quarantine record exists.
 */
export async function hasBundledPluginQuarantineRecord(
  dshHome: string,
  entry: BundledPluginManifestEntry,
): Promise<boolean> {
  assertBundledPluginManifestEntry(entry)
  try {
    const parsed = JSON.parse(await readFile(join(dshHome, 'quarantine', 'profile-plugins.json'), 'utf8')) as {
      plugins?: Array<{ profile?: unknown; packageName?: unknown }>
    }
    return Array.isArray(parsed.plugins) && parsed.plugins.some(record => (
      record.profile === entry.profile && record.packageName === entry.packageName
    ))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function writeMarker(path: string, entry: BundledPluginManifestEntry): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify({
    schema: 2,
    seedId: entry.seedId,
    packageName: entry.packageName,
    version: entry.version,
    seededAt: new Date().toISOString(),
  }, null, 2)}\n`, { flag: 'wx' })
  await rename(temporary, path)
}

/**
 * Verify one packaged archive without installing it or creating a seed marker.
 * Diagnostic-only entries use this path so a lab exercise cannot become a
 * normal preset merely by being carried in the application resources.
 */
export async function verifyBundledPluginArchive(
  resourcesDirectory: string,
  entry: BundledPluginManifestEntry,
): Promise<string> {
  assertBundledPluginManifestEntry(entry)
  const source = join(resourcesDirectory, entry.archive)
  const bytes = await readFile(source)
  const actualIntegrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
  if (actualIntegrity !== entry.integrity) {
    throw new Error(`desktop: bundled plugin integrity mismatch for ${entry.packageName}`)
  }
  return source
}

/** Seed once. The durable marker intentionally survives a later user uninstall. */
export async function seedBundledPlugin(options: SeedBundledPluginOptions): Promise<SeedBundledPluginResult> {
  const {
    entry, resourcesDirectory, dshHome, install, prepare,
    force = false, repairLegacyMarker = false, onProgress,
  } = options
  assertBundledPluginManifestEntry(entry)
  const stateDirectory = join(dshHome, 'bundled-plugins')
  const markerPath = join(stateDirectory, `${entry.seedId}.seeded.json`)
  const dependency = await bundledDependencyState(
    join(dshHome, 'profiles', entry.profile, 'package.json'), stateDirectory,
    entry,
  )
  // An explicit user restore hands ownership back to the current packaged
  // archive even when a snapshot hold preserved an older desktop-owned file.
  let replaceDesktopOwnedDependency = force && dependency.desktopOwned
  if (!force) {
    const marker = await readSeedMarker(markerPath)
    if (marker !== undefined) {
      if (await snapshotVersionHeld(dshHome, entry, marker)) {
        return 'already-seeded'
      }
      const bundledVersionChanged = marker.schema >= 2
        && marker.version !== undefined
        && marker.version !== entry.version
      replaceDesktopOwnedDependency = bundledVersionChanged && dependency.desktopOwned
      if (!replaceDesktopOwnedDependency
        && (!repairLegacyMarker || marker.schema >= 2 || dependency.present)) {
        if (dependency.present) await prepare?.(entry)
        return 'already-seeded'
      }
      await unlink(markerPath)
    }
  }

  if (dependency.present && !replaceDesktopOwnedDependency) {
    await prepare?.(entry)
    onProgress?.({ stage: 'configuring', progress: 90 })
    await writeMarker(markerPath, entry)
    onProgress?.({ stage: 'configuring', progress: 100 })
    return 'already-installed'
  }

  onProgress?.({ stage: 'verifying', progress: 8 })
  const source = await verifyBundledPluginArchive(resourcesDirectory, entry)
  await mkdir(stateDirectory, { recursive: true })
  const stableArchive = join(stateDirectory, entry.archive)
  await copyFile(source, stableArchive)
  await prepare?.(entry)
  onProgress?.({ stage: 'extracting', progress: 46 })
  await install(stableArchive, entry)
  onProgress?.({ stage: 'configuring', progress: 90 })
  await writeMarker(markerPath, entry)
  onProgress?.({ stage: 'configuring', progress: 100 })
  return 'installed'
}

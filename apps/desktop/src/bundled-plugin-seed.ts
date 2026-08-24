/** One-time, removable installation of plugins shipped with the desktop app. */

import { createHash } from 'node:crypto'
import { appendFile, copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

export interface BundledPluginManifestEntry {
  readonly seedId: string
  readonly packageName: string
  readonly version: string
  readonly profile: string
  readonly installPolicy: 'startup' | 'manual'
  /** Exact npm or Git spec used first so ordinary installs remain updateable. */
  readonly registrySpec?: string
  readonly archive: string
  readonly integrity: string
}

export interface SeedBundledPluginOptions {
  readonly entry: BundledPluginManifestEntry
  readonly resourcesDirectory: string
  readonly dshHome: string
  readonly install: (archivePath: string, entry: BundledPluginManifestEntry) => Promise<void>
  /** Explicit UI installs may replace a tombstone left by an earlier uninstall. */
  readonly force?: boolean
}

export type SeedBundledPluginResult = 'installed' | 'already-seeded' | 'already-installed'

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
export function assertBundledPluginManifestEntry(entry: BundledPluginManifestEntry): void {
  if (!/^[a-z0-9][a-z0-9._-]*$/iu.test(entry.seedId)
    || !/^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/iu.test(entry.packageName)
    || !/^[a-z0-9][a-z0-9._-]*$/iu.test(entry.profile)
    || !/^[a-z0-9][a-z0-9.+-]*$/iu.test(entry.version)
    || basename(entry.archive) !== entry.archive
    || (entry.installPolicy !== 'startup' && entry.installPolicy !== 'manual')
    || (entry.registrySpec !== undefined && (!/^\S+$/u.test(entry.registrySpec) || entry.registrySpec.length > 512))
    || !entry.integrity.startsWith('sha512-')) {
    throw new TypeError(`desktop: invalid bundled plugin manifest entry ${entry.seedId}`)
  }
}

async function hasDependency(packagePath: string, packageName: string): Promise<boolean> {
  try {
    const manifest = JSON.parse(await readFile(packagePath, 'utf8')) as {
      dependencies?: Record<string, unknown>
      devDependencies?: Record<string, unknown>
    }
    return Object.hasOwn(manifest.dependencies ?? {}, packageName)
      || Object.hasOwn(manifest.devDependencies ?? {}, packageName)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return false
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

async function writeMarker(path: string, entry: BundledPluginManifestEntry): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify({
    schema: 1,
    seedId: entry.seedId,
    packageName: entry.packageName,
    version: entry.version,
    seededAt: new Date().toISOString(),
  }, null, 2)}\n`, { flag: 'wx' })
  await rename(temporary, path)
}

/** Seed once. The durable marker intentionally survives a later user uninstall. */
export async function seedBundledPlugin(options: SeedBundledPluginOptions): Promise<SeedBundledPluginResult> {
  const { entry, resourcesDirectory, dshHome, install, force = false } = options
  assertBundledPluginManifestEntry(entry)
  const stateDirectory = join(dshHome, 'bundled-plugins')
  const markerPath = join(stateDirectory, `${entry.seedId}.seeded.json`)
  if (!force && await markerExists(markerPath)) return 'already-seeded'

  if (await hasDependency(join(dshHome, 'profiles', entry.profile, 'package.json'), entry.packageName)) {
    await writeMarker(markerPath, entry)
    return 'already-installed'
  }

  const source = join(resourcesDirectory, entry.archive)
  const bytes = await readFile(source)
  const actualIntegrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
  if (actualIntegrity !== entry.integrity) {
    throw new Error(`desktop: bundled plugin integrity mismatch for ${entry.packageName}`)
  }
  await mkdir(stateDirectory, { recursive: true })
  const stableArchive = join(stateDirectory, entry.archive)
  await copyFile(source, stableArchive)
  await install(stableArchive, entry)
  await writeMarker(markerPath, entry)
  return 'installed'
}

/** One-time, removable installation of plugins shipped with the desktop app. */

import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

export interface BundledPluginManifestEntry {
  readonly seedId: string
  readonly packageName: string
  readonly version: string
  readonly profile: string
  readonly archive: string
  readonly integrity: string
}

export interface SeedBundledPluginOptions {
  readonly entry: BundledPluginManifestEntry
  readonly resourcesDirectory: string
  readonly dshHome: string
  readonly install: (archivePath: string, entry: BundledPluginManifestEntry) => Promise<void>
}

export type SeedBundledPluginResult = 'installed' | 'already-seeded' | 'already-installed'

function assertEntry(entry: BundledPluginManifestEntry): void {
  if (!/^[a-z0-9][a-z0-9._-]*$/iu.test(entry.seedId)
    || !/^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/iu.test(entry.packageName)
    || basename(entry.archive) !== entry.archive
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
  const { entry, resourcesDirectory, dshHome, install } = options
  assertEntry(entry)
  const stateDirectory = join(dshHome, 'bundled-plugins')
  const markerPath = join(stateDirectory, `${entry.seedId}.seeded.json`)
  if (await markerExists(markerPath)) return 'already-seeded'

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

/** Validation and temporary staging for user-selected imported plugin sources. */

import { copyFile, lstat, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { list } from 'tar'

const IMPORTED_PLUGIN_ARCHIVE_LIMIT = 200 * 1024 * 1024
const IMPORTED_PLUGIN_MANIFEST_LIMIT = 1024 * 1024

export interface ImportedPluginPackageManifest {
  readonly name: string
  readonly version?: string
}

export interface StagedImportedPlugin {
  readonly archivePath: string
  readonly manifest: ImportedPluginPackageManifest
  cleanup(): Promise<void>
}

/** Run a bounded package-manager command in a validated plugin source directory. */
export type ImportedPluginPack = (
  args: readonly string[],
  sourceDirectory: string,
  timeoutMs: number,
) => Promise<string>

function parseManifest(source: string, expectedName: string): ImportedPluginPackageManifest {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch {
    throw new Error('desktop: selected plugin package.json is not valid JSON')
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('desktop: selected plugin package.json must be an object')
  }
  const manifest = value as { name?: unknown; version?: unknown }
  if (manifest.name !== expectedName) {
    const actualName = typeof manifest.name === 'string' ? manifest.name : 'unnamed or invalid'
    throw new Error(`desktop: selected package is ${actualName}, expected ${expectedName}`)
  }
  if (manifest.version !== undefined && typeof manifest.version !== 'string') {
    throw new Error('desktop: selected plugin version must be a string')
  }
  return {
    name: expectedName,
    ...(typeof manifest.version === 'string' ? { version: manifest.version } : {}),
  }
}

export function isSafeImportedPluginArchivePath(path: string): boolean {
  const normalized = path.replace(/\\/gu, '/')
  return !normalized.startsWith('/') && !/^[A-Za-z]:\//u.test(normalized)
    && !normalized.split('/').some(part => part === '..')
}

/** Read only package/package.json while rejecting unsafe archive entry paths. */
export async function inspectImportedPluginArchive(
  archivePath: string,
  expectedName: string,
): Promise<ImportedPluginPackageManifest> {
  const metadata = await lstat(archivePath)
  if (!metadata.isFile()) throw new Error('desktop: selected plugin archive is not a regular file')
  if (metadata.size > IMPORTED_PLUGIN_ARCHIVE_LIMIT) throw new Error('desktop: selected plugin archive exceeds 200 MiB')
  let manifestSource: Buffer[] | undefined
  let manifestBytes = 0
  let validationError: Error | undefined
  await list({
    file: archivePath,
    strict: true,
    onReadEntry(entry) {
      if (!isSafeImportedPluginArchivePath(entry.path)) {
        validationError ??= new Error(`desktop: unsafe path in plugin archive: ${entry.path}`)
      }
      if (entry.path !== 'package/package.json') return
      if (manifestSource !== undefined) {
        validationError ??= new Error('desktop: plugin archive contains duplicate package manifests')
        return
      }
      if (entry.type !== 'File' && entry.type !== 'OldFile') {
        validationError ??= new Error('desktop: plugin archive manifest is not a regular file')
        return
      }
      if (entry.size > IMPORTED_PLUGIN_MANIFEST_LIMIT) {
        validationError ??= new Error('desktop: plugin archive manifest exceeds 1 MiB')
        return
      }
      manifestSource = []
      entry.on('data', (chunk: Buffer) => {
        manifestBytes += chunk.length
        if (manifestBytes <= IMPORTED_PLUGIN_MANIFEST_LIMIT) manifestSource?.push(chunk)
      })
    },
  })
  if (validationError !== undefined) throw validationError
  if (manifestSource === undefined || manifestBytes > IMPORTED_PLUGIN_MANIFEST_LIMIT) {
    throw new Error('desktop: plugin archive is missing a valid package/package.json')
  }
  return parseManifest(Buffer.concat(manifestSource).toString('utf8'), expectedName)
}

/** Validate and stage a selected tgz so the original absolute path is never retained. */
export async function stageImportedPluginArchive(
  archivePath: string,
  expectedName: string,
): Promise<StagedImportedPlugin> {
  const manifest = await inspectImportedPluginArchive(archivePath, expectedName)
  const directory = await mkdtemp(join(tmpdir(), 'dsh-imported-plugin-'))
  const stagedPath = join(directory, basename(archivePath).endsWith('.tgz') ? basename(archivePath) : 'plugin.tgz')
  try {
    await copyFile(archivePath, stagedPath)
    return {
      archivePath: stagedPath,
      manifest,
      cleanup: () => rm(directory, { recursive: true, force: true }),
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

/** Validate a source directory, pack it without lifecycle scripts, then inspect the produced tgz. */
export async function stageImportedPluginDirectory(
  sourceDirectory: string,
  expectedName: string,
  pack: ImportedPluginPack,
): Promise<StagedImportedPlugin> {
  const source = resolve(sourceDirectory)
  const metadata = await lstat(source)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('desktop: selected plugin source is not a regular directory')
  }
  const packagePath = join(source, 'package.json')
  const packageMetadata = await lstat(packagePath)
  if (!packageMetadata.isFile() || packageMetadata.size > IMPORTED_PLUGIN_MANIFEST_LIMIT) {
    throw new Error('desktop: selected plugin package.json is missing or exceeds 1 MiB')
  }
  parseManifest(await readFile(packagePath, 'utf8'), expectedName)
  const directory = await mkdtemp(join(tmpdir(), 'dsh-imported-plugin-'))
  try {
    await pack(['--config.ignore-scripts=true', 'pack', '--pack-destination', directory], source, 60_000)
    const archives = (await readdir(directory)).filter(name => name.endsWith('.tgz'))
    if (archives.length !== 1) throw new Error('desktop: pnpm pack did not produce exactly one plugin archive')
    const archivePath = join(directory, archives[0] as string)
    if (!archivePath.startsWith(`${directory}${sep}`)) throw new Error('desktop: invalid staged plugin archive path')
    const manifest = await inspectImportedPluginArchive(archivePath, expectedName)
    return {
      archivePath,
      manifest,
      cleanup: () => rm(directory, { recursive: true, force: true }),
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

/** Whether a local package version differs from the imported dependency declaration. */
export function importedPluginVersionDiffers(declaredSpec: string, version: string | undefined): boolean {
  if (version === undefined) return false
  return declaredSpec !== version && declaredSpec !== `v${version}`
}

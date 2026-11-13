/** Materialize checksummed, single-root desktop archives into versioned user-data caches. */

import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { createReadStream } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, isAbsolute, join, posix } from 'node:path'
import { extract } from 'tar'
import { readPrebuiltProfile } from './prebuilt-profile.ts'

/** User-visible work performed while one packaged archive stream is authenticated and materialized. */
export type PackagedArchiveProgress = 'verifying-archive' | 'extracting-archive'

export interface PackagedRuntimeOptions {
  expandedPath?: string
  archivePath: string
  checksumPath?: string
  destination: string
  archiveRoot: string
  onProgress?: (phase: PackagedArchiveProgress) => void
}

export interface PackagedPrebuiltProfileOptions {
  archivePath: string
  checksumPath?: string
  destination: string
  archiveRoot: string
  onProgress?: (phase: PackagedArchiveProgress) => void
}

/** Return the expected archive root for a packaged Unix runtime. */
export function packagedRuntimeArchiveRoot(platform: NodeJS.Platform, arch: string): string | undefined {
  if (platform !== 'darwin' && platform !== 'linux') return undefined
  return `desktop-runtime-${platform}-${arch}`
}

/** Return the expected archive root for a native CI-built Profile. */
export function packagedPrebuiltProfileArchiveRoot(platform: NodeJS.Platform, arch: string): string {
  return `desktop-prebuilt-${platform}-${arch}`
}

/** Resolve Office from the runtime selected by startup, or the expanded Windows resources. */
export function packagedOfficeNodeModules(runtime: string | undefined, resourcesPath: string): string {
  return join(runtime ?? join(resourcesPath, 'harness'), 'node_modules')
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function expectedArchiveChecksum(archivePath: string, checksumPath?: string): Promise<string | undefined> {
  if (checksumPath === undefined) return undefined
  const source = (await readFile(checksumPath, 'utf8')).trim()
  const match = /^([0-9a-f]{64})\s{2}([^/\\]+)$/u.exec(source)
  if (match === null || match[2] !== archivePath.split(/[\\/]/u).at(-1)) throw new Error('desktop: invalid packaged archive checksum file')
  return match[1]
}

function safeArchivePath(path: string, root: string): boolean {
  const normalized = path.endsWith('/') ? path.slice(0, -1) : path
  return (normalized === root || normalized.startsWith(`${root}/`))
    && !isAbsolute(normalized) && !normalized.includes('\\') && !normalized.includes(':')
    && normalized.split('/').every(part => part !== '' && part !== '.' && part !== '..')
}

function archiveEntryValidator(root: string, onFirstEntry: () => void): {
  filter: (path: string, entry: { size?: number; type?: string; linkpath?: string }) => boolean
  assertNotEmpty: () => void
} {
  let entries = 0
  let bytes = 0
  return {
    filter: (path, entry) => {
      if (entries === 0) onFirstEntry()
      entries += 1
      bytes += entry.size ?? 0
      if (entries > 100_000 || bytes > 8 * 1024 * 1024 * 1024) throw new Error('desktop: packaged archive exceeds safety limits')
      if (!safeArchivePath(path, root)) throw new Error(`desktop: unsafe packaged archive path ${path}`)
      if (entry.type === undefined || !['File', 'OldFile', 'Directory', 'SymbolicLink', 'Link'].includes(entry.type)) {
        throw new Error(`desktop: unsupported packaged archive entry ${entry.type ?? 'unknown'}`)
      }
      if (entry.type === 'SymbolicLink') {
        const target = posix.normalize(posix.join(posix.dirname(path), entry.linkpath ?? ''))
        if (!safeArchivePath(target, root)) throw new Error(`desktop: unsafe packaged archive link ${path}`)
      }
      if (entry.type === 'Link' && !safeArchivePath(posix.normalize(entry.linkpath ?? ''), root)) {
        throw new Error(`desktop: unsafe packaged archive link ${path}`)
      }
      return true
    },
    assertNotEmpty: () => {
      if (entries === 0) throw new Error('desktop: packaged archive is empty')
    },
  }
}

async function extractArchive(
  archivePath: string,
  checksumPath: string | undefined,
  destination: string,
  root: string,
  ready: (path: string) => Promise<boolean>,
  onProgress?: (phase: PackagedArchiveProgress) => void,
): Promise<string> {
  onProgress?.('verifying-archive')
  const expectedChecksum = await expectedArchiveChecksum(archivePath, checksumPath)
  await mkdir(dirname(destination), { recursive: true })
  const temporary = await mkdtemp(join(dirname(destination), '.extract-'))
  try {
    const hash = createHash('sha256')
    let extractingReported = false
    const validator = archiveEntryValidator(root, () => {
      if (extractingReported) return
      extractingReported = true
      onProgress?.('extracting-archive')
    })
    const unpack = extract({
      cwd: temporary,
      strict: true,
      preservePaths: false,
      preserveOwner: false,
      unlink: true,
      filter: validator.filter,
    })
    let unpackError: unknown
    const unpackDone = new Promise<void>((resolve) => {
      unpack.once('close', resolve)
      unpack.once('error', (error: unknown) => {
        unpackError = error
        resolve()
      })
    })
    for await (const chunk of createReadStream(archivePath)) {
      const bytes = chunk as Buffer
      hash.update(bytes)
      if (unpackError !== undefined) continue
      try {
        if (!unpack.write(bytes)) {
          await Promise.race([
            once(unpack, 'drain').then(() => undefined).catch((error: unknown) => { unpackError = error }),
            unpackDone,
          ])
        }
      } catch (error) {
        unpackError = error
      }
    }
    unpack.end()
    if (unpackError === undefined) await unpackDone
    const checksumMatches = expectedChecksum === undefined || hash.digest('hex') === expectedChecksum
    if (!checksumMatches) {
      throw new Error('desktop: packaged archive checksum mismatch; reinstall the application')
    }
    if (unpackError !== undefined) {
      throw unpackError instanceof Error
        ? unpackError
        : new Error(typeof unpackError === 'string' ? unpackError : 'desktop: packaged archive extraction failed')
    }
    validator.assertNotEmpty()
    const extracted = join(temporary, root)
    if (!await ready(extracted)) throw new Error('desktop: packaged archive payload is incomplete')
    await rm(destination, { recursive: true, force: true })
    await rename(extracted, destination)
    return destination
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

/** Return whether a runtime cache satisfies the packaged layout. */
export async function isPackagedRuntimeReady(destination: string): Promise<boolean> {
  return await exists(join(destination, 'lib', 'bin.js'))
    && await exists(join(destination, 'node_modules'))
    && await exists(join(destination, 'node_modules', '@deepseek-ai/cosmokit'))
    && await exists(join(destination, 'package-runtime', 'bin', 'node'))
    && await exists(join(destination, 'package-runtime', 'bin', 'pnpm'))
    && await exists(join(destination, '.desktop-runtime-v3'))
}

async function isPackagedPrebuiltProfileReady(destination: string): Promise<boolean> {
  try {
    return await readPrebuiltProfile(destination) !== undefined
  } catch {
    return false
  }
}

/** Use an expanded runtime or atomically materialize its verified archive. */
export async function ensurePackagedRuntime(options: PackagedRuntimeOptions): Promise<string> {
  if (options.expandedPath !== undefined && await exists(options.expandedPath)) {
    if (!await isPackagedRuntimeReady(options.expandedPath)) throw new Error('desktop: installed runtime is incomplete; reinstall the application')
    return options.expandedPath
  }
  if (await isPackagedRuntimeReady(options.destination)) return options.destination
  return await extractArchive(options.archivePath, options.checksumPath, options.destination, options.archiveRoot,
    isPackagedRuntimeReady, options.onProgress)
}

/** Atomically materialize a verified prebuilt Profile archive when first start needs it. */
export async function ensurePackagedPrebuiltProfile(options: PackagedPrebuiltProfileOptions): Promise<string> {
  if (await isPackagedPrebuiltProfileReady(options.destination)) return options.destination
  return await extractArchive(options.archivePath, options.checksumPath, options.destination, options.archiveRoot,
    isPackagedPrebuiltProfileReady, options.onProgress)
}

/** Materialize checksummed, single-root desktop archives into versioned user-data caches. */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, isAbsolute, join, posix } from 'node:path'
import { extract, list } from 'tar'
import { readPrebuiltProfile } from './prebuilt-profile.ts'

export interface PackagedRuntimeOptions {
  expandedPath?: string
  archivePath: string
  checksumPath?: string
  destination: string
  archiveRoot: string
}

export interface PackagedPrebuiltProfileOptions {
  archivePath: string
  checksumPath?: string
  destination: string
  archiveRoot: string
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

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

async function verifyArchiveChecksum(archivePath: string, checksumPath?: string): Promise<void> {
  if (checksumPath === undefined) return
  const source = (await readFile(checksumPath, 'utf8')).trim()
  const match = /^([0-9a-f]{64})\s{2}([^/\\]+)$/u.exec(source)
  if (match === null || match[2] !== archivePath.split(/[\\/]/u).at(-1)) throw new Error('desktop: invalid packaged archive checksum file')
  if (await sha256File(archivePath) !== match[1]) throw new Error('desktop: packaged archive checksum mismatch; reinstall the application')
}

function safeArchivePath(path: string, root: string): boolean {
  const normalized = path.endsWith('/') ? path.slice(0, -1) : path
  return (normalized === root || normalized.startsWith(`${root}/`))
    && !isAbsolute(normalized) && !normalized.includes('\\') && !normalized.includes(':')
    && normalized.split('/').every(part => part !== '' && part !== '.' && part !== '..')
}

async function validateArchive(archivePath: string, root: string): Promise<void> {
  let entries = 0
  let bytes = 0
  let validationError: Error | undefined
  await list({
    file: archivePath,
    strict: true,
    onReadEntry: (entry) => {
      if (validationError !== undefined) return
      entries += 1
      bytes += entry.size
      if (entries > 100_000 || bytes > 8 * 1024 * 1024 * 1024) validationError = new Error('desktop: packaged archive exceeds safety limits')
      else if (!safeArchivePath(entry.path, root)) validationError = new Error(`desktop: unsafe packaged archive path ${entry.path}`)
      else if (!['File', 'OldFile', 'Directory', 'SymbolicLink', 'Link'].includes(entry.type)) validationError = new Error(`desktop: unsupported packaged archive entry ${entry.type}`)
      if (entry.type === 'SymbolicLink') {
        const target = posix.normalize(posix.join(posix.dirname(entry.path), entry.linkpath ?? ''))
        if (!safeArchivePath(target, root)) validationError = new Error(`desktop: unsafe packaged archive link ${entry.path}`)
      }
      if (entry.type === 'Link' && !safeArchivePath(posix.normalize(entry.linkpath ?? ''), root)) validationError = new Error(`desktop: unsafe packaged archive link ${entry.path}`)
    },
  })
  if (validationError !== undefined) throw validationError
  if (entries === 0) throw new Error('desktop: packaged archive is empty')
}

async function extractArchive(
  archivePath: string,
  checksumPath: string | undefined,
  destination: string,
  root: string,
  ready: (path: string) => Promise<boolean>,
): Promise<string> {
  await verifyArchiveChecksum(archivePath, checksumPath)
  await validateArchive(archivePath, root)
  await mkdir(dirname(destination), { recursive: true })
  const temporary = await mkdtemp(join(dirname(destination), '.extract-'))
  try {
    await extract({ file: archivePath, cwd: temporary, strict: true, preservePaths: false, preserveOwner: false, unlink: true })
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
    && await exists(join(destination, 'node_modules', '@deepseek-ai', 'cosmokit'))
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
  return await extractArchive(options.archivePath, options.checksumPath, options.destination, options.archiveRoot, isPackagedRuntimeReady)
}

/** Atomically materialize a verified prebuilt Profile archive when first start needs it. */
export async function ensurePackagedPrebuiltProfile(options: PackagedPrebuiltProfileOptions): Promise<string> {
  if (await isPackagedPrebuiltProfileReady(options.destination)) return options.destination
  return await extractArchive(options.archivePath, options.checksumPath, options.destination, options.archiveRoot,
    isPackagedPrebuiltProfileReady)
}

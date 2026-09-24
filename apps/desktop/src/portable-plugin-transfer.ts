/** Transfer one verified plugin bundle file between desktop installations. */

import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, lstat, mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { tmpdir } from 'node:os'
import { create, extract, list } from 'tar'
import { verifyPreparedPortablePluginBundle, type PortablePluginTarget } from './portable-plugin-bundle.ts'

const MAX_TRANSFER_BYTES = 5 * 1024 * 1024 * 1024
const MAX_TRANSFER_FILES = 110_000
const ALLOWED_TOP_LEVEL = new Set(['manifest.json', 'artifacts', 'store', 'cache'])

function safeEntryPath(path: string): boolean {
  const normalized = path.replace(/^\.\//u, '').replace(/\/$/u, '')
  const parts = normalized.split('/')
  return normalized !== '' && !isAbsolute(normalized) && !path.includes('\\')
    && parts.every(part => part !== '' && part !== '.' && part !== '..')
    && ALLOWED_TOP_LEVEL.has(parts[0] ?? '')
}

/** Create a single portable tgz after checking every source artifact and cache file. */
export async function packPortablePluginBundle(bundleDirectory: string, destination: string): Promise<void> {
  await verifyPreparedPortablePluginBundle(bundleDirectory)
  const temporary = join(dirname(destination), `.portable-plugins-${randomUUID()}.tmp`)
  try {
    await create({ cwd: bundleDirectory, file: temporary, gzip: true, portable: true }, [
      'manifest.json', 'artifacts', 'store', 'cache',
    ])
    const metadata = await lstat(temporary)
    if (!metadata.isFile() || metadata.size > MAX_TRANSFER_BYTES) {
      throw new Error('desktop: portable plugin transfer exceeds 5 GiB')
    }
    await lstat(destination).then(() => { throw new Error('desktop: portable plugin transfer destination exists') },
      (error: unknown) => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error })
    await rename(temporary, destination)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

export interface UnpackedPortablePluginBundle {
  readonly directory: string
  readonly target: PortablePluginTarget
  cleanup(): Promise<void>
}

/** Copy the selected file into private staging before inspecting, extracting, and hashing it. */
export async function unpackPortablePluginBundle(source: string): Promise<UnpackedPortablePluginBundle> {
  const metadata = await lstat(source)
  if (!metadata.isFile() || metadata.size > MAX_TRANSFER_BYTES) {
    throw new Error('desktop: portable plugin transfer is not a bounded regular file')
  }
  const staging = await mkdtemp(join(tmpdir(), 'dsh-portable-plugin-transfer-'))
  const archive = join(staging, 'transfer.tgz')
  const directory = join(staging, 'bundle')
  try {
    await copyFile(source, archive)
    const copied = await lstat(archive)
    if (!copied.isFile() || copied.size !== metadata.size) throw new Error('desktop: portable plugin transfer changed while copying')
    let count = 0
    let total = 0
    const seen = new Set<string>()
    let invalid: string | undefined
    await list({ file: archive, strict: true, onReadEntry(entry) {
      const normalized = entry.path.replace(/^\.\//u, '').replace(/\/$/u, '')
      if (!safeEntryPath(entry.path) || seen.has(normalized)
        || (entry.type !== 'File' && entry.type !== 'OldFile' && entry.type !== 'Directory')
        || ++count > MAX_TRANSFER_FILES || (total += entry.size) > MAX_TRANSFER_BYTES) {
        invalid ??= entry.path
      }
      seen.add(normalized)
    } })
    if (invalid !== undefined) throw new Error(`desktop: unsafe portable plugin transfer entry: ${invalid}`)
    await mkdir(directory, { mode: 0o700 })
    await extract({ file: archive, cwd: directory, strict: true, preservePaths: false })
    const verified = await verifyPreparedPortablePluginBundle(directory)
    return { directory, target: verified.target, cleanup: () => rm(staging, { recursive: true, force: true }) }
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}

/** Inspect a user-selected transfer before granting a short-lived chooser selection. */
export async function inspectPortablePluginTransfer(source: string): Promise<{ target: PortablePluginTarget; sha256: string }> {
  const unpacked = await unpackPortablePluginBundle(source)
  try {
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(source)) hash.update(chunk as Buffer)
    return { target: unpacked.target, sha256: hash.digest('hex') }
  } finally {
    await unpacked.cleanup()
  }
}

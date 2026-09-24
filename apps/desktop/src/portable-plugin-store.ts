/** Merge verified portable pnpm content into the target home without replacing existing files. */

import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, link, lstat, mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { verifyPreparedPortablePluginBundle } from './portable-plugin-bundle.ts'

async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700 }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  })
  if (!(await lstat(path)).isDirectory()) throw new Error('desktop: portable plugin store destination is not a regular directory')
}

async function digest(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

export interface PortablePluginStoreMergeResult {
  readonly filesAdded: number
  readonly bytesAdded: number
}

/** Run only while the desktop Profile mutation lease is held; a mismatch leaves existing files unchanged. */
export async function mergePortablePluginStore(
  bundleDirectory: string,
  dshHome: string,
): Promise<PortablePluginStoreMergeResult> {
  await verifyPreparedPortablePluginBundle(bundleDirectory)
  const source = join(bundleDirectory, 'store')
  const destination = join(dshHome, '.pnpm-store')
  await ensureDirectory(destination)
  let filesAdded = 0
  let bytesAdded = 0
  const merge = async (from: string, into: string): Promise<void> => {
    for (const entry of await readdir(from, { withFileTypes: true })) {
      const sourceFile = join(from, entry.name)
      const targetFile = join(into, entry.name)
      const sourceMetadata = await lstat(sourceFile)
      if (sourceMetadata.isDirectory()) {
        await ensureDirectory(targetFile)
        await merge(sourceFile, targetFile)
        continue
      }
      if (!sourceMetadata.isFile()) throw new Error('desktop: portable pnpm store contains a linked or irregular file')
      const sourceDigest = await digest(sourceFile)
      const temporary = join(into, `.dsh-portable-${randomUUID()}.tmp`)
      try {
        await copyFile(sourceFile, temporary)
        if (await digest(temporary) !== sourceDigest) throw new Error('desktop: portable pnpm store file changed while copying')
        try {
          await link(temporary, targetFile)
          filesAdded += 1
          bytesAdded += sourceMetadata.size
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
          const existing = await lstat(targetFile)
          if (!existing.isFile() || await digest(targetFile) !== sourceDigest) {
            throw new Error(`desktop: existing pnpm store entry differs from portable bundle: ${entry.name}`)
          }
        }
      } finally {
        await rm(temporary, { force: true })
      }
    }
  }
  await merge(source, destination)
  return { filesAdded, bytesAdded }
}

/** Create a deterministic single-root archive plus a detached SHA-256 digest. */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, readlink, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { create } from 'tar'

export async function sha256File(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

/** Validate the whole staging tree before replacing an existing qualified archive. */
export async function verifyPackagedTreeLinks(source) {
  const root = resolve(source)
  const metadata = await lstat(root)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('desktop archive: source must be a real directory')
  const physicalRoot = await realpath(root)
  const inside = (base, path) => {
    const child = relative(base, path)
    return child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
  }
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const stat = await lstat(path)
      if (stat.isSymbolicLink()) {
        const target = await readlink(path)
        if (isAbsolute(target) || target.includes('\\') || target.includes(':') || !inside(root, resolve(dirname(path), target))) {
          throw new Error(`desktop archive: unsafe symlink ${relative(root, path)}`)
        }
        let physicalTarget
        try { physicalTarget = await realpath(path) }
        catch { throw new Error(`desktop archive: unresolved symlink ${relative(root, path)}`) }
        if (!inside(physicalRoot, physicalTarget)) throw new Error(`desktop archive: escaping symlink ${relative(root, path)}`)
      } else if (stat.isDirectory()) await visit(path)
    }
  }
  await visit(root)
}

export async function createPackagedArchive(source, archive, installedName = basename(archive)) {
  const root = basename(source)
  if (!/^desktop-(?:runtime|prebuilt)-(?:darwin-(?:arm64|x64)|linux-x64|win32-x64)$/u.test(root)) {
    throw new Error(`desktop archive: invalid source root ${root}`)
  }
  if (!/^[a-z0-9][a-z0-9.-]*\.tar$/u.test(installedName)) throw new Error(`desktop archive: invalid installed name ${installedName}`)
  await verifyPackagedTreeLinks(source)
  await mkdir(dirname(archive), { recursive: true })
  await rm(archive, { force: true })
  await rm(`${archive}.sha256`, { force: true })
  // tar@7 can leave its async file promise unsettled after traversing large
  // deployed node_modules trees even though no event-loop handles remain.
  // The synchronous writer uses the same portable archive format and makes
  // completion explicit before hashing or deleting the expanded source.
  create.syncFile({ cwd: dirname(source), file: archive, portable: true, noMtime: true, strict: true }, [root])
  const digest = await sha256File(archive)
  await writeFile(`${archive}.sha256`, `${digest}  ${installedName}\n`, { mode: 0o644 })
  console.log(`desktop archive: ${basename(archive)} ${digest}`)
  return { archive, digest, root }
}

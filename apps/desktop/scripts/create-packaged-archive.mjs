/** Create a deterministic single-root archive plus a detached SHA-256 digest. */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { create } from 'tar'

export async function sha256File(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

export async function createPackagedArchive(source, archive) {
  const root = basename(source)
  if (!/^desktop-(?:runtime|prebuilt)-(?:darwin-(?:arm64|x64)|linux-x64|win32-x64)$/u.test(root)) {
    throw new Error(`desktop archive: invalid source root ${root}`)
  }
  await mkdir(dirname(archive), { recursive: true })
  await rm(archive, { force: true })
  await rm(`${archive}.sha256`, { force: true })
  // tar@7 can leave its async file promise unsettled after traversing large
  // deployed node_modules trees even though no event-loop handles remain.
  // The synchronous writer uses the same portable archive format and makes
  // completion explicit before hashing or deleting the expanded source.
  create.syncFile({ cwd: dirname(source), file: archive, portable: true, noMtime: true, strict: true }, [root])
  const digest = await sha256File(archive)
  await writeFile(`${archive}.sha256`, `${digest}  ${basename(archive)}\n`, { mode: 0o644 })
  console.log(`desktop archive: ${basename(archive)} ${digest}`)
  return { archive, digest, root }
}

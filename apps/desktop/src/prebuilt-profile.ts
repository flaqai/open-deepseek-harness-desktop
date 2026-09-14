/** Checksummed, relocatable Profile resources. Callers own the Profile transaction and process lease. */
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, copyFile, lstat, mkdir, readFile, readlink, readdir, rename, symlink, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parse } from 'yaml'

const HOME_TOKEN = '__DSH_PREBUILT_HOME__'
const MANIFEST = 'prebuilt-profile.json'
type Resource = { path: string; kind: 'file'; size: number; sha256: string; mode: number; relocate: boolean }
  | { path: string; kind: 'link'; target: string }

/** Exact build inputs required before choosing the prebuilt deployment path. */
export interface PrebuiltProfileIdentity {
  target: string
  nodeVersion: string
  pnpmVersion: string
  runtimeVersion: string
  pluginManifestSha256: string
}

/** Portable file inventory; its fingerprint covers identity, build approvals, and every entry. */
export interface PrebuiltProfileManifest {
  schema: 1
  identity: PrebuiltProfileIdentity
  allowBuilds: Record<string, boolean>
  files: Resource[]
  fingerprint: string
}

/**
 * Read explicit Profile build rules before selecting or deploying a prebuilt template.
 * @param home - Active Profile home.
 * @returns Validated rules, empty when no workspace exists.
 */
export async function readProfileBuildApprovals(home: string): Promise<Record<string, boolean>> {
  let source: string
  try { source = await readFile(join(home, 'profiles/web/pnpm-workspace.yaml'), 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
  const document = parse(source) as { allowBuilds?: unknown } | null
  const rules = document?.allowBuilds
  if (rules === undefined) return {}
  if (rules === null || typeof rules !== 'object' || Array.isArray(rules)
    || !Object.values(rules).every(rule => typeof rule === 'boolean')) throw new Error('desktop: invalid Profile build approvals')
  return rules as Record<string, boolean>
}

function digest(bytes: string): string { return createHash('sha256').update(bytes).digest('hex') }
async function fileDigest(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}
function portablePath(path: string): boolean {
  return path !== '' && !isAbsolute(path) && !path.includes('\\') && !path.includes(':')
    && path.split('/').every(part => part !== '' && part !== '.' && part !== '..')
}
function fingerprint(manifest: Omit<PrebuiltProfileManifest, 'fingerprint'>): string {
  return digest(JSON.stringify(manifest))
}
function contained(root: string, path: string): boolean {
  const child = relative(root, path)
  return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`))
}
function managedMetadata(path: string): boolean {
  return ['profiles/web/package.json', 'profiles/web/pnpm-lock.yaml', 'profiles/web/pnpm-workspace.yaml',
    'profiles/web/node_modules/.modules.yaml', 'profiles/web/node_modules/.pnpm/lock.yaml',
    'profiles/web/node_modules/.pnpm-workspace-state-v1.json'].includes(path)
    || path.startsWith('profiles/web/node_modules/.bin/')
}
function allowedResource(path: string): boolean {
  return ['profiles/web/package.json', 'profiles/web/pnpm-lock.yaml', 'profiles/web/pnpm-workspace.yaml'].includes(path)
    || path.startsWith('profiles/web/node_modules/')
    || /^bundled-plugins\/[a-zA-Z0-9._-]+\.(?:tgz|seeded\.json)$/u.test(path)
}

/**
 * Inventory a prepared, private build home and normalize generated home references in place.
 * External fallback links are omitted: the CLI regenerates them from its installed runtime.
 * @param root - Disposable build home containing only the selected Profile and repair archives.
 * @param identity - Exact packaged build inputs.
 * @param allowBuilds - Effective build approvals used to produce the dependencies.
 * @param runtimeRoot - Only permitted external target for generated core fallback links.
 * @returns Checksummed manifest also written into root.
 */
export async function sealPrebuiltProfile(
  root: string, identity: PrebuiltProfileIdentity, allowBuilds: Record<string, boolean>, runtimeRoot: string,
): Promise<PrebuiltProfileManifest> {
  const files: Resource[] = []
  const walk = async (directory: string): Promise<void> => {
    for (const name of (await readdir(directory)).sort()) {
      const absolute = join(directory, name)
      const path = relative(root, absolute).split(sep).join('/')
      if (path === MANIFEST) continue
      if (!portablePath(path)) throw new Error(`desktop: invalid prebuilt resource path ${path}`)
      const stat = await lstat(absolute)
      if (stat.isSymbolicLink()) {
        const target = resolve(dirname(absolute), await readlink(absolute))
        if (!contained(root, target)) {
          if (!contained(runtimeRoot, target)) throw new Error(`desktop: external prebuilt link ${path}`)
          await unlink(absolute)
          continue
        }
        const normalized = relative(dirname(absolute), target).split(sep).join('/')
        files.push({ kind: 'link', path, target: normalized })
      } else if (stat.isDirectory()) {
        await chmod(absolute, 0o755)
        await walk(absolute)
      } else if (stat.isFile()) {
        if (!allowedResource(path)) throw new Error(`desktop: unexpected prebuilt file ${path}`)
        const relocate = managedMetadata(path)
        if (relocate) {
          const source = await readFile(absolute, 'utf8')
          const normalized = source.replaceAll(root.replaceAll('\\', '\\\\'), HOME_TOKEN)
            .replaceAll(root.split(sep).join('/'), HOME_TOKEN).replaceAll(root, HOME_TOKEN)
          await writeFile(absolute, normalized)
        }
        // Installed resources may be owned by root/a different installer account.
        const mode = (stat.mode & 0o111) === 0 ? 0o644 : 0o755
        await chmod(absolute, mode)
        files.push({ kind: 'file', path, size: (await lstat(absolute)).size,
          sha256: await fileDigest(absolute), mode, relocate })
      } else throw new Error(`desktop: unsupported prebuilt resource ${path}`)
    }
  }
  // Only controlled application state may become a release resource.
  for (const name of await readdir(root)) {
    if (!['profiles', 'bundled-plugins', MANIFEST].includes(name)) throw new Error(`desktop: unexpected prebuilt home entry ${name}`)
  }
  await chmod(root, 0o755)
  await walk(root)
  // Link recipes, not build-machine junctions, are shipped. Deployment creates local links.
  for (const file of files) if (file.kind === 'link') await unlink(join(root, file.path))
  const unsigned = { schema: 1 as const, identity, allowBuilds, files }
  const result = { ...unsigned, fingerprint: fingerprint(unsigned) }
  await writeFile(join(root, MANIFEST), `${JSON.stringify(result)}\n`, { mode: 0o644 })
  return result
}

/**
 * Read and validate the untrusted inventory without hashing its large payload.
 * @param root - Installed prebuilt resource directory.
 * @returns Manifest, or undefined only when the manifest is absent.
 */
export async function readPrebuiltProfile(root: string): Promise<PrebuiltProfileManifest | undefined> {
  let source: string
  try { source = await readFile(join(root, MANIFEST), 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  const value = JSON.parse(source) as {
    schema?: unknown
    identity?: unknown
    files?: unknown
    allowBuilds?: unknown
    fingerprint?: unknown
  } | null
  if (value?.schema !== 1 || !value.identity || !Array.isArray(value.files) || !value.allowBuilds
    || typeof value.allowBuilds !== 'object' || Array.isArray(value.allowBuilds)
    || !Object.values(value.allowBuilds).every(rule => typeof rule === 'boolean')
    || !['target', 'nodeVersion', 'pnpmVersion', 'runtimeVersion', 'pluginManifestSha256'].every(
      key => typeof (value.identity as Record<string, unknown>)[key] === 'string',
    )) throw new Error('desktop: invalid prebuilt Profile manifest')
  const seen = new Set<string>()
  for (const raw of value.files) {
    const file = raw as Partial<{
      path: string
      kind: string
      size: number
      sha256: string
      mode: number
      relocate: boolean
      target: string
    }> | null
    if (!file || typeof file.path !== 'string' || !portablePath(file.path) || seen.has(file.path.toLowerCase())
      || !allowedResource(file.path)) {
      throw new Error('desktop: unsafe prebuilt Profile resource path')
    }
    seen.add(file.path.toLowerCase())
    if (file.kind === 'file') {
      if (typeof file.size !== 'number' || !Number.isSafeInteger(file.size) || file.size < 0
        || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(file.sha256)
        || typeof file.mode !== 'number' || !Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o777
        || typeof file.relocate !== 'boolean' || (file.relocate && !managedMetadata(file.path))) {
        throw new Error('desktop: invalid prebuilt Profile file metadata')
      }
    } else if (file.kind === 'link') {
      if (typeof file.target !== 'string' || file.target.includes('\\') || file.target.includes(':')
        || isAbsolute(file.target) || !contained(root, resolve(root, dirname(file.path), file.target))) {
        throw new Error('desktop: prebuilt Profile link escapes its deployment')
      }
    } else throw new Error('desktop: invalid prebuilt Profile resource kind')
  }
  for (const path of seen) {
    let parent = dirname(path)
    while (parent !== '.') {
      if (seen.has(parent.toLowerCase())) throw new Error('desktop: prebuilt resource parent is not a directory')
      parent = dirname(parent)
    }
  }
  const { fingerprint: expected, ...unsigned } = value
  if (digest(JSON.stringify(unsigned)) !== expected) throw new Error('desktop: prebuilt Profile manifest checksum mismatch')
  return value as PrebuiltProfileManifest
}

/**
 * Copy verified resources into an exclusively owned candidate, retaining complete files on cancellation.
 * No file is shared by hard link with the installed template. Links are created after all regular files.
 * @param source - Read-only installed template.
 * @param target - Candidate home under the caller's active transaction lease.
 * @param manifest - Validated manifest returned by readPrebuiltProfile.
 * @param signal - Lifecycle cancellation; caller must await completion before releasing its lease.
 * @param progress - File counts, including verified files reused after interruption.
 */
export async function deployPrebuiltProfile(
  source: string, target: string, manifest: PrebuiltProfileManifest,
  signal: AbortSignal, progress: (completed: number, total: number) => void,
): Promise<void> {
  const directories = new Set<string>()
  const directory = async (path: string): Promise<void> => {
    if (directories.has(path)) return
    if (!contained(target, path)) throw new Error('desktop: prebuilt deployment escapes its candidate')
    if (path !== target) await directory(dirname(path))
    try { await mkdir(path) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    if (!(await lstat(path)).isDirectory()) throw new Error('desktop: prebuilt candidate contains a linked parent')
    directories.add(path)
  }
  const sourceDirectories = new Set<string>()
  const checkSourceParents = async (path: string): Promise<void> => {
    if (sourceDirectories.has(path)) return
    if (!contained(source, path) || !(await lstat(path)).isDirectory()) throw new Error('desktop: unsafe prebuilt source directory')
    if (path !== source) await checkSourceParents(dirname(path))
    sourceDirectories.add(path)
  }
  await directory(target)
  // Keep hard-interruption leftovers outside the Profile that will be activated.
  const partials = join(target, '.prebuilt-partials')
  await directory(partials)
  for (const name of await readdir(partials)) {
    if (!/^[a-f0-9-]{36}\.part$/u.test(name) || !(await lstat(join(partials, name))).isFile()) {
      throw new Error('desktop: unsafe prebuilt partial resource')
    }
    await unlink(join(partials, name))
  }
  let completed = 0
  for (const file of manifest.files.filter(file => file.kind === 'file')) {
    signal.throwIfAborted()
    const from = join(source, file.path)
    const to = join(target, file.path)
    await directory(dirname(to))
    await checkSourceParents(dirname(from))
    const sourceStat = await lstat(from)
    if (!sourceStat.isFile() || sourceStat.size !== file.size || await fileDigest(from) !== file.sha256) {
      throw new Error(`desktop: damaged prebuilt resource ${file.path}; reinstall the application`)
    }
    let bytes: Buffer | undefined
    if (file.relocate) {
      const text = await readFile(from, 'utf8')
      const replacement = file.path.endsWith('.json') ? target.replaceAll('\\', '\\\\') : target.split(sep).join('/')
      bytes = Buffer.from(text.replaceAll(HOME_TOKEN, replacement))
    }
    const expected = bytes === undefined ? file.sha256 : createHash('sha256').update(bytes).digest('hex')
    let reusable = false
    try {
      if (!(await lstat(to)).isFile()) throw new Error('desktop: unsafe prebuilt candidate file')
      reusable = await fileDigest(to) === expected
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (!reusable) {
      const temporary = join(partials, `${randomUUID()}.part`)
      try {
        if (bytes === undefined) await copyFile(from, temporary)
        else await writeFile(temporary, bytes, { flag: 'wx' })
        await chmod(temporary, file.mode)
        if (await fileDigest(temporary) !== expected) throw new Error(`desktop: copied prebuilt resource checksum mismatch: ${file.path}`)
        signal.throwIfAborted()
        await rename(temporary, to)
      } finally {
        try { await unlink(temporary) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      }
    }
    progress(++completed, manifest.files.length)
  }
  for (const file of manifest.files.filter(file => file.kind === 'link')) {
    signal.throwIfAborted()
    const to = join(target, file.path)
    await directory(dirname(to))
    try {
      if (!(await lstat(to)).isSymbolicLink()) throw new Error('desktop: unsafe prebuilt candidate link')
      await unlink(to)
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const destination = resolve(dirname(to), file.target)
    const isDirectory = (await lstat(destination)).isDirectory()
    await symlink(process.platform === 'win32' && isDirectory ? destination : file.target, to, isDirectory ? 'junction' : 'file')
    progress(++completed, manifest.files.length)
  }
}

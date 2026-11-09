/** Inspect missing local preset sources and adopt verified replacements only in a candidate. */
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path'
import { valid } from 'semver'
import { list } from 'tar'
import { parse, stringify } from 'yaml'
import { assertBundledPluginManifestEntry, verifyBundledPluginArchive, type BundledPluginManifestEntry } from './bundled-plugin-seed.ts'

export interface LegacyBundledPluginSourceOptions {
  readonly home: string
  readonly entries: readonly BundledPluginManifestEntry[]
}
export interface LegacyBundledPluginSourceIssue {
  readonly packageName: string
  readonly dependencySpec: string
  readonly installedVersion?: string
  readonly targetVersion?: string
  readonly archivePath: string
}

/** A missing direct archive source that blocks dependency operations until reviewed repair. */
export class MissingLocalPluginArchiveError extends Error {
  readonly code = 'desktop.plugin-archive-missing'
  readonly packageName: string
  readonly missingArchive: string
  readonly phase = 'source-preflight'

  constructor(issue: LegacyBundledPluginSourceIssue) {
    super(`Local archive for ${issue.packageName} is missing; review its installation source before changing plugins.`)
    this.name = 'MissingLocalPluginArchiveError'
    this.packageName = issue.packageName
    this.missingArchive = issue.archivePath
  }
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('desktop: invalid plugin metadata')
  return value as Record<string, unknown>
}
function within(parent: string, child: string): boolean {
  const part = relative(parent, child)
  return part !== '' && !isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`)
}
async function optionalText(path: string): Promise<string | undefined> {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('desktop: unsafe plugin metadata file')
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
function archivePath(profile: string, spec: string): string | undefined {
  if (!spec.startsWith('file:') || !spec.toLowerCase().endsWith('.tgz')) return undefined
  const path = spec.slice(5)
  return /^[a-z]:[\\/]/iu.test(path) || path.startsWith('\\\\') ? win32.normalize(path) : resolve(profile, path)
}

/**
 * List missing direct local archives without asserting that installed packages activated.
 * @param options - Profile home and the trusted replacement allowlist.
 * @returns Missing sources requiring an explicit source-repair decision.
 */
export async function inspectLegacyBundledPluginSources(
  options: LegacyBundledPluginSourceOptions,
): Promise<LegacyBundledPluginSourceIssue[]> {
  const results: LegacyBundledPluginSourceIssue[] = []
  for (const entry of options.entries) assertBundledPluginManifestEntry(entry)
  const profiles = new Set(['web', ...options.entries.map(entry => entry.profile)])
  for (const profileName of profiles) {
    const profile = join(options.home, 'profiles', profileName)
    const source = await optionalText(join(profile, 'package.json'))
    if (source === undefined) continue
    const manifest = record(JSON.parse(source))
    const dependencies = { ...record(manifest.devDependencies ?? {}), ...record(manifest.dependencies ?? {}) }
    for (const [packageName, spec] of Object.entries(dependencies)) {
      if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/iu.test(packageName)) {
        throw new Error('desktop: invalid local plugin dependency name')
      }
      if (typeof spec !== 'string') continue
      const path = archivePath(profile, spec)
      if (path === undefined) continue
      try {
        const info = await lstat(path)
        if (!info.isFile() || info.isSymbolicLink()) throw new Error('desktop: unsafe local plugin archive')
        continue
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      const installed = await optionalText(join(profile, 'node_modules', ...packageName.split('/'), 'package.json'))
      let installedVersion: string | undefined
      if (installed !== undefined) {
        const identity = record(JSON.parse(installed))
        if (identity.name !== packageName || typeof identity.version !== 'string' || valid(identity.version) === null) {
          throw new Error(`desktop: installed plugin identity disagrees with ${packageName}`)
        }
        installedVersion = identity.version
      }
      const entry = options.entries.find(item => item.packageName === packageName && item.profile === profileName)
      results.push({ packageName, dependencySpec: spec, archivePath: path,
        ...(entry === undefined ? {} : { targetVersion: entry.version }),
        ...(installedVersion === undefined ? {} : { installedVersion }) })
    }
  }
  return results
}

/**
 * Audit all direct local plugin archives, including user packages without a bundled replacement.
 * @param home - Profile home inspected without modifications.
 * @param entries - Trusted presets used only to annotate available replacement versions.
 * @returns Missing archives; an absent targetVersion means no trusted bundled repair is available.
 */
export function inspectMissingLocalPluginSources(
  home: string, entries: readonly BundledPluginManifestEntry[],
): Promise<LegacyBundledPluginSourceIssue[]> {
  return inspectLegacyBundledPluginSources({ home, entries })
}

function pruneLocators(value: unknown, specs: readonly string[]): unknown {
  const normalized = (text: string): string => {
    try { return decodeURI(text).replaceAll('\\', '/') } catch { return text.replaceAll('\\', '/') }
  }
  const matches = (text: string): boolean => specs.some((spec) => {
    const value = normalized(text)
    return [normalized(spec), normalized(spec.slice(5))].some((needle) => {
      const index = value.indexOf(needle)
      if (index < 0 || (index !== 0 && value[index - 1] !== '@')) return false
      const end = index + needle.length
      return end === value.length || value[end] === '('
    })
  })
  if (Array.isArray(value)) return value.map(item => pruneLocators(item, specs))
  if (value === null || typeof value !== 'object') return value
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(record(value))) {
    if (matches(key) || (typeof child === 'string' && matches(child))) continue
    if (child !== null && typeof child === 'object' && !Array.isArray(child)
      && Object.values(record(child)).some(item => typeof item === 'string' && matches(item))) continue
    result[key] = pruneLocators(child, specs)
  }
  return result
}
async function assertArchiveIdentity(path: string, entry: BundledPluginManifestEntry): Promise<void> {
  let identity: unknown
  let count = 0
  await list({ file: path, onReadEntry: (item) => {
    if (item.path !== 'package/package.json') return
    count++
    if (item.size > 65_536 || item.type !== 'File') throw new Error('desktop: invalid bundled archive package manifest')
    let text = ''
    item.on('data', (chunk: Buffer) => { text += chunk.toString('utf8') })
    item.on('end', () => {
      try { identity = JSON.parse(text) as unknown } catch { identity = undefined }
    })
  } })
  if (count !== 1 || record(identity).name !== entry.packageName || record(identity).version !== entry.version) {
    throw new Error('desktop: bundled archive package identity mismatch')
  }
}
async function atomicText(path: string, source: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  try { await writeFile(temporary, source, { flag: 'wx', mode: 0o600 }); await rename(temporary, path) }
  finally { await rm(temporary, { force: true }) }
}

/**
 * Adopt explicitly approved current preset archives in a candidate under the caller's mutation lease, retaining original metadata.
 * @param options - Candidate, active home, trusted package manifest and exact approved package names.
 * @returns Repaired and unresolved sources. Caller regenerates the pruned lock with pnpm and verifies activation.
 */
export async function repairLegacyBundledPluginSources(options: LegacyBundledPluginSourceOptions & {
  readonly sourceDshHome: string
  readonly resourcesDirectory: string
  readonly approvedPackages?: readonly string[]
}): Promise<{ repaired: LegacyBundledPluginSourceIssue[]; unresolved: LegacyBundledPluginSourceIssue[] }> {
  const sourceHome = await realpath(options.sourceDshHome)
  const home = await realpath(options.home)
  if (!within(join(sourceHome, 'plugin-transactions'), home) || !home.endsWith(`${sep}candidate`)) {
    throw new Error('desktop: source repair requires an owned candidate home')
  }
  const issues = await inspectLegacyBundledPluginSources(options)
  const approved = new Set(options.approvedPackages ?? [])
  if ([...approved].some(name => !options.entries.some(entry => entry.packageName === name))) throw new Error('desktop: untrusted plugin source repair request')
  const repaired = issues.filter(issue => approved.has(issue.packageName))
  if (repaired.length === 0) return { repaired, unresolved: issues }
  const replacements = new Map<string, string>()
  const stableDirectory = join(home, 'bundled-plugins')
  await mkdir(stableDirectory, { recursive: true, mode: 0o700 })
  if (await realpath(stableDirectory) !== stableDirectory) throw new Error('desktop: unsafe candidate archive directory')
  // Verify every archive before editing any dependency metadata.
  for (const issue of repaired) {
    const entry = options.entries.find(item => item.packageName === issue.packageName)
    if (entry === undefined) throw new Error('desktop: repaired package left the trusted manifest')
    const source = await verifyBundledPluginArchive(options.resourcesDirectory, entry)
    const bytes = await readFile(source)
    if (`sha512-${createHash('sha512').update(bytes).digest('base64')}` !== entry.integrity) {
      throw new Error('desktop: bundled plugin integrity changed during source repair')
    }
    const target = join(stableDirectory, entry.archive)
    try {
      const info = await lstat(target)
      if (!info.isFile() || info.isSymbolicLink() || !bytes.equals(await readFile(target))) throw new Error('desktop: candidate archive conflict')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await writeFile(target, bytes, { flag: 'wx', mode: 0o600 })
    }
    await assertArchiveIdentity(target, entry)
    replacements.set(issue.packageName, `file:${target}`)
  }
  const changes: Array<{ path: string; before: string; after: string }> = []
  for (const profileName of new Set(options.entries.filter(entry => replacements.has(entry.packageName)).map(entry => entry.profile))) {
    const profile = join(home, 'profiles', profileName)
    if (!within(home, await realpath(profile))) throw new Error('desktop: plugin Profile escapes candidate')
    for (const name of ['package.json', 'pnpm-lock.yaml', 'node_modules/.pnpm/lock.yaml']) {
      const path = join(profile, name); const before = await optionalText(path)
      if (before === undefined) continue
      if (!within(home, await realpath(path))) throw new Error('desktop: plugin metadata escapes candidate')
      let after: string
      if (name === 'package.json') {
        const manifest = record(JSON.parse(before))
        for (const group of ['dependencies', 'devDependencies']) {
          if (manifest[group] === undefined) continue
          const dependencies = record(manifest[group])
          for (const issue of repaired) {
            if (dependencies[issue.packageName] === issue.dependencySpec) {
              dependencies[issue.packageName] = replacements.get(issue.packageName)
            }
          }
        }
        after = `${JSON.stringify(manifest, null, 2)}\n`
      } else after = stringify(pruneLocators(parse(before) as unknown, repaired.map(issue => issue.dependencySpec)))
      if (after !== before) changes.push({ path, before, after })
    }
  }
  const backupDirectory = join(home, 'legacy-source-repairs', randomUUID())
  await mkdir(backupDirectory, { recursive: true, mode: 0o700 })
  for (const change of changes) {
    const backup = join(backupDirectory, relative(home, change.path)); await mkdir(dirname(backup), { recursive: true, mode: 0o700 })
    await writeFile(backup, change.before, { flag: 'wx', mode: 0o600 })
  }
  const applied: typeof changes = []
  try {
    for (const change of changes) { await atomicText(change.path, change.after); applied.push(change) }
  } catch (error) {
    for (const change of applied.reverse()) await atomicText(change.path, change.before)
    throw error
  }
  return { repaired, unresolved: issues.filter(issue => !approved.has(issue.packageName)) }
}

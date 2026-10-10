/** Inspect retired configuration fields before Desktop starts or changes a user Profile. */
import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { isMap, isScalar, isSeq, parseDocument } from 'yaml'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { inspectProfileMutationLock } from './menu-mutation-guard.ts'

const PATCHES = ['cordis.patch.yml', 'profiles/web/cordis.patch.yml'] as const

export interface LegacyConfigIssue {
  readonly code: 'desktop.legacy-tools-mode' | 'desktop.legacy-instruction-home' | 'desktop.legacy-config-invalid'
  readonly file: string
  readonly row: string
}

export interface LegacyConfigPlan {
  readonly issues: readonly LegacyConfigIssue[]
  readonly changes: readonly { readonly file: string; readonly before: string; readonly after: string }[]
}

function explicitHome(value: string): string | undefined {
  const expanded = value === '~' ? homedir()
    : value.startsWith('~/') || value.startsWith('~\\') ? join(homedir(), value.slice(2)) : value
  return isAbsolute(expanded) ? resolve(expanded) : undefined
}

/**
 * Check other Profiles before migrating their shared home patch under the Web mutation lease.
 * @param home Active data directory containing Profile mutation leases.
 * @returns Whether a live, unreadable, or malformed non-Web writer prevents shared-home edits.
 */
export async function legacyConfigExternalWriterActive(home: string): Promise<boolean> {
  let files: string[]
  try { files = await readdir(join(home, 'plugin-snapshots/v1')) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    return true
  }
  return files.some((file) => {
    const match = /^\.profile-plugin-mutation\.([A-Za-z0-9._~-]{1,64})\.lock$/u.exec(file)
    return match !== null && match[1] !== 'web' && inspectProfileMutationLock(home, match[1]).active
  })
}

/**
 * Inspect local user patches without evaluating expressions or inferring a replacement tools mode.
 * Only literal instruction roots equal to the active process home qualify for field removal.
 * @param home Directory containing the patches being inspected, including a startup candidate.
 * @param activeHome Process home whose instruction semantics the user selected.
 * @param toolsMode Effective environment override, when present.
 * @returns Blocking issues and exact proposed patch bytes; no files are changed.
 */
export async function inspectLegacyConfig(home: string, activeHome: string, toolsMode?: string): Promise<LegacyConfigPlan> {
  const issues: LegacyConfigIssue[] = toolsMode === 'both'
    ? [{ code: 'desktop.legacy-tools-mode', file: 'DSH_TOOLS_MODE', row: 'tools' }] : []
  const changes: Array<{ file: string; before: string; after: string }> = []
  for (const file of PATCHES) {
    const path = join(home, file)
    let before: string
    try {
      const stat = await lstat(path)
      if (!stat.isFile() || stat.size > 1024 * 1024) {
        issues.push({ code: 'desktop.legacy-config-invalid', file, row: '' }); continue
      }
      before = await readFile(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      issues.push({ code: 'desktop.legacy-config-invalid', file, row: '' }); continue
    }
    const document = parseDocument(before, {
      customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }],
    })
    if (document.errors.length > 0 || !isSeq(document.contents)) {
      issues.push({ code: 'desktop.legacy-config-invalid', file, row: '' }); continue
    }
    const visit = (node: unknown): boolean => {
      if (isSeq(node)) return node.items.map(visit).some(Boolean)
      if (!isMap(node)) return false
      let changed = false
      const id = node.get('id')
      const name = node.get('name')
      const row = typeof id === 'string' ? id : typeof name === 'string' ? name : ''
      const instruction = name === '@deepseek-ai/dsh-agent-instructions' || id === 'agent-instructions'
      const tools = name === '@deepseek-ai/dsh-tools' || name === '@deepseek-ai/dsh-agent-tool-presentation'
        || id === 'tools' || id === 'tool-presentation'
      const config = node.get('config', true)
      if (isMap(config)) {
        if (tools && config.get('mode') === 'both') issues.push({ code: 'desktop.legacy-tools-mode', file, row })
        if (instruction && config.has('dshHome')) {
          const value = config.get('dshHome', true)
          if (isScalar(value) && value.tag === undefined && typeof value.value === 'string'
            && explicitHome(value.value) === resolve(activeHome)) {
            config.delete('dshHome')
            changed = true
          } else issues.push({ code: 'desktop.legacy-instruction-home', file, row })
        }
      }
      const children = node.items.map(pair => visit(pair.value))
      return changed || children.some(Boolean)
    }
    if (visit(document.contents)) changes.push({ file, before, after: String(document) })
  }
  return { issues, changes }
}

/**
 * Apply an inspected plan inside the Desktop startup candidate after saving original bytes.
 * A changed candidate or any unresolved issue refuses the migration. Backups never include other data.
 * @param candidateHome Mutation-owned candidate containing copied user patches.
 * @param activeHome Original home receiving private content-addressed configuration backups.
 * @param plan Read-only inspection of the same candidate.
 * @returns Number of rewritten configuration files; an already migrated candidate returns zero.
 */
export async function migrateLegacyConfigCandidate(candidateHome: string, activeHome: string, plan: LegacyConfigPlan): Promise<number> {
  if (plan.issues.length > 0) throw new Error('desktop: legacy configuration requires an explicit user decision')
  if (plan.changes.some(change => change.file === 'cordis.patch.yml') && await legacyConfigExternalWriterActive(activeHome)) {
    throw new Error('desktop: another Profile writer prevents migration of the shared home patch')
  }
  for (const change of plan.changes) {
    if (!PATCHES.some(file => file === change.file)) throw new Error('desktop: unsupported legacy configuration file')
    if (await readFile(join(candidateHome, change.file), 'utf8') !== change.before) {
      throw new Error('desktop: legacy configuration changed after inspection')
    }
  }
  const directory = join(activeHome, 'diagnostics', 'config-backups')
  if (plan.changes.length > 0) {
    // Validate each home-relative ancestor before creating its child. A recursive
    // mkdir followed by checking only the leaf follows a diagnostics symlink.
    for (const ancestor of [activeHome, join(activeHome, 'diagnostics'), directory]) {
      if (ancestor !== activeHome) {
        try { await mkdir(ancestor, { mode: 0o700 }) }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
      }
      const stat = await lstat(ancestor)
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('desktop: unsafe legacy configuration backup directory')
    }
  }
  for (const change of plan.changes) {
    const digest = createHash('sha256').update(change.before).digest('hex')
    const backup = join(directory, `${change.file.replaceAll('/', '-')}.${digest}.yml`)
    try { await writeFile(backup, change.before, { flag: 'wx', mode: 0o600 }) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const stat = await lstat(backup)
      if (!stat.isFile() || stat.isSymbolicLink() || await readFile(backup, 'utf8') !== change.before) throw error
    }
    await writeFileAtomic(join(candidateHome, change.file), change.after, { mode: 0o600 })
  }
  return plan.changes.length
}

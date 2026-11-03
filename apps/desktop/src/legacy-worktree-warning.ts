/** Preserve and diagnose the retired standalone worktree bundle without changing user configuration. */
import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const LEGACY_WORKTREE_BUNDLE = '@deepseek-ai/dsh-experimental-tool-worktree'

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/**
 * Back up a regular Web Profile manifest when its literal bundle list still enables the retired entry.
 * @param home Local data directory; no files outside this home are inspected.
 * @returns Relative backup path for manual migration, or undefined when the entry is absent.
 */
async function backupManifest(home: string, file: string): Promise<string | undefined> {
  const manifest = join(home, file)
  let source: Buffer
  try {
    for (const directory of ['profiles', file.split('/').slice(0, 2).join('/')]) {
      if (!(await lstat(join(home, directory))).isDirectory()) throw new Error('desktop: unsafe legacy worktree Profile directory')
    }
    if (!(await lstat(manifest)).isFile()) throw new Error('desktop: legacy worktree manifest is not a regular file')
    source = await readFile(manifest)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  const value: unknown = JSON.parse(source.toString('utf8'))
  const profile = record(record(record(value)?.dsh)?.profile)
  if (!Array.isArray(profile?.bundles) || !profile.bundles.includes(LEGACY_WORKTREE_BUNDLE)) return undefined
  try {
    const digest = createHash('sha256').update(source).digest('hex')
    const relative = `diagnostics/legacy-worktree-backups/package-${digest}.json`
    for (const part of ['diagnostics', 'diagnostics/legacy-worktree-backups']) {
      const directory = join(home, part)
      await mkdir(directory, { recursive: true, mode: 0o700 })
      if (!(await lstat(directory)).isDirectory()) throw new Error('desktop: unsafe legacy worktree backup directory')
    }
    try { await writeFile(join(home, relative), source, { flag: 'wx', mode: 0o600 }) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = join(home, relative)
      if (!(await lstat(existing)).isFile() || !(await readFile(existing)).equals(source)) {
        throw new Error('desktop: legacy worktree backup is not an intact regular file')
      }
    }
    return relative
  } catch (error) {
    throw new LegacyWorktreeBackupError('desktop: unsafe or unavailable legacy worktree backup', { cause: error })
  }
}

/**
 * Preserve literal Web and shared bundle declarations before diagnosing the retired entry.
 * @param home Local data directory; sources are never modified or evaluated.
 * @returns Backup paths for affected manifests, or undefined when no retired bundle is declared.
 */
export async function backupLegacyWorktreeConfiguration(home: string): Promise<string | undefined> {
  const backups: string[] = []
  for (const file of ['profiles/web/package.json', 'profiles/shared/package.json']) {
    const backup = await backupManifest(home, file)
    if (backup !== undefined) backups.push(backup)
  }
  return backups.length === 0 ? undefined : backups.join(', ')
}

class LegacyWorktreeBackupError extends Error {}

/**
 * Classify a retired bundle warning without allowing a backup failure to block application startup.
 * @param home Local data directory whose literal Profile manifests are inspected.
 * @returns A nonblocking warning with accurate backup outcome, or undefined when no retired bundle is present.
 */
export async function inspectLegacyWorktreeWarning(home: string): Promise<{
  code: 'runtime.legacy-worktree-bundle' | 'runtime.legacy-worktree-backup-failed'
  backup?: string
} | undefined> {
  try {
    const backup = await backupLegacyWorktreeConfiguration(home)
    return backup === undefined ? undefined : { code: 'runtime.legacy-worktree-bundle', backup }
  } catch (error) {
    if (!(error instanceof LegacyWorktreeBackupError)) throw error
    return { code: 'runtime.legacy-worktree-backup-failed' }
  }
}

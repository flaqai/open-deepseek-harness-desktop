/** Conservative post-commit collection of explicitly reviewed desktop archives. */
import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, realpath, unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parse } from 'yaml'

/** Reference inventory covering active Profiles, pending transactions and all retained snapshots. */
export interface ManagedArchiveReferenceAudit {
  /** False when any reference-bearing metadata is missing, unreadable or unsupported. */
  readonly complete: boolean
  readonly referencedArchives: readonly string[]
}

/** Explicit verified archive identities and exclusive mutation ownership supplied by the archive manager. */
export interface ManagedArchiveCleanupOptions {
  readonly home: string
  readonly readinessCommitted: boolean
  readonly archives: readonly { readonly archive: string; readonly integrity: string }[]
  /** Hold the normal Profile mutation lease throughout audit, identity checks and deletion. */
  withMutationLease<T>(run: () => Promise<T>): Promise<T>
  /** Read every retained reference under the same lease; unknown coverage retains all files. */
  auditReferences(): Promise<ManagedArchiveReferenceAudit>
}

/** Independent cleanup outcome; deferred cleanup never reverses a successful activation. */
export interface ManagedArchiveCleanupResult {
  readonly removed: readonly string[]
  readonly deferred: boolean
}

/**
 * Remove only reviewed, unchanged and unreferenced archives after normal readiness commit.
 * @param options - Trusted archive identities, complete reference audit and exclusive lease adapter.
 * @returns Removed basenames and whether any cleanup remains deferred.
 */
export async function collectManagedPluginArchives(options: ManagedArchiveCleanupOptions): Promise<ManagedArchiveCleanupResult> {
  const removed: string[] = []
  if (!options.readinessCommitted) return { removed, deferred: true }
  try {
    return await options.withMutationLease(async () => {
      const directory = resolve(await realpath(options.home), 'bundled-plugins')
      if ((await lstat(directory)).isSymbolicLink() || await realpath(directory) !== directory) {
        return { removed, deferred: true }
      }
      const audit = await options.auditReferences()
      if (!audit.complete) return { removed, deferred: true }
      const referenced = new Set(audit.referencedArchives)
      let deferred = false
      const seen = new Set<string>()
      for (const entry of options.archives) {
        if (seen.has(entry.archive)) continue
        seen.add(entry.archive)
        if (!/^[A-Za-z0-9@_.-]+\.tgz$/u.test(entry.archive) || referenced.has(entry.archive)) continue
        const path = join(directory, entry.archive)
        try {
          const before = await lstat(path)
          if (!before.isFile() || before.isSymbolicLink() || before.size > 256 * 1024 * 1024) {
            deferred = true
            continue
          }
          const integrity = /^(sha256|sha512)-([A-Za-z0-9+/]+={0,2})$/u.exec(entry.integrity)
          const algorithm = integrity?.[1]
          if ((algorithm !== 'sha256' && algorithm !== 'sha512')
            || createHash(algorithm).update(await readFile(path)).digest('base64') !== integrity?.[2]) {
            deferred = true
            continue
          }
          const after = await lstat(path)
          if (after.dev !== before.dev || after.ino !== before.ino || after.mtimeMs !== before.mtimeMs || after.size !== before.size) {
            deferred = true
            continue
          }
          await unlink(path)
          removed.push(entry.archive)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') deferred = true
        }
      }
      return { removed, deferred }
    })
  } catch { return { removed, deferred: true } }
}

/**
 * Audit all active Profile manifests/locks, retaining every reviewed archive while any snapshot exists.
 * @param home - Active Harness home, inspected while the caller owns its mutation lease.
 * @param archives - Reviewed archive basenames whose possible references must be protected.
 * @returns Complete conservative references, or incomplete when any state cannot be established.
 */
export async function auditManagedPluginArchiveReferences(
  home: string, archives: readonly string[],
): Promise<ManagedArchiveReferenceAudit> {
  const retain = { complete: false, referencedArchives: archives }
  try {
    const safeEntries = async (directory: string) => {
      if ((await lstat(directory)).isSymbolicLink()) throw new Error('unsafe archive reference directory')
      return await readdir(directory, { withFileTypes: true })
    }
    const snapshots = await safeEntries(join(home, 'plugin-snapshots', 'v1'))
    if (snapshots.some(entry => entry.isDirectory() || entry.isSymbolicLink())) return { complete: true, referencedArchives: archives }
    try {
      for (const profile of await safeEntries(join(home, 'plugin-transactions'))) {
        if (!profile.isDirectory()) return retain
        const entries = await safeEntries(join(home, 'plugin-transactions', profile.name))
        for (const entry of entries) {
          if (entry.name !== 'cleanup-pending' || !entry.isDirectory()
            || (await safeEntries(join(home, 'plugin-transactions', profile.name, entry.name))).length > 0) return retain
        }
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return retain }
    const referenced = new Set<string>()
    for (const profile of await safeEntries(join(home, 'profiles'))) {
      if (!profile.isDirectory() || profile.isSymbolicLink()) return retain
      for (const name of ['package.json', 'pnpm-lock.yaml', 'node_modules/.modules.yaml', 'node_modules/.pnpm/lock.yaml']) {
        const path = join(home, 'profiles', profile.name, name)
        let info
        try { info = await lstat(path) } catch (error) {
          if (name.startsWith('node_modules/') && (error as NodeJS.ErrnoException).code === 'ENOENT') continue
          return retain
        }
        if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 * 1024
          || await realpath(path) !== resolve(await realpath(home), 'profiles', profile.name, name)) return retain
        const text = await readFile(path, 'utf8')
        const parsed: unknown = name.endsWith('.json') ? JSON.parse(text) : parse(text, { maxAliasCount: 20 })
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return retain
        const decoded = decodeURIComponent(JSON.stringify(parsed))
        for (const archive of archives) if (decoded.includes(archive)) referenced.add(archive)
      }
    }
    return { complete: true, referencedArchives: [...referenced] }
  } catch { return retain }
}

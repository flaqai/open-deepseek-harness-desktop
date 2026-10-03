/** Retire the legacy Schedule bundle now that Web provides the official service. */

import { lstat, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const SCHEDULE_BUNDLE = '@deepseek-ai/dsh-experimental-schedule-bundle'

type ProfileManifest = {
  dependencies?: Record<string, unknown>
  dsh?: { profile?: { bundles?: unknown; [key: string]: unknown }; [key: string]: unknown }
  odsh?: { scheduleMigration?: unknown; [key: string]: unknown }
  [key: string]: unknown
}

async function regularFile(path: string): Promise<string | undefined> {
  try {
    if (!(await lstat(path)).isFile()) throw new Error(`desktop: unsafe legacy Schedule file ${path}`)
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function parseManifest(source: string): ProfileManifest {
  const value: unknown = JSON.parse(source)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('desktop: invalid legacy Schedule Profile manifest')
  }
  const data = value as Record<string, unknown>
  if (data.odsh !== undefined && (data.odsh === null || typeof data.odsh !== 'object' || Array.isArray(data.odsh))) {
    throw new Error('desktop: legacy Schedule Profile community metadata is invalid')
  }
  const manifest = data as ProfileManifest
  if (data.dependencies !== undefined && (data.dependencies === null
    || typeof data.dependencies !== 'object' || Array.isArray(data.dependencies))) {
    throw new Error('desktop: legacy Schedule Profile dependencies are invalid')
  }
  const bundles = manifest.dsh?.profile?.bundles
  if (!Array.isArray(bundles) || !bundles.every(bundle => typeof bundle === 'string')) {
    throw new Error('desktop: legacy Schedule Profile bundle list is invalid')
  }
  return manifest
}

/** Inspection is read-only and scoped to one local DSH_HOME. */
export async function legacyScheduleMigrationNeeded(home: string): Promise<boolean> {
  const manifestSource = await regularFile(join(home, 'profiles', 'web', 'package.json'))
  if (manifestSource === undefined) return false
  const manifest = parseManifest(manifestSource)
  return manifest.odsh?.scheduleMigration === 1
    || (manifest.dsh?.profile?.bundles as string[]).includes(SCHEDULE_BUNDLE)
    || Object.hasOwn(manifest.dependencies ?? {}, SCHEDULE_BUNDLE)
}

/** Called only inside DesktopProfileMutation's startup candidate, never on the live Profile. */
export async function migrateLegacyScheduleCandidate(candidateHome: string): Promise<'converted' | 'recorded' | 'unchanged'> {
  const path = join(candidateHome, 'profiles', 'web', 'package.json')
  const source = await regularFile(path)
  if (source === undefined) throw new Error('desktop: legacy Schedule candidate Profile is missing')
  const manifest = parseManifest(source)
  const bundles = manifest.dsh?.profile?.bundles as string[]
  const converted = bundles.includes(SCHEDULE_BUNDLE) || Object.hasOwn(manifest.dependencies ?? {}, SCHEDULE_BUNDLE)
  if (!converted && manifest.odsh?.scheduleMigration === 2) return 'unchanged'
  if (converted) {
    manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles: bundles.filter(bundle => bundle !== SCHEDULE_BUNDLE) } }
    if (manifest.dependencies !== undefined) {
      manifest.dependencies = Object.fromEntries<unknown>(
        Object.entries(manifest.dependencies).filter(([name]) => name !== SCHEDULE_BUNDLE),
      )
    }
  }
  manifest.odsh = { ...manifest.odsh, scheduleMigration: 2 }
  const temporary = `${path}.${process.pid}.schedule-migration.tmp`
  await writeFile(temporary, `${JSON.stringify(manifest, undefined, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, path)
  return converted ? 'converted' : 'recorded'
}

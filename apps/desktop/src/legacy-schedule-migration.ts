/** Preserve explicitly enabled legacy Web schedules when Schedule becomes an optional bundle. */

import { lstat, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isMap, isScalar, isSeq, parseDocument } from 'yaml'

export const SCHEDULE_BUNDLE = '@deepseek-ai/dsh-experimental-schedule-bundle'

type ProfileManifest = {
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

/** Last literal user override wins; an expression is not evidence of opt-in. */
function scheduleOverride(source: string | undefined): boolean | undefined {
  if (source === undefined) return undefined
  const document = parseDocument(source, { uniqueKeys: true })
  if (document.errors.length > 0) throw new Error(`desktop: invalid legacy Schedule Profile patch: ${document.errors[0]?.message ?? 'unknown error'}`)
  if (document.contents === null) return undefined
  if (!isSeq(document.contents)) throw new Error('desktop: legacy Schedule Profile patch must be a sequence')
  let enabled: boolean | undefined
  for (const item of document.contents.items) {
    if (!isMap(item)) continue
    const id = item.get('id', true)
    if (!isScalar(id) || id.toString() !== 'schedule') continue
    const disabled = item.get('disabled', true)
    if (disabled === undefined) continue
    if (isScalar(disabled) && typeof disabled.value === 'boolean' && disabled.tag === undefined) enabled = !disabled.value
  }
  return enabled
}

async function hasActiveStoredTasks(home: string): Promise<boolean> {
  const source = await regularFile(join(home, 'storages', 'schedule.json'))
  if (source === undefined) return false
  let value: unknown
  try { value = JSON.parse(source) } catch { return false }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const document = value as Record<string, unknown>
  const unit = document.unit
  const tables = document.tables
  if (typeof unit !== 'object' || unit === null || Array.isArray(unit)
    || (unit as Record<string, unknown>).name !== 'schedule'
    || (unit as Record<string, unknown>).version !== 1
    || typeof tables !== 'object' || tables === null || Array.isArray(tables)) return false
  const tasks = (tables as Record<string, unknown>).tasks
  if (typeof tasks !== 'object' || tasks === null || Array.isArray(tasks)) return false
  return Object.values(tasks).some(task => typeof task === 'object' && task !== null && !Array.isArray(task)
    && ((task as Record<string, unknown>).status === undefined || (task as Record<string, unknown>).status === 'active'))
}

async function effectiveScheduleOverride(home: string): Promise<boolean | undefined> {
  const profile = scheduleOverride(await regularFile(join(home, 'profiles', 'web', 'cordis.patch.yml')))
  const homeOverride = scheduleOverride(await regularFile(join(home, 'cordis.patch.yml')))
  return homeOverride ?? profile
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
  if (manifest.odsh?.scheduleMigration === 1) return false
  if ((manifest.dsh?.profile?.bundles as string[]).includes(SCHEDULE_BUNDLE)) return true
  const override = await effectiveScheduleOverride(home)
  if (override === false) return false
  return override === true || await hasActiveStoredTasks(home)
}

/** Called only inside DesktopProfileMutation's startup candidate, never on the live Profile. */
export async function migrateLegacyScheduleCandidate(
  candidateHome: string, liveHome = candidateHome, allowLegacyEnable = true,
): Promise<'enabled' | 'recorded' | 'unchanged'> {
  const path = join(candidateHome, 'profiles', 'web', 'package.json')
  const source = await regularFile(path)
  if (source === undefined) throw new Error('desktop: legacy Schedule candidate Profile is missing')
  const manifest = parseManifest(source)
  const bundles = manifest.dsh?.profile?.bundles as string[]
  if (manifest.odsh?.scheduleMigration === 1) return 'unchanged'
  let enable = false
  if (allowLegacyEnable && !bundles.includes(SCHEDULE_BUNDLE)) {
    const candidateOverride = scheduleOverride(await regularFile(join(candidateHome, 'profiles', 'web', 'cordis.patch.yml')))
    const homeOverride = scheduleOverride(await regularFile(join(liveHome, 'cordis.patch.yml')))
    const override = homeOverride ?? candidateOverride
    if (override === false) return 'unchanged'
    enable = override === true || await hasActiveStoredTasks(liveHome)
    if (!enable) return 'unchanged'
    manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles: [...bundles, SCHEDULE_BUNDLE] } }
  }
  manifest.odsh = { ...manifest.odsh, scheduleMigration: 1 }
  const temporary = `${path}.${process.pid}.schedule-migration.tmp`
  await writeFile(temporary, `${JSON.stringify(manifest, undefined, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, path)
  return enable ? 'enabled' : 'recorded'
}

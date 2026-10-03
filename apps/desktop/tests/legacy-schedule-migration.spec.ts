import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { legacyScheduleMigrationNeeded, migrateLegacyScheduleCandidate, SCHEDULE_BUNDLE } from '../src/legacy-schedule-migration.ts'

interface Manifest {
  dependencies: Record<string, string>
  dsh: { profile: { bundles: string[]; custom: boolean } }
  odsh?: { scheduleMigration: number; custom?: boolean }
}

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function saveManifest(home: string, value: Manifest): Promise<void> {
  await writeFile(join(home, 'profiles/web/package.json'), `${JSON.stringify(value, undefined, 2)}\n`)
}

async function manifest(home: string): Promise<Manifest> {
  return JSON.parse(await readFile(join(home, 'profiles/web/package.json'), 'utf8')) as Manifest
}

async function profile(patch = '[]\n'): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-legacy-schedule-'))
  roots.push(home)
  await mkdir(join(home, 'profiles/web'), { recursive: true })
  await saveManifest(home, {
    dependencies: { 'custom-plugin': '1.2.3' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'custom-plugin'], custom: true } },
  })
  await writeFile(join(home, 'profiles/web/cordis.patch.yml'), patch)
  return home
}

async function tasks(home: string, status: 'active' | 'inactive'): Promise<void> {
  await mkdir(join(home, 'storages'), { recursive: true })
  await writeFile(join(home, 'storages/schedule.json'), JSON.stringify({
    unit: { name: 'schedule', version: 1 }, global: null,
    tables: { tasks: { old: { status, sessionId: 'saved-session', record: { id: 'old' } } } },
  }) + '\n')
}

describe('legacy Schedule bundle retirement', () => {
  it.each([true, false])('removes the retired bundle while preserving disabled=%s and stored task status', async (disabled) => {
    const patch = `- id: schedule\n  disabled: ${disabled}\n  config:\n    deliveryHistoryDays: 7\n`
    const live = await profile(patch)
    const candidate = await profile(patch)
    const homePatch = '- id: schedule\n  disabled: true\n'
    await writeFile(join(candidate, 'cordis.patch.yml'), homePatch)
    const before = await manifest(candidate)
    before.dsh.profile.bundles.push(SCHEDULE_BUNDLE)
    before.dependencies[SCHEDULE_BUNDLE] = '0.2.0'
    before.odsh = { scheduleMigration: 1, custom: true }
    await saveManifest(candidate, before)
    await tasks(candidate, disabled ? 'inactive' : 'active')
    const originalLive = await readFile(join(live, 'profiles/web/package.json'), 'utf8')
    const originalTasks = await readFile(join(candidate, 'storages/schedule.json'), 'utf8')
    expect(await legacyScheduleMigrationNeeded(candidate)).toBe(true)
    expect(await migrateLegacyScheduleCandidate(candidate)).toBe('converted')
    const migrated = await manifest(candidate)
    expect(migrated.dsh.profile.bundles).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'custom-plugin'])
    expect(migrated.dependencies).toEqual({ 'custom-plugin': '1.2.3' })
    expect(migrated.dsh.profile.custom).toBe(true)
    expect(migrated.odsh).toEqual({ scheduleMigration: 2, custom: true })
    expect(await readFile(join(candidate, 'profiles/web/cordis.patch.yml'), 'utf8')).toBe(patch)
    expect(await readFile(join(candidate, 'cordis.patch.yml'), 'utf8')).toBe(homePatch)
    expect(await readFile(join(candidate, 'storages/schedule.json'), 'utf8')).toBe(originalTasks)
    expect(await readFile(join(live, 'profiles/web/package.json'), 'utf8')).toBe(originalLive)
    expect(await migrateLegacyScheduleCandidate(candidate)).toBe('unchanged')
    expect(await legacyScheduleMigrationNeeded(candidate)).toBe(false)
  })

  it('upgrades a previous marker without selecting an optional bundle or reactivating tasks', async () => {
    const home = await profile('- id: schedule\n  disabled: true\n')
    const before = await manifest(home)
    before.odsh = { scheduleMigration: 1 }
    await saveManifest(home, before)
    await tasks(home, 'inactive')
    const originalTasks = await readFile(join(home, 'storages/schedule.json'), 'utf8')
    expect(await legacyScheduleMigrationNeeded(home)).toBe(true)
    expect(await migrateLegacyScheduleCandidate(home)).toBe('recorded')
    expect((await manifest(home)).odsh?.scheduleMigration).toBe(2)
    expect((await manifest(home)).dsh.profile.bundles).not.toContain(SCHEDULE_BUNDLE)
    expect(await readFile(join(home, 'storages/schedule.json'), 'utf8')).toBe(originalTasks)
  })

  it('records a fresh Profile without creating tasks or changing an explicit disable', async () => {
    const patch = '- id: schedule\n  disabled: true\n'
    const home = await profile(patch)
    expect(await legacyScheduleMigrationNeeded(home)).toBe(false)
    expect(await migrateLegacyScheduleCandidate(home)).toBe('recorded')
    expect(await readFile(join(home, 'profiles/web/cordis.patch.yml'), 'utf8')).toBe(patch)
    await expect(readFile(join(home, 'storages/schedule.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not infer bundle opt-in from active tasks or explicit enable YAML', async () => {
    const home = await profile('- id: schedule\n  disabled: false\n')
    await tasks(home, 'active')
    expect(await legacyScheduleMigrationNeeded(home)).toBe(false)
  })

  it('removes a retired dependency even after deselection or a completed marker', async () => {
    const home = await profile()
    const before = await manifest(home)
    before.dependencies[SCHEDULE_BUNDLE] = '0.2.0'
    before.odsh = { scheduleMigration: 2 }
    await saveManifest(home, before)
    expect(await legacyScheduleMigrationNeeded(home)).toBe(true)
    expect(await migrateLegacyScheduleCandidate(home)).toBe('converted')
    expect((await manifest(home)).dependencies).toEqual({ 'custom-plugin': '1.2.3' })
  })

  it('does not change the live Profile when candidate validation fails', async () => {
    const live = await profile()
    const candidate = await profile()
    const liveBefore = await readFile(join(live, 'profiles/web/package.json'), 'utf8')
    await writeFile(join(candidate, 'profiles/web/package.json'), '{ bad json')
    await expect(migrateLegacyScheduleCandidate(candidate)).rejects.toThrow()
    expect(await readFile(join(live, 'profiles/web/package.json'), 'utf8')).toBe(liveBefore)
  })

  it('refuses invalid dependency metadata without rewriting the candidate', async () => {
    const home = await profile()
    const invalid = JSON.stringify({ ...await manifest(home), dependencies: [] })
    await writeFile(join(home, 'profiles/web/package.json'), invalid)
    await expect(legacyScheduleMigrationNeeded(home)).rejects.toThrow('dependencies are invalid')
    await expect(migrateLegacyScheduleCandidate(home)).rejects.toThrow('dependencies are invalid')
    expect(await readFile(join(home, 'profiles/web/package.json'), 'utf8')).toBe(invalid)
  })

  it('is scoped to the selected local home', async () => {
    const local = await profile()
    const remote = await profile()
    const before = await manifest(remote)
    before.dsh.profile.bundles.push(SCHEDULE_BUNDLE)
    await saveManifest(remote, before)
    expect(await legacyScheduleMigrationNeeded(local)).toBe(false)
    expect(await legacyScheduleMigrationNeeded(remote)).toBe(true)
    expect(await manifest(remote)).toEqual(before)
  })
})

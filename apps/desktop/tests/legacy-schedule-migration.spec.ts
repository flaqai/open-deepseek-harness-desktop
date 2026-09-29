import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  legacyScheduleMigrationNeeded, migrateLegacyScheduleCandidate, SCHEDULE_BUNDLE,
} from '../src/legacy-schedule-migration.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function profile(patch = '[]\n'): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-legacy-schedule-'))
  roots.push(home)
  const directory = join(home, 'profiles', 'web')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web', private: true, dependencies: { 'custom-plugin': '1.2.3' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'custom-plugin'], custom: true } },
  }, undefined, 2) + '\n')
  await writeFile(join(directory, 'cordis.patch.yml'), patch)
  return home
}

async function tasks(home: string, status: 'active' | 'inactive' = 'active'): Promise<void> {
  await mkdir(join(home, 'storages'), { recursive: true })
  await writeFile(join(home, 'storages', 'schedule.json'), JSON.stringify({
    unit: { name: 'schedule', version: 1 }, global: null,
    tables: { tasks: { old: { status, sessionId: 'saved-session', record: { id: 'old' } } } },
  }) + '\n')
}

describe('legacy Schedule optional-bundle migration', () => {
  it('preserves an explicitly enabled old Profile and its exact user patch inside a candidate', async () => {
    const live = await profile('- id: schedule\n  disabled: false\n  config:\n    deliveryHistoryDays: 7\n- id: time-context\n  disabled: false\n')
    const candidate = await profile(await readFile(join(live, 'profiles/web/cordis.patch.yml'), 'utf8'))
    const originalLive = await readFile(join(live, 'profiles/web/package.json'), 'utf8')
    const originalPatch = await readFile(join(candidate, 'profiles/web/cordis.patch.yml'), 'utf8')
    expect(await legacyScheduleMigrationNeeded(live)).toBe(true)
    expect(await migrateLegacyScheduleCandidate(candidate)).toBe('enabled')
    const migrated = JSON.parse(await readFile(join(candidate, 'profiles/web/package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      dsh: { profile: { bundles: string[]; custom: boolean } }
    }
    expect(migrated.dsh.profile.bundles).toEqual([
      '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'custom-plugin', SCHEDULE_BUNDLE,
    ])
    expect(migrated.dependencies).toEqual({ 'custom-plugin': '1.2.3' })
    expect(migrated.dsh.profile.custom).toBe(true)
    expect(migrated).toHaveProperty('odsh.scheduleMigration', 1)
    expect(await readFile(join(candidate, 'profiles/web/cordis.patch.yml'), 'utf8')).toBe(originalPatch)
    expect(await readFile(join(live, 'profiles/web/package.json'), 'utf8')).toBe(originalLive)
    expect(await migrateLegacyScheduleCandidate(candidate)).toBe('unchanged')
    expect(await legacyScheduleMigrationNeeded(candidate)).toBe(false)
  })

  it('keeps a fresh or inactive Profile off, but retains active old tasks without a literal override', async () => {
    const fresh = await profile()
    expect(await legacyScheduleMigrationNeeded(fresh)).toBe(false)
    await tasks(fresh, 'inactive')
    expect(await legacyScheduleMigrationNeeded(fresh)).toBe(false)
    const active = await profile()
    await tasks(active)
    expect(await legacyScheduleMigrationNeeded(active)).toBe(true)
    const originalTasks = await readFile(join(active, 'storages/schedule.json'), 'utf8')
    expect(await migrateLegacyScheduleCandidate(active)).toBe('enabled')
    expect(await readFile(join(active, 'storages/schedule.json'), 'utf8')).toBe(originalTasks)
  })

  it('respects an explicit off switch even when stale active records remain', async () => {
    const home = await profile('- id: schedule\n  disabled: true\n')
    await tasks(home)
    expect(await legacyScheduleMigrationNeeded(home)).toBe(false)
  })

  it('honors the higher-priority home patch while checking a private candidate', async () => {
    const live = await profile('- id: schedule\n  disabled: true\n')
    const candidate = await profile('- id: schedule\n  disabled: true\n')
    await writeFile(join(live, 'cordis.patch.yml'), '- id: schedule\n  disabled: false\n')
    expect(await legacyScheduleMigrationNeeded(live)).toBe(true)
    expect(await migrateLegacyScheduleCandidate(candidate, live)).toBe('enabled')

    const off = await profile('- id: schedule\n  disabled: false\n')
    await writeFile(join(off, 'cordis.patch.yml'), '- id: schedule\n  disabled: true\n')
    await tasks(off)
    expect(await legacyScheduleMigrationNeeded(off)).toBe(false)
  })

  it('does not change the live Profile when candidate validation fails', async () => {
    const live = await profile('- id: schedule\n  disabled: false\n')
    const candidate = await profile()
    const liveBefore = await readFile(join(live, 'profiles/web/package.json'), 'utf8')
    await writeFile(join(candidate, 'profiles/web/package.json'), '{ bad json')
    await expect(migrateLegacyScheduleCandidate(candidate)).rejects.toThrow()
    expect(await readFile(join(live, 'profiles/web/package.json'), 'utf8')).toBe(liveBefore)
  })

  it('records a fresh default-off Profile so later stored tasks cannot undo an intentional disable', async () => {
    const home = await profile()
    expect(await migrateLegacyScheduleCandidate(home, home, false)).toBe('recorded')
    await tasks(home)
    expect(await legacyScheduleMigrationNeeded(home)).toBe(false)
    const manifest = JSON.parse(await readFile(join(home, 'profiles/web/package.json'), 'utf8')) as {
      dsh: { profile: { bundles: string[] } }
    }
    expect(manifest.dsh.profile.bundles).not.toContain(SCHEDULE_BUNDLE)
  })

  it('acknowledges a bundle the user enabled themselves, preserving a later opt-out', async () => {
    const home = await profile()
    const path = join(home, 'profiles/web/package.json')
    const manifest = JSON.parse(await readFile(path, 'utf8')) as { dsh: { profile: { bundles: string[] } } }
    manifest.dsh.profile.bundles.push(SCHEDULE_BUNDLE)
    await writeFile(path, `${JSON.stringify(manifest)}\n`)
    expect(await legacyScheduleMigrationNeeded(home)).toBe(true)
    expect(await migrateLegacyScheduleCandidate(home)).toBe('recorded')
    manifest.dsh.profile.bundles.pop()
    const marked = JSON.parse(await readFile(path, 'utf8')) as { odsh: { scheduleMigration: number } }
    await writeFile(path, `${JSON.stringify({ ...manifest, odsh: marked.odsh })}\n`)
    await tasks(home)
    expect(await legacyScheduleMigrationNeeded(home)).toBe(false)
  })

  it('is scoped to the chosen local home and never scans a remote NAS home', async () => {
    const local = await profile()
    const remote = await profile('- id: schedule\n  disabled: false\n')
    expect(await legacyScheduleMigrationNeeded(local)).toBe(false)
    expect(await legacyScheduleMigrationNeeded(remote)).toBe(true)
    expect(await readFile(join(remote, 'profiles/web/package.json'), 'utf8')).not.toContain(SCHEDULE_BUNDLE)
  })
})

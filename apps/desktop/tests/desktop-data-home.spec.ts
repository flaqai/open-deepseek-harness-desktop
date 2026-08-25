import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  desktopDataHomeSetup,
  hasDesktopData,
  hasImportableDesktopData,
  importOfficialDesktopData,
  readDesktopDataHomeSetup,
  resolveRecordedDesktopDataHome,
  resolveDesktopDataHomeLayout,
  writeDesktopDataHomeSetup,
} from '../src/desktop-data-home.ts'

const roots: string[] = []

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-data-home-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('desktop data home', () => {
  it('separates packaged and development data under the repository name', () => {
    const packaged = resolveDesktopDataHomeLayout('/app-data', '/home/user', true, {})
    const development = resolveDesktopDataHomeLayout('/app-data', '/home/user', false, {})
    expect(packaged.desktopRoot).toBe(join('/app-data', 'open-deepseek-harness-desktop'))
    expect(packaged.dshHome).toBe(join(packaged.desktopRoot, 'dsh-home'))
    expect(packaged.sessionData).toBe(join(packaged.desktopRoot, 'session-data'))
    expect(development.desktopRoot).toBe(join('/app-data', 'open-deepseek-harness-desktop', 'development'))
    expect(development.dshHome).toBe(join(development.desktopRoot, 'dsh-home'))
    expect(packaged.officialDshHome).toBe(join('/home/user', '.dsh'))
  })

  it('keeps an explicit DSH_HOME authoritative and expands a home prefix', () => {
    const layout = resolveDesktopDataHomeLayout('/app-data', '/home/user', true, { DSH_HOME: '~/.custom-dsh' })
    expect(layout.dshHome).toBe(join('/home/user', '.custom-dsh'))
    expect(layout.explicitDshHome).toBe(true)
    expect(layout.desktopRoot).toBe(join('/app-data', 'open-deepseek-harness-desktop'))
  })

  it('imports supported user state without plugin runtimes, markers, or symlinks', async () => {
    const root = await fixture()
    const official = join(root, '.dsh')
    const target = join(root, 'desktop', 'dsh-home')
    await mkdir(join(official, 'sessions', 'one'), { recursive: true })
    await mkdir(join(official, 'profiles', 'web', 'node_modules'), { recursive: true })
    await mkdir(join(official, 'bundled-plugins'), { recursive: true })
    await writeFile(join(official, 'settings.yaml'), 'locale: zh\n')
    await writeFile(join(official, '.credentials.yaml'), 'version: "1"\n')
    await writeFile(join(official, 'sessions', 'one', 'session.jsonl'), '{}\n')
    await writeFile(join(official, 'profiles', 'web', 'package.json'), '{}\n')
    await writeFile(join(official, 'bundled-plugins', 'plugin.seeded.json'), '{}\n')
    await writeFile(join(official, '.anonymous-user-id'), 'old-id\n')
    await symlink(join(official, 'settings.yaml'), join(official, 'AGENTS.md'))

    expect(await hasImportableDesktopData(official)).toBe(true)
    const result = await importOfficialDesktopData(official, target)
    expect(result.copied).toEqual(['.credentials.yaml', 'sessions', 'settings.yaml'])
    expect(result.skippedSymlinks).toEqual(['AGENTS.md'])
    expect(await readFile(join(target, 'settings.yaml'), 'utf8')).toBe('locale: zh\n')
    expect(await readFile(join(target, 'sessions', 'one', 'session.jsonl'), 'utf8')).toBe('{}\n')
    await expect(readFile(join(target, 'profiles', 'web', 'package.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(target, 'bundled-plugins', 'plugin.seeded.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(target, '.anonymous-user-id'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await hasDesktopData(target)).toBe(true)
  })

  it('refuses a non-empty destination and records setup atomically', async () => {
    const root = await fixture()
    const official = join(root, '.dsh')
    const target = join(root, 'target')
    const setupPath = join(root, 'desktop', 'data-home-setup.json')
    await mkdir(official)
    await mkdir(target)
    await writeFile(join(target, 'owned.txt'), 'keep')
    await expect(importOfficialDesktopData(official, target)).rejects.toThrow('non-empty Harness home')
    expect(await readFile(join(target, 'owned.txt'), 'utf8')).toBe('keep')

    const setup = desktopDataHomeSetup('imported', target, official)
    await writeDesktopDataHomeSetup(setupPath, setup)
    expect(await readDesktopDataHomeSetup(setupPath)).toEqual(setup)
    await writeFile(setupPath, '{broken')
    expect(await readDesktopDataHomeSetup(setupPath)).toBeUndefined()
  })

  it('records direct reuse of the official home without copying it', async () => {
    const root = await fixture()
    const official = join(root, '.dsh')
    const setupPath = join(root, 'desktop', 'data-home-setup.json')
    const setup = desktopDataHomeSetup('reused', official, official)
    await writeDesktopDataHomeSetup(setupPath, setup)
    await expect(readDesktopDataHomeSetup(setupPath)).resolves.toEqual(setup)
    expect(await hasDesktopData(join(root, 'desktop', 'dsh-home'))).toBe(false)

    const layout = resolveDesktopDataHomeLayout(join(root, 'app-data'), root, true, {})
    expect(resolveRecordedDesktopDataHome(layout, setup)).toBe(official)
    expect(resolveRecordedDesktopDataHome(layout, {
      ...setup,
      source: join(root, 'unexpected'),
    })).toBeUndefined()
  })
})

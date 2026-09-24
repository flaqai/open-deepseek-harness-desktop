import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { create } from 'tar'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DesktopDataHomeAuthority,
  DesktopDataHomeChooserSession,
  type DesktopDataHomeChooserPresentation,
} from '../src/desktop-data-home-authority.ts'
import {
  COMMUNITY_PROFILE_IDENTITY_FILE,
  PORTABLE_PLUGIN_TRANSFER_FILENAME,
  ensureCommunityProfileIdentity,
  readDesktopDataHomeSetup,
  resolveDesktopDataHomeLayout,
} from '../src/desktop-data-home.ts'
import { writePortablePluginBundle } from '../src/portable-plugin-bundle.ts'
import { packPortablePluginBundle } from '../src/portable-plugin-transfer.ts'

const roots: string[] = []

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-data-home-authority-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function presentation(defaultTarget: string): DesktopDataHomeChooserPresentation {
  return {
    officialSourceUnreadable: false,
    officialSourceCandidate: join(defaultTarget, '.official'),
    communitySourceUnreadable: false,
    communitySourceCandidate: join(defaultTarget, '.community'),
    defaultTarget,
    returnToMain: false,
    defaultTargetAvailable: true,
  }
}

async function portableFixture(root: string): Promise<string> {
  const packageDirectory = join(root, 'package-source', 'package')
  await mkdir(packageDirectory, { recursive: true })
  await writeFile(join(packageDirectory, 'package.json'), JSON.stringify({ name: 'example-plugin', version: '1.2.3' }))
  const archive = join(root, 'example.tgz')
  await create({ cwd: join(root, 'package-source'), file: archive, gzip: true }, ['package'])
  const bundle = join(root, 'bundle')
  const manifest = await writePortablePluginBundle(bundle, {
    platform: 'win32', architecture: 'x64', osVersion: '10.0.22631',
  }, [{ packageName: 'example-plugin', version: '1.2.3', archive }])
  await mkdir(join(bundle, 'store'))
  await mkdir(join(bundle, 'cache'))
  const emptyHash = createHash('sha256').digest('hex')
  await writeFile(join(bundle, 'manifest.json'), JSON.stringify({
    ...manifest, registry: 'https://registry.npmjs.org/',
    store: { sha256: emptyHash, cacheSha256: emptyHash, verification: 'target-rehearsal-required' },
  }))
  const transfer = join(root, 'transfer.tgz')
  await packPortablePluginBundle(bundle, transfer)
  return transfer
}

describe('Desktop data-home authority interface', () => {
  it('revalidates an opaque chooser target immediately before accepting it', async () => {
    const root = await fixture()
    const target = join(root, 'target')
    await mkdir(target)
    const session = new DesktopDataHomeChooserSession(presentation(join(root, 'default')), {
      now: () => 100,
      createSelectionId: () => '11111111-1111-4111-8111-111111111111',
      selectionLifetimeMs: 1_000,
    })

    await expect(session.chooseTarget(target)).resolves.toEqual({
      status: 'selected',
      selectionId: '11111111-1111-4111-8111-111111111111',
      path: target,
    })
    await writeFile(join(target, 'appeared-after-selection.txt'), 'keep')

    await expect(session.submit({
      mode: 'fresh',
      target: { kind: 'custom', selectionId: '11111111-1111-4111-8111-111111111111' },
    })).resolves.toEqual({
      status: 'target-error',
      result: { status: 'not-empty', path: target },
    })
  })

  it('requires explicit confirmation before an unidentified community source can be reused', async () => {
    const root = await fixture()
    const source = join(root, 'legacy-community')
    await mkdir(source)
    await writeFile(join(source, 'settings.yaml'), 'locale: zh\n')
    const session = new DesktopDataHomeChooserSession(presentation(join(root, 'target')), {
      now: () => 100,
      createSelectionId: () => '22222222-2222-4222-8222-222222222222',
      selectionLifetimeMs: 1_000,
    })

    await expect(session.chooseSource('community', source)).resolves.toMatchObject({
      status: 'confirmation-required', path: source,
    })
    const confirmed = await session.chooseSource('community', source, true)
    expect(confirmed).toMatchObject({
      status: 'valid', path: source, selectionId: '22222222-2222-4222-8222-222222222222',
    })
    await expect(session.submit({
      mode: 'reused', sourceKind: 'community', source,
      sourceSelectionId: '22222222-2222-4222-8222-222222222222',
    })).resolves.toEqual({
      status: 'selected', choice: { mode: 'reused', sourceKind: 'community', source },
    })
    await expect(readFile(join(source, COMMUNITY_PROFILE_IDENTITY_FILE), 'utf8')).resolves.toContain('instanceId')
  })

  it('initializes a fresh home and publishes its setup through one operation', async () => {
    const root = await fixture()
    const layout = resolveDesktopDataHomeLayout(join(root, 'app-data'), root, true, {})
    const calls: string[] = []
    const authority = new DesktopDataHomeAuthority({
      layout,
      stopActiveProfile: async () => { calls.push('stop') },
      scheduleRestart: () => { calls.push('restart') },
    })

    const result = await authority.initialize(async (session) => {
      expect(session.presentation.defaultTarget).toBe(layout.dshHome)
      const submission = await session.submit({ mode: 'fresh', target: { kind: 'default' } })
      if (submission.status !== 'selected') throw new Error(`unexpected ${submission.status}`)
      return submission.choice
    })

    expect(result).toEqual({ path: layout.dshHome, copied: false })
    await expect(readDesktopDataHomeSetup(layout.setupFile)).resolves.toMatchObject({
      mode: 'fresh', dshHome: layout.dshHome,
    })
    expect(calls).toEqual([])
  })

  it('imports an official source and publishes the resulting independent home', async () => {
    const root = await fixture()
    const layout = resolveDesktopDataHomeLayout(join(root, 'app-data'), root, true, {})
    await mkdir(layout.officialDshHome, { recursive: true })
    await writeFile(join(layout.officialDshHome, 'settings.yaml'), 'locale: zh\n')
    const authority = new DesktopDataHomeAuthority({
      layout,
      stopActiveProfile: async () => {},
      scheduleRestart: () => {},
    })

    const result = await authority.initialize(async (session) => {
      expect(session.presentation.officialSource?.path).toBe(layout.officialDshHome)
      const submission = await session.submit({
        mode: 'copied',
        sourceKind: 'official',
        source: layout.officialDshHome,
        target: { kind: 'default' },
      })
      if (submission.status !== 'selected') throw new Error(`unexpected ${submission.status}`)
      return submission.choice
    })

    expect(result).toEqual({ path: layout.dshHome, copied: true })
    await expect(readFile(join(layout.dshHome, 'settings.yaml'), 'utf8')).resolves.toContain('locale: zh')
    await expect(readDesktopDataHomeSetup(layout.setupFile)).resolves.toMatchObject({
      mode: 'imported', dshHome: layout.dshHome, source: layout.officialDshHome,
    })
  })

  it('copies only a verified offline transfer with the configuration and rejects a foreign selection id', async () => {
    const root = await fixture()
    const layout = resolveDesktopDataHomeLayout(join(root, 'app-data'), root, true, {})
    await mkdir(layout.officialDshHome, { recursive: true })
    await writeFile(join(layout.officialDshHome, 'settings.yaml'), 'locale: zh\n')
    const transfer = await portableFixture(root)
    const authority = new DesktopDataHomeAuthority({
      layout, stopActiveProfile: async () => {}, scheduleRestart: () => {},
    })
    const result = await authority.initialize(async (session) => {
      const chosen = await session.choosePortable(transfer)
      if (chosen.status !== 'selected') throw new Error(`unexpected ${chosen.status}`)
      expect(chosen.target).toEqual({ platform: 'win32', architecture: 'x64', osVersion: '10.0.22631' })
      await expect(session.submit({
        mode: 'copied', sourceKind: 'official', source: layout.officialDshHome,
        target: { kind: 'default' }, pluginMigration: { mode: 'offline', selectionId: '00000000-0000-4000-8000-000000000000' },
      })).resolves.toEqual({ status: 'ignored' })
      const submission = await session.submit({
        mode: 'copied', sourceKind: 'official', source: layout.officialDshHome,
        target: { kind: 'default' }, pluginMigration: { mode: 'offline', selectionId: chosen.selectionId },
      })
      if (submission.status !== 'selected') throw new Error(`unexpected ${submission.status}`)
      return submission.choice
    })
    expect(result.copied).toBe(true)
    expect(await readFile(join(layout.dshHome, PORTABLE_PLUGIN_TRANSFER_FILENAME)))
      .toEqual(await readFile(transfer))
  })

  it('refuses an expired offline selection before copying any configuration', async () => {
    const root = await fixture()
    const source = join(root, 'official')
    const target = join(root, 'target')
    await mkdir(source)
    await writeFile(join(source, 'settings.yaml'), 'locale: zh\n')
    const transfer = await portableFixture(root)
    let now = 100
    const session = new DesktopDataHomeChooserSession(presentation(target), {
      now: () => now, selectionLifetimeMs: 50,
      createSelectionId: () => '77777777-7777-4777-8777-777777777777',
    })
    const chosen = await session.choosePortable(transfer)
    if (chosen.status !== 'selected') throw new Error(`unexpected ${chosen.status}`)
    now = 151
    await expect(session.submit({
      mode: 'copied', sourceKind: 'official', source, target: { kind: 'default' },
      pluginMigration: { mode: 'offline', selectionId: chosen.selectionId },
    })).resolves.toEqual({ status: 'ignored' })
  })

  it('keeps the destination unpublished if the verified transfer changes before copying', async () => {
    const root = await fixture()
    const layout = resolveDesktopDataHomeLayout(join(root, 'app-data'), root, true, {})
    await mkdir(layout.officialDshHome, { recursive: true })
    await writeFile(join(layout.officialDshHome, 'settings.yaml'), 'locale: zh\n')
    const transfer = await portableFixture(root)
    const authority = new DesktopDataHomeAuthority({
      layout, stopActiveProfile: async () => {}, scheduleRestart: () => {},
    })
    await expect(authority.initialize(async (session) => {
      const chosen = await session.choosePortable(transfer)
      if (chosen.status !== 'selected') throw new Error(`unexpected ${chosen.status}`)
      const submission = await session.submit({
        mode: 'copied', sourceKind: 'official', source: layout.officialDshHome,
        target: { kind: 'default' }, pluginMigration: { mode: 'offline', selectionId: chosen.selectionId },
      })
      if (submission.status !== 'selected') throw new Error(`unexpected ${submission.status}`)
      await writeFile(transfer, 'changed after selection')
      return submission.choice
    })).rejects.toThrow('selected offline plugin transfer changed before import')
    await expect(readFile(join(layout.dshHome, PORTABLE_PLUGIN_TRANSFER_FILENAME)))
      .rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readDesktopDataHomeSetup(layout.setupFile)).resolves.toBeUndefined()
  })

  it('binds switch selections to one renderer and publishes only a consumed decision', async () => {
    const root = await fixture()
    const layout = resolveDesktopDataHomeLayout(join(root, 'app-data'), root, true, {})
    const active = layout.dshHome
    const selected = join(root, 'selected')
    await mkdir(join(active, 'profiles', 'web'), { recursive: true })
    await writeFile(join(active, 'profiles', 'web', 'package.json'), '{}\n')
    await mkdir(join(selected, 'profiles', 'web'), { recursive: true })
    await writeFile(join(selected, 'profiles', 'web', 'package.json'), '{}\n')
    await ensureCommunityProfileIdentity(selected)
    const ids = [
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
    ]
    const calls: string[] = []
    const authority = new DesktopDataHomeAuthority({
      layout,
      createSelectionId: () => ids.shift() ?? '55555555-5555-4555-8555-555555555555',
      stopActiveProfile: async () => { calls.push('stop') },
      scheduleRestart: () => { calls.push('restart') },
    })

    const first = await authority.chooseDirectory(7, 'existing', selected)
    if (first.status !== 'selected') throw new Error(`unexpected ${first.status}`)
    await expect(authority.switch(active, 8, { kind: 'custom', selectionId: first.selectionId }))
      .rejects.toThrow('expired; choose it again')
    expect(calls).toEqual([])

    const second = await authority.chooseDirectory(7, 'existing', selected)
    if (second.status !== 'selected') throw new Error(`unexpected ${second.status}`)
    await expect(authority.switch(active, 7, { kind: 'custom', selectionId: second.selectionId }))
      .resolves.toEqual({ restarting: true, activePath: selected })
    expect(calls).toEqual(['stop', 'restart'])
    await expect(readDesktopDataHomeSetup(layout.setupFile)).resolves.toMatchObject({
      mode: 'reused', dshHome: selected, source: selected,
    })
  })

  it('rejects an expired recovery selection without stopping the active Profile', async () => {
    const root = await fixture()
    const layout = resolveDesktopDataHomeLayout(join(root, 'app-data'), root, true, {})
    const empty = join(root, 'empty')
    await mkdir(empty)
    let now = 10
    const calls: string[] = []
    const authority = new DesktopDataHomeAuthority({
      layout,
      now: () => now,
      selectionLifetimeMs: 50,
      createSelectionId: () => '66666666-6666-4666-8666-666666666666',
      stopActiveProfile: async () => { calls.push('stop') },
      scheduleRestart: () => { calls.push('restart') },
    })
    const selected = await authority.chooseRecoveryDirectory(9, empty)
    if (selected.status !== 'selected') throw new Error(`unexpected ${selected.status}`)
    now = 61

    await expect(authority.switch(layout.dshHome, 9, {
      kind: 'create', selectionId: selected.selectionId,
    })).rejects.toThrow('expired; choose it again')
    expect(calls).toEqual([])
  })

  it('does not publish or restart when the runtime chooser keeps the active community home', async () => {
    const root = await fixture()
    const layout = resolveDesktopDataHomeLayout(join(root, 'app-data'), root, true, {})
    const active = join(root, 'community')
    await mkdir(active)
    await writeFile(join(active, 'settings.yaml'), 'locale: en\n')
    await ensureCommunityProfileIdentity(active)
    const calls: string[] = []
    const authority = new DesktopDataHomeAuthority({
      layout,
      stopActiveProfile: async () => { calls.push('stop') },
      scheduleRestart: () => { calls.push('restart') },
    })

    await expect(authority.change(active, async (session) => {
      expect(session.presentation.returnToMain).toBe(true)
      const submission = await session.submit({
        mode: 'reused', sourceKind: 'community', source: active,
      })
      if (submission.status !== 'selected') throw new Error(`unexpected ${submission.status}`)
      return submission.choice
    })).resolves.toEqual({ restarting: false, activePath: active })
    expect(calls).toEqual([])
  })
})

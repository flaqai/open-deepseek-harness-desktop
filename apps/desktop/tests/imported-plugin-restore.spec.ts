import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  extractImportedPluginRestorePlan,
  classifyImportedPluginSourceFailure,
  dependencyMatchesImportedRestore,
  ImportedPluginRestoreManager,
  mergeImportedAllowBuilds,
  readImportedPluginRestorePlan,
  writeImportedPluginRestorePlan,
} from '../src/imported-plugin-restore.ts'

const roots: string[] = []

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-imported-plugin-restore-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('imported plugin restore', () => {
  it('distinguishes missing sources from temporary registry failures', () => {
    expect(classifyImportedPluginSourceFailure('ERR_PNPM_FETCH_404 package not found')).toMatchObject({
      availability: 'unavailable',
    })
    expect(classifyImportedPluginSourceFailure("fatal: couldn't find remote ref missing")).toMatchObject({
      availability: 'unavailable',
    })
    for (const diagnostic of ['ENOTFOUND registry.npmjs.org', 'ERR_PNPM_FETCH_401', '429 rate limit']) {
      expect(classifyImportedPluginSourceFailure(diagnostic)).toMatchObject({ availability: 'unknown' })
    }
    expect(classifyImportedPluginSourceFailure('stopped', true)).toMatchObject({ availability: 'unknown' })
  })

  it('extracts only ordered dependency and bundle intersections and classifies unsafe sources', async () => {
    const root = await fixture()
    const profile = join(root, 'profiles', 'web')
    await mkdir(profile, { recursive: true })
    await writeFile(join(root, 'settings.yaml'), 'agent-presets:\n  externalTools:\n    codex: true\n')
    await writeFile(join(profile, 'package.json'), JSON.stringify({
      dependencies: {
        library: '^1.0.0',
        registryPlugin: '^2.0.0',
        aliasPlugin: 'npm:real-plugin@^3.0.0',
        gitPlugin: 'github:owner/repo#v1',
        localPlugin: 'file:../plugin',
        secretPlugin: 'git+https://user:token@example.test/repo.git',
        '@deepseek-ai/dsh-subagent-codex': '^0.1.0',
      },
      dsh: { profile: { bundles: [
        '@deepseek-ai/dsh-base', 'gitPlugin', 'library-missing', 'registryPlugin',
        'localPlugin', 'secretPlugin', 'aliasPlugin', '@deepseek-ai/dsh-subagent-codex',
      ] } },
    }))
    await writeFile(join(profile, 'pnpm-workspace.yaml'), [
      'packages:', '  - .', 'dangerouslyAllowAllBuilds: true', 'allowBuilds:',
      '  node-pty: true', '  unsafe-native: false', '',
    ].join('\n'))

    let index = 0
    const plan = await extractImportedPluginRestorePlan(root, () => `restore-${++index}`)
    expect(plan.entries.map(entry => entry.packageName)).toEqual([
      'gitPlugin', 'registryPlugin', 'localPlugin', 'secretPlugin', 'aliasPlugin',
      '@deepseek-ai/dsh-subagent-codex',
    ])
    expect(plan.entries.find(entry => entry.packageName === 'localPlugin')).toMatchObject({
      recoverable: false, unsupportedReason: 'local-source',
    })
    expect(plan.entries.find(entry => entry.packageName === 'secretPlugin')).toMatchObject({
      recoverable: false, unsupportedReason: 'credentialed-source',
    })
    expect(plan.entries.at(-1)).toMatchObject({
      category: 'external-tool', tool: 'codex', defaultSelected: true,
    })
    expect(plan.allowBuilds).toEqual({ 'node-pty': true, 'unsafe-native': false })
  })

  it('keeps malformed official Profile metadata non-blocking', async () => {
    const root = await fixture()
    const profile = join(root, 'profiles', 'web')
    await mkdir(profile, { recursive: true })
    await writeFile(join(profile, 'package.json'), '{broken')
    await writeFile(join(profile, 'pnpm-workspace.yaml'), 'allowBuilds: [broken')
    const plan = await extractImportedPluginRestorePlan(root)
    expect(plan.entries).toEqual([])
    expect(plan.sourceIssues).toHaveLength(2)
  })

  it('does not follow a linked official Profile manifest', async () => {
    const root = await fixture()
    const outside = join(root, 'outside-package.json')
    const profile = join(root, 'profiles', 'web')
    await mkdir(profile, { recursive: true })
    await writeFile(outside, JSON.stringify({
      dependencies: { plugin: '^1.0.0' }, dsh: { profile: { bundles: ['plugin'] } },
    }))
    await symlink(outside, join(profile, 'package.json'))
    const plan = await extractImportedPluginRestorePlan(root)
    expect(plan.entries).toEqual([])
  })

  it('does not follow a linked Web Profile directory', async () => {
    const root = await fixture()
    const outside = join(root, 'outside-web')
    await mkdir(join(root, 'profiles'), { recursive: true })
    await mkdir(outside)
    await writeFile(join(outside, 'package.json'), JSON.stringify({
      dependencies: { plugin: '^1.0.0' }, dsh: { profile: { bundles: ['plugin'] } },
    }))
    await symlink(outside, join(root, 'profiles', 'web'))
    const plan = await extractImportedPluginRestorePlan(root)
    expect(plan.entries).toEqual([])
  })

  it('merges exact build rules with explicit false winning and comments retained', async () => {
    const root = await fixture()
    await writeFile(join(root, 'pnpm-workspace.yaml'), [
      'packages:', '  - .', '# keep user setting', 'nodeLinker: hoisted', 'allowBuilds:',
      '  node-pty: false', '  sharp: true', '',
    ].join('\n'))
    await expect(mergeImportedAllowBuilds(root, {
      'node-pty': true, sharp: false, ssh2: true,
    })).resolves.toBe(true)
    const content = await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8')
    expect(content).toContain('# keep user setting')
    expect(content).toContain('node-pty: false')
    expect(content).toContain('sharp: false')
    expect(content).toContain('ssh2: true')
  })

  it('adopts matching names, npm aliases, and GitHub repository subpaths', () => {
    expect(dependencyMatchesImportedRestore('plugin', '^9', {
      packageName: 'plugin', declaredSpec: '^1',
    })).toBe(true)
    expect(dependencyMatchesImportedRestore('renamed', 'npm:real-plugin@^2', {
      packageName: 'alias', declaredSpec: 'npm:real-plugin@^1',
    })).toBe(true)
    expect(dependencyMatchesImportedRestore('renamed', 'github:owner/repo#path:/one', {
      packageName: 'git-plugin', declaredSpec: 'git+https://github.com/owner/repo.git#path:/one',
    })).toBe(true)
    expect(dependencyMatchesImportedRestore('renamed', 'github:owner/repo#path:/two', {
      packageName: 'git-plugin', declaredSpec: 'github:owner/repo#path:/one',
    })).toBe(false)
  })

  it('rolls back a selected batch when one install fails and retains the cause', async () => {
    const root = await fixture()
    await mkdir(join(root, 'profiles', 'web'), { recursive: true })
    await writeFile(join(root, 'profiles', 'web', 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
    const base = await extractImportedPluginRestorePlan(root)
    await writeImportedPluginRestorePlan(root, {
      ...base,
      entries: [
        { restoreId: 'one', packageName: 'provided', packageSpec: 'provided@^1', declaredSpec: '^1', category: 'plugin', defaultSelected: true, recoverable: true, state: 'pending' },
        { restoreId: 'two', packageName: 'good', packageSpec: 'good@^1', declaredSpec: '^1', category: 'plugin', defaultSelected: true, recoverable: true, state: 'pending' },
        { restoreId: 'three', packageName: 'bad', packageSpec: 'bad@^1', declaredSpec: '^1', category: 'plugin', defaultSelected: true, recoverable: true, state: 'pending' },
      ],
    })
    const install = vi.fn(async (specs: readonly string[]) => {
      if (specs.includes('bad@^1')) throw new Error('registry unavailable')
      return 'installed'
    })
    const mutationCalls: string[][] = []
    const withMutation = async <T>(operation: () => Promise<T>, expectedPackages: readonly string[]): Promise<T> => {
      mutationCalls.push([...expectedPackages])
      return operation()
    }
    const manager = new ImportedPluginRestoreManager({
      dshHome: root, providedDependencies: { provided: '^2' }, install, withMutation,
    })
    await manager.prepare()
    expect(manager.snapshot()?.entries[0]?.state).toBe('provided')
    await expect(manager.start(['unknown'])).rejects.toThrow('not selectable')
    await manager.start(['two', 'three'])
    await vi.waitFor(() => { expect(manager.snapshot()?.active).toBe(false) })
    expect(install).toHaveBeenCalledOnce()
    expect(install).toHaveBeenCalledWith(['good@^1', 'bad@^1'])
    expect(mutationCalls).toEqual([['good', 'bad']])
    expect(manager.snapshot()?.entries.map(entry => entry.state)).toEqual(['provided', 'failed', 'failed'])
    expect((await readImportedPluginRestorePlan(root))?.entries[1]?.diagnostic).toContain('rolled back')
    expect((await readImportedPluginRestorePlan(root))?.entries[2]?.diagnostic).toContain('registry unavailable')
  })

  it('does not report a restored plugin when managed activation rolls back', async () => {
    const root = await fixture()
    await mkdir(join(root, 'profiles', 'web'), { recursive: true })
    await writeFile(join(root, 'profiles', 'web', 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
    const base = await extractImportedPluginRestorePlan(root)
    await writeImportedPluginRestorePlan(root, {
      ...base,
      entries: [{ restoreId: 'managed', packageName: 'plugin', packageSpec: 'plugin@1', declaredSpec: '1', category: 'plugin', defaultSelected: true, recoverable: true, state: 'pending' }],
    })
    const withMutation = vi.fn(async (operation: () => Promise<unknown>, _expectedPackages: readonly string[]) => {
      await operation()
      throw new Error('candidate startup rolled back')
    })
    const manager = new ImportedPluginRestoreManager({
      dshHome: root, providedDependencies: {}, install: async () => '', withMutation,
    })
    await manager.prepare()
    await manager.start(['managed'])
    await vi.waitFor(() => { expect(manager.snapshot()?.active).toBe(false) })
    expect(withMutation).toHaveBeenCalledOnce()
    expect(withMutation).toHaveBeenCalledWith(expect.any(Function), ['plugin'])
    expect(manager.snapshot()?.entries[0]).toMatchObject({ state: 'failed', diagnostic: 'candidate startup rolled back' })
  })

  it('activates one managed candidate for a selected plugin batch', async () => {
    const root = await fixture()
    await mkdir(join(root, 'profiles', 'web'), { recursive: true })
    const base = await extractImportedPluginRestorePlan(root)
    await writeImportedPluginRestorePlan(root, {
      ...base,
      entries: ['first', 'second'].map(name => ({
        restoreId: name, packageName: name, packageSpec: `${name}@1`, declaredSpec: '1',
        category: 'plugin' as const, defaultSelected: true, recoverable: true, state: 'pending' as const,
      })),
    })
    const install = vi.fn(async () => '')
    const mutationCalls: string[][] = []
    const withMutation = async <T>(operation: () => Promise<T>, expectedPackages: readonly string[]): Promise<T> => {
      mutationCalls.push([...expectedPackages])
      return operation()
    }
    const manager = new ImportedPluginRestoreManager({
      dshHome: root, providedDependencies: {}, install, withMutation,
    })
    await manager.prepare()
    await manager.start(['first', 'second'])
    await vi.waitFor(() => { expect(manager.snapshot()?.active).toBe(false) })
    expect(install).toHaveBeenCalledOnce()
    expect(install).toHaveBeenCalledWith(['first@1', 'second@1'])
    expect(mutationCalls).toEqual([['first', 'second']])
    expect(manager.snapshot()?.entries.map(entry => entry.state)).toEqual(['succeeded', 'succeeded'])
    expect(manager.snapshot()?.restartRequired).toBe(false)
  })

  it('checks at most three sources concurrently and blocks only confirmed unavailable sources', async () => {
    const root = await fixture()
    await mkdir(join(root, 'profiles', 'web'), { recursive: true })
    await writeFile(join(root, 'profiles', 'web', 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
    const base = await extractImportedPluginRestorePlan(root)
    await writeImportedPluginRestorePlan(root, {
      ...base,
      entries: Array.from({ length: 5 }, (_, index) => ({
        restoreId: `id-${index}`, packageName: `plugin-${index}`, packageSpec: `plugin-${index}@^1`,
        declaredSpec: '^1', category: 'plugin' as const, defaultSelected: true,
        recoverable: true, state: 'pending' as const,
      })),
    })
    let running = 0
    let maximum = 0
    const manager = new ImportedPluginRestoreManager({
      dshHome: root,
      providedDependencies: {},
      install: vi.fn(async () => ''),
      withMutation: operation => operation(),
      inspectSource: async (spec) => {
        running += 1
        maximum = Math.max(maximum, running)
        await new Promise(resolve => setTimeout(resolve, 5))
        running -= 1
        return spec.startsWith('plugin-0@')
          ? { availability: 'unavailable' as const }
          : spec.startsWith('plugin-1@')
            ? { availability: 'unknown' as const }
            : { availability: 'available' as const }
      },
    })
    await manager.prepare()
    expect(manager.startSourceCheck()?.sourceCheckActive).toBe(true)
    await vi.waitFor(() => { expect(manager.snapshot()?.sourceCheckActive).toBe(false) })
    expect(maximum).toBe(3)
    expect(manager.snapshot()?.entries.map(entry => entry.availability)).toEqual([
      'unavailable', 'unknown', 'available', 'available', 'available',
    ])
    await expect(manager.start(['id-0'])).rejects.toThrow('source is unavailable')
    await expect(manager.start(['id-1'])).resolves.toMatchObject({ active: true })
    await vi.waitFor(() => { expect(manager.snapshot()?.active).toBe(false) })
  })

  it('routes a host-validated local archive through the standard installer and persists failure', async () => {
    const root = await fixture()
    await mkdir(join(root, 'profiles', 'web'), { recursive: true })
    await writeFile(join(root, 'profiles', 'web', 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
    const base = await extractImportedPluginRestorePlan(root)
    await writeImportedPluginRestorePlan(root, {
      ...base,
      entries: [{
        restoreId: 'local-id', packageName: 'local-plugin', packageSpec: 'local-plugin@file:../old',
        declaredSpec: 'file:../old', category: 'plugin', defaultSelected: false,
        recoverable: false, unsupportedReason: 'local-source', state: 'pending',
      }],
    })
    const install = vi.fn(async () => { throw new Error('local install failed safely') })
    const manager = new ImportedPluginRestoreManager({
      dshHome: root, providedDependencies: {}, install, withMutation: operation => operation(),
    })
    await manager.prepare()
    await expect(manager.installLocal('local-id', '/staged/plugin.tgz')).resolves.toMatchObject({ active: false })
    expect(install).toHaveBeenCalledWith(['/staged/plugin.tgz'])
    expect((await readImportedPluginRestorePlan(root))?.entries[0]).toMatchObject({
      state: 'failed', diagnostic: 'local install failed safely',
    })
  })

  it('commits a portable batch only after its candidate transaction succeeds', async () => {
    const root = await fixture()
    await mkdir(join(root, 'profiles', 'web'), { recursive: true })
    await writeFile(join(root, 'profiles', 'web', 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
    const base = await extractImportedPluginRestorePlan(root)
    await writeImportedPluginRestorePlan(root, {
      ...base,
      entries: ['one', 'two'].map(packageName => ({
        restoreId: `${packageName}-id`, packageName, packageSpec: `${packageName}@^1`,
        declaredSpec: '^1', category: 'plugin' as const, defaultSelected: true,
        recoverable: true, state: 'pending' as const,
      })),
    })
    let finishMutation: (() => void) | undefined
    const withMutation = async <T>(operation: () => Promise<T>, expectedPackages: readonly string[]): Promise<T> => {
      expect(expectedPackages).toEqual(['one', 'two'])
      await new Promise<void>((resolve) => { finishMutation = resolve })
      return operation()
    }
    const manager = new ImportedPluginRestoreManager({
      dshHome: root, providedDependencies: {}, install: async () => '', withMutation,
    })
    await manager.prepare()
    const selected = [
      { restoreId: 'one-id', packageName: 'one', archive: '/bundle/one.tgz' },
      { restoreId: 'two-id', packageName: 'two', archive: '/bundle/two.tgz' },
    ]
    const pending = manager.installPortable(selected, async () => 'installed')
    await vi.waitFor(() => { expect(finishMutation).toBeDefined() })
    expect(manager.snapshot()?.entries.map(entry => entry.state)).toEqual(['pending', 'pending'])
    finishMutation?.()
    await expect(pending).resolves.toMatchObject({ active: false })
    expect(manager.snapshot()?.entries.map(entry => entry.state)).toEqual(['succeeded', 'succeeded'])
  })

  it('keeps a failed portable batch retryable and rejects a substituted identity', async () => {
    const root = await fixture()
    await mkdir(join(root, 'profiles', 'web'), { recursive: true })
    await writeFile(join(root, 'profiles', 'web', 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
    const base = await extractImportedPluginRestorePlan(root)
    await writeImportedPluginRestorePlan(root, {
      ...base,
      entries: [{
        restoreId: 'one-id', packageName: 'one', packageSpec: 'one@^1',
        declaredSpec: '^1', category: 'plugin', defaultSelected: true,
        recoverable: true, state: 'pending',
      }],
    })
    const manager = new ImportedPluginRestoreManager({
      dshHome: root, providedDependencies: {}, install: async () => '',
      withMutation: async () => { throw new Error('activation failed') },
    })
    await manager.prepare()
    await expect(manager.installPortable([{ restoreId: 'one-id', packageName: 'other', archive: '/bad.tgz' }], async () => ''))
      .rejects.toThrow('identity changed')
    await expect(manager.installPortable([{ restoreId: 'one-id', packageName: 'one', archive: '/good.tgz' }], async () => ''))
      .resolves.toMatchObject({ active: false })
    expect((await readImportedPluginRestorePlan(root))?.entries[0]).toMatchObject({
      state: 'failed', diagnostic: 'activation failed',
    })
  })

  it('rejects a locally edited plan that tries to replace an opaque id with a path install', async () => {
    const root = await fixture()
    const plan = await extractImportedPluginRestorePlan(root)
    await writeImportedPluginRestorePlan(root, {
      ...plan,
      entries: [{
        restoreId: 'tampered', packageName: 'plugin', packageSpec: 'file:/tmp/plugin',
        declaredSpec: '^1.0.0', category: 'plugin', defaultSelected: true,
        recoverable: true, state: 'pending',
      }],
    })
    await expect(readImportedPluginRestorePlan(root)).resolves.toBeUndefined()
  })
})

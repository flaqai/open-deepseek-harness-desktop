import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { create } from 'tar'
import { afterEach, expect, it } from 'vitest'
import { inspectLegacyBundledPluginSources, inspectMissingLocalPluginSources, repairLegacyBundledPluginSources } from '../src/legacy-bundled-plugin-sources.ts'
import { BundledPluginInstaller } from '../src/bundled-plugin-installer.ts'
import type { BundledPluginManifestEntry } from '../src/bundled-plugin-seed.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function fixture() {
  const sourceDshHome = await mkdtemp(join(tmpdir(), 'legacy-archive-')); roots.push(sourceDshHome)
  const home = join(sourceDshHome, 'plugin-transactions/web/11111111-1111-4111-8111-111111111111/candidate')
  const profile = join(home, 'profiles/web'); const resourcesDirectory = join(sourceDshHome, 'resources/bundled-plugins')
  await mkdir(join(profile, 'node_modules/dshmarket'), { recursive: true }); await mkdir(resourcesDirectory, { recursive: true })
  await mkdir(join(sourceDshHome, 'payload/package'), { recursive: true })
  await writeFile(join(sourceDshHome, 'payload/package/package.json'), JSON.stringify({ name: 'dshmarket', version: '1.73.12' }))
  await create({ cwd: join(sourceDshHome, 'payload'), file: join(resourcesDirectory, 'market.tgz'), gzip: true }, ['package'])
  const bytes = await readFile(join(resourcesDirectory, 'market.tgz'))
  const entry: BundledPluginManifestEntry = { seedId: 'dshmarket', packageName: 'dshmarket', version: '1.73.12', profile: 'web', installPolicy: 'startup', archive: 'market.tgz', integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` }
  await writeFile(join(resourcesDirectory, entry.archive), bytes)
  const old = 'file:D:\\old install\\resources\\bundled-plugins\\dshmarket-1.55.0.tgz'
  const manifest = { dependencies: { dshmarket: old, custom: 'file:../user-plugin' }, dsh: { profile: { bundles: ['dshmarket', 'custom'] } } }
  await writeFile(join(profile, 'package.json'), JSON.stringify(manifest))
  await writeFile(join(profile, 'node_modules/dshmarket/package.json'), JSON.stringify({ name: 'dshmarket', version: '1.55.0' }))
  await writeFile(join(profile, 'pnpm-lock.yaml'), `lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      dshmarket:\n        specifier: '${old}'\n        version: '${old}'\n      custom:\n        specifier: file:../user-plugin\n        version: file:../user-plugin\npackages:\n  '${old}':\n    resolution:\n      integrity: sha512-old\n`)
  return { home, sourceDshHome, resourcesDirectory, entries: [entry], profile, old }
}
it('detects missing Windows install archive and preserves it until explicit adoption', async () => {
  const f = await fixture(); const before = await readFile(join(f.profile, 'package.json'), 'utf8')
  const issues = await inspectLegacyBundledPluginSources(f)
  expect(issues).toMatchObject([{ packageName: 'dshmarket', installedVersion: '1.55.0', targetVersion: '1.73.12', dependencySpec: f.old }])
  const result = await repairLegacyBundledPluginSources(f)
  expect(result.unresolved).toHaveLength(1); expect(result.repaired).toHaveLength(0)
  expect(await readFile(join(f.profile, 'package.json'), 'utf8')).toBe(before)
})
it('adopts only approved bundled package before an unrelated pnpm mutation and prunes old lock locators', async () => {
  const f = await fixture(); const result = await repairLegacyBundledPluginSources({ ...f, approvedPackages: ['dshmarket'] })
  expect(result.repaired).toHaveLength(1); expect(result.unresolved).toEqual([])
  const manifest = JSON.parse(await readFile(join(f.profile, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
  expect(manifest.dependencies.dshmarket).toBe(`file:${join(await realpath(f.home), 'bundled-plugins/market.tgz')}`)
  expect(manifest.dependencies.custom).toBe('file:../user-plugin')
  expect(await readFile(join(f.profile, 'pnpm-lock.yaml'), 'utf8')).not.toContain('dshmarket-1.55.0.tgz')
  expect(await readFile(join(f.profile, 'pnpm-lock.yaml'), 'utf8')).toContain('file:../user-plugin')
  expect((await repairLegacyBundledPluginSources({ ...f, approvedPackages: ['dshmarket'] })).repaired).toEqual([])
})
it('rejects an altered target archive before changing the manifest', async () => {
  const f = await fixture(); const before = await readFile(join(f.profile, 'package.json'), 'utf8')
  await writeFile(join(f.resourcesDirectory, 'market.tgz'), 'tampered')
  await expect(repairLegacyBundledPluginSources({ ...f, approvedPackages: ['dshmarket'] })).rejects.toThrow('integrity')
  expect(await readFile(join(f.profile, 'package.json'), 'utf8')).toBe(before)
})
it('refuses to edit the active home even with approval', async () => {
  const f = await fixture()
  await expect(repairLegacyBundledPluginSources({ ...f, sourceDshHome: f.home, approvedPackages: ['dshmarket'] })).rejects.toThrow('candidate')
})

it('does not auto-adopt an unknown missing source merely because its installed version matches', async () => {
  const f = await fixture()
  await writeFile(join(f.profile, 'node_modules/dshmarket/package.json'), JSON.stringify({ name: 'dshmarket', version: '1.73.12' }))
  expect((await repairLegacyBundledPluginSources(f)).unresolved).toHaveLength(1)
})
it('rejects an installed identity that disagrees with the declared dependency', async () => {
  const f = await fixture()
  await writeFile(join(f.profile, 'node_modules/dshmarket/package.json'), JSON.stringify({ name: 'another-package', version: '1.55.0' }))
  await expect(inspectLegacyBundledPluginSources(f)).rejects.toThrow('identity disagrees')
})
it('prunes normalized Windows lock locators while retaining a similar unrelated path', async () => {
  const f = await fixture()
  const normalized = f.old.replaceAll('\\', '/')
  await writeFile(join(f.profile, 'pnpm-lock.yaml'), `lockfileVersion: '9.0'\npackages:\n  '${normalized}':\n    resolution:\n      integrity: old\n  '${normalized}-copy.tgz':\n    resolution:\n      integrity: keep\n`)
  await repairLegacyBundledPluginSources({ ...f, approvedPackages: ['dshmarket'] })
  const lock = await readFile(join(f.profile, 'pnpm-lock.yaml'), 'utf8')
  expect(lock).toContain('-copy.tgz')
  expect(lock).not.toContain('integrity: old')
})

it('unblocks an actual offline pnpm install after the missing archive is explicitly repaired', async () => {
  const f = await fixture()
  const custom = join(f.profile, '../user-plugin')
  await mkdir(custom, { recursive: true })
  await writeFile(join(custom, 'package.json'), JSON.stringify({ name: 'custom', version: '1.0.0' }))
  const run = promisify(execFile)
  const install = () => run('pnpm', ['--dir', f.profile, 'install', '--offline', '--ignore-scripts'], { timeout: 30_000 })
  let initialError: unknown
  try { await install() } catch (error) { initialError = error }
  expect(initialError).toBeInstanceOf(Error)
  expect((initialError as { stdout?: string }).stdout).toContain('ENOENT')
  await repairLegacyBundledPluginSources({ ...f, approvedPackages: ['dshmarket'] })
  await install()
  const installed = JSON.parse(await readFile(join(f.profile, 'node_modules/dshmarket/package.json'), 'utf8')) as { version: string }
  expect(installed.version).toBe('1.73.12')
}, 40_000)

it('audits unknown custom plugin archives without offering or authorizing a bundled replacement', async () => {
  const f = await fixture()
  const file = join(f.profile, 'package.json')
  const manifest = JSON.parse(await readFile(file, 'utf8')) as { dependencies: Record<string, string> }
  manifest.dependencies.custom = 'file:../user-only-1.0.0.tgz'
  await writeFile(file, JSON.stringify(manifest))
  const before = await readFile(file, 'utf8')
  const issues = await inspectMissingLocalPluginSources(f.home, f.entries)
  expect(issues).toHaveLength(2)
  expect(issues.find(issue => issue.packageName === 'custom')).toMatchObject({ dependencySpec: 'file:../user-only-1.0.0.tgz' })
  expect(issues.find(issue => issue.packageName === 'custom')?.targetVersion).toBeUndefined()
  await expect(repairLegacyBundledPluginSources({ ...f, approvedPackages: ['custom'] })).rejects.toThrow('untrusted')
  expect(await readFile(file, 'utf8')).toBe(before)
})

function installerFor(f: Awaited<ReturnType<typeof fixture>>) {
  return new BundledPluginInstaller({ manifest: { schema: 2, plugins: f.entries },
    dshHome: f.sourceDshHome, resourcesDirectory: f.resourcesDirectory, install: async () => {} })
}
it('blocks the entire batch before any changes when an unknown source is missing', async () => {
  const f = await fixture()
  const path = join(f.profile, 'package.json')
  const manifest = JSON.parse(await readFile(path, 'utf8')) as { dependencies: Record<string, string> }
  manifest.dependencies.custom = 'file:../missing-custom.tgz'
  await writeFile(path, JSON.stringify(manifest))
  const before = await readFile(path, 'utf8')
  const installer = installerFor(f)
  expect(await installer.getSourceRepairPlan(f.home)).toEqual({
    targets: [{ packageName: 'dshmarket', version: '1.73.12' }], blocked: [{ packageName: 'custom' }],
  })
  await expect(installer.repairSourcesInCandidate(f.home, [{ packageName: 'dshmarket', version: '1.73.12' }]))
    .rejects.toThrow('custom plugin sources')
  expect(await readFile(path, 'utf8')).toBe(before)
})
it('rejects a forged or incomplete reviewed batch before editing metadata', async () => {
  const f = await fixture(); const installer = installerFor(f)
  const before = await readFile(join(f.profile, 'package.json'), 'utf8')
  await expect(installer.repairSourcesInCandidate(f.home, [{ packageName: 'dshmarket', version: '999.0.0' }]))
    .rejects.toThrow('stale or untrusted')
  await expect(installer.repairSourcesInCandidate(f.home, [])).rejects.toThrow('stale or untrusted')
  expect(await readFile(join(f.profile, 'package.json'), 'utf8')).toBe(before)
})
it('repairs all missing trusted sources together before the same offline pnpm install', async () => {
  const f = await fixture()
  const payload = join(f.sourceDshHome, 'second/package')
  await mkdir(payload, { recursive: true })
  await writeFile(join(payload, 'package.json'), JSON.stringify({ name: 'bridge', version: '2.0.2' }))
  const archive = join(f.resourcesDirectory, 'bridge.tgz')
  await create({ cwd: join(f.sourceDshHome, 'second'), file: archive, gzip: true }, ['package'])
  const bytes = await readFile(archive)
  const first = f.entries[0]
  if (first === undefined) throw new Error('missing fixture preset')
  f.entries.push({ ...first, seedId: 'bridge', packageName: 'bridge', version: '2.0.2', archive: 'bridge.tgz',
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` })
  const path = join(f.profile, 'package.json')
  const manifest = JSON.parse(await readFile(path, 'utf8')) as { dependencies: Record<string, string> }
  manifest.dependencies.bridge = 'file:../old-bridge.tgz'
  await writeFile(path, JSON.stringify(manifest))
  const custom = join(f.profile, '../user-plugin')
  await mkdir(custom, { recursive: true })
  await writeFile(join(custom, 'package.json'), JSON.stringify({ name: 'custom', version: '1.0.0' }))
  const installer = installerFor(f); const plan = await installer.getSourceRepairPlan(f.home)
  expect(plan.targets).toHaveLength(2)
  await expect(installer.repairSourcesInCandidate(f.home, plan.targets.slice(0, 1))).rejects.toThrow('stale or untrusted')
  const result = await installer.repairSourcesInCandidate(f.home, plan.targets)
  expect(result).toHaveLength(2)
  await promisify(execFile)('pnpm', ['--dir', f.profile, 'install', '--offline', '--ignore-scripts'], { timeout: 30_000 })
  for (const target of plan.targets) {
    const installed = JSON.parse(await readFile(join(f.profile, 'node_modules', target.packageName, 'package.json'), 'utf8')) as { version: string }
    expect(installed.version).toBe(target.version)
  }
}, 40_000)

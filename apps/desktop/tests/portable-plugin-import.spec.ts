import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { create } from 'tar'
import { afterEach, describe, expect, it } from 'vitest'
import { extractImportedPluginRestorePlan, writeImportedPluginRestorePlan } from '../src/imported-plugin-restore.ts'
import { writePortablePluginBundle } from '../src/portable-plugin-bundle.ts'
import { planPortablePluginImport } from '../src/portable-plugin-import.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(): Promise<{ home: string; bundle: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-portable-import-'))
  roots.push(root)
  const home = join(root, 'home')
  const profile = join(home, 'profiles', 'web')
  await mkdir(profile, { recursive: true })
  await writeFile(join(profile, 'package.json'), JSON.stringify({
    dependencies: { 'example-plugin': '^1.0.0' }, dsh: { profile: { bundles: ['example-plugin'] } },
  }))
  await writeImportedPluginRestorePlan(home, await extractImportedPluginRestorePlan(home))
  const source = join(root, 'source')
  await mkdir(join(source, 'package'), { recursive: true })
  await writeFile(join(source, 'package', 'package.json'), JSON.stringify({ name: 'example-plugin', version: '1.2.3' }))
  const archive = join(root, 'source.tgz')
  await create({ cwd: source, file: archive, gzip: true }, ['package'])
  const bundle = join(root, 'bundle')
  const target = { platform: 'win32', architecture: 'x64', osVersion: 'Windows 11' } as const
  const manifest = await writePortablePluginBundle(bundle, target, [
    { packageName: 'example-plugin', version: '1.2.3', archive },
  ])
  await mkdir(join(bundle, 'store'))
  await mkdir(join(bundle, 'cache'))
  const emptyHash = createHash('sha256').digest('hex')
  await writeFile(join(bundle, 'manifest.json'), JSON.stringify({
    ...manifest, registry: 'https://registry.npmjs.org/',
    store: { sha256: emptyHash, cacheSha256: emptyHash, verification: 'target-rehearsal-required' },
  }))
  return { home, bundle }
}

describe('portable plugin import plan', () => {
  it('requires target-host offline rehearsal and matches only restore-plan entries', async () => {
    const { home, bundle } = await fixture()
    const target = { platform: 'win32', architecture: 'x64', osVersion: 'Windows 11' } as const
    let called = false
    const plan = await planPortablePluginImport(home, bundle, target, async (args, cwd, environment) => {
      called = true
      expect(args).toContain('--offline')
      expect(environment.npm_config_offline).toBe('true')
      await mkdir(join(cwd, 'node_modules', 'example-plugin'), { recursive: true })
      await writeFile(join(cwd, 'node_modules', 'example-plugin', 'package.json'), JSON.stringify({
        name: 'example-plugin', version: '1.2.3',
      }))
    })
    expect(called).toBe(true)
    expect(plan.ready).toMatchObject([{ packageName: 'example-plugin', version: '1.2.3' }])
    expect(plan.skipped).toEqual([])
    called = false
    await expect(planPortablePluginImport(home, bundle, { ...target, osVersion: 'Windows 10' }, async () => {
      called = true
    })).rejects.toThrow(/different operating system or version/u)
    expect(called).toBe(false)
  })
})

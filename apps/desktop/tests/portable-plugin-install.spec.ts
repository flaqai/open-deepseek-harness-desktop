import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { create } from 'tar'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { writePortablePluginBundle } from '../src/portable-plugin-bundle.ts'
import { installPortablePluginCandidate } from '../src/portable-plugin-install.ts'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-portable-install-'))
  roots.push(root)
  const packageDirectory = join(root, 'package-source', 'package')
  await mkdir(packageDirectory, { recursive: true })
  await writeFile(join(packageDirectory, 'package.json'), JSON.stringify({ name: 'example-plugin', version: '1.2.3' }))
  const archive = join(root, 'example.tgz')
  await create({ cwd: join(root, 'package-source'), file: archive, gzip: true }, ['package'])
  const bundle = join(root, 'bundle')
  const manifest = await writePortablePluginBundle(bundle, {
    platform: 'win32', architecture: 'x64', osVersion: 'Windows 11',
  }, [{ packageName: 'example-plugin', version: '1.2.3', archive }])
  await mkdir(join(bundle, 'store'))
  await mkdir(join(bundle, 'cache'))
  const emptyHash = createHash('sha256').digest('hex')
  await writeFile(join(bundle, 'manifest.json'), JSON.stringify({
    ...manifest, registry: 'https://registry.npmjs.org/',
    store: { sha256: emptyHash, cacheSha256: emptyHash, verification: 'target-rehearsal-required' },
  }))
  const activeHome = join(root, 'active')
  const candidateHome = join(root, 'candidate')
  await mkdir(activeHome)
  await mkdir(candidateHome)
  return { bundle, activeHome, candidateHome, manifest }
}

describe('portable candidate installation', () => {
  it('stages a verified archive in the candidate and forces offline resolution', async () => {
    const { bundle, activeHome, candidateHome, manifest } = await fixture()
    const run = vi.fn(async (_args: readonly string[], _environment: NodeJS.ProcessEnv) => 'installed')
    await expect(installPortablePluginCandidate({
      activeHome, candidateHome, bundleDirectory: bundle, selectedPackages: ['example-plugin'], run,
    })).resolves.toBe('installed')
    const staged = join(candidateHome, 'bundled-plugins', `portable-${manifest.artifacts[0]?.sha256}.tgz`)
    expect(await readFile(staged)).toEqual(await readFile(join(bundle, manifest.artifacts[0]!.file)))
    const [args, environment] = run.mock.calls[0]!
    expect(args).toContain('--offline')
    expect(args).toContain(staged)
    expect(environment).toMatchObject({ npm_config_offline: 'true', COREPACK_ENABLE_NETWORK: '0' })
  })

  it('rejects a package that is not in the verified bundle without calling the installer', async () => {
    const { bundle, activeHome, candidateHome } = await fixture()
    const run = vi.fn(async (_args: readonly string[], _environment: NodeJS.ProcessEnv) => 'unexpected')
    await expect(installPortablePluginCandidate({
      activeHome, candidateHome, bundleDirectory: bundle, selectedPackages: ['other'], run,
    })).rejects.toThrow('not in the verified bundle')
    expect(run).not.toHaveBeenCalled()
  })
})

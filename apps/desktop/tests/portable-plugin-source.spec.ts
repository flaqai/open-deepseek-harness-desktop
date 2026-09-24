import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { create } from 'tar'
import { afterEach, describe, expect, it } from 'vitest'
import { exportPortablePluginsFromHome, planPortablePluginSources } from '../src/portable-plugin-source.ts'
import { verifyPreparedPortablePluginBundle } from '../src/portable-plugin-bundle.ts'

const roots: string[] = []
const execFileAsync = promisify(execFile)

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('portable plugin source plan', () => {
  it('uses actual installed versions and omits missing, external, and custom sources', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-portable-source-'))
    roots.push(root)
    const profile = join(root, 'profiles', 'web')
    await mkdir(join(profile, 'node_modules', 'registry-plugin'), { recursive: true })
    await mkdir(join(profile, 'node_modules', 'custom-plugin'), { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify({
      dependencies: {
        'registry-plugin': '^1.0.0',
        'missing-plugin': '^1.0.0',
        'custom-plugin': 'github:owner/custom-plugin#v2',
        '@deepseek-ai/dsh-subagent-codex': '^0.1.0',
      },
      dsh: { profile: { bundles: [
        'registry-plugin', 'missing-plugin', 'custom-plugin', '@deepseek-ai/dsh-subagent-codex',
      ] } },
    }))
    await writeFile(join(profile, 'node_modules', 'registry-plugin', 'package.json'), JSON.stringify({
      name: 'registry-plugin', version: '1.4.2',
    }))
    await writeFile(join(profile, 'node_modules', 'custom-plugin', 'package.json'), JSON.stringify({
      name: 'custom-plugin', version: '2.0.0',
    }))
    const plan = await planPortablePluginSources(root)
    expect(plan.sourceIssues).toEqual([])
    expect(plan.candidates).toEqual([{ packageName: 'registry-plugin', version: '1.4.2', source: 'registry' }])
    expect(plan.omitted).toEqual([
      { packageName: 'missing-plugin', reason: 'missing-installation' },
      { packageName: 'custom-plugin', reason: 'custom-source' },
      { packageName: '@deepseek-ai/dsh-subagent-codex', reason: 'external-tool' },
    ])
  })

  it('accepts a matching desktop archive but refuses an external installed package link', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-portable-source-'))
    roots.push(root)
    const profile = join(root, 'profiles', 'web')
    const outside = await mkdtemp(join(tmpdir(), 'dsh-portable-external-'))
    roots.push(outside)
    await mkdir(join(profile, 'node_modules'), { recursive: true })
    await mkdir(join(root, 'archives'))
    await mkdir(join(root, 'archive-source', 'package'), { recursive: true })
    await writeFile(join(root, 'archive-source', 'package', 'package.json'), JSON.stringify({
      name: 'local-plugin', version: '2.3.4',
    }))
    await create({ cwd: join(root, 'archive-source'), file: join(root, 'archives', 'local.tgz'), gzip: true }, ['package'])
    await mkdir(join(profile, 'node_modules', 'local-plugin'))
    await writeFile(join(profile, 'node_modules', 'local-plugin', 'package.json'), JSON.stringify({
      name: 'local-plugin', version: '2.3.4',
    }))
    await writeFile(join(outside, 'package.json'), JSON.stringify({ name: 'linked-plugin', version: '1.0.0' }))
    await symlink(outside, join(profile, 'node_modules', 'linked-plugin'))
    await writeFile(join(profile, 'package.json'), JSON.stringify({
      dependencies: {
        'local-plugin': 'file:../../archives/local.tgz',
        'linked-plugin': '^1.0.0',
      },
      dsh: { profile: { bundles: ['local-plugin', 'linked-plugin'] } },
    }))
    const plan = await planPortablePluginSources(root)
    expect(plan.sourceIssues).toEqual([])
    expect(plan.candidates).toEqual([{
      packageName: 'local-plugin', version: '2.3.4', source: 'local-archive',
      archive: join(root, 'archives', 'local.tgz'),
    }])
    expect(plan.omitted).toEqual([{ packageName: 'linked-plugin', reason: 'invalid-installation' }])
  })

  it('does not follow an archive parent directory outside the selected Harness home', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-portable-source-'))
    const outside = await mkdtemp(join(tmpdir(), 'dsh-portable-external-'))
    roots.push(root, outside)
    const profile = join(root, 'profiles', 'web')
    await mkdir(join(profile, 'node_modules', 'example-plugin'), { recursive: true })
    await writeFile(join(profile, 'node_modules', 'example-plugin', 'package.json'), JSON.stringify({
      name: 'example-plugin', version: '1.2.3',
    }))
    await mkdir(join(outside, 'package'))
    await writeFile(join(outside, 'package', 'package.json'), JSON.stringify({ name: 'example-plugin', version: '1.2.3' }))
    await create({ cwd: outside, file: join(outside, 'plugin.tgz'), gzip: true }, ['package'])
    await symlink(outside, join(root, 'archives'))
    await writeFile(join(profile, 'package.json'), JSON.stringify({
      dependencies: { 'example-plugin': 'file:../../archives/plugin.tgz' },
      dsh: { profile: { bundles: ['example-plugin'] } },
    }))
    const plan = await planPortablePluginSources(root)
    expect(plan.candidates).toEqual([])
    expect(plan.omitted).toEqual([{ packageName: 'example-plugin', reason: 'custom-source' }])
  })

  it('fetches the source machine\'s exact registry package and leaves an offline-ready export', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-portable-source-'))
    roots.push(root)
    const profile = join(root, 'profiles', 'web')
    await mkdir(join(profile, 'node_modules', 'example-plugin'), { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify({
      dependencies: { 'example-plugin': '^1.0.0' }, dsh: { profile: { bundles: ['example-plugin'] } },
    }))
    await writeFile(join(profile, 'node_modules', 'example-plugin', 'package.json'), JSON.stringify({
      name: 'example-plugin', version: '1.2.3',
    }))
    const source = join(root, 'package-source')
    await mkdir(join(source, 'package'), { recursive: true })
    await writeFile(join(source, 'package', 'package.json'), JSON.stringify({
      name: 'example-plugin', version: '1.2.3',
    }))
    const archivePath = join(root, 'registry.tgz')
    await create({ cwd: source, file: archivePath, gzip: true }, ['package'])
    const archive = await readFile(archivePath)
    const request = async (url: URL): Promise<Response> => url.pathname.endsWith('/1.2.3')
      ? Response.json({ name: 'example-plugin', version: '1.2.3', dist: {
        tarball: 'https://registry.npmjs.org/example-plugin/-/example-plugin-1.2.3.tgz',
        integrity: `sha512-${createHash('sha512').update(archive).digest('base64')}`,
      } })
      : new Response(archive)
    const target = { platform: 'darwin', architecture: 'arm64', osVersion: 'macOS 15' } as const
    const pnpm = fileURLToPath(new URL('../node_modules/pnpm/bin/pnpm.cjs', import.meta.url))
    const output = join(root, 'export')
    const { manifest } = await exportPortablePluginsFromHome(
      root, output, target, target, ['example-plugin'], 'https://registry.npmjs.org/',
      async (args, cwd, environment) => {
        await execFileAsync(process.execPath, [pnpm, ...args], {
          cwd, env: environment, timeout: 30_000, maxBuffer: 256 * 1024,
        })
      }, request,
    )
    expect(manifest.artifacts).toMatchObject([{ packageName: 'example-plugin', version: '1.2.3' }])
    expect(manifest.store?.verification).toBe('source-host-rehearsed')
    await expect(verifyPreparedPortablePluginBundle(output)).resolves.toMatchObject({ store: manifest.store })
  }, 65_000)
})

import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { create } from 'tar'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertPortablePluginHost,
  parsePortablePluginBundleManifest,
  parsePortablePluginTarget,
  PORTABLE_PLUGIN_BUNDLE_SCHEMA,
  preparePortablePluginBundle,
  rehearsePortablePluginBundle,
  verifyPreparedPortablePluginBundle,
  verifyPortablePluginBundle,
  writePortablePluginBundle,
} from '../src/portable-plugin-bundle.ts'

const roots: string[] = []
const execFileAsync = promisify(execFile)

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function manifest(file: string, sha256: string): unknown {
  return {
    schema: PORTABLE_PLUGIN_BUNDLE_SCHEMA,
    target: { platform: 'win32', architecture: 'x64', osVersion: 'Windows 11' },
    artifacts: [{ packageName: 'example-plugin', version: '1.2.3', file, sha256 }],
  }
}

async function archiveAt(
  root: string,
  name = 'example-plugin',
  version = '1.2.3',
  dependencies?: Record<string, string>,
): Promise<string> {
  await mkdir(join(root, 'package'))
  await writeFile(join(root, 'package', 'package.json'), JSON.stringify({ name, version, dependencies }))
  const archive = join(root, 'source.tgz')
  await create({ cwd: root, file: archive, gzip: true, portable: true }, ['package'])
  return archive
}

describe('portable plugin bundle', () => {
  it('records the destination OS version separately from Desktop version and rejects invalid targets', () => {
    expect(parsePortablePluginTarget({ platform: 'win32', architecture: 'x64', osVersion: 'Windows 11' }))
      .toEqual({ platform: 'win32', architecture: 'x64', osVersion: 'Windows 11' })
    for (const osVersion of ['', '../Windows 11', 'Windows 11\nsecret']) {
      expect(() => parsePortablePluginTarget({ platform: 'win32', architecture: 'x64', osVersion })).toThrow()
    }
    expect(() => { assertPortablePluginHost({ platform: 'win32', architecture: 'x64', osVersion: 'Windows 11' }, 'darwin', 'arm64') }).toThrow(/targets win32\/x64/u)
  })

  it('rejects traversal, aliases, duplicate packages, and mutable version declarations', () => {
    const sha = 'a'.repeat(64)
    for (const file of ['../outside.tgz', 'artifacts/../outside.tgz', 'artifacts/plugin.tgz']) {
      expect(() => parsePortablePluginBundleManifest(manifest(file, sha))).toThrow()
    }
    const valid = manifest(`artifacts/${sha}.tgz`, sha) as { artifacts: Record<string, unknown>[] }
    expect(() => parsePortablePluginBundleManifest({ ...valid, artifacts: [
      { ...valid.artifacts[0], version: '^1.2.3' },
    ] })).toThrow()
    expect(() => parsePortablePluginBundleManifest({ ...valid, artifacts: [
      valid.artifacts[0], valid.artifacts[0],
    ] })).toThrow()
    for (const registry of [
      'https://user:secret@registry.npmjs.org/',
      'https://registry.npmjs.org/?token=secret',
      'http://registry.npmjs.org/',
    ]) {
      expect(() => parsePortablePluginBundleManifest({ ...valid, registry })).toThrow(/registry/u)
    }
    expect(parsePortablePluginBundleManifest({ ...valid, registry: 'https://registry.npmjs.org' }).registry)
      .toBe('https://registry.npmjs.org/')
  })

  it('checks each regular artifact against its recorded hash without following links', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-portable-plugins-'))
    roots.push(root)
    await mkdir(join(root, 'artifacts'))
    const archive = await archiveAt(root)
    const body = await readFile(archive)
    const hash = createHash('sha256').update(body).digest('hex')
    const file = `artifacts/${hash}.tgz`
    await writeFile(join(root, file), body)
    await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest(file, hash)))
    await expect(verifyPortablePluginBundle(root)).resolves.toMatchObject({ artifacts: [{ file, sha256: hash }] })
    await writeFile(join(root, file), 'tampered')
    await expect(verifyPortablePluginBundle(root)).rejects.toThrow(/integrity/u)
    await rm(join(root, file))
    await symlink(join(root, 'manifest.json'), join(root, file))
    await expect(verifyPortablePluginBundle(root)).rejects.toThrow(/regular file/u)
  })

  it('publishes only verified, exact-version original archives and leaves an existing destination untouched', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-portable-plugins-'))
    roots.push(root)
    const destination = join(root, 'bundle')
    const archive = await archiveAt(root)
    const target = { platform: 'darwin', architecture: 'arm64', osVersion: 'macOS 15' } as const
    await writePortablePluginBundle(destination, target, [{ packageName: 'example-plugin', version: '1.2.3', archive }])
    await expect(verifyPortablePluginBundle(destination)).resolves.toMatchObject({ target, artifacts: [{
      packageName: 'example-plugin', version: '1.2.3',
    }] })
    await expect(writePortablePluginBundle(destination, target, [{ packageName: 'example-plugin', version: '1.2.3', archive }]))
      .rejects.toThrow(/already exists/u)
    await expect(verifyPortablePluginBundle(destination)).resolves.toMatchObject({ target })
    await expect(writePortablePluginBundle(join(root, 'invalid'), target, [
      { packageName: 'example-plugin', version: '^1.2.3', archive },
    ])).rejects.toThrow(/version mismatch/u)
  })

  it('refuses a different OS version or missing store before a network-disabled rehearsal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-portable-plugins-'))
    roots.push(root)
    const archive = await archiveAt(root)
    const target = { platform: 'darwin', architecture: 'arm64', osVersion: 'macOS 15' } as const
    const bundle = join(root, 'bundle')
    await writePortablePluginBundle(bundle, target, [{ packageName: 'example-plugin', version: '1.2.3', archive }])
    await expect(verifyPreparedPortablePluginBundle(bundle)).rejects.toThrow(/incomplete/u)
    let called = false
    const install = async (): Promise<void> => { called = true }
    await expect(rehearsePortablePluginBundle(bundle, { ...target, osVersion: 'macOS 14' }, install))
      .rejects.toThrow(/different operating system or version/u)
    await expect(rehearsePortablePluginBundle(bundle, target, install)).rejects.toThrow(/store/u)
    expect(called).toBe(false)
  })

  it('passes only offline arguments and disabled-network settings to the dependency installer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-portable-plugins-'))
    roots.push(root)
    const archive = await archiveAt(root)
    const target = { platform: 'darwin', architecture: 'arm64', osVersion: 'macOS 15' } as const
    const bundle = join(root, 'bundle')
    await writePortablePluginBundle(bundle, target, [{ packageName: 'example-plugin', version: '1.2.3', archive }])
    await mkdir(join(bundle, 'store'))
    await mkdir(join(bundle, 'cache'))
    let called = false
    await rehearsePortablePluginBundle(bundle, target, async (args, cwd, environment) => {
      called = true
      expect(args).toContain('--offline')
      expect(args).toContain(`--store-dir=${join(bundle, 'store')}`)
      expect(args.at(-1)).toContain(join(bundle, 'artifacts'))
      expect(cwd).not.toContain(bundle)
      expect(environment.npm_config_offline).toBe('true')
      expect(environment.COREPACK_ENABLE_NETWORK).toBe('0')
      expect(environment.HTTPS_PROXY).toBe('http://127.0.0.1:9')
      await mkdir(join(cwd, 'node_modules', 'example-plugin'), { recursive: true })
      await writeFile(join(cwd, 'node_modules', 'example-plugin', 'package.json'), JSON.stringify({
        name: 'example-plugin', version: '1.2.3',
      }))
    })
    expect(called).toBe(true)
  })

  it('installs a dependency-free archive with the bundled pnpm while all network routes are blocked', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-portable-plugins-'))
    roots.push(root)
    const archive = await archiveAt(root)
    const target = { platform: 'darwin', architecture: 'arm64', osVersion: 'macOS 15' } as const
    const bundle = join(root, 'bundle')
    await writePortablePluginBundle(bundle, target, [{ packageName: 'example-plugin', version: '1.2.3', archive }])
    await mkdir(join(bundle, 'store'))
    await mkdir(join(bundle, 'cache'))
    const pnpm = fileURLToPath(new URL('../node_modules/pnpm/bin/pnpm.cjs', import.meta.url))
    await rehearsePortablePluginBundle(bundle, target, async (args, cwd, environment) => {
      await execFileAsync(process.execPath, [pnpm, ...args], {
        cwd, env: environment, timeout: 30_000, maxBuffer: 256 * 1024,
      })
      const installed = JSON.parse(await readFile(join(cwd, 'node_modules', 'example-plugin', 'package.json'), 'utf8')) as {
        name: string
        version: string
      }
      expect(installed).toMatchObject({ name: 'example-plugin', version: '1.2.3' })
    })
  }, 35_000)

  it('does not report a portable plugin with missing transitive dependencies as offline-ready', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-portable-plugins-'))
    roots.push(root)
    const archive = await archiveAt(root, 'example-plugin', '1.2.3', { 'is-number': '7.0.0' })
    const target = { platform: 'darwin', architecture: 'arm64', osVersion: 'macOS 15' } as const
    const bundle = join(root, 'bundle')
    await writePortablePluginBundle(bundle, target, [{ packageName: 'example-plugin', version: '1.2.3', archive }])
    await mkdir(join(bundle, 'store'))
    const pnpm = fileURLToPath(new URL('../node_modules/pnpm/bin/pnpm.cjs', import.meta.url))
    await expect(rehearsePortablePluginBundle(bundle, target, async (args, cwd, environment) => {
      await execFileAsync(process.execPath, [pnpm, ...args], {
        cwd, env: environment, timeout: 30_000, maxBuffer: 256 * 1024,
      })
    })).rejects.toThrow()
  }, 35_000)

  it('fetches into a private store and marks a same-system bundle only after a real offline rehearsal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-portable-plugins-'))
    roots.push(root)
    const archive = await archiveAt(root)
    const target = { platform: 'darwin', architecture: 'arm64', osVersion: 'macOS 15' } as const
    const bundle = join(root, 'bundle')
    const pnpm = fileURLToPath(new URL('../node_modules/pnpm/bin/pnpm.cjs', import.meta.url))
    const calls: string[][] = []
    const result = await preparePortablePluginBundle(bundle, target, target, [
      { packageName: 'example-plugin', version: '1.2.3', archive },
    ], 'https://registry.npmjs.org/', async (args, cwd, environment) => {
      calls.push([...args])
      await execFileAsync(process.execPath, [pnpm, ...args], {
        cwd, env: environment, timeout: 30_000, maxBuffer: 256 * 1024,
      })
    })
    expect(calls).toHaveLength(2)
    expect(calls[0]).not.toContain('--offline')
    expect(calls[1]).toContain('--offline')
    expect(result.store?.verification).toBe('source-host-rehearsed')
    await expect(verifyPreparedPortablePluginBundle(bundle)).resolves.toMatchObject({ store: result.store })
    await writeFile(join(bundle, 'store', 'unexpected'), 'tampered')
    await expect(verifyPortablePluginBundle(bundle)).rejects.toThrow(/store failed integrity/u)
  }, 65_000)

  it('keeps cross-system bundles unverified until a target-host offline rehearsal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-portable-plugins-'))
    roots.push(root)
    const archive = await archiveAt(root)
    const target = { platform: 'win32', architecture: 'x64', osVersion: 'Windows 11' } as const
    const host = { platform: 'darwin', architecture: 'arm64', osVersion: 'macOS 15' } as const
    let calls = 0
    const bundle = join(root, 'bundle')
    const pnpm = fileURLToPath(new URL('../node_modules/pnpm/bin/pnpm.cjs', import.meta.url))
    const result = await preparePortablePluginBundle(bundle, target, host, [
      { packageName: 'example-plugin', version: '1.2.3', archive },
    ], 'https://registry.npmjs.org/', async (args, cwd, environment) => {
      calls += 1
      await execFileAsync(process.execPath, [pnpm, ...args], {
        cwd, env: environment, timeout: 30_000, maxBuffer: 256 * 1024,
      })
    })
    expect(calls).toBe(1)
    expect(result.store?.verification).toBe('target-rehearsal-required')
  })

  it('does not publish a bundle when the package manager reports success without installing its package', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-portable-plugins-'))
    roots.push(root)
    const archive = await archiveAt(root)
    const bundle = join(root, 'bundle')
    const target = { platform: 'win32', architecture: 'x64', osVersion: 'Windows 11' } as const
    const host = { platform: 'darwin', architecture: 'arm64', osVersion: 'macOS 15' } as const
    await expect(preparePortablePluginBundle(bundle, target, host, [
      { packageName: 'example-plugin', version: '1.2.3', archive },
    ], 'https://registry.npmjs.org/', async () => {})).rejects.toThrow()
    await expect(readFile(join(bundle, 'manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('captures a transitive registry dependency and installs it after the registry goes offline', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-portable-plugins-'))
    roots.push(root)
    const pluginRoot = join(root, 'plugin-source')
    const dependencyRoot = join(root, 'dependency-source')
    await mkdir(pluginRoot)
    await mkdir(dependencyRoot)
    const plugin = await archiveAt(pluginRoot, 'example-plugin', '1.2.3', { 'fixture-dependency': '1.0.0' })
    const dependency = await readFile(await archiveAt(dependencyRoot, 'fixture-dependency', '1.0.0'))
    const integrity = `sha512-${createHash('sha512').update(dependency).digest('base64')}`
    let registryUrl = ''
    const registry = createServer((request, response) => {
      if (request.url === '/fixture-dependency') {
        response.setHeader('content-type', 'application/vnd.npm.install-v1+json')
        response.end(JSON.stringify({
          name: 'fixture-dependency', 'dist-tags': { latest: '1.0.0' },
          versions: { '1.0.0': { name: 'fixture-dependency', version: '1.0.0', dist: {
            tarball: `${registryUrl}/fixture-dependency/-/fixture-dependency-1.0.0.tgz`, integrity,
          } } },
        }))
        return
      }
      if (request.url === '/fixture-dependency/-/fixture-dependency-1.0.0.tgz') {
        response.setHeader('content-type', 'application/octet-stream')
        response.end(dependency)
        return
      }
      response.statusCode = 404
      response.end('not found')
    })
    try {
      await new Promise<void>((resolve) => { registry.listen(0, '127.0.0.1', resolve) })
      const address = registry.address()
      if (address === null || typeof address === 'string') throw new Error('test registry has no port')
      registryUrl = `http://127.0.0.1:${address.port}`
      const target = { platform: 'darwin', architecture: 'arm64', osVersion: 'macOS 15' } as const
      const pnpm = fileURLToPath(new URL('../node_modules/pnpm/bin/pnpm.cjs', import.meta.url))
      let calls = 0
      const bundle = join(root, 'bundle')
      const result = await preparePortablePluginBundle(bundle, target, target, [
        { packageName: 'example-plugin', version: '1.2.3', archive: plugin },
      ], `${registryUrl}/`, async (args, cwd, environment) => {
        calls += 1
        try {
          await execFileAsync(process.execPath, [pnpm, ...args], {
            cwd,
            env: environment,
            timeout: 30_000,
            maxBuffer: 256 * 1024,
          })
        } catch (error) {
          throw new Error(`pnpm fixture install failed: ${(error as { stderr?: string }).stderr ?? String(error)}`, { cause: error })
        }
        if (calls === 1) await new Promise<void>((resolve, reject) => {
          registry.close((error) => { if (error === undefined) resolve(); else reject(error) })
        })
      })
      expect(calls).toBe(2)
      expect(result.store?.verification).toBe('source-host-rehearsed')
      await expect(verifyPortablePluginBundle(bundle)).resolves.toMatchObject({ store: result.store })
    } finally {
      if (registry.listening) await new Promise<void>((resolve) => { registry.close(() => { resolve() }) })
    }
  }, 65_000)
})

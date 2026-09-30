import { createHash } from 'node:crypto'
import { copyFile, cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { c } from 'tar'
import { afterEach, describe, expect, it } from 'vitest'
import { OptionalRuntimeManager } from '../src/workspace-runtime-manager.ts'
import type { WorkspaceRuntimeManifest } from '../src/workspace-runtime-manifest.ts'
import type { PythonEnvironmentPort, PythonEnvironmentProbe } from '../src/workspace-python-environment.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function fixture(options: {
  nas?: boolean
  platform?: NodeJS.Platform
  arch?: string
  corruptDigest?: boolean
  corruptOfficeIntegrity?: boolean
  slowDownload?: boolean
  pythonEnvironment?: PythonEnvironmentPort
  bundledPython?: boolean
  bundledOffice?: boolean
  bundledOfficePath?: (root: string) => string
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-workspace-runtime-'))
  roots.push(root)
  const source = join(root, 'source', 'workspace-runtime')
  const digest = 'b'.repeat(64)
  const officeDigest = 'c'.repeat(64)
  await mkdir(join(source, 'python', 'bin'), { recursive: true })
  await mkdir(join(source, 'python', 'lib', 'python3.12', 'site-packages'), { recursive: true })
  await writeFile(join(source, 'python', 'bin', 'python3'), '#!/bin/sh\n')
  await writeFile(join(source, 'runtime.json'), JSON.stringify({
    schema: 'dsh/workspace-runtime-payload/v1', desktopVersion: '0.1.6-alpha.2.1',
    platform: 'darwin', arch: 'arm64', payloadDigest: digest, pythonVersion: '3.12.14', pythonPackages: {},
  }))
  const archive = join(root, 'archive.tar.gz')
  await c({ cwd: join(root, 'source'), file: archive, gzip: true }, ['workspace-runtime'])
  const bytes = await readFile(archive)
  const officeSource = join(root, 'office-source', 'package')
  await mkdir(officeSource, { recursive: true })
  await writeFile(join(officeSource, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/libreoffice-kit-darwin-arm64', version: '0.0.1',
  }))
  const officeArchive = join(root, 'office-archive.tar.gz')
  await c({ cwd: join(root, 'office-source'), file: officeArchive, gzip: true }, ['package'])
  const officeBytes = await readFile(officeArchive)
  const artifact = {
    target: 'darwin-arm64' as const,
    fileName: 'DeepSeek-Harness-workspace-runtime-darwin-arm64.tar.gz',
    size: bytes.length,
    sha256: options.corruptDigest === true ? 'a'.repeat(64) : createHash('sha256').update(bytes).digest('hex'),
    payloadDigest: digest, pythonVersion: '3.12.14',
    githubUrl: 'https://github.com/example/archive.tar.gz', cnbUrl: 'https://cnb.cool/example/archive.tar.gz',
    office: {
      source: 'npm' as const, fileName: 'libreoffice-kit-darwin-arm64-0.0.1.tgz',
      size: officeBytes.length,
      integrity: options.corruptOfficeIntegrity === true
        ? `sha512-${Buffer.alloc(64).toString('base64')}`
        : `sha512-${createHash('sha512').update(officeBytes).digest('base64')}`,
      payloadDigest: officeDigest, enginePackage: '@deepseek-ai/libreoffice-kit-darwin-arm64', engineVersion: '0.0.1',
      url: 'https://registry.npmjs.org/@deepseek-ai/libreoffice-kit-darwin-arm64/-/libreoffice-kit-darwin-arm64-0.0.1.tgz',
    },
  }
  const manifest: WorkspaceRuntimeManifest = {
    schema: 'dsh/desktop-workspace-runtimes/v2', desktopVersion: '0.1.6-alpha.2.1',
    issuedAt: new Date(Date.now() - 1_000).toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
    artifacts: {
      'darwin-arm64': artifact,
      'darwin-x64': { ...artifact, target: 'darwin-x64' },
      'linux-x64': { ...artifact, target: 'linux-x64' },
      'win32-x64': { ...artifact, target: 'win32-x64' },
    },
  }
  let home = join(root, 'home-one')
  const bundledOfficePath = options.bundledOfficePath
  const stateFile = join(root, 'user-data', 'state.json')
  let fetchCount = 0
  const manager = new OptionalRuntimeManager({
    cacheRoot: join(root, 'user-data', 'optional-runtimes'), stateFile,
    desktopVersion: '0.1.6-alpha.2.1', platform: options.platform ?? 'darwin', arch: options.arch ?? 'arm64',
    target: 'darwin-arm64', getHome: () => home, isNas: () => options.nas === true,
    source: () => 'github', loadManifest: () => Promise.resolve(manifest),
    fetch: (url, init) => {
      fetchCount += 1
      const selectedBytes = url.includes('registry.npmjs.org') ? officeBytes : bytes
      const range = new Headers(init?.headers).get('range')
      const offset = Number(/^bytes=(\d+)-$/u.exec(range ?? '')?.[1] ?? 0)
      const body = selectedBytes.subarray(offset)
      const headers: Record<string, string> = { 'content-length': String(body.byteLength) }
      if (offset > 0) headers['content-range'] = `bytes ${offset}-${selectedBytes.byteLength - 1}/${selectedBytes.byteLength}`
      if (options.slowDownload !== true || offset > 0) {
        return Promise.resolve(new Response(body, { status: offset > 0 ? 206 : 200, headers }))
      }
      let timer: ReturnType<typeof setTimeout> | undefined
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const split = Math.max(1, Math.floor(body.byteLength / 2))
          controller.enqueue(body.subarray(0, split))
          timer = setTimeout(() => { controller.enqueue(body.subarray(split)); controller.close() }, 100)
        },
        cancel() { if (timer !== undefined) clearTimeout(timer) },
      })
      return Promise.resolve(new Response(stream, { status: 200, headers }))
    },
    ...(options.bundledPython === true
      ? { bundledArtifactsRoot: join(root, 'bundled'), requireBundledPython: true }
      : {}),
    ...(options.bundledOffice === true ? { bundledOfficeNodeModules: bundledOfficePath === undefined
      ? join(root, 'harness', 'node_modules')
      : () => bundledOfficePath(root) } : {}),
    ...(options.pythonEnvironment === undefined ? {} : { pythonEnvironment: options.pythonEnvironment }),
  })
  if (options.bundledPython === true) {
    await mkdir(join(root, 'bundled'), { recursive: true })
    await copyFile(archive, join(root, 'bundled', artifact.fileName))
  }
  if (options.bundledOffice === true) {
    const scope = join(root, 'harness', 'node_modules', '@deepseek-ai')
    await mkdir(join(scope, 'libreoffice-kit-darwin-arm64'), { recursive: true })
    await mkdir(join(scope, 'libreoffice-kit'), { recursive: true })
    await writeFile(join(scope, 'libreoffice-kit', 'package.json'), JSON.stringify({
      name: '@deepseek-ai/libreoffice-kit', version: '0.0.1',
      optionalDependencies: { '@deepseek-ai/libreoffice-kit-darwin-arm64': '0.0.1' },
    }))
    await writeFile(join(scope, 'libreoffice-kit-darwin-arm64', 'package.json'), JSON.stringify({
      name: '@deepseek-ai/libreoffice-kit-darwin-arm64', version: '0.0.1',
    }))
    await writeFile(join(scope, 'libreoffice-kit-darwin-arm64', 'prebuilds.json'), '{}')
  }
  return {
    manager, root, digest, officeDigest, stateFile, fetchCount: () => fetchCount,
    setPythonDigest: (value: string) => { artifact.payloadDigest = value },
    setOfficeDigest: (value: string) => { artifact.office.payloadDigest = value },
    setHome: (name: string) => { home = join(root, name) },
  }
}

async function settle(manager: OptionalRuntimeManager, jobId: string) {
  for (let attempts = 0; attempts < 100; attempts += 1) {
    const snapshot = manager.getJob(jobId)
    if (!['running', 'paused'].includes(snapshot.phase)) return snapshot
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('runtime job did not settle')
}

describe('OptionalRuntimeManager', () => {
  it('does not abort desktop startup when its configured packaged Office directory is absent', async () => {
    const { manager, root, fetchCount } = await fixture({ bundledOffice: true, bundledPython: true })
    await rm(join(root, 'harness'), { recursive: true })
    await expect(manager.officeNodeModules()).resolves.toBeUndefined()
    const job = await manager.start('office')
    await expect(settle(manager, job.jobId)).resolves.toMatchObject({ phase: 'failed' })
    expect(fetchCount()).toBe(0)
  })

  it('resolves bundled Office from the runtime location selected after archive extraction', async () => {
    const { manager, root } = await fixture({
      bundledOffice: true,
      bundledOfficePath: root => join(root, 'runtime-cache', 'node_modules'),
    })
    await cp(join(root, 'harness', 'node_modules'), join(root, 'runtime-cache', 'node_modules'), { recursive: true })
    await rm(join(root, 'harness'), { recursive: true })
    await expect(manager.officeNodeModules()).resolves.toBe(join(root, 'runtime-cache', 'node_modules'))
    const job = await manager.start('office')
    await expect(settle(manager, job.jobId)).resolves.toMatchObject({ phase: 'succeeded' })
  })

  it('uses the packaged Office engine without fetching its npm tarball', async () => {
    const { manager, root, fetchCount, setOfficeDigest } = await fixture({ bundledPython: true, bundledOffice: true })
    const job = await manager.start('office')
    await expect(settle(manager, job.jobId)).resolves.toMatchObject({ phase: 'succeeded', stage: 'ready' })
    expect(fetchCount()).toBe(0)
    await manager.activate('office')
    await manager.commitPending()
    expect((await manager.get()).capabilities.office.phase).toBe('enabled')
    expect(await manager.officeNodeModules()).toBe(join(root, 'harness', 'node_modules'))
    setOfficeDigest('d'.repeat(64))
    expect((await manager.get()).capabilities.office.phase).toBe('enabled')
    await manager.remove('office')
    await manager.commitPending()
    expect(await manager.officeNodeModules()).toBe(join(root, 'harness', 'node_modules'))
  })

  it('rejects a missing packaged Office engine instead of downloading it', async () => {
    const { manager, root, fetchCount } = await fixture({ bundledPython: true, bundledOffice: true })
    await rm(join(root, 'harness', 'node_modules', '@deepseek-ai', 'libreoffice-kit-darwin-arm64', 'prebuilds.json'))
    const job = await manager.start('office')
    const result = await settle(manager, job.jobId)
    expect(result.phase).toBe('failed')
    expect(result.message).toMatch(/incomplete/u)
    expect(fetchCount()).toBe(0)
  })

  it('prepares bundled Python without fetching it from a release', async () => {
    const { manager, fetchCount } = await fixture({ bundledPython: true })
    const job = await manager.start('ptc')
    await expect(settle(manager, job.jobId)).resolves.toMatchObject({ phase: 'succeeded', stage: 'ready' })
    expect(fetchCount()).toBe(0)
    await manager.activate('ptc')
    await manager.commitPending()
    expect((await manager.get()).capabilities.ptc.phase).toBe('enabled')
  })

  it('keeps unchanged bundled runtimes enabled and flags only changed payloads', async () => {
    const { manager, setPythonDigest, setOfficeDigest } = await fixture({ bundledPython: true })
    const ptcJob = await manager.start('ptc')
    await settle(manager, ptcJob.jobId)
    await manager.activate('ptc')
    const officeJob = await manager.start('office')
    await settle(manager, officeJob.jobId)
    await manager.activate('office')
    await manager.commitPending()
    expect((await manager.get()).capabilities.ptc.phase).toBe('enabled')
    expect((await manager.get()).capabilities.office.phase).toBe('enabled')
    setPythonDigest('d'.repeat(64))
    expect((await manager.get()).capabilities.ptc.phase).toBe('needs-update')
    setPythonDigest('b'.repeat(64))
    setOfficeDigest('e'.repeat(64))
    expect((await manager.get()).capabilities.office.phase).toBe('needs-update')
  })

  it('downloads one verified shared payload and keeps Office/PTC references independent', async () => {
    const { manager, root, digest, setHome } = await fixture()
    const job = await manager.start('office')
    const result = await settle(manager, job.jobId)
    expect(result, result.message).toMatchObject({ phase: 'succeeded', stage: 'ready' })
    await manager.activate('office')
    expect(await manager.pending()).toEqual({ office: 'enable', ptc: undefined })
    await manager.commitPending()
    expect((await manager.get()).capabilities.office.phase).toBe('enabled')

    setHome('home-two')
    await manager.activate('ptc')
    await manager.commitPending()
    expect((await manager.get()).capabilities.ptc.phase).toBe('enabled')

    setHome('home-one')
    await manager.remove('office')
    await manager.commitPending()
    await expect(readFile(join(root, 'user-data', 'optional-runtimes', digest, 'darwin-arm64', 'runtime.json'), 'utf8')).resolves.toContain(digest)

    setHome('home-two')
    await manager.remove('ptc')
    await manager.commitPending()
    await expect(readFile(join(root, 'user-data', 'optional-runtimes', digest, 'darwin-arm64', 'runtime.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await manager.dispose()
  })

  it('exposes NAS and unsupported PTC states without starting a download', async () => {
    const nas = await fixture({ nas: true })
    expect((await nas.manager.get()).capabilities.office.phase).toBe('nas-unavailable')
    await expect(nas.manager.start('office')).rejects.toThrow(/NAS mode/u)

    const windows = await fixture({ platform: 'win32', arch: 'x64' })
    expect((await windows.manager.get()).capabilities.ptc.phase).toBe('unsupported')
    await expect(windows.manager.start('ptc')).rejects.toThrow(/unsupported/u)
  })

  it('keeps custom Python separate from Office and PTC capabilities', async () => {
    const probe: PythonEnvironmentProbe = {
      requestedPath: '/custom/python', executable: '/custom/python', implementation: 'CPython',
      version: '3.12.8', architecture: 'arm64', pipVersion: 'pip 25.2',
      sitePackages: '/custom/site-packages', writable: true, packages: {},
    }
    let current = probe
    const pythonEnvironment: PythonEnvironmentPort = {
      probe: () => Promise.resolve(current),
      plan: value => ({ changes: value.packages.openpyxl === '3.1.5'
        ? [] : [{ name: 'openpyxl', target: '3.1.5', action: 'add' }], requiresConfirmation: false }),
      install: () => { current = { ...probe, packages: { openpyxl: '3.1.5' } }; return Promise.resolve(current) },
    }
    const { manager } = await fixture({ pythonEnvironment })
    await manager.selectCustomPython('/custom/python')
    expect((await manager.get()).python).toMatchObject({ source: 'custom', probe: { executable: '/custom/python' } })
    await expect(manager.activate('office')).rejects.toThrow(/downloaded/u)
    const job = await manager.start('office')
    await expect(settle(manager, job.jobId)).resolves.toMatchObject({ phase: 'succeeded' })
    await expect(manager.activate('office')).rejects.toThrow(/Office dependencies/u)
    await manager.installCustomOffice(false)
    await manager.activate('office')
    expect(await manager.pending()).toEqual({ office: 'enable', ptc: undefined })
    await expect(manager.officeNodeModules()).resolves.toMatch(/office[/\\]node_modules$/u)
    await manager.activate('ptc')
    expect(await manager.pending()).toEqual({ office: 'enable', ptc: 'enable' })
  })

  it('rejects an archive whose signed digest does not match', async () => {
    const { manager } = await fixture({ corruptDigest: true })
    const state = await manager.start('office')
    const result = await settle(manager, state.jobId)
    expect(result.phase).toBe('failed')
    expect(result.message).toMatch(/SHA-256 mismatch/u)
    await manager.dispose()
  })

  it('rejects an official Office archive whose npm integrity does not match', async () => {
    const { manager } = await fixture({ corruptOfficeIntegrity: true })
    const state = await manager.start('office')
    const result = await settle(manager, state.jobId)
    expect(result.phase).toBe('failed')
    expect(result.message).toMatch(/npm integrity mismatch/u)
    await manager.dispose()
  })

  it('discards incomplete shared cache contents before re-downloading', async () => {
    const { manager, root, digest, fetchCount } = await fixture()
    const first = await manager.start('office')
    await expect(settle(manager, first.jobId)).resolves.toMatchObject({ phase: 'succeeded' })
    await writeFile(
      join(root, 'user-data', 'optional-runtimes', digest, 'darwin-arm64', 'runtime.json'),
      '{"schema":"corrupt"}\n',
    )
    const second = await manager.start('ptc')
    await expect(settle(manager, second.jobId)).resolves.toMatchObject({ phase: 'succeeded' })
    expect(fetchCount()).toBe(3)
    await manager.dispose()
  })

  it('rejects corrupted persisted references instead of exposing attacker-selected cache paths', async () => {
    const { manager, stateFile, root } = await fixture()
    await mkdir(join(stateFile, '..'), { recursive: true })
    await writeFile(stateFile, JSON.stringify({
      schema: 'open-dsh-desktop/workspace-runtimes/v1',
      homes: { [join(root, 'home-one')]: { office: {
        payloadDigest: '../escape', desktopVersion: '0.1.6-alpha.2.1', state: 'enabled',
      } } },
      pendingCleanup: [],
    }))
    await expect(manager.get()).rejects.toThrow(/invalid workspace-runtime state/u)
  })

  it('requires an Office engine download for references written before engine payloads were split', async () => {
    const { manager, stateFile, root, digest } = await fixture()
    await mkdir(join(stateFile, '..'), { recursive: true })
    await writeFile(stateFile, JSON.stringify({
      schema: 'open-dsh-desktop/workspace-runtimes/v1',
      homes: { [join(root, 'home-one')]: { office: {
        payloadDigest: digest, desktopVersion: '0.1.6-alpha.2.1', state: 'enabled', source: 'managed',
      } } },
      pendingCleanup: [],
    }))

    expect((await manager.get()).capabilities.office.phase).toBe('needs-update')
    await expect(manager.officeNodeModules()).resolves.toBeUndefined()
  })

  it('pauses after retaining partial bytes and resumes the same job with an HTTP range request', async () => {
    const { manager, fetchCount } = await fixture({ slowDownload: true })
    const started = await manager.start('office')
    for (let attempts = 0; attempts < 50 && manager.getJob(started.jobId).transferredBytes === 0; attempts += 1) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    const paused = await manager.pause(started.jobId)
    expect(paused).toMatchObject({ phase: 'paused', stage: 'downloading' })
    expect(paused.transferredBytes).toBeGreaterThan(0)
    const resumed = await manager.start('office')
    expect(resumed.jobId).toBe(started.jobId)
    await expect(settle(manager, started.jobId)).resolves.toMatchObject({ phase: 'succeeded' })
    expect(fetchCount()).toBe(3)
  })
})

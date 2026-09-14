import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { create } from 'tar'
import { ensurePackagedRuntime, isPackagedRuntimeReady, packagedRuntimeArchiveRoot } from '../src/packaged-runtime.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function createRuntime(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-packaged-runtime-'))
  roots.push(root)
  await mkdir(join(root, 'lib'), { recursive: true })
  await mkdir(join(root, 'node_modules', '@deepseek-ai', 'cosmokit'), { recursive: true })
  await mkdir(join(root, 'package-runtime', 'bin'), { recursive: true })
  await writeFile(join(root, 'lib', 'bin.js'), '')
  await writeFile(join(root, 'package-runtime', 'bin', 'node'), '')
  await writeFile(join(root, 'package-runtime', 'bin', 'pnpm'), '')
  return root
}

describe('packaged desktop runtime', () => {
  it('runs the expanded installation without extracting or creating a user cache', async () => {
    const root = await createRuntime()
    await writeFile(join(root, '.desktop-runtime-v3'), 'runtime')
    expect(await ensurePackagedRuntime({ expandedPath: root, destination: join(root, 'unused-cache'), archivePath: 'missing.tar.gz', archiveRoot: 'unused' })).toBe(root)
  })

  it('rejects an incomplete expanded installation even when a complete cache exists', async () => {
    const expanded = await createRuntime()
    const cached = await createRuntime()
    await writeFile(join(cached, '.desktop-runtime-v3'), 'runtime')
    await expect(ensurePackagedRuntime({ expandedPath: expanded, destination: cached, archivePath: 'missing.tar.gz', archiveRoot: 'unused' })).rejects.toThrow('reinstall')
  })

  it('recognizes the old cached layout when expanded resources are absent', async () => {
    const cached = await createRuntime()
    await writeFile(join(cached, '.desktop-runtime-v3'), 'runtime')
    expect(await ensurePackagedRuntime({ expandedPath: join(cached, 'absent'), destination: cached, archivePath: 'missing.tar.gz', archiveRoot: 'unused' })).toBe(cached)
  })
  it('selects embedded runtime archives for macOS and Linux only', () => {
    expect(packagedRuntimeArchiveRoot('darwin', 'arm64')).toBe('desktop-runtime-darwin-arm64')
    expect(packagedRuntimeArchiveRoot('darwin', 'x64')).toBe('desktop-runtime-darwin-x64')
    expect(packagedRuntimeArchiveRoot('linux', 'x64')).toBe('desktop-runtime-linux-x64')
    expect(packagedRuntimeArchiveRoot('win32', 'x64')).toBeUndefined()
  })

  it('rejects an extracted cache from the old incomplete layout', async () => {
    const runtime = await createRuntime()
    expect(await isPackagedRuntimeReady(runtime)).toBe(false)
  })

  it('accepts a complete versioned runtime layout', async () => {
    const runtime = await createRuntime()
    await writeFile(join(runtime, '.desktop-runtime-v3'), '@deepseek-ai/dsh@0.1.0-rc.5\n')
    expect(await isPackagedRuntimeReady(runtime)).toBe(true)
  })

  it('extracts a checksummed single-root runtime archive into the versioned cache', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'dsh-packaged-archive-'))
    roots.push(parent)
    const source = join(parent, 'desktop-runtime-darwin-arm64')
    await mkdir(source)
    const staged = await createRuntime()
    await rm(source, { recursive: true })
    await cp(staged, source, { recursive: true })
    await writeFile(join(source, '.desktop-runtime-v3'), 'runtime')
    const archive = join(parent, 'runtime.tar')
    await create({ cwd: parent, file: archive }, ['desktop-runtime-darwin-arm64'])
    const checksum = createHash('sha256').update(readFileSync(archive)).digest('hex')
    await writeFile(`${archive}.sha256`, `${checksum}  runtime.tar\n`)
    const destination = join(parent, 'cache', 'runtime')
    expect(await ensurePackagedRuntime({ archivePath: archive, checksumPath: `${archive}.sha256`, destination, archiveRoot: 'desktop-runtime-darwin-arm64' })).toBe(destination)
    expect(await isPackagedRuntimeReady(destination)).toBe(true)
  })

  it('rejects a packaged archive when its detached checksum is wrong', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'dsh-packaged-checksum-'))
    roots.push(parent)
    const archive = join(parent, 'runtime.tar')
    await writeFile(archive, 'not an archive')
    await writeFile(`${archive}.sha256`, `${'0'.repeat(64)}  runtime.tar\n`)
    await expect(ensurePackagedRuntime({ archivePath: archive, checksumPath: `${archive}.sha256`, destination: join(parent, 'cache'), archiveRoot: 'desktop-runtime-darwin-arm64' })).rejects.toThrow('checksum mismatch')
  })

  it('rejects a checksummed archive whose root differs from the expected platform root', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'dsh-packaged-root-'))
    roots.push(parent)
    await mkdir(join(parent, 'desktop-runtime-linux-x64'))
    await writeFile(join(parent, 'desktop-runtime-linux-x64', 'payload'), 'unexpected platform')
    const archive = join(parent, 'runtime.tar')
    await create({ cwd: parent, file: archive }, ['desktop-runtime-linux-x64'])
    const checksum = createHash('sha256').update(readFileSync(archive)).digest('hex')
    await writeFile(`${archive}.sha256`, `${checksum}  runtime.tar\n`)
    await expect(ensurePackagedRuntime({ archivePath: archive, checksumPath: `${archive}.sha256`, destination: join(parent, 'cache'), archiveRoot: 'desktop-runtime-darwin-arm64' })).rejects.toThrow('unsafe packaged archive path')
  })
})

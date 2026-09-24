import { spawnSync } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { create } from 'tar'
import { afterEach, describe, expect, it } from 'vitest'
import {
  importedPluginVersionDiffers,
  inspectImportedPluginArchive,
  isSafeImportedPluginArchivePath,
  stageImportedPluginArchive,
  stageImportedPluginDirectory,
} from '../src/imported-plugin-local-source.ts'

const roots: string[] = []

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-imported-local-'))
  roots.push(root)
  return root
}

async function pluginArchive(root: string, name = 'example-plugin', version = '1.2.3'): Promise<string> {
  const source = join(root, 'source')
  const packageDirectory = join(source, 'package')
  await mkdir(packageDirectory, { recursive: true })
  await writeFile(join(packageDirectory, 'package.json'), JSON.stringify({ name, version }))
  const archive = join(root, 'plugin.tgz')
  await create({ cwd: source, file: archive, gzip: true }, ['package'])
  return archive
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('imported plugin local source', () => {
  it('accepts only relative archive paths without traversal', () => {
    expect(isSafeImportedPluginArchivePath('package/package.json')).toBe(true)
    expect(isSafeImportedPluginArchivePath('../package/package.json')).toBe(false)
    expect(isSafeImportedPluginArchivePath('package\\..\\secret')).toBe(false)
    expect(isSafeImportedPluginArchivePath('/absolute/file')).toBe(false)
    expect(isSafeImportedPluginArchivePath('C:/absolute/file')).toBe(false)
  })

  it('reads only the package identity and rejects a mismatched package name', async () => {
    const root = await fixture()
    const archive = await pluginArchive(root)
    await expect(inspectImportedPluginArchive(archive, 'example-plugin')).resolves.toEqual({
      name: 'example-plugin', version: '1.2.3',
    })
    await expect(inspectImportedPluginArchive(archive, 'different-plugin')).rejects.toThrow('expected different-plugin')
  })

  it('rejects damaged archives and oversized manifests', async () => {
    const root = await fixture()
    const damaged = join(root, 'damaged.tgz')
    await writeFile(damaged, 'not a tar archive')
    await expect(inspectImportedPluginArchive(damaged, 'example-plugin')).rejects.toThrow()

    const source = join(root, 'oversized-source')
    const packageDirectory = join(source, 'package')
    await mkdir(packageDirectory, { recursive: true })
    await writeFile(join(packageDirectory, 'package.json'), ' '.repeat(1024 * 1024 + 1))
    const oversized = join(root, 'oversized.tgz')
    await create({ cwd: source, file: oversized, gzip: true }, ['package'])
    await expect(inspectImportedPluginArchive(oversized, 'example-plugin')).rejects.toThrow('1 MiB')
  })

  it('stages selected archives and deletes the temporary copy', async () => {
    const root = await fixture()
    const archive = await pluginArchive(root)
    const staged = await stageImportedPluginArchive(archive, 'example-plugin')
    expect(await readFile(staged.archivePath)).toEqual(await readFile(archive))
    await staged.cleanup()
    await expect(access(staged.archivePath)).rejects.toThrow()
  })

  it('validates source directories before packing and cleans generated archives', async () => {
    const root = await fixture()
    const source = join(root, 'plugin-source')
    await mkdir(source)
    await writeFile(join(source, 'package.json'), JSON.stringify({ name: 'example-plugin', version: '2.0.0' }))
    const staged = await stageImportedPluginDirectory(source, 'example-plugin', async (args, directory, timeoutMs) => {
      expect(args.slice(0, 3)).toEqual(['--config.ignore-scripts=true', 'pack', '--pack-destination'])
      expect(args).not.toContain('--ignore-scripts')
      expect(timeoutMs).toBe(60_000)
      const destination = args[3] as string
      const packageDirectory = join(destination, 'package')
      await mkdir(packageDirectory)
      await writeFile(join(packageDirectory, 'package.json'), await readFile(join(directory, 'package.json')))
      await create({ cwd: destination, file: join(destination, 'packed.tgz'), gzip: true }, ['package'])
      await rm(packageDirectory, { recursive: true })
      return ''
    })
    expect(staged.manifest.version).toBe('2.0.0')
    await staged.cleanup()
    await expect(access(staged.archivePath)).rejects.toThrow()
  })

  it('packs a local plugin with bundled pnpm without running lifecycle scripts', async () => {
    const root = await fixture()
    const source = join(root, 'plugin-source')
    await mkdir(source)
    await writeFile(join(source, 'package.json'), JSON.stringify({
      name: 'example-plugin', version: '2.0.0',
      scripts: { prepack: "node -e \"require('node:fs').writeFileSync('prepack-ran', 'yes')\"" },
    }))
    const pnpm = fileURLToPath(new URL('../node_modules/pnpm/bin/pnpm.cjs', import.meta.url))
    const staged = await stageImportedPluginDirectory(source, 'example-plugin', async (args, cwd) => {
      const result = spawnSync(process.execPath, [pnpm, ...args], {
        cwd, encoding: 'utf8', timeout: 20_000,
      })
      if (result.status !== 0) throw new Error(result.stderr || result.stdout)
      return result.stdout
    })
    expect(staged.manifest).toEqual({ name: 'example-plugin', version: '2.0.0' })
    await expect(access(join(source, 'prepack-ran'))).rejects.toThrow()
    await staged.cleanup()
  })

  it('rejects a source directory whose package identity differs before packing', async () => {
    const root = await fixture()
    const source = join(root, 'wrong-source')
    await mkdir(source)
    await writeFile(join(source, 'package.json'), JSON.stringify({ name: 'other-plugin', version: '1.0.0' }))
    let packed = false
    await expect(stageImportedPluginDirectory(source, 'example-plugin', async () => {
      packed = true
      return ''
    })).rejects.toThrow('expected example-plugin')
    expect(packed).toBe(false)
  })

  it('requires confirmation only when a known local version differs', () => {
    expect(importedPluginVersionDiffers('1.2.3', '1.2.3')).toBe(false)
    expect(importedPluginVersionDiffers('v1.2.3', '1.2.3')).toBe(false)
    expect(importedPluginVersionDiffers('^1.2.0', '1.2.3')).toBe(true)
    expect(importedPluginVersionDiffers('^1.2.0', undefined)).toBe(false)
  })
})

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { deployPrebuiltProfile, sealPrebuiltProfile } from '../src/prebuilt-profile.ts'

// Exercise Windows metadata rendering through the real deployment function;
// native Windows CI still owns filesystem and package-manager qualification.
vi.mock('node:path', async original => ({ ...await original<typeof import('node:path')>(), sep: '\\' }))

it('keeps relocated archive specifiers identical in JSON and pnpm lockfiles with Windows separators', async () => {
  const root = await mkdtemp(join(tmpdir(), 'prebuilt windows paths '))
  try {
    const source = join(root, 'source')
    const target = join(root, 'Windows\\用户 with spaces')
    await mkdir(join(source, 'profiles/web'), { recursive: true })
    await writeFile(join(source, 'profiles/web/package.json'), JSON.stringify({
      dependencies: { demo: `file:${source}/bundled-plugins/demo.tgz` },
    }))
    await writeFile(join(source, 'profiles/web/pnpm-lock.yaml'), `specifier: file:${source}/bundled-plugins/demo.tgz\n`)
    const manifest = await sealPrebuiltProfile(source, {
      target: 'win32-x64', nodeVersion: '24.21.0', pnpmVersion: '11.28.5',
      runtimeVersion: '0.2.1-alpha.2', pluginManifestSha256: 'a'.repeat(64),
    }, {}, join(root, 'runtime'))
    await deployPrebuiltProfile(source, target, manifest, new AbortController().signal, () => {})
    const packageJson = JSON.parse(await readFile(join(target, 'profiles/web/package.json'), 'utf8')) as {
      dependencies: { demo: string }
    }
    const lockfile = await readFile(join(target, 'profiles/web/pnpm-lock.yaml'), 'utf8')
    expect(packageJson.dependencies.demo).toBe(`file:${target.replaceAll('\\', '/')}/bundled-plugins/demo.tgz`)
    expect(lockfile).toBe(`specifier: ${packageJson.dependencies.demo}\n`)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

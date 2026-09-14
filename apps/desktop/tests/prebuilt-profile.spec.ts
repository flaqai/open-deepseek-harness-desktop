import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { deployPrebuiltProfile, readPrebuiltProfile, readProfileBuildApprovals, sealPrebuiltProfile } from '../src/prebuilt-profile.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'prebuilt profile '))
  roots.push(root)
  const source = join(root, 'source')
  const target = join(root, '配置 with spaces')
  await mkdir(join(source, 'profiles/web/node_modules/demo'), { recursive: true })
  await writeFile(join(source, 'profiles/web/package.json'), JSON.stringify({ path: source }))
  await writeFile(join(source, 'profiles/web/node_modules/demo/index.js'), 'export const value = 1\n')
  const identity = { target: 'darwin-arm64', nodeVersion: '24.17.0', pnpmVersion: '11.7.0', runtimeVersion: '0.1.5', pluginManifestSha256: 'a'.repeat(64) }
  const manifest = await sealPrebuiltProfile(source, identity, {}, join(root, 'runtime'))
  return { root, source, target, manifest }
}
const signal = (): AbortSignal => new AbortController().signal
describe('prebuilt Profile resources', () => {
  it('retains explicit build denials and rejects malformed approvals', async () => {
    const f = await fixture()
    const path = join(f.source, 'profiles/web/pnpm-workspace.yaml')
    await writeFile(path, 'allowBuilds:\n  esbuild: false\n')
    expect(await readProfileBuildApprovals(f.source)).toEqual({ esbuild: false })
    await writeFile(path, 'allowBuilds:\n  esbuild: maybe\n')
    await expect(readProfileBuildApprovals(f.source)).rejects.toThrow('invalid Profile build approvals')
  })
  it('removes interrupted partials without activating them and repairs incomplete candidate files', async () => {
    const f = await fixture()
    await mkdir(join(f.target, '.prebuilt-partials'), { recursive: true })
    const part = join(f.target, '.prebuilt-partials/00000000-0000-0000-0000-000000000000.part')
    await writeFile(part, 'partial')
    await deployPrebuiltProfile(f.source, f.target, f.manifest, signal(), () => {})
    await expect(lstat(part)).rejects.toMatchObject({ code: 'ENOENT' })
    const file = join(f.target, 'profiles/web/node_modules/demo/index.js')
    await writeFile(file, 'partial')
    await deployPrebuiltProfile(f.source, f.target, f.manifest, signal(), () => {})
    expect(await readFile(file, 'utf8')).toContain('value = 1')
  })
  it('verifies, relocates and copies without sharing mutable files with the template', async () => {
    const f = await fixture()
    expect(await readPrebuiltProfile(f.source)).toEqual(f.manifest)
    if (process.platform !== 'win32') {
      expect((await lstat(f.source)).mode & 0o777).toBe(0o755)
      expect((await lstat(join(f.source, 'prebuilt-profile.json'))).mode & 0o777).toBe(0o644)
    }
    await deployPrebuiltProfile(f.source, f.target, f.manifest, signal(), () => {})
    expect(JSON.parse(await readFile(join(f.target, 'profiles/web/package.json'), 'utf8'))).toEqual({ path: f.target })
    await writeFile(join(f.target, 'profiles/web/node_modules/demo/index.js'), 'changed')
    expect(await readFile(join(f.source, 'profiles/web/node_modules/demo/index.js'), 'utf8')).toContain('value = 1')
  })
  it('retains completed files on interruption and reuses them on retry', async () => {
    const f = await fixture()
    const abort = new AbortController()
    await expect(deployPrebuiltProfile(f.source, f.target, f.manifest, abort.signal, () => { abort.abort() })).rejects.toThrow()
    const file = join(f.target, 'profiles/web/node_modules/demo/index.js')
    const before = await lstat(file)
    await deployPrebuiltProfile(f.source, f.target, f.manifest, signal(), () => {})
    expect((await lstat(file)).mtimeMs).toBe(before.mtimeMs)
  })
  it('rejects a damaged template rather than installing it or silently falling back', async () => {
    const f = await fixture()
    await writeFile(join(f.source, 'profiles/web/node_modules/demo/index.js'), 'damaged')
    await expect(deployPrebuiltProfile(f.source, f.target, f.manifest, signal(), () => {})).rejects.toThrow('damaged prebuilt')
  })
  it('rejects manifest traversal even with an internally consistent checksum', async () => {
    const f = await fixture()
    const { fingerprint: _fingerprint, ...unsigned } = f.manifest
    unsigned.files[0]!.path = '../escape'
    await writeFile(join(f.source, 'prebuilt-profile.json'), JSON.stringify({ ...unsigned, fingerprint: createHash('sha256').update(JSON.stringify(unsigned)).digest('hex') }))
    await expect(readPrebuiltProfile(f.source)).rejects.toThrow('unsafe')
  })
  it('refuses deployment through an existing symlink parent', async () => {
    const f = await fixture()
    await mkdir(f.target)
    await symlink(f.source, join(f.target, 'profiles'), 'junction')
    await expect(deployPrebuiltProfile(f.source, f.target, f.manifest, signal(), () => {})).rejects.toThrow('linked parent')
  })
  it('does not accept a home carrying credentials as a release resource', async () => {
    const f = await fixture()
    await writeFile(join(f.source, 'settings.yaml'), 'private')
    await expect(sealPrebuiltProfile(f.source, f.manifest.identity, {}, join(f.root, 'runtime'))).rejects.toThrow('unexpected')
  })
})

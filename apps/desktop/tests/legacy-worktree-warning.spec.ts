/** Retired bundle diagnosis preserves exact user bytes and never enables a replacement. */
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { backupLegacyWorktreeConfiguration, inspectLegacyWorktreeWarning, LEGACY_WORKTREE_BUNDLE } from '../src/legacy-worktree-warning.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function fixture(bundles: string[]) {
  const home = await mkdtemp(join(tmpdir(), 'legacy-worktree-'))
  roots.push(home)
  await mkdir(join(home, 'profiles/web'), { recursive: true })
  const source = JSON.stringify({ dsh: { profile: { bundles } }, dependencies: { custom: '1.0.0' } }, null, 4) + '\n'
  await writeFile(join(home, 'profiles/web/package.json'), source)
  return { home, source }
}
it('backs up exact bytes once and leaves bundle membership untouched', async () => {
  const { home, source } = await fixture([LEGACY_WORKTREE_BUNDLE, 'custom'])
  const backup = await backupLegacyWorktreeConfiguration(home)
  expect(backup).toBeDefined()
  expect(await readFile(join(home, backup!), 'utf8')).toBe(source)
  expect(await backupLegacyWorktreeConfiguration(home)).toBe(backup)
  expect(await readdir(join(home, 'diagnostics/legacy-worktree-backups'))).toHaveLength(1)
  expect(await readFile(join(home, 'profiles/web/package.json'), 'utf8')).toBe(source)
})
it('does not create backups for unrelated bundles', async () => {
  const { home } = await fixture(['@deepseek-ai/dsh-experimental-forge-bundle'])
  expect(await backupLegacyWorktreeConfiguration(home)).toBeUndefined()
  expect(await readdir(home)).toEqual(['profiles'])
})
it('rejects a linked backup directory and preserves the manifest', async () => {
  const { home, source } = await fixture([LEGACY_WORKTREE_BUNDLE])
  const outside = await mkdtemp(join(tmpdir(), 'worktree-outside-'))
  roots.push(outside)
  await symlink(outside, join(home, 'diagnostics'))
  await expect(backupLegacyWorktreeConfiguration(home)).rejects.toThrow('unsafe')
  await expect(inspectLegacyWorktreeWarning(home)).resolves.toEqual({ code: 'runtime.legacy-worktree-backup-failed' })
  expect(await readdir(outside)).toEqual([])
  expect(await readFile(join(home, 'profiles/web/package.json'), 'utf8')).toBe(source)
})

it('backs up a shared Profile declaration without changing its inherited configuration', async () => {
  const { home } = await fixture(['custom'])
  const source = JSON.stringify({ dsh: { profile: { bundles: [LEGACY_WORKTREE_BUNDLE] } } })
  await mkdir(join(home, 'profiles/shared'))
  await writeFile(join(home, 'profiles/shared/package.json'), source)
  const backup = await backupLegacyWorktreeConfiguration(home)
  expect(backup).toBeDefined()
  expect(await readFile(join(home, backup!), 'utf8')).toBe(source)
  expect(await readFile(join(home, 'profiles/shared/package.json'), 'utf8')).toBe(source)
})

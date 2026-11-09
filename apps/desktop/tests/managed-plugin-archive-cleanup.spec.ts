import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { collectManagedPluginArchives, auditManagedPluginArchiveReferences } from '../src/managed-plugin-archive-cleanup.ts'

it('collects only integrity-proven unreferenced archives after commit under a lease', async () => {
  const home = await mkdtemp(join(tmpdir(), 'managed-archive-gc-'))
  try {
    await mkdir(join(home, 'bundled-plugins'))
    const bytes = Buffer.from('archive')
    for (const file of ['unused.tgz', 'referenced.tgz', 'unknown.tgz']) await writeFile(join(home, 'bundled-plugins', file), bytes)
    const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
    let leased = false
    const result = await collectManagedPluginArchives({ home, readinessCommitted: true,
      archives: [{ archive: 'unused.tgz', integrity }, { archive: 'referenced.tgz', integrity }],
      withMutationLease: async (run) => { leased = true; return await run() },
      auditReferences: async () => { expect(leased).toBe(true); return { complete: true, referencedArchives: ['referenced.tgz'] } },
    })
    expect(result.removed).toEqual(['unused.tgz'])
    await expect(readFile(join(home, 'bundled-plugins', 'unused.tgz'))).rejects.toThrow()
    expect(await readFile(join(home, 'bundled-plugins', 'unknown.tgz'), 'utf8')).toBe('archive')
    expect(await readFile(join(home, 'bundled-plugins', 'referenced.tgz'), 'utf8')).toBe('archive')
  } finally { await rm(home, { recursive: true, force: true }) }
})

it('retains everything before commit, on incomplete audits, mismatched hashes or missing evidence', async () => {
  const home = await mkdtemp(join(tmpdir(), 'managed-archive-gc-'))
  try {
    await mkdir(join(home, 'bundled-plugins'))
    await writeFile(join(home, 'bundled-plugins', 'old.tgz'), 'archive')
    const options = { home, archives: [{ archive: 'old.tgz', integrity: 'sha512-wrong' }],
      withMutationLease: async <T>(run: () => Promise<T>) => await run(),
      auditReferences: async () => ({ complete: false, referencedArchives: [] }),
    }
    expect((await collectManagedPluginArchives({ ...options, readinessCommitted: false })).removed).toEqual([])
    expect((await collectManagedPluginArchives({ ...options, readinessCommitted: true })).removed).toEqual([])
    expect((await collectManagedPluginArchives({ ...options, readinessCommitted: true,
      auditReferences: async () => ({ complete: true, referencedArchives: [] }) })).removed).toEqual([])
    expect(await readFile(join(home, 'bundled-plugins', 'old.tgz'), 'utf8')).toBe('archive')
  } finally { await rm(home, { recursive: true, force: true }) }
})

it('audits decoded lock references and retains all archives for snapshots, pending or invalid metadata', async () => {
  const home = await mkdtemp(join(tmpdir(), 'managed-archive-audit-'))
  try {
    await mkdir(join(home, 'profiles/web'), { recursive: true })
    await mkdir(join(home, 'plugin-snapshots/v1'), { recursive: true })
    await writeFile(join(home, 'profiles/web/package.json'), '{}')
    await writeFile(join(home, 'profiles/web/pnpm-lock.yaml'), 'dependencies:\n  alpha: "file:used.tgz"\n')
    expect(await auditManagedPluginArchiveReferences(home, ['used.tgz', 'free.tgz']))
      .toEqual({ complete: true, referencedArchives: ['used.tgz'] })
    await mkdir(join(home, 'plugin-snapshots/v1/retained'))
    expect((await auditManagedPluginArchiveReferences(home, ['used.tgz', 'free.tgz'])).referencedArchives)
      .toEqual(['used.tgz', 'free.tgz'])
    await rm(join(home, 'plugin-snapshots/v1/retained'), { recursive: true })
    await mkdir(join(home, 'plugin-transactions/web'), { recursive: true })
    await writeFile(join(home, 'plugin-transactions/web/pending.json'), '{}')
    expect((await auditManagedPluginArchiveReferences(home, ['used.tgz'])).complete).toBe(false)
    await rm(join(home, 'plugin-transactions'), { recursive: true })
    await writeFile(join(home, 'profiles/web/pnpm-lock.yaml'), '[invalid')
    expect((await auditManagedPluginArchiveReferences(home, ['used.tgz'])).complete).toBe(false)
  } finally { await rm(home, { recursive: true, force: true }) }
})

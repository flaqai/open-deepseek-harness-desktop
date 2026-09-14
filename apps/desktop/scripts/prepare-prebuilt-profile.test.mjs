import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pruneForeignNodePtyPrebuilds } from './prepare-prebuilt-profile.mjs'

test('prebuilt Profile keeps only node-pty resources for its packaged target', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-prebuilt-prune-'))
  const packageRoot = join(home, 'store/node-pty')
  try {
    for (const target of ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-arm64', 'win32-x64']) {
      await mkdir(join(packageRoot, 'prebuilds', target), { recursive: true })
    }
    for (const target of ['win10-arm64', 'win10-x64']) {
      await mkdir(join(packageRoot, 'third_party/conpty/1.0.0', target), { recursive: true })
    }
    const profileModules = join(home, 'profiles/web/node_modules')
    await mkdir(profileModules, { recursive: true })
    await symlink(packageRoot, join(profileModules, 'node-pty'), 'dir')

    await pruneForeignNodePtyPrebuilds(home, 'win32-x64')

    assert.deepEqual(await readdir(join(packageRoot, 'prebuilds')), ['win32-x64'])
    assert.deepEqual(await readdir(join(packageRoot, 'third_party/conpty/1.0.0')), ['win10-x64'])
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('non-Windows prebuilt Profile removes Windows-only ConPTY resources', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-prebuilt-prune-'))
  const packageRoot = join(home, 'profiles/web/node_modules/node-pty')
  try {
    await mkdir(join(packageRoot, 'prebuilds/darwin-arm64'), { recursive: true })
    await mkdir(join(packageRoot, 'third_party/conpty/1.0.0/win10-x64'), { recursive: true })

    await pruneForeignNodePtyPrebuilds(home, 'darwin-arm64')

    await assert.rejects(readdir(join(packageRoot, 'third_party/conpty')), { code: 'ENOENT' })
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('prebuilt Profile rejects unknown native targets', async () => {
  await assert.rejects(pruneForeignNodePtyPrebuilds('/unused', 'win32-arm64'), /invalid prebuilt target/)
})

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pruneForeignNodePtyPrebuilds, qualifyOfflinePluginRemoval } from './prepare-prebuilt-profile.mjs'

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

test('offline removal follows frozen policy warming with one private official-registry cache that is not published', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-prebuilt-cache-'))
  const home = join(root, 'relocated home')
  const calls = []
  try {
    await mkdir(join(home, 'profiles/web'), { recursive: true })
    await writeFile(join(home, 'profiles/web/pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    await qualifyOfflinePluginRemoval(home, 'fixture-plugin', async (actualHome, args) => {
      assert.equal(actualHome, home)
      calls.push(args)
      const cache = args.find(arg => arg.startsWith('--config.cache-dir=')).slice('--config.cache-dir='.length)
      assert.notEqual(cache, home)
      assert.ok(cache.startsWith(join(root, 'prebuilt-metadata-cache-')))
      assert.deepEqual(await readdir(cache), [])
    })
    assert.deepEqual(calls[0].slice(0, 4), ['install', '--frozen-lockfile', '--ignore-scripts', '--lockfile-only'])
    assert.deepEqual(calls[1].slice(0, 3), ['remove', 'fixture-plugin', '--config.offline=true'])
    assert.deepEqual(calls[0].slice(-2), calls[1].slice(-2))
    assert.equal(calls[0].at(-1), '--config.registry=https://registry.npmjs.org/')
    assert.deepEqual(await readdir(root), ['relocated home'])
  } finally { await rm(root, { recursive: true, force: true }) }
})

for (const failure of ['policy rejection', 'lockfile change']) {
  test(`metadata qualification refuses offline removal after ${failure} and cleans private cache`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-prebuilt-cache-'))
    const home = join(root, 'relocated home')
    let calls = 0
    try {
      await mkdir(join(home, 'profiles/web'), { recursive: true })
      const lockfile = join(home, 'profiles/web/pnpm-lock.yaml')
      await writeFile(lockfile, 'original lock')
      await assert.rejects(qualifyOfflinePluginRemoval(home, 'fixture-plugin', async () => {
        calls += 1
        if (failure === 'policy rejection') throw new Error('policy rejected')
        await writeFile(lockfile, 'changed lock')
      }), failure === 'policy rejection' ? /policy rejected/u : /changed the frozen lockfile/u)
      assert.equal(calls, 1)
      assert.deepEqual(await readdir(root), ['relocated home'])
    } finally { await rm(root, { recursive: true, force: true }) }
  })
}

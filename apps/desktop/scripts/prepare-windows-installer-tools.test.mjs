import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { prepareWindowsInstallerTools, windowsInstallerToolRequest } from './prepare-windows-installer-tools.mjs'

async function fixture(t) {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'dsh-windows-installer-tool-'))
  t.after(() => rm(repositoryRoot, { recursive: true, force: true }))
  const toolDirectory = join(repositoryRoot, 'downloaded-tool')
  await mkdir(join(toolDirectory, 'bin'), { recursive: true })
  await writeFile(join(toolDirectory, 'bin/7za.exe'), 'MZ synthetic tool')
  await writeFile(join(toolDirectory, 'COPYING'), 'synthetic copying terms')
  await writeFile(join(toolDirectory, 'LICENSE.txt'), 'synthetic license terms')
  return { repositoryRoot, toolDirectory }
}

test('pins the official Windows x64 tool request without shared mutable options', () => {
  assert.deepEqual(windowsInstallerToolRequest(), {
    releaseName: '7zip@1.0.0', filenameWithExt: '7zip-win-x64.tar.gz',
    checksums: { '7zip-win-x64.tar.gz': 'be071f15bd6da2f78fe81c6ddef2009b0c4d8a51f36b780cb806c7e6df95e1b3' },
    githubOrgRepo: 'electron-userland/electron-builder-binaries',
  })
  const changed = windowsInstallerToolRequest()
  changed.checksums['7zip-win-x64.tar.gz'] = 'changed'
  assert.notEqual(windowsInstallerToolRequest().checksums['7zip-win-x64.tar.gz'], 'changed')
})

test('matches the pinned app-builder-lib toolset checksum and release', async () => {
  const desktopRequire = createRequire(new URL('../package.json', import.meta.url))
  const builderRequire = createRequire(desktopRequire.resolve('electron-builder/package.json'))
  assert.equal(builderRequire('app-builder-lib/package.json').version, '26.17.0')
  const source = await readFile(builderRequire.resolve('app-builder-lib/out/toolsets/7zip.js'), 'utf8')
  assert.ok(source.includes('7zip@1.0.0'))
  const digest = windowsInstallerToolRequest().checksums['7zip-win-x64.tar.gz']
  assert.match(source, new RegExp(`"7zip-win-x64\\.tar\\.gz": "${digest}"`, 'u'))
})

test('stages only the fixed executable and both licenses through the verified downloader', async t => {
  const item = await fixture(t)
  const calls = []
  const prepared = await prepareWindowsInstallerTools({
    repositoryRoot: item.repositoryRoot,
    downloadBuilderToolset: async request => { calls.push(request); return item.toolDirectory },
  })
  assert.deepEqual(calls, [windowsInstallerToolRequest()])
  assert.equal(prepared.directory, join(item.repositoryRoot, '.artifacts/desktop-runtime-win-x64/installer'))
  assert.equal(prepared.executable, join(prepared.directory, '7za.exe'))
  assert.deepEqual((await readdir(prepared.directory)).sort(), ['7za.exe', 'COPYING', 'LICENSE.txt'])
  for (const [source, destination] of [['bin/7za.exe', '7za.exe'], ['COPYING', 'COPYING'], ['LICENSE.txt', 'LICENSE.txt']]) {
    assert.deepEqual(await readFile(join(prepared.directory, destination)), await readFile(join(item.toolDirectory, source)))
  }
})

test('propagates downloader failures without creating staged tools', async t => {
  const item = await fixture(t)
  await assert.rejects(prepareWindowsInstallerTools({
    repositoryRoot: item.repositoryRoot,
    downloadBuilderToolset: async () => { throw new Error('archive checksum mismatch') },
  }), /archive checksum mismatch/u)
  await assert.rejects(readdir(join(item.repositoryRoot, '.artifacts')), { code: 'ENOENT' })
})

for (const invalid of ['missing-license', 'empty-tool', 'linked-tool']) {
  test(`rejects ${invalid} before staging any files`, async t => {
    const item = await fixture(t)
    if (invalid === 'missing-license') await rm(join(item.toolDirectory, 'LICENSE.txt'))
    if (invalid === 'empty-tool') await writeFile(join(item.toolDirectory, 'bin/7za.exe'), '')
    if (invalid === 'linked-tool') {
      await rm(join(item.toolDirectory, 'bin/7za.exe'))
      await symlink('../COPYING', join(item.toolDirectory, 'bin/7za.exe'))
    }
    await assert.rejects(prepareWindowsInstallerTools({
      repositoryRoot: item.repositoryRoot, downloadBuilderToolset: async () => item.toolDirectory,
    }))
    await assert.rejects(readdir(join(item.repositoryRoot, '.artifacts')), { code: 'ENOENT' })
  })
}

test('normal Windows runtime preparation stages tools only after host validation and output reset', async () => {
  const source = await readFile(new URL('prepare-windows-runtime.mjs', import.meta.url), 'utf8')
  const call = source.indexOf('await prepareWindowsInstallerTools({ repositoryRoot })')
  assert.ok(call > source.indexOf("if (process.platform !== 'win32' || process.arch !== 'x64')"))
  assert.ok(call > source.indexOf('await rm(outputRoot, { recursive: true, force: true })'))
  assert.ok(call < source.indexOf('await preservePnpmWorkspaceState(repositoryRoot'))
})

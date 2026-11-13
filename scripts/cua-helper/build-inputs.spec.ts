/** Byte-level source reuse survives unrelated releases and invalidates changed build inputs. */
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { cuaHelperSourceDigest, cuaHelperSourceMatches } from './build-inputs.ts'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cua-inputs-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  const git = (...args: string[]): void => { execFileSync('git', args, { cwd: root, stdio: 'pipe' }) }
  const files = {
    'package.json': JSON.stringify({ version: '1.0.0', packageManager: 'pnpm@11.28.5' }),
    'pnpm-lock.yaml': 'lockfileVersion: 9.0\n',
    'packages/experimental/cua-macos/native/Package.swift': '// swift package\n',
    'packages/experimental/cua-macos/native/Sources/Main.swift': 'print("one")\n',
    'packages/experimental/cua-macos/native/Info.plist': 'application identity',
    'scripts/cua-helper/payload.ts': 'build helper',
    'apps/desktop/scripts/notarize-macos.mjs': 'notarize helper',
    '.github/workflows/macos-intel-package.yml': 'build configuration',
    '.github/workflows/release-publish.yml': 'publish configuration',
    'packages/client/unrelated/src/index.ts': 'unrelated feature',
  }
  for (const [path, bytes] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), bytes)
  }
  git('init', '--quiet')
  git('add', '.')
  return { root, git, source: join(root, 'packages/experimental/cua-macos/native/Sources/Main.swift') }
}

function copyHelperScripts(root: string): void {
  const file = 'scripts/cua-helper/build-inputs.ts'
  mkdirSync(dirname(join(root, file)), { recursive: true })
  copyFileSync(resolve(file), join(root, file))
}

it('keeps identical source bytes across product versions and unrelated package edits', () => {
  const f = fixture()
  const before = cuaHelperSourceDigest(f.root)
  writeFileSync(join(f.root, 'package.json'), JSON.stringify({ version: '2.0.0', packageManager: 'pnpm@11.28.5' }))
  writeFileSync(join(f.root, 'packages/client/unrelated/src/index.ts'), 'another unrelated feature')
  utimesSync(f.source, new Date('2001-01-01'), new Date('2001-01-01'))
  expect(cuaHelperSourceDigest(f.root)).toBe(before)
  writeFileSync(f.source, readFileSync(f.source).toString().replace('one', 'two'))
  utimesSync(f.source, new Date('2001-01-01'), new Date('2001-01-01'))
  expect(cuaHelperSourceDigest(f.root)).not.toBe(before)
})

it.each(['add', 'delete', 'rename', 'resource', 'dependency', 'script', 'workflow', 'package manager'])(
  'invalidates %s changes', (change) => {
    const f = fixture()
    const before = cuaHelperSourceDigest(f.root)
    if (change === 'add') writeFileSync(join(dirname(f.source), 'Added.swift'), 'new source')
    if (change === 'delete') rmSync(f.source)
    if (change === 'rename') renameSync(f.source, join(dirname(f.source), 'Renamed.swift'))
    if (change === 'resource') writeFileSync(join(f.root, 'packages/experimental/cua-macos/native/Info.plist'), 'changed identity')
    if (change === 'dependency') writeFileSync(join(f.root, 'pnpm-lock.yaml'), 'changed dependency')
    if (change === 'script') writeFileSync(join(f.root, 'apps/desktop/scripts/notarize-macos.mjs'), 'changed notarization')
    if (change === 'workflow') writeFileSync(join(f.root, '.github/workflows/macos-intel-package.yml'), 'changed build configuration')
    if (change === 'package manager') writeFileSync(join(f.root, 'package.json'), JSON.stringify({ packageManager: 'pnpm@12.0.0' }))
    f.git('add', '-A')
    expect(cuaHelperSourceDigest(f.root)).not.toBe(before)
  },
)

it.skipIf(process.platform === 'win32')('includes executable mode and rejects source links', () => {
  const f = fixture()
  const before = cuaHelperSourceDigest(f.root)
  chmodSync(f.source, 0o755)
  expect(cuaHelperSourceDigest(f.root)).not.toBe(before)
  rmSync(f.source)
  symlinkSync(join(f.root, 'pnpm-lock.yaml'), f.source)
  expect(() => cuaHelperSourceDigest(f.root)).toThrow('regular file')
})

it('fails on missing required tracked build inputs', () => {
  const f = fixture()
  f.git('rm', '--cached', 'scripts/cua-helper/payload.ts')
  expect(() => cuaHelperSourceDigest(f.root)).toThrow('missing tracked build input')
})

it('loads fingerprinting under plain Node with no node_modules directory', () => {
  const f = fixture()
  copyHelperScripts(f.root)
  const output = execFileSync(process.execPath, ['--input-type=module', '-e',
    "const b = await import('./scripts/cua-helper/build-inputs.ts'); console.log(typeof b.cuaHelperSourceDigest)"],
  { cwd: f.root, encoding: 'utf8', timeout: 30_000, stdio: 'pipe' })
  expect(output.trim()).toBe('function')
})

const repository = 'deepseek-harness/deepseek-harness'

function producerSnapshot(root: string) {
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' })
  git('add', '-A')
  git('-c', `core.hooksPath=${join(root, 'no-hooks')}`, '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture',
    '-c', 'user.email=fixture@example.test', 'commit', '--quiet', '-m', 'fixture')
  const commit = git('rev-parse', 'HEAD').trim()
  const tree = git('ls-tree', '-r', '-z', 'HEAD').split('\0').filter(Boolean).map((entry) => {
    const [metadata, path] = entry.split('\t')
    const [mode, type, sha] = (metadata ?? '').split(' ')
    if (!path || !mode || !type || !sha) throw new Error('Invalid Git fixture tree entry')
    return { path, mode, type, sha }
  })
  const response = { truncated: false, tree }
  const responses: Record<string, unknown> = { [`repos/${repository}/git/trees/${commit}?recursive=1`]: response }
  for (const entry of tree.filter(entry => entry.path === 'package.json')) {
    const bytes = execFileSync('git', ['cat-file', 'blob', entry.sha], { cwd: root, stdio: 'pipe' })
    responses[`repos/${repository}/git/blobs/${entry.sha}`] = { sha: entry.sha, encoding: 'base64', content: bytes.toString('base64') }
  }
  return { commit, response, responses, api: async (path: string): Promise<unknown> => {
    if (!(path in responses)) throw new Error(`Unexpected GitHub fixture request ${path}`)
    return responses[path]
  } }
}

it('compares GitHub commit objects independently of artifact claims while allowing a root version bump', async () => {
  const f = fixture()
  const previous = producerSnapshot(f.root)
  expect(await cuaHelperSourceMatches(f.root, repository, previous.commit, previous.api)).toBe(true)
  writeFileSync(join(f.root, 'package.json'), JSON.stringify({ version: '2.0.0', packageManager: 'pnpm@11.28.5' }))
  writeFileSync(join(f.root, 'packages/client/unrelated/src/index.ts'), 'another unrelated feature')
  expect(await cuaHelperSourceMatches(f.root, repository, previous.commit, previous.api)).toBe(true)
  writeFileSync(f.source, 'changed native code')
  expect(await cuaHelperSourceMatches(f.root, repository, previous.commit, previous.api)).toBe(false)
})

it.each(['helper workflow', 'publish workflow', 'packaging script', 'manifest lifecycle', 'npm config', 'patch', 'tracked dependency', 'deleted file'])(
  'rejects independent producer source proof after a changed %s', async (change) => {
    const f = fixture()
    const previous = producerSnapshot(f.root)
    const digest = cuaHelperSourceDigest(f.root)
    if (change === 'helper workflow') writeFileSync(join(f.root, '.github/workflows/macos-intel-package.yml'), 'forged uploader')
    if (change === 'publish workflow') writeFileSync(join(f.root, '.github/workflows/release-publish.yml'), 'forged caller')
    if (change === 'packaging script') writeFileSync(join(f.root, 'scripts/cua-helper/payload.ts'), 'forged metadata')
    if (change === 'manifest lifecycle') writeFileSync(join(f.root, 'package.json'), JSON.stringify({
      version: '1.0.0', packageManager: 'pnpm@11.28.5', scripts: { postinstall: 'unexpected code' },
    }))
    if (change === 'npm config') writeFileSync(join(f.root, '.npmrc'), 'node-options=--require=./unexpected.cjs')
    if (change === 'patch') {
      mkdirSync(join(f.root, 'patches'))
      writeFileSync(join(f.root, 'patches/dependency.patch'), 'changed package code')
    }
    if (change === 'tracked dependency') {
      mkdirSync(join(f.root, 'apps/desktop/node_modules/unexpected'), { recursive: true })
      writeFileSync(join(f.root, 'apps/desktop/node_modules/unexpected/index.js'), 'unexpected dependency code')
      f.git('add', '--force', 'apps/desktop/node_modules')
    }
    if (change === 'deleted file') rmSync(f.source)
    f.git('add', '-A')
    expect(cuaHelperSourceDigest(f.root)).not.toBe(digest)
    expect(await cuaHelperSourceMatches(f.root, repository, previous.commit, previous.api)).toBe(false)
  },
)

it('stops source comparison when GitHub returns an incomplete tree', async () => {
  const f = fixture()
  const previous = producerSnapshot(f.root)
  previous.response.truncated = true
  await expect(cuaHelperSourceMatches(f.root, repository, previous.commit, previous.api)).rejects.toThrow('incomplete commit tree')
})

it('matches Git blobs when tracked attributes require CRLF checkout bytes', async () => {
  const f = fixture()
  const path = join(f.root, 'apps/desktop/scripts/fixture.cmd')
  writeFileSync(join(f.root, '.gitattributes'), '*.cmd text eol=crlf\n')
  writeFileSync(path, '@echo off\necho fixture\n')
  const previous = producerSnapshot(f.root)
  writeFileSync(path, '@echo off\r\necho fixture\r\n')
  expect(await cuaHelperSourceMatches(f.root, repository, previous.commit, previous.api)).toBe(true)
  writeFileSync(join(f.root, '.gitattributes'), '*.cmd text eol=lf\n')
  expect(await cuaHelperSourceMatches(f.root, repository, previous.commit, previous.api)).toBe(false)
})

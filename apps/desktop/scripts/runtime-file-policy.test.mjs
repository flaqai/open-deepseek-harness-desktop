import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pruneDesktopRuntime, removeExtraneousWorkspaceLinks } from './runtime-file-policy.mjs'

const target = { platform: 'darwin', arch: 'arm64' }

async function fixtureFile(root, path) {
  const destination = join(root, 'node_modules', path)
  await mkdir(join(destination, '..'), { recursive: true })
  await writeFile(destination, path)
}

async function fixturePackage(root, name, manifest = {}) {
  await fixtureFile(root, `${name}/package.json`)
  await writeFile(join(root, 'node_modules', name, 'package.json'), JSON.stringify({ name, ...manifest }))
}

test('desktop runtime omits source-only files and foreign native packages without removing runtime assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-runtime-policy-'))
  const modules = join(root, 'node_modules')
  try {
    await fixturePackage(root, 'example')
    for (const path of [
      'example/index.js', 'example/index.d.ts', 'example/index.js.map',
      'example/index.d.cts', 'example/index.d.mts', 'example/style.css.map',
      'example/build.tsbuildinfo', 'example/data.map', 'example/module.wasm',
      'example/LICENSE', 'example/NOTICE', 'example/test/runtime.json',
    ]) await fixtureFile(root, path)
    await fixturePackage(root, 'sherpa-onnx-darwin-x64', { os: ['darwin'], cpu: ['x64'] })
    await fixtureFile(root, 'sherpa-onnx-darwin-x64/native.node')
    await fixturePackage(root, 'sherpa-onnx-darwin-arm64', { os: ['darwin'], cpu: ['arm64'] })
    await fixtureFile(root, 'sherpa-onnx-darwin-arm64/native.node')
    await fixturePackage(root, '@deepseek-ai/libreoffice-kit-win32-x64')
    await fixtureFile(root, '@deepseek-ai/libreoffice-kit-win32-x64/prebuilds.json')
    await fixturePackage(root, '@deepseek-ai/libreoffice-kit-darwin-arm64')
    await fixtureFile(root, '@deepseek-ai/libreoffice-kit-darwin-arm64/prebuilds.json')
    await fixturePackage(root, '@mixmark-io/domino')
    await fixtureFile(root, '@mixmark-io/domino/test/fixture.html')
    await fixtureFile(root, '@mixmark-io/domino/lib/index.js')
    await fixturePackage(root, 'node-pty')
    await fixtureFile(root, 'node-pty/prebuilds/darwin-arm64/pty.node')
    await fixtureFile(root, 'node-pty/prebuilds/darwin-arm64/spawn-helper')
    await fixtureFile(root, 'node-pty/prebuilds/darwin-x64/pty.node')
    await fixtureFile(root, 'node-pty/prebuilds/darwin-arm64/pty.pdb')
    await fixtureFile(root, 'node-pty/third_party/conpty/OpenConsole.exe')
    await fixtureFile(root, '.modules.yaml')

    await pruneDesktopRuntime(modules, target, '@deepseek-ai/libreoffice-kit-darwin-arm64')

    for (const path of [
      'example/index.d.ts', 'example/index.d.cts', 'example/index.d.mts',
      'example/index.js.map', 'example/style.css.map', 'example/build.tsbuildinfo',
      'sherpa-onnx-darwin-x64', '@deepseek-ai/libreoffice-kit-win32-x64',
      '@mixmark-io/domino/test', 'node-pty/prebuilds/darwin-x64',
      'node-pty/prebuilds/darwin-arm64/pty.pdb', '.modules.yaml',
    ]) assert.equal(existsSync(join(modules, path)), false, path)
    for (const path of [
      'example/index.js', 'example/data.map', 'example/module.wasm',
      'example/LICENSE', 'example/NOTICE', 'example/test/runtime.json',
      'sherpa-onnx-darwin-arm64/native.node',
      '@deepseek-ai/libreoffice-kit-darwin-arm64/prebuilds.json',
      '@mixmark-io/domino/lib/index.js', 'node-pty/prebuilds/darwin-arm64/pty.node',
      'node-pty/prebuilds/darwin-arm64/spawn-helper',
      'node-pty/third_party/conpty/OpenConsole.exe',
    ]) assert.equal(typeof (await readFile(join(modules, path), 'utf8')), 'string', path)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('alpha2 worker, SSH helper, Python bootstrap and target native-loader resources survive pruning', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-alpha2-resources-'))
  const modules = join(root, 'node_modules')
  const resources = {
    '@deepseek-ai/dsh-ptc-runtime-node': ['lib/index.js', 'lib/process.js'],
    '@deepseek-ai/dsh-subprocess-local': ['lib/runner.js', 'lib/runner-launch-fixture.js'],
    '@deepseek-ai/dsh-ssh': ['lib/helper.js', 'lib/protocol-fixture.js', 'lib/stream-security-fixture.js'],
    '@deepseek-ai/dsh-experimental-ptc-runtime-python': ['py/bootstrap.py', 'py/protocol.py'],
    'node-addon-require-builtin-darwin-arm64': ['require_builtin.node'],
  }
  try {
    for (const [name, paths] of Object.entries(resources)) {
      await fixturePackage(root, name, name.endsWith('darwin-arm64') ? { os: ['darwin'], cpu: ['arm64'] } : {})
      for (const path of paths) await fixtureFile(root, `${name}/${path}`)
    }
    await pruneDesktopRuntime(modules, target, '@deepseek-ai/libreoffice-kit-darwin-arm64')
    for (const [name, paths] of Object.entries(resources)) {
      for (const path of paths) assert.equal(await readFile(join(modules, name, path), 'utf8'), `${name}/${path}`)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('desktop runtime respects negative OS and CPU manifest constraints in nested dependencies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-runtime-policy-'))
  const modules = join(root, 'node_modules')
  try {
    await fixturePackage(root, 'outer')
    await fixturePackage(root, 'outer/node_modules/foreign', { os: ['!darwin'] })
    await fixtureFile(root, 'outer/node_modules/foreign/index.js')
    await fixturePackage(root, 'outer/node_modules/native', { cpu: ['arm64', '!x64'] })
    await fixtureFile(root, 'outer/node_modules/native/index.js')
    await pruneDesktopRuntime(modules, target, '@deepseek-ai/libreoffice-kit-darwin-arm64')
    assert.equal(existsSync(join(modules, 'outer/node_modules/foreign')), false)
    assert.equal(existsSync(join(modules, 'outer/node_modules/native/index.js')), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('legacy deploy extraneous workspace links are unlinked without touching projects or production Python resources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-workspace-links-'))
  const modules = join(root, 'runtime/node_modules')
  const sdk = join(root, 'workspace/python/sdk-runtime')
  const python = join(root, 'workspace/ptc-python')
  try {
    await mkdir(modules, { recursive: true })
    await mkdir(sdk, { recursive: true })
    await writeFile(join(sdk, 'package.json'), '{"name":"dsh-python-runtime-closure"}')
    await mkdir(join(python, 'py'), { recursive: true })
    await writeFile(join(python, 'py/bootstrap.py'), 'bootstrap bytes')
    await symlink(sdk, join(modules, 'dsh-python-runtime-closure'), 'dir')
    await mkdir(join(modules, '@deepseek-ai'), { recursive: true })
    await symlink(sdk, join(modules, '@deepseek-ai/dsh'), 'dir')
    await symlink(python, join(modules, '@deepseek-ai/dsh-experimental-ptc-runtime-python'), 'dir')
    await symlink(sdk, join(modules, 'unknown-package'), 'dir')
    const count = await removeExtraneousWorkspaceLinks(modules,
      ['dsh-python-runtime-closure', '@deepseek-ai/dsh', '@deepseek-ai/dsh-experimental-ptc-runtime-python'],
      ['@deepseek-ai/dsh-experimental-ptc-runtime-python'])
    assert.equal(count, 2)
    assert.equal(existsSync(join(modules, 'dsh-python-runtime-closure')), false)
    assert.equal(existsSync(join(modules, '@deepseek-ai/dsh')), false)
    assert.equal(await readFile(join(sdk, 'package.json'), 'utf8'), '{"name":"dsh-python-runtime-closure"}')
    assert.equal(await readFile(join(modules, '@deepseek-ai/dsh-experimental-ptc-runtime-python/py/bootstrap.py'), 'utf8'), 'bootstrap bytes')
    assert.ok((await lstat(join(modules, 'unknown-package'))).isSymbolicLink())
  } finally { await rm(root, { recursive: true, force: true }) }
})

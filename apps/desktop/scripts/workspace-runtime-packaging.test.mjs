import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '../../..')
const read = path => readFile(join(root, path), 'utf8')

test('desktop installers embed Python and retain the target Office engine in the Harness closure', async () => {
  const builderConfigs = await Promise.all([
    'apps/desktop/electron-builder.yml',
    'apps/desktop/electron-builder.macos.yml',
    'apps/desktop/electron-builder.linux.yml',
  ].map(read))
  for (const config of builderConfigs) {
    assert.match(config, /- scripts\/primary-runtime-lock\.json/u)
    assert.match(config, /DeepSeek-Harness-workspace-runtime-/u)
    assert.match(config, /workspace-runtime\/workspace-runtime-/u)
    assert.doesNotMatch(config, /\.whl|python(?:3|\.exe)/iu)
  }

  const cli = JSON.parse(await read('apps/cli/package.json'))
  for (const name of [
    '@deepseek-ai/dsh-host-workspace-runtime',
    '@deepseek-ai/dsh-skill-office',
  ]) assert.equal(typeof cli.dependencies[name], 'string', `${name} must remain in the production closure`)
  assert.equal(cli.dependencies['@deepseek-ai/dsh-experimental-ptc-runtime-python'], undefined,
    'PTC must not enter the default CLI production closure')
  const desktopMain = await read('apps/desktop/src/main.ts')
  assert.match(desktopMain, /ensureWorkspacePtcPlugin\(context\.home, ptcVersion/u)
  assert.match(desktopMain, /kind: 'add', packageSpecs: \[packageSpec\]/u)

  assert.doesNotMatch(await read('apps/desktop-host/src/index.ts'), /primary-runtime|desktopOffice/u)

  const [unixRuntime, windowsRuntime, optionalRuntime] = await Promise.all([
    read('apps/desktop/scripts/prepare-unix-runtime.mjs'),
    read('apps/desktop/scripts/prepare-windows-runtime.mjs'),
    read('apps/desktop/scripts/prepare-workspace-runtime.ts'),
  ])
  for (const runtime of [unixRuntime, windowsRuntime]) {
    assert.match(runtime, /pruneDesktopRuntime\(/u)
    assert.match(runtime, /selectOfficeEngine/u)
    assert.match(runtime, /officePackageDirectories/u)
    assert.match(runtime, /verifyBundledOfficeIdentity/u)
    assert.match(runtime, /prebuilds\.json/u)
    assert.match(runtime, /document-conversion\.docx/u)
    assert.match(runtime, /'convert', '--input'/u)
    assert.match(runtime, /PATH: ''/u)
    assert.doesNotMatch(runtime, /optional LibreOffice engine remained in the installer runtime/u)
  }
  assert.match(unixRuntime, /const \[runtimePlatform, runtimeArch\] = target\.split\('-'\)/u)
  assert.match(unixRuntime, /platform: runtimePlatform, arch: runtimeArch/u)
  assert.doesNotMatch(unixRuntime, /pruneDesktopRuntime\([\s\S]*?platform: process\.platform, arch: process\.arch/u)
  assert.match(optionalRuntime, /officialOfficeArtifact/u)
  assert.doesNotMatch(optionalRuntime, /DeepSeek-Harness-office-runtime/u)
})

test('Python is built into each desktop target while Office metadata identifies its official npm source', async () => {
  const lock = JSON.parse(await read('apps/desktop/scripts/primary-runtime-lock.json'))
  assert.equal(lock.pythonVersion.startsWith('3.12.'), true)
  assert.deepEqual(Object.keys(lock.targets).sort(), ['linux-x64', 'mac-arm64', 'mac-x64', 'win-x64'])
  for (const name of [
    'numpy', 'pandas', 'Pillow', 'lxml', 'python-docx', 'python-pptx', 'openpyxl', 'XlsxWriter',
  ]) assert.equal(typeof lock.pythonPackages[name], 'string', `${name} must be locked`)

  const workflow = await read('.github/workflows/desktop-packages.yml')
  assert.match(workflow, /prepare-workspace-runtime\.ts win-x64/u)
  assert.doesNotMatch(workflow, /DeepSeek-Harness-office-runtime/u)
  assert.match(await read('apps/desktop/scripts/official-office-runtime.ts'), /registry\.npmjs\.org/u)
  await assert.rejects(read('.github/workflows/workspace-runtime-release.yml'), /ENOENT/u)
})

test('production Office consumers pin the signed catalog engine version exactly', async () => {
  const lock = await read('pnpm-lock.yaml')
  const resolved = /'@deepseek-ai\/libreoffice-kit':\s*\n\s*specifier: ([^\n]+)\s*\n\s*version: ([^\n]+)/u.exec(lock)
  assert.ok(resolved, 'Office kit must appear in the workspace lockfile')
  assert.equal(resolved[1], resolved[2], 'Office kit lockfile specifier must be exact')
  for (const path of [
    'packages/bundle/web-app/package.json',
    'packages/document/office-kit/package.json',
  ]) {
    const manifest = JSON.parse(await read(path))
    const declared = manifest.dependencies?.['@deepseek-ai/libreoffice-kit']
      ?? manifest.optionalDependencies?.['@deepseek-ai/libreoffice-kit']
      ?? manifest.devDependencies?.['@deepseek-ai/libreoffice-kit']
    assert.equal(declared, resolved[2], `${path} must pin the signed Office version`)
  }
  const skills = JSON.parse(await read('packages/skill/skill-office/package.json'))
  assert.equal(skills.dependencies?.['@deepseek-ai/libreoffice-kit'], undefined,
    'Office skills delegate rendering to the shared Office provider rather than loading a separate kit')
})

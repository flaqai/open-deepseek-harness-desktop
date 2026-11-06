/** Exercise pnpm production deployment of the optional-bundle -> provider closure. */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { expect, it } from 'vitest'

const repository = resolve(import.meta.dirname, '../../..')
const require = createRequire(resolve(repository, 'apps/desktop/package.json'))
const pnpm = resolve(dirname(require.resolve('pnpm')), 'bin/pnpm.mjs')

it('keeps hidden bundle dependencies resolvable from the deployed Harness anchor without dev dependencies', () => {
  const temporary = mkdtempSync(join(tmpdir(), '桌面 offline closure '))
  const workspace = join(temporary, 'source')
  const deployed = join(temporary, 'production')
  mkdirSync(workspace)
  const cli = JSON.parse(readFileSync(resolve(repository, 'apps/cli/package.json'), 'utf8')) as { version: string }
  const version = cli.version
  interface Manifest { name: string; version: string }
  const names = new Map<string, string>()
  function pkg(name: string, selectedVersion = version, extra: Record<string, unknown> = {}) {
    const directory = join(workspace, 'packages', String(names.size))
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ name, version: selectedVersion, files: ['dist', 'typescript', '*.node', '*.so', '*.md'], ...extra }))
    names.set(name, directory)
    return directory
  }
  function file(name: string, path: string) {
    const directory = names.get(name)
    if (directory === undefined) throw new Error('Missing fixture package')
    const target = join(directory, path)
    mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, 'offline fixture payload')
  }
  try {
    writeFileSync(join(workspace, 'package.json'), JSON.stringify({ name: 'offline-fixture', private: true, packageManager: 'pnpm@11.28.5' }))
    writeFileSync(join(workspace, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\nlinkWorkspacePackages: true\npreferWorkspacePackages: true\nsupportedArchitectures:\n  os: [darwin, win32, linux]\n  cpu: [arm64, x64]\n  libc: [glibc, musl]\n')
    const bundles = ['browser-use-bundle', 'computer-use-native-bundle']
    pkg('@deepseek-ai/dsh', version, { dependencies: Object.fromEntries(bundles.map(name => ['@deepseek-ai/dsh-' + name, 'workspace:*'])), devDependencies: { 'fixture-dev-only': 'workspace:*' } })
    pkg('fixture-dev-only')
    for (const name of bundles) {
      const manifest = JSON.parse(readFileSync(resolve(repository, `packages/experimental/${name}/package.json`), 'utf8')) as { name: string; dependencies: Record<string, string> }
      pkg(manifest.name, version, { dependencies: manifest.dependencies })
    }
    pkg('@deepseek-ai/dsh-browser-use'); pkg('@deepseek-ai/dsh-computer-use')
    // External binaries are inert local fixture packages, with explicit workspace
    // links to prevent registry access. Production resource identities are checked
    // separately by preinstalled-browser-providers/preinstalled-computer-use specs.
    for (const [name, dependency, externalVersion] of [
      ['browser-use-playwright-mcp', '@playwright/mcp', '0.0.80'],
      ['browser-use-chrome-devtools-mcp', 'chrome-devtools-mcp', '1.9.0'],
      ['computer-use-cua-driver-native', '@trycua/cua-driver', '0.28.0'],
    ] as const) {
      const manifest = JSON.parse(readFileSync(resolve(repository, `packages/experimental/${name}/package.json`), 'utf8')) as { name: string; dependencies: Record<string, string> }
      expect(manifest.dependencies[dependency]).toBe(externalVersion)
      pkg(manifest.name, version, { dependencies: { [dependency]: 'workspace:*' } })
    }
    pkg('@playwright/mcp', '0.0.80'); pkg('chrome-devtools-mcp', '1.9.0')
    pkg('@trycua/cua-driver', '0.28.0', { dependencies: { '@ubjs/node': 'workspace:*', '@ubjs/core': 'workspace:*' },
      optionalDependencies: { '@trycua/cua-driver-linux-x64-gnu': 'workspace:*' } })
    pkg('@trycua/cua-driver-linux-x64-gnu', '0.28.0'); pkg('@ubjs/node', '0.31.0-3'); pkg('@ubjs/core', '0.31.0-3')
    file('@trycua/cua-driver', 'dist/native/node-runtime.js'); file('@trycua/cua-driver', 'dist/native/cua_driver_sdk-ffi.js')
    file('@ubjs/node', 'typescript/dist/resolve-lib.js')
    for (const path of ['libcua_driver_sdk.so', 'cua_driver_node_runtime.node', 'node-runtime-NOTICE.md']) file('@trycua/cua-driver-linux-x64-gnu', path)
    const common = ['--config.node-linker=hoisted', '--config.auto-install-peers=false']
    const options = { cwd: workspace, timeout: 60_000, stdio: 'pipe' as const }
    execFileSync(process.execPath, [pnpm, 'install', '--offline', '--ignore-scripts', ...common], options)
    execFileSync(process.execPath, [pnpm, '--filter', '@deepseek-ai/dsh', 'deploy', '--prod', '--legacy', ...common, deployed], options)
    const deployedRequire = createRequire(join(deployed, 'package.json'))
    for (const [name, sourceDirectory] of names) {
      if (name === '@deepseek-ai/dsh' || name === 'fixture-dev-only') continue
      const actual = JSON.parse(readFileSync(deployedRequire.resolve(name + '/package.json'), 'utf8')) as Manifest
      const original = JSON.parse(readFileSync(join(sourceDirectory, 'package.json'), 'utf8')) as Manifest
      expect({ name: actual.name, version: actual.version }).toEqual({ name: original.name, version: original.version })
    }
    expect(() => deployedRequire.resolve('fixture-dev-only/package.json')).toThrow()
    rmSync(join(deployed, 'node_modules/@deepseek-ai/dsh-experimental-browser-use-playwright-mcp'), { recursive: true, force: true })
    expect(() => readFileSync(deployedRequire.resolve('@deepseek-ai/dsh-experimental-browser-use-playwright-mcp/package.json'), 'utf8')).toThrow()
  } finally { rmSync(temporary, { recursive: true, force: true }) }
}, 120_000)

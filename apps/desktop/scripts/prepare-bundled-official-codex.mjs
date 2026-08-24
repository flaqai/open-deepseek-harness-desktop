import { createHash } from 'node:crypto'
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { requiresWindowsCommandShell } from './windows-command-shell.mjs'

const PACKAGE_NAME = '@deepseek-ai/dsh-subagent-codex'
const VERSION = '0.1.0-rc.8'
const TARGET_PAYLOADS = {
  'darwin-arm64': '@openai/codex-darwin-arm64',
  'darwin-x64': '@openai/codex-darwin-x64',
  'win32-x64': '@openai/codex-win32-x64',
  'linux-x64': '@openai/codex-linux-x64',
}

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(desktopRoot, '..', '..')
const sourceDirectory = join(desktopRoot, 'bundled-plugins')
const outputDirectory = join(repositoryRoot, '.artifacts', 'desktop-bundled-plugins')
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function targetArgument() {
  const index = process.argv.indexOf('--target')
  if (index < 0 || process.argv[index + 1] === undefined) {
    throw new Error('desktop: prepare bundled Codex requires --target <platform-arch>')
  }
  return process.argv[index + 1]
}

function run(command, args, cwd, env = {}) {
  return new Promise((resolvePromise, reject) => {
    const needsCommandShell = requiresWindowsCommandShell(process.platform, command)
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: needsCommandShell,
    })
    const stdout = []
    const stderr = []
    child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)))
    child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)))
    child.on('error', reject)
    child.on('close', (code, signal) => {
      const output = Buffer.concat(stdout).toString('utf8')
      if (code === 0) return resolvePromise(output)
      reject(new Error(`${command} ${args.join(' ')} failed (${String(code)}, ${String(signal)}): ${Buffer.concat(stderr).toString('utf8').slice(-4000)}`))
    })
  })
}

async function packageDirectory(nodeModules, name) {
  const path = join(nodeModules, ...name.split('/'))
  await readFile(join(path, 'package.json'), 'utf8')
  return path
}

async function collectDependencyClosure(nodeModules, roots) {
  const pending = [...roots]
  const packages = new Map()
  while (pending.length > 0) {
    const name = pending.pop()
    if (name === undefined || packages.has(name)) continue
    let path
    try {
      path = await packageDirectory(nodeModules, name)
    } catch {
      continue
    }
    const manifest = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'))
    packages.set(name, path)
    pending.push(...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.optionalDependencies ?? {}))
  }
  return packages
}

async function packedArchive(directory) {
  const files = (await readdir(directory)).filter(file => file.endsWith('.tgz'))
  if (files.length !== 1) throw new Error(`desktop: expected one packed archive in ${directory}`)
  return join(directory, files[0])
}

async function main() {
  const target = targetArgument()
  const payload = TARGET_PAYLOADS[target]
  if (payload === undefined) throw new Error(`desktop: unsupported Codex bundle target ${target}`)
  const [platform, arch] = target.split('-')
  const temp = await mkdtemp(join(tmpdir(), 'dsh-official-codex-bundle-'))
  try {
    await rm(outputDirectory, { recursive: true, force: true })
    await mkdir(dirname(outputDirectory), { recursive: true })
    await cp(sourceDirectory, outputDirectory, { recursive: true })

    const sourcePack = join(temp, 'source-pack')
    await mkdir(sourcePack)
    await run(pnpmCommand, [
      '--config.verifyDepsBeforeRun=false', '--filter', PACKAGE_NAME,
      'pack', '--pack-destination', sourcePack,
    ], repositoryRoot)
    const sourceArchive = await packedArchive(sourcePack)

    const installRoot = join(temp, 'install')
    await mkdir(installRoot)
    await writeFile(join(installRoot, 'package.json'), `${JSON.stringify({
      private: true,
      dependencies: { [PACKAGE_NAME]: `file:${sourceArchive}` },
    }, null, 2)}\n`)
    await run(npmCommand, [
      'install', '--ignore-scripts', '--omit=dev', '--legacy-peer-deps', '--no-audit', '--no-fund',
    ], installRoot, {
      npm_config_cache: join(temp, 'npm-cache'),
      npm_config_registry: process.env.npm_config_registry ?? 'https://registry.npmjs.org',
      // npm's cross-platform selectors are named `os` and `cpu`. The
      // `platform`/`arch` aliases are not honored by npm install, which made an
      // Intel package prepared on Apple Silicon silently select the arm64
      // optional payload and fail the closure check below.
      npm_config_os: platform,
      npm_config_cpu: arch,
    })

    const nodeModules = join(installRoot, 'node_modules')
    const connectorPath = await packageDirectory(nodeModules, PACKAGE_NAME)
    const stage = join(temp, 'stage')
    await cp(connectorPath, stage, { recursive: true, dereference: true })
    const connectorManifest = JSON.parse(await readFile(join(stage, 'package.json'), 'utf8'))
    const closure = await collectDependencyClosure(nodeModules, [
      ...Object.keys(connectorManifest.dependencies ?? {}), payload,
    ])
    if (!closure.has('@openai/codex') || !closure.has(payload)) {
      throw new Error(`desktop: Codex dependency closure is missing @openai/codex or ${payload}`)
    }
    for (const [name, path] of closure) {
      await cp(path, join(stage, 'node_modules', ...name.split('/')), { recursive: true, dereference: true })
    }
    connectorManifest.bundledDependencies = [...closure.keys()].sort()
    await writeFile(join(stage, 'package.json'), `${JSON.stringify(connectorManifest, null, 2)}\n`)

    const packed = join(temp, 'packed')
    await mkdir(packed)
    await run(npmCommand, ['pack', '--pack-destination', packed], stage, {
      npm_config_cache: join(temp, 'npm-cache'),
    })
    const archive = `deepseek-ai-dsh-subagent-codex-${VERSION}-${target}.tgz`
    const archivePath = join(outputDirectory, archive)
    // Windows runner temp and checkout paths can be on different volumes.
    await copyFile(await packedArchive(packed), archivePath)
    const bytes = await readFile(archivePath)
    const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
    const manifestPath = join(outputDirectory, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.plugins = manifest.plugins.filter(plugin => plugin.seedId !== 'deepseek-ai-dsh-subagent-codex')
    manifest.plugins.push({
      seedId: 'deepseek-ai-dsh-subagent-codex',
      packageName: PACKAGE_NAME,
      version: VERSION,
      profile: 'web',
      installPolicy: 'manual',
      archive,
      integrity,
    })
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    process.stdout.write(`Prepared ${basename(archivePath)} with ${payload}\n`)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

await main()

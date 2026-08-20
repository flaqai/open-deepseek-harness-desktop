/** Prepare a self-contained Windows x64 Harness production runtime. */

import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
const repositoryRoot = resolve(desktopRoot, '../..')
const outputRoot = join(repositoryRoot, '.artifacts', 'desktop-runtime-win-x64')
const harnessRoot = join(outputRoot, 'harness')
const runtimeRoot = join(outputRoot, 'runtime', 'win32-x64')
const downloads = join(repositoryRoot, '.artifacts', 'downloads')
const nodeVersion = '24.11.1'
const pnpmVersion = '11.7.0'
const nodeArchiveName = `node-v${nodeVersion}-win-x64.zip`
const nodeArchiveSha256 = '5355ae6d7c49eddcfde7d34ac3486820600a831bf81dc3bdca5c8db6a9bb0e76'
const nodeArchive = join(downloads, nodeArchiveName)
const nodeExecutable = join(runtimeRoot, 'node.exe')
const pnpmCommand = join(runtimeRoot, 'pnpm.cmd')
const desktopRequire = createRequire(join(desktopRoot, 'package.json'))
const pnpmManifestPath = desktopRequire.resolve('pnpm')
const pnpmEntry = join(dirname(pnpmManifestPath), 'bin', 'pnpm.mjs')
const stagedPnpmEntry = join(runtimeRoot, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error(`prepare-windows-runtime: requires Windows x64, received ${process.platform}-${process.arch}`)
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repositoryRoot,
      env: options.env ?? process.env,
      stdio: options.stdio ?? 'inherit',
      windowsHide: true,
      shell: options.shell ?? false,
    })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${command} failed with code ${String(code)} signal ${String(signal)}`))
    })
  })
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function ensureNodeArchive() {
  await mkdir(downloads, { recursive: true })
  if (existsSync(nodeArchive) && await sha256(nodeArchive) === nodeArchiveSha256) return
  await rm(nodeArchive, { force: true })
  const url = `https://nodejs.org/dist/v${nodeVersion}/${nodeArchiveName}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`prepare-windows-runtime: failed to download ${url}: HTTP ${response.status}`)
  const data = Buffer.from(await response.arrayBuffer())
  const actual = createHash('sha256').update(data).digest('hex')
  if (actual !== nodeArchiveSha256) {
    throw new Error(`prepare-windows-runtime: Node archive checksum mismatch: expected ${nodeArchiveSha256}, received ${actual}`)
  }
  await writeFile(nodeArchive, data)
}

async function stageNodeRuntime() {
  await ensureNodeArchive()
  const extractedRoot = join(outputRoot, 'node-extract')
  await mkdir(extractedRoot, { recursive: true })
  await run('tar', ['-xf', nodeArchive, '-C', extractedRoot])
  await mkdir(dirname(runtimeRoot), { recursive: true })
  await rename(join(extractedRoot, `node-v${nodeVersion}-win-x64`), runtimeRoot)
  await rm(extractedRoot, { recursive: true, force: true })
  await rm(join(runtimeRoot, 'node_modules', 'npm'), { recursive: true, force: true })
  for (const name of ['npm', 'npm.cmd', 'npx', 'npx.cmd']) await rm(join(runtimeRoot, name), { force: true })
}

async function firstSymlink(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink()) return path
    if (metadata.isDirectory()) {
      const nested = await firstSymlink(path)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

async function materializeLinks() {
  const nodeModules = join(harnessRoot, 'node_modules')
  let link = await firstSymlink(nodeModules)
  while (link !== undefined) {
    const segments = relative(nodeModules, link).split(sep)
    const binIndex = segments.lastIndexOf('.bin')
    if (binIndex >= 0) {
      const binRoot = join(nodeModules, ...segments.slice(0, binIndex + 1))
      if ((await lstat(binRoot)).isSymbolicLink()) await unlink(binRoot)
      else await rm(binRoot, { recursive: true, force: true })
    } else {
      const source = await realpath(link)
      await unlink(link)
      await mkdir(dirname(link), { recursive: true })
      await cp(source, link, { recursive: true, dereference: true })
    }
    link = await firstSymlink(nodeModules)
  }
  const binRoot = join(nodeModules, '.bin')
  if (existsSync(binRoot)) {
    if ((await lstat(binRoot)).isSymbolicLink()) await unlink(binRoot)
    else await rm(binRoot, { recursive: true, force: true })
  }
}

async function indexWorkspacePackages(directory, packages, depth = 0) {
  if (depth > 4) return
  const manifestPath = join(directory, 'package.json')
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (typeof manifest.name === 'string') packages.set(manifest.name, { directory, manifest })
  }
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || ['.artifacts', '.git', 'lib', 'node_modules'].includes(entry.name)) continue
    await indexWorkspacePackages(join(directory, entry.name), packages, depth + 1)
  }
}

function workspaceDependencies(manifest, packages) {
  const names = new Set()
  for (const dependencies of [manifest.dependencies, manifest.optionalDependencies, manifest.peerDependencies]) {
    if (dependencies === undefined) continue
    for (const name of Object.keys(dependencies)) {
      if (packages.has(name)) names.add(name)
    }
  }
  return names
}

async function injectWorkspaceClosure() {
  const packages = new Map()
  await indexWorkspacePackages(repositoryRoot, packages)
  const rootManifest = JSON.parse(await readFile(join(repositoryRoot, 'apps', 'cli', 'package.json'), 'utf8'))
  const queue = [...workspaceDependencies(rootManifest, packages)]
  const injected = new Set()
  while (queue.length > 0) {
    const name = queue.shift()
    if (name === undefined || injected.has(name)) continue
    const project = packages.get(name)
    if (project === undefined) continue
    injected.add(name)
    for (const dependency of workspaceDependencies(project.manifest, packages)) queue.push(dependency)
    const destination = join(harnessRoot, 'node_modules', ...name.split('/'))
    await rm(destination, { recursive: true, force: true })
    await cp(project.directory, destination, {
      recursive: true,
      dereference: true,
      filter: path => !relative(project.directory, path).split(sep).includes('node_modules'),
    })
  }
  console.log(`prepare-windows-runtime: injected ${injected.size} workspace packages`)
}

async function injectVendoredDependencies() {
  const vendorRoot = join(repositoryRoot, 'vendor')
  for (const entry of await readdir(vendorRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const source = join(vendorRoot, entry.name)
    const manifestPath = join(source, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (typeof manifest.name !== 'string' || !manifest.name.startsWith('@deepseek-ai/')) continue
    const destination = join(harnessRoot, 'node_modules', ...manifest.name.split('/'))
    await rm(destination, { recursive: true, force: true })
    await cp(source, destination, {
      recursive: true,
      dereference: true,
      filter: path => !relative(source, path).split(sep).includes('node_modules'),
    })
  }
}

async function pruneForeignNativePackages() {
  const packageGroups = [
    { directory: join(harnessRoot, 'node_modules', '@koromix'), keep: new Set(['koffi-win32-x64']) },
    { directory: join(harnessRoot, 'node_modules', '@img'), keep: new Set(['colour', 'sharp-libvips-win32-x64', 'sharp-win32-x64']) },
  ]
  for (const group of packageGroups) {
    if (!existsSync(group.directory)) continue
    for (const entry of await readdir(group.directory, { withFileTypes: true })) {
      if (entry.isDirectory() && !group.keep.has(entry.name)) {
        await rm(join(group.directory, entry.name), { recursive: true, force: true })
      }
    }
  }
  const nodeModules = join(harnessRoot, 'node_modules')
  for (const entry of await readdir(nodeModules, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('node-addon-require-builtin-') && entry.name !== 'node-addon-require-builtin-win32-x64-msvc') {
      await rm(join(nodeModules, entry.name), { recursive: true, force: true })
    }
  }
  const nodePtyPrebuilds = join(nodeModules, 'node-pty', 'prebuilds')
  if (existsSync(nodePtyPrebuilds)) {
    for (const entry of await readdir(nodePtyPrebuilds, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== 'win32-x64') {
        await rm(join(nodePtyPrebuilds, entry.name), { recursive: true, force: true })
      }
    }
  }
}

async function stagePackageManager() {
  const pnpmManifest = JSON.parse(await readFile(pnpmManifestPath, 'utf8'))
  if (pnpmManifest.version !== pnpmVersion) {
    throw new Error(`prepare-windows-runtime: expected pnpm ${pnpmVersion}, received ${String(pnpmManifest.version)}`)
  }
  const source = dirname(pnpmManifestPath)
  const destination = join(runtimeRoot, 'node_modules', 'pnpm')
  await cp(source, destination, {
    recursive: true,
    dereference: true,
    filter: path => !relative(source, path).split(sep).includes('node_modules'),
  })
  await writeFile(pnpmCommand, '@echo off\r\n"%~dp0node.exe" "%~dp0node_modules\\pnpm\\bin\\pnpm.mjs" %*\r\n')
}

async function smokeHarness() {
  const entry = join(harnessRoot, 'lib', 'bin.js')
  const smokeHome = join(outputRoot, 'smoke-home')
  try {
    await new Promise((resolvePromise, reject) => {
      const child = spawn(nodeExecutable, [entry, 'web', '--host', '127.0.0.1', '--port', '0'], {
        cwd: harnessRoot,
        env: {
          ...process.env,
          DSH_HOME: smokeHome,
          DSH_PNPM_BIN: stagedPnpmEntry,
          PATH: `${runtimeRoot};${process.env.PATH ?? ''}`,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      let output = ''
      let ready = false
      let failure
      const accept = (chunk) => {
        output += chunk.toString('utf8')
        if (!ready && /^dsh web: http:\/\/127\.0\.0\.1:\d+$/mu.test(output)) {
          ready = true
          child.kill()
        }
      }
      child.stdout.on('data', accept)
      child.stderr.on('data', accept)
      child.once('error', (error) => {
        failure = error
      })
      child.once('close', (code, signal) => {
        clearTimeout(timeout)
        if (ready) resolvePromise()
        else reject(failure ?? new Error(`prepare-windows-runtime: Harness smoke exited before readiness (${String(code)}, ${String(signal)}): ${output.slice(-4000)}`))
      })
      const timeout = setTimeout(() => {
        failure = new Error(`prepare-windows-runtime: Harness smoke timed out: ${output.slice(-4000)}`)
        child.kill()
      }, 45_000)
    })
  } finally {
    await rm(smokeHome, { recursive: true, force: true })
  }
}

async function smokeBundledPlugins() {
  const entry = join(harnessRoot, 'lib', 'bin.js')
  const smokeHome = join(outputRoot, 'plugin-smoke-home')
  const bundledDirectory = join(desktopRoot, 'bundled-plugins')
  const manifest = JSON.parse(await readFile(join(bundledDirectory, 'manifest.json'), 'utf8'))
  try {
    for (const plugin of manifest.plugins) {
      await run(nodeExecutable, [
        entry,
        'plugin', '--profile', plugin.profile,
        'add', '--save-exact', join(bundledDirectory, plugin.archive),
      ], {
        env: {
          ...process.env,
          DSH_HOME: smokeHome,
          DSH_PNPM_BIN: stagedPnpmEntry,
          PATH: `${runtimeRoot};${process.env.PATH ?? ''}`,
        },
      })
    }
  } finally {
    await rm(smokeHome, { recursive: true, force: true })
  }
}

async function verifyRuntime() {
  const entry = join(harnessRoot, 'lib', 'bin.js')
  if (!existsSync(entry)) throw new Error(`prepare-windows-runtime: missing ${entry}`)
  const require = createRequire(entry)
  for (const packagePath of [
    '@koromix/koffi-win32-x64',
    '@img/sharp-win32-x64/sharp.node',
    'node-addon-require-builtin-win32-x64-msvc',
    '@deepseek-ai/dsh-scope',
    '@deepseek-ai/dsh-web-frontend/dist/index.html',
  ]) require.resolve(packagePath)
  for (const path of [nodeExecutable, pnpmCommand, stagedPnpmEntry]) {
    if (!existsSync(path)) throw new Error(`prepare-windows-runtime: missing ${path}`)
  }
  const remainingLink = await firstSymlink(outputRoot)
  if (remainingLink !== undefined) throw new Error(`prepare-windows-runtime: retained symlink ${remainingLink}`)
  for (const secretName of ['.env', 'auth.json']) {
    if (existsSync(join(harnessRoot, secretName))) throw new Error(`prepare-windows-runtime: contains forbidden ${secretName}`)
  }
  await run(nodeExecutable, ['--version'])
  await run(nodeExecutable, [stagedPnpmEntry, '--version'])
  await smokeBundledPlugins()
  await smokeHarness()
  const manifest = JSON.parse(await readFile(join(harnessRoot, 'package.json'), 'utf8'))
  await writeFile(join(outputRoot, '.desktop-runtime-v4'), `${manifest.name}@${manifest.version}\ntarget=win32-x64\nnode@${nodeVersion}\npnpm@${pnpmVersion}\n`)
  console.log(`prepare-windows-runtime: verified ${manifest.name}@${manifest.version} with Node ${nodeVersion} and pnpm ${pnpmVersion}`)
}

if (outputRoot === repositoryRoot || repositoryRoot.startsWith(outputRoot + sep)) {
  throw new Error(`prepare-windows-runtime: refusing to clear unsafe path ${outputRoot}`)
}
await rm(outputRoot, { recursive: true, force: true })
await mkdir(outputRoot, { recursive: true })
await run(process.execPath, [
  pnpmEntry,
  '--filter',
  '@deepseek-ai/dsh',
  'deploy',
  '--prod',
  '--legacy',
  '--config.node-linker=hoisted',
  '--config.auto-install-peers=false',
  '--config.link-workspace-packages=true',
  harnessRoot,
])
await materializeLinks()
await injectWorkspaceClosure()
await injectVendoredDependencies()
await pruneForeignNativePackages()
await stageNodeRuntime()
await stagePackageManager()
await verifyRuntime()

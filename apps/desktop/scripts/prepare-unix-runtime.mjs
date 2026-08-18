/** Prepare a self-contained macOS or Linux Harness production runtime archive. */

import { chmod, cp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, delimiter, dirname, join, relative, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
const repositoryRoot = resolve(desktopRoot, '../..')
const target = `${process.platform}-${process.arch}`
const targets = {
  'darwin-arm64': {
    nodeSha256: 'b05aa3a66efe680023f930bd5af3fdbbd542794da5644ca2ad711d68cbd4dc35',
    nativePackages: [
      '@koromix/koffi-darwin-arm64',
      '@img/sharp-darwin-arm64/sharp.node',
      'node-addon-require-builtin-darwin-arm64',
    ],
  },
  'darwin-x64': {
    nodeSha256: '096081b6d6fcdd3f5ba0f5f1d44a47e83037ad2e78eada26671c252fe64dd111',
    nativePackages: [
      '@koromix/koffi-darwin-x64',
      '@img/sharp-darwin-x64/sharp.node',
      'node-addon-require-builtin-darwin-x64',
    ],
  },
  'linux-x64': {
    nodeSha256: '58a5ff5cc8f2200e458bea22e329d5c1994aa1b111d499ca46ec2411d58239ca',
    nativePackages: [
      '@koromix/koffi-linux-x64',
      '@img/sharp-linux-x64/sharp.node',
      'node-addon-require-builtin-linux-x64-gnu',
    ],
  },
}
const targetConfig = targets[target]
if (targetConfig === undefined) {
  throw new Error(`prepare-unix-runtime: unsupported native target ${target}`)
}
const runtimeName = `desktop-runtime-${target}`
const staging = join(repositoryRoot, '.artifacts', runtimeName)
const archive = join(repositoryRoot, '.artifacts', `${runtimeName}.tar.gz`)
const runtimeMarker = '.desktop-runtime-v3'
const nodeVersion = '24.11.1'
const pnpmVersion = '11.7.0'
const nodeArchiveName = `node-v${nodeVersion}-${target}.tar.gz`
const nodeArchiveSha256 = targetConfig.nodeSha256
const downloads = join(repositoryRoot, '.artifacts', 'downloads')
const nodeArchive = join(downloads, nodeArchiveName)

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: repositoryRoot, env: process.env, stdio: 'inherit' })
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
  if (!response.ok) throw new Error(`prepare-unix-runtime: failed to download ${url}: HTTP ${response.status}`)
  const data = Buffer.from(await response.arrayBuffer())
  const actual = createHash('sha256').update(data).digest('hex')
  if (actual !== nodeArchiveSha256) {
    throw new Error(`prepare-unix-runtime: Node archive checksum mismatch: expected ${nodeArchiveSha256}, received ${actual}`)
  }
  await writeFile(nodeArchive, data)
}

async function stagePackageRuntime() {
  await ensureNodeArchive()
  const packageRuntime = join(staging, 'package-runtime')
  await mkdir(packageRuntime, { recursive: true })
  await run('tar', ['-xzf', nodeArchive, '-C', packageRuntime, '--strip-components', '1'])

  const desktopRequire = createRequire(join(desktopRoot, 'package.json'))
  const pnpmManifestPath = desktopRequire.resolve('pnpm')
  const pnpmManifest = JSON.parse(await readFile(pnpmManifestPath, 'utf8'))
  if (pnpmManifest.version !== pnpmVersion) {
    throw new Error(`prepare-unix-runtime: expected pnpm ${pnpmVersion}, received ${String(pnpmManifest.version)}`)
  }
  const pnpmDestination = join(packageRuntime, 'lib', 'node_modules', 'pnpm')
  await cp(dirname(pnpmManifestPath), pnpmDestination, {
    recursive: true,
    dereference: true,
    filter: path => !relative(dirname(pnpmManifestPath), path).split(sep).includes('node_modules'),
  })
  const pnpmEntry = join(pnpmDestination, 'bin', 'pnpm.mjs')
  await chmod(pnpmEntry, 0o755)
  await symlink('../lib/node_modules/pnpm/bin/pnpm.mjs', join(packageRuntime, 'bin', 'pnpm'))

  const runtimeEnvironment = {
    ...process.env,
    PATH: `${join(packageRuntime, 'bin')}${delimiter}${process.env.PATH ?? ''}`,
  }
  await new Promise((resolvePromise, reject) => {
    const child = spawn(join(packageRuntime, 'bin', 'pnpm'), ['--version'], {
      cwd: staging,
      env: runtimeEnvironment,
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`embedded pnpm failed with code ${String(code)} signal ${String(signal)}`))
    })
  })
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
    const destination = join(staging, 'node_modules', ...name.split('/'))
    await rm(destination, { recursive: true, force: true })
    await cp(project.directory, destination, {
      recursive: true,
      dereference: true,
      filter: path => !relative(project.directory, path).split(sep).includes('node_modules'),
    })
  }
  console.log(`prepare-unix-runtime: injected ${injected.size} workspace packages`)
}

async function verifyRuntime() {
  const entry = join(staging, 'lib', 'bin.js')
  if (!existsSync(entry)) throw new Error(`desktop package runtime is missing ${entry}`)
  const require = createRequire(entry)
  for (const packagePath of [
    ...targetConfig.nativePackages,
    '@deepseek-ai/cosmokit',
    '@deepseek-ai/cordis-plugin-group',
    '@deepseek-ai/dsh-web-frontend/dist/index.html',
  ]) require.resolve(packagePath)
  for (const secretName of ['.env', 'auth.json']) {
    if (existsSync(join(staging, secretName))) throw new Error(`desktop package runtime contains forbidden ${secretName}`)
  }
  const manifest = JSON.parse(await readFile(join(staging, 'package.json'), 'utf8'))
  for (const runtimePath of [
    join(staging, 'package-runtime', 'bin', 'node'),
    join(staging, 'package-runtime', 'bin', 'pnpm'),
  ]) {
    if (!existsSync(runtimePath)) throw new Error(`desktop package runtime is missing ${runtimePath}`)
  }
  await writeFile(
    join(staging, runtimeMarker),
    `${manifest.name}@${manifest.version}\ntarget=${target}\nnode@${nodeVersion}\npnpm@${pnpmVersion}\n`,
  )
  console.log(`prepare-unix-runtime: verified ${manifest.name}@${manifest.version} for ${target} in ${staging}`)
}

if (staging === repositoryRoot || repositoryRoot.startsWith(staging + sep)) {
  throw new Error(`refusing to clear unsafe runtime staging path ${staging}`)
}
await rm(staging, { recursive: true, force: true })
await rm(archive, { force: true })
await run('pnpm', [
  '--filter',
  '@deepseek-ai/dsh',
  'deploy',
  '--prod',
  '--legacy',
  '--config.node-linker=hoisted',
  '--config.auto-install-peers=false',
  staging,
])
await injectWorkspaceClosure()
await stagePackageRuntime()
await verifyRuntime()
await run('tar', ['-czf', archive, '-C', dirname(staging), basename(staging)])
console.log(`prepare-unix-runtime: wrote ${archive}`)

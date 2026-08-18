/** Prepare a symlink-free Windows x64 Harness production dependency closure. */

import { cp, lstat, mkdir, readFile, readdir, realpath, rename, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
const repositoryRoot = resolve(desktopRoot, '../..')
const staging = join(repositoryRoot, '.artifacts', 'desktop-runtime-win-x64')
const desktopRequire = createRequire(join(desktopRoot, 'package.json'))
const pnpmManifestPath = desktopRequire.resolve('pnpm')
const pnpmEntry = join(dirname(pnpmManifestPath), 'bin', 'pnpm.mjs')

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${command} failed with code ${String(code)} signal ${String(signal)}`))
    })
  })
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
  const nodeModules = join(staging, 'node_modules')
  let link = await firstSymlink(nodeModules)
  while (link !== undefined) {
    const segments = relative(nodeModules, link).split(sep)
    const binIndex = segments.lastIndexOf('.bin')
    if (binIndex >= 0) {
      await rm(join(nodeModules, ...segments.slice(0, binIndex + 1)), { recursive: true, force: true })
    } else {
      const source = await realpath(link)
      await rm(link, { recursive: true, force: true })
      await mkdir(dirname(link), { recursive: true })
      await cp(source, link, {
        recursive: true,
        dereference: true,
      })
    }
    link = await firstSymlink(nodeModules)
  }
}

async function injectVendoredDependencies() {
  // pnpm's legacy deploy omits indirect workspace dependencies of vendored
  // Cordis packages. Ship every built vendor package at the runtime root.
  const vendorRoot = join(repositoryRoot, 'vendor')
  for (const entry of await readdir(vendorRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const source = join(vendorRoot, entry.name)
    const manifestPath = join(source, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (typeof manifest.name !== 'string' || !manifest.name.startsWith('@deepseek-ai/')) continue
    const destination = join(staging, 'node_modules', manifest.name)
    await rm(destination, { recursive: true, force: true })
    await cp(source, destination, {
      recursive: true,
      dereference: true,
      filter: path => !relative(source, path).split(sep).includes('node_modules'),
    })
  }
}

async function injectPackageManager() {
  const source = dirname(pnpmManifestPath)
  await cp(source, join(staging, 'node_modules', 'pnpm'), {
    recursive: true,
    dereference: true,
  })
}

async function verifyRuntime() {
  const entry = join(staging, 'lib', 'bin.js')
  if (!existsSync(entry)) throw new Error(`desktop package runtime is missing ${entry}`)
  const require = createRequire(entry)
  const requiredPackages = [
    '@koromix/koffi-win32-x64',
    '@img/sharp-win32-x64/sharp.node',
    'node-addon-require-builtin-win32-x64-msvc',
  ]
  for (const packagePath of requiredPackages) require.resolve(packagePath)
  require.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html')
  if (!existsSync(join(staging, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'))) {
    throw new Error('desktop package runtime is missing embedded pnpm')
  }
  const remainingLink = await firstSymlink(staging)
  if (remainingLink !== undefined) throw new Error(`desktop package runtime retains symlink ${remainingLink}`)
  for (const secretName of ['.env', 'auth.json']) {
    if (existsSync(join(staging, secretName))) throw new Error(`desktop package runtime contains forbidden ${secretName}`)
  }
  const manifest = JSON.parse(await readFile(join(staging, 'package.json'), 'utf8'))
  console.log(`prepare-windows-runtime: verified ${manifest.name}@${manifest.version} in ${staging}`)
}

if (staging === repositoryRoot || repositoryRoot.startsWith(staging + sep)) {
  throw new Error(`refusing to clear unsafe runtime staging path ${staging}`)
}
await rm(staging, { recursive: true, force: true })
await run(process.execPath, [
  pnpmEntry,
  '--filter',
  '@deepseek-ai/dsh',
  'deploy',
  '--prod',
  '--legacy',
  '--config.node-linker=hoisted',
  '--config.auto-install-peers=false',
  staging,
])
await materializeLinks()
await injectVendoredDependencies()
await injectPackageManager()
await verifyRuntime()
// electron-builder intentionally excludes directories named node_modules from
// extraResources. Keep this bundled production closure under a neutral name;
// the packaged launcher exposes it through NODE_PATH at runtime.
await rename(join(staging, 'node_modules'), join(staging, 'runtime-dependencies'))
if (!existsSync(join(staging, 'runtime-dependencies'))) {
  throw new Error(`desktop package runtime is missing runtime-dependencies in ${staging}`)
}

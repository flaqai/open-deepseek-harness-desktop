/** Verify offline browser connectors without importing or starting their services. */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, sep } from 'node:path'

/** Desktop-carried providers; their Profile bundles remain opt-in. */
export const PREINSTALLED_BROWSER_PROVIDERS = [
  '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp',
  '@deepseek-ai/dsh-experimental-browser-use-chrome-devtools-mcp',
]

function manifest(anchor, name, root) {
  for (const directory of createRequire(anchor).resolve.paths(name) ?? []) {
    const path = join(directory, name, 'package.json')
    const location = relative(root, path)
    if (location === '..' || location.startsWith(`..${sep}`)) continue
    if (existsSync(path)) {
      const value = JSON.parse(readFileSync(path, 'utf8'))
      if (value.name !== name) throw new Error(`browser preinstall: wrong package identity at ${path}`)
      return { path, value }
    }
  }
  throw new Error(`browser preinstall: missing offline dependency ${name}`)
}

/**
 * Check exact provider and external dependency identities, and reject bundled browser executables.
 * @param {string} root Expanded Harness package root after production deployment and pruning.
 * @returns {void} Returns after offline dependencies and the browser-free resource policy pass.
 */
export function verifyPreinstalledBrowserProviders(root) {
  const anchor = join(root, 'package.json')
  const version = JSON.parse(readFileSync(anchor, 'utf8')).version
  const bundle = manifest(anchor, '@deepseek-ai/dsh-browser-use-bundle', root)
  if (bundle.value.version !== version) throw new Error('browser preinstall: optional bundle does not match Harness')
  manifest(anchor, '@deepseek-ai/dsh-browser-use', root)
  const providers = [
    [PREINSTALLED_BROWSER_PROVIDERS[0], '@playwright/mcp'],
    [PREINSTALLED_BROWSER_PROVIDERS[1], 'chrome-devtools-mcp'],
  ]
  for (const [name, dependency] of providers) {
    const provider = manifest(anchor, name, root)
    if (provider.value.version !== version) throw new Error(`browser preinstall: ${name} does not match Harness ${version}`)
    const installed = manifest(provider.path, dependency, root)
    if (installed.value.version !== provider.value.dependencies[dependency]) {
      throw new Error(`browser preinstall: ${dependency} does not match the reviewed provider dependency`)
    }
  }
  const forbidden = new Set(['chrome', 'chrome.exe', 'headless_shell', 'headless_shell.exe', 'Google Chrome', 'Chromium'])
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === 'ms-playwright') throw new Error('browser preinstall: bundled browser cache is forbidden')
        visit(join(directory, entry.name))
      } else if (entry.isFile() && forbidden.has(entry.name)) {
        throw new Error(`browser preinstall: bundled browser executable is forbidden: ${entry.name}`)
      }
    }
  }
  visit(root)
}

/**
 * Verify the optional native Computer Use payload without importing the SDK or requesting OS permissions.
 * @param {string} root Expanded Harness package root after platform pruning.
 * @param {string} target Native package target, including Linux GNU and Windows MSVC suffix selection.
 * @returns {void} Returns after the SDK, loader, native library, addon and notice are present.
 */
export function verifyPreinstalledComputerUse(root, target) {
  const targets = {
    'darwin-arm64': ['darwin-arm64', 'libcua_driver_sdk.dylib'],
    'darwin-x64': ['darwin-x64', 'libcua_driver_sdk.dylib'],
    'win32-x64': ['win32-x64-msvc', 'cua_driver_sdk.dll'],
    'linux-x64': ['linux-x64-gnu', 'libcua_driver_sdk.so'],
  }
  const selected = targets[target]
  if (selected === undefined) throw new Error(`computer preinstall: unsupported target ${target}`)
  const anchor = join(root, 'package.json')
  const version = JSON.parse(readFileSync(anchor, 'utf8')).version
  const bundle = manifest(anchor, '@deepseek-ai/dsh-computer-use-native-bundle', root)
  if (bundle.value.version !== version) throw new Error('computer preinstall: optional bundle does not match Harness')
  const provider = manifest(anchor, '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native', root)
  const service = manifest(anchor, '@deepseek-ai/dsh-computer-use', root)
  if (provider.value.version !== version || service.value.version !== version) {
    throw new Error('computer preinstall: provider and service must match Harness')
  }
  const sdk = manifest(provider.path, '@trycua/cua-driver', root)
  if (sdk.value.version !== provider.value.dependencies?.['@trycua/cua-driver']) {
    throw new Error('computer preinstall: wrong CUA SDK version')
  }
  const nativeName = `@trycua/cua-driver-${selected[0]}`
  const native = manifest(sdk.path, nativeName, root)
  if (native.value.version !== sdk.value.optionalDependencies?.[nativeName] || native.value.version !== sdk.value.version) {
    throw new Error('computer preinstall: wrong native CUA package version')
  }
  const ubNode = manifest(sdk.path, '@ubjs/node', root)
  const ubCore = manifest(sdk.path, '@ubjs/core', root)
  if (ubNode.value.version !== sdk.value.dependencies?.['@ubjs/node']
    || ubCore.value.version !== sdk.value.dependencies?.['@ubjs/core']) {
    throw new Error('computer preinstall: SDK loader dependency version mismatch')
  }
  for (const path of [
    join(dirname(sdk.path), 'dist/native/node-runtime.js'),
    join(dirname(sdk.path), 'dist/native/cua_driver_sdk-ffi.js'),
    join(dirname(ubNode.path), 'typescript/dist/resolve-lib.js'),
    join(dirname(native.path), selected[1]),
    join(dirname(native.path), 'cua_driver_node_runtime.node'),
    join(dirname(native.path), 'node-runtime-NOTICE.md'),
  ]) {
    if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size === 0) {
      throw new Error(`computer preinstall: missing SDK loader or native resource ${relative(root, path)}`)
    }
  }
  for (const other of Object.keys(sdk.value.optionalDependencies ?? {})) {
    if (other === nativeName || !other.startsWith('@trycua/cua-driver-')) continue
    for (const directory of createRequire(sdk.path).resolve.paths(other) ?? []) {
      const path = join(directory, other, 'package.json')
      const location = relative(root, path)
      if (location !== '..' && !location.startsWith(`..${sep}`) && existsSync(path)) {
        throw new Error(`computer preinstall: foreign native CUA package remains: ${other}`)
      }
    }
  }
}

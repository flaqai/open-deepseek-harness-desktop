/** Build the optional AX-only selection addon for this macOS runner. */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const desktop = resolve(fileURLToPath(new URL('..', import.meta.url)))
const source = join(desktop, 'src')
const output = join(desktop, 'lib')

function run(command, args, environment) {
  const result = spawnSync(command, args, { cwd: desktop, env: environment, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`orb selection: ${command} exited with ${String(result.status ?? result.signal)}`)
}

function nodeHeaders() {
  const execDir = dirname(process.execPath)
  const declared = process.config?.variables?.nodedir
  const candidates = [
    typeof declared === 'string' ? join(declared, 'include', 'node') : undefined,
    typeof declared === 'string' ? declared : undefined,
    resolve(execDir, '../include/node'),
    resolve(execDir, '../../include/node'),
  ]
  const found = candidates.find(dir => dir !== undefined && existsSync(join(dir, 'node_api.h')))
  if (found === undefined) throw new Error('orb selection: Node-API headers are unavailable')
  return found
}

/** Build in a private sibling directory before replacing complete output files. */
export function buildOrbMacSelection() {
  if (process.platform !== 'darwin') return
  mkdirSync(output, { recursive: true })
  const pending = mkdtempSync(join(output, '.orb-selection-build-'))
  const dylibName = 'liborb-selection-macos.dylib'
  const addonName = 'orb-selection-macos-napi.node'
  const dylib = join(pending, dylibName)
  const addon = join(pending, addonName)
  const triple = `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos13.5`
  const environment = {
    ...process.env,
    CLANG_MODULE_CACHE_PATH: join(pending, 'clang-modules'),
    SWIFT_MODULE_CACHE_PATH: join(pending, 'swift-modules'),
  }
  try {
    run('swiftc', [
      '-O', '-parse-as-library', '-emit-library', '-module-name', 'OrbSelectionNative',
      '-target', triple,
      '-module-cache-path', environment.SWIFT_MODULE_CACHE_PATH,
      '-Xlinker', '-install_name', '-Xlinker', `@rpath/${dylibName}`,
      '-o', dylib, join(source, 'orb-selection-macos.swift'),
      '-framework', 'AppKit', '-framework', 'ApplicationServices',
    ], environment)
    run('clang', [
      '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-fPIC', '-bundle',
      '-undefined', 'dynamic_lookup', '-mmacosx-version-min=13.5',
      '-I', nodeHeaders(), join(source, 'orb-selection-macos-napi.c'), dylib,
      '-Wl,-rpath,@loader_path', '-o', addon,
    ], environment)
    renameSync(dylib, join(output, dylibName))
    renameSync(addon, join(output, addonName))
    console.log(`orb selection: built ${basename(output)}/${dylibName} and ${addonName}`)
  } finally {
    rmSync(pending, { recursive: true, force: true })
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  buildOrbMacSelection()
}

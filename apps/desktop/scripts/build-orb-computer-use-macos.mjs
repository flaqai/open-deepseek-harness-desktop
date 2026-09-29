/** Build the restricted foreground macOS Computer Use helper. */

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const desktop = resolve(fileURLToPath(new URL('..', import.meta.url)))

/** Compile a single native executable next to Desktop's emitted JavaScript. */
export function buildOrbComputerUseMacos() {
  if (process.platform !== 'darwin') return
  const output = join(desktop, 'lib')
  mkdirSync(output, { recursive: true })
  const pending = mkdtempSync(join(output, '.orb-computer-use-build-'))
  const executable = join(pending, 'orb-computer-use-macos')
  const environment = {
    ...process.env,
    CLANG_MODULE_CACHE_PATH: join(pending, 'clang-modules'),
    SWIFT_MODULE_CACHE_PATH: join(pending, 'swift-modules'),
  }
  try {
    const result = spawnSync('swiftc', [
      '-O', '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos13.5`,
      '-module-cache-path', environment.SWIFT_MODULE_CACHE_PATH,
      '-o', executable, join(desktop, 'src/orb-computer-use-macos.swift'),
      '-framework', 'AppKit', '-framework', 'ApplicationServices', '-framework', 'ImageIO',
    ], { cwd: desktop, env: environment, stdio: 'inherit' })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`orb computer use: swiftc exited with ${String(result.status ?? result.signal)}`)
    renameSync(executable, join(output, 'orb-computer-use-macos'))
  } finally {
    rmSync(pending, { recursive: true, force: true })
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  buildOrbComputerUseMacos()
}

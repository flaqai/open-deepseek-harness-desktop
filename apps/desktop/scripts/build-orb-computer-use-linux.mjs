/** Build the restricted foreground X11 Computer Use helper on Linux. */

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const desktop = resolve(fileURLToPath(new URL('..', import.meta.url)))

function run(command, args) {
  const result = spawnSync(command, args, { cwd: desktop, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`orb computer use: ${command} failed: ${result.stderr.trim()}`)
  return result.stdout.trim().split(/\s+/u).filter(Boolean)
}

/** Compile the X11 helper beside Desktop's emitted JavaScript. */
export function buildOrbComputerUseLinux() {
  if (process.platform !== 'linux') return
  const output = join(desktop, 'lib')
  mkdirSync(output, { recursive: true })
  const pending = mkdtempSync(join(output, '.orb-computer-use-build-'))
  try {
    const executable = join(pending, 'orb-computer-use-linux')
    const flags = run('pkg-config', ['--cflags', '--libs', 'x11', 'xtst', 'libpng'])
    const result = spawnSync('cc', [
      '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-o', executable,
      join(desktop, 'src/orb-computer-use-linux.c'), ...flags,
    ], { cwd: desktop, stdio: 'inherit' })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`orb computer use: C compiler exited with ${String(result.status ?? result.signal)}`)
    renameSync(executable, join(output, 'orb-computer-use-linux'))
  } finally {
    rmSync(pending, { recursive: true, force: true })
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  buildOrbComputerUseLinux()
}

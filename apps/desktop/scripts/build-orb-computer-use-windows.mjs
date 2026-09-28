/** Build the restricted foreground Windows Computer Use helper. */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const desktop = resolve(fileURLToPath(new URL('..', import.meta.url)))

function visualStudioEnvironment() {
  const programFiles = process.env['ProgramFiles(x86)']
  if (!programFiles) throw new Error('orb computer use: Visual Studio C++ build tools are unavailable')
  const vswhere = join(programFiles, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
  if (!existsSync(vswhere)) throw new Error('orb computer use: Visual Studio C++ build tools are unavailable')
  const located = spawnSync(vswhere, [
    '-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
    '-property', 'installationPath',
  ], { encoding: 'utf8', windowsHide: true })
  const installation = located.status === 0 ? located.stdout.trim() : ''
  const vcvars = join(installation, 'VC', 'Auxiliary', 'Build', 'vcvarsall.bat')
  if (!installation || !existsSync(vcvars)) throw new Error('orb computer use: Visual Studio C++ build tools are unavailable')
  const result = spawnSync('cmd.exe', ['/d', '/s', '/c', `""${vcvars}" amd64 >nul && set"`], {
    encoding: 'utf8', windowsHide: true, maxBuffer: 2 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error('orb computer use: could not initialize Visual Studio C++ build tools')
  const environment = { ...process.env }
  for (const line of result.stdout.split(/\r?\n/u)) {
    const separator = line.indexOf('=')
    if (separator > 0) environment[line.slice(0, separator)] = line.slice(separator + 1)
  }
  return environment
}

/** Compile the standalone helper next to Desktop's emitted JavaScript. */
export function buildOrbComputerUseWindows() {
  if (process.platform !== 'win32') return
  if (process.arch !== 'x64') throw new Error('orb computer use: Windows helper requires x64')
  const output = join(desktop, 'lib')
  mkdirSync(output, { recursive: true })
  const pending = mkdtempSync(join(output, '.orb-computer-use-windows-build-'))
  const executable = join(pending, 'orb-computer-use-windows.exe')
  try {
    const args = [
      '/nologo', '/std:c++17', '/EHsc', '/O2', '/W4',
      '/DUNICODE', '/D_UNICODE', '/D_WIN32_WINNT=0x0A00',
      `/Fe:${executable}`, join(desktop, 'src/orb-computer-use-windows.cpp'),
      '/link', 'user32.lib', 'gdi32.lib', 'advapi32.lib',
    ]
    const options = { cwd: pending, stdio: 'inherit', windowsHide: true }
    let result = spawnSync('cl.exe', args, options)
    if (result.error?.code === 'ENOENT') {
      result = spawnSync('cl.exe', args, { ...options, env: visualStudioEnvironment() })
    }
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`orb computer use: cl.exe exited with ${String(result.status ?? result.signal)}`)
    renameSync(executable, join(output, 'orb-computer-use-windows.exe'))
  } finally {
    rmSync(pending, { recursive: true, force: true })
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  buildOrbComputerUseWindows()
}

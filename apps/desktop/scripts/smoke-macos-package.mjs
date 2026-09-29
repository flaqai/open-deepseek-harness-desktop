import { execFileSync } from 'node:child_process'
import { accessSync, constants, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const suffixes = ['', ' (GPU)', ' (Plugin)', ' (Renderer)']

/** Validate the names used by Electron's native Helper lookup.
 * @param {string} app Application bundle directory.
 */
export function verifyHelperLayout(app) {
  const plist = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', join(app, 'Contents/Info.plist')], { encoding: 'utf8' }))
  for (const key of ['CFBundleName', 'CFBundleExecutable']) {
    if (typeof plist[key] !== 'string' || !plist[key] || /[/\\]/.test(plist[key])) throw new Error(`Invalid ${key}`)
  }
  accessSync(join(app, 'Contents/MacOS', plist.CFBundleExecutable), constants.X_OK)
  for (const suffix of suffixes) {
    const helper = `${plist.CFBundleName} Helper${suffix}`
    const bundle = join(app, 'Contents/Frameworks', `${helper}.app`)
    try {
      accessSync(join(bundle, 'Contents/MacOS', helper), constants.X_OK)
    } catch (cause) {
      throw new Error(`CFBundleName=${plist.CFBundleName}: missing executable ${helper}; keep CFBundleName aligned with productName`, { cause })
    }
    const executable = execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', join(bundle, 'Contents/Info.plist')], { encoding: 'utf8' }).trim()
    if (executable !== helper) throw new Error(`Helper CFBundleExecutable mismatch: ${helper}`)
  }
  return plist.CFBundleExecutable
}

/** Verify the extracted final app without skipping deep signature checks.
 * @param {string} app Application bundle directory.
 * @param {typeof execFileSync} run Command runner.
 */
export function verifyCodeSignature(app, run = execFileSync) {
  // Large x64 bundles can take over a minute to traverse on shared runners.
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { timeout: 300000 })
}

/** Confirm that the Node addon and its @rpath-linked Swift library unpack together.
 * @param {string} app Packaged application directory.
 * @returns The two native paths to verify with codesign.
 */
export function verifyOrbSelectionLayout(app) {
  const directory = join(app, 'Contents/Resources/app.asar.unpacked/lib')
  const files = ['orb-selection-macos-napi.node', 'liborb-selection-macos.dylib']
    .map(name => join(directory, name))
  for (const file of files) accessSync(file, constants.R_OK)
  return files
}

/** Confirm the foreground Computer Use helper is executable after asar unpacking.
 * @param {string} app Packaged application directory.
 * @returns Executable native helper path.
 */
export function verifyOrbComputerUseLayout(app) {
  const executable = join(app, 'Contents/Resources/app.asar.unpacked/lib/orb-computer-use-macos')
  accessSync(executable, constants.X_OK)
  return executable
}

/** Check a final DMG, ZIP, or app on a native macOS runner.
 * @param {string} input Final package or extracted application.
 */
export function smokeMacPackage(input) {
  if (process.platform !== 'darwin') throw new Error('macOS package smoke requires macOS')
  const source = resolve(input)
  const temp = mkdtempSync(join(tmpdir(), 'dsh-macos-smoke-'))
  const mount = join(temp, 'mounted')
  let mounted = false
  try {
    let directory = temp
    if (source.endsWith('.dmg')) {
      execFileSync('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, source], { timeout: 120000 })
      mounted = true
      const apps = readdirSync(mount).filter(name => name.endsWith('.app'))
      if (apps.length !== 1) throw new Error('Expected exactly one app in DMG')
      execFileSync('/usr/bin/ditto', [join(mount, apps[0]), join(temp, apps[0])], { timeout: 120000 })
    } else if (source.endsWith('.zip')) {
      execFileSync('/usr/bin/ditto', ['-x', '-k', source, temp], { timeout: 120000 })
    } else if (source.endsWith('.app')) {
      directory = null
    } else {
      throw new Error('Expected .dmg, .zip, or .app')
    }
    const apps = directory ? readdirSync(directory).filter(name => name.endsWith('.app')) : [basename(source)]
    if (apps.length !== 1) throw new Error('Expected exactly one extracted application')
    const app = directory ? join(directory, apps[0]) : source
    const executable = verifyHelperLayout(app)
    verifyCodeSignature(app)
    const orbSelectionNative = verifyOrbSelectionLayout(app)
    const orbComputerUseNative = verifyOrbComputerUseLayout(app)
    for (const file of orbSelectionNative) {
      execFileSync('/usr/bin/codesign', ['--verify', '--strict', file], { timeout: 30000 })
    }
    execFileSync('/usr/bin/codesign', ['--verify', '--strict', orbComputerUseNative], { timeout: 30000 })
    execFileSync(process.execPath, [fileURLToPath(new URL('./verify-prebuilt-profile.mjs', import.meta.url)), join(app, 'Contents/Resources')], { timeout: 300000, stdio: 'inherit' })
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    delete env.NODE_OPTIONS
    const output = execFileSync(join(app, 'Contents/MacOS', executable), ['--dsh-native-smoke', `--user-data-dir=${join(temp, 'user-data')}`], { env, encoding: 'utf8', timeout: 15000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 })
    if (!/^DSH_NATIVE_SMOKE_READY$/m.test(output)) throw new Error(`Missing native Electron readiness output: ${output}`)
    console.log(`PASS ${basename(source)}: Helper layout, deep signature, native Electron startup (${output.trim()})`)
  } finally {
    if (mounted) execFileSync('/usr/bin/hdiutil', ['detach', mount], { timeout: 30000 })
    rmSync(temp, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length < 3) throw new Error('Usage: node smoke-macos-package.mjs <dmg|zip|app> [...]')
  for (const input of process.argv.slice(2)) smokeMacPackage(input)
}

/** Project-local macOS development wrapper with download-only proxy configuration. */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { electronDownloadEnvironment } from './electron-download-network.mjs'

const productName = 'Open DeepSeek Harness Desktop'

/** Return a launchable development binary with the product's menu identity. */
export function developmentElectron() {
  const require = createRequire(import.meta.url)
  const packageRoot = dirname(require.resolve('electron/package.json'))
  const version = require('electron/package.json').version
  const pathFile = join(packageRoot, 'path.txt')
  const versionFile = join(packageRoot, 'dist', 'version')
  const installed = existsSync(pathFile) && existsSync(versionFile)
    && readFileSync(versionFile, 'utf8').trim().replace(/^v/u, '') === version
    && existsSync(join(packageRoot, 'dist', readFileSync(pathFile, 'utf8').trim()))
  if (!installed && !process.env.ELECTRON_OVERRIDE_DIST_PATH) {
    console.info('desktop: preparing the locked Electron binary (download uses configured HTTP proxy when available)')
    const result = spawnSync(process.execPath, [join(packageRoot, 'install.js')], {
      stdio: 'inherit', env: electronDownloadEnvironment(),
    })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error('desktop: Electron download failed; check your proxy or ELECTRON_MIRROR and retry. The locked version and checksum verification remain required.')
  }
  const binary = require('electron')
  if (process.platform !== 'darwin') return binary
  const source = resolve(dirname(binary), '../..')
  const key = createHash('sha256').update(`${source}:${version}:${productName}:identity-v3`).digest('hex').slice(0, 16)
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.artifacts/desktop-dev', key)
  const target = join(root, `${productName}.app`)
  if (!existsSync(join(root, 'ready'))) {
    mkdirSync(root, { recursive: true })
    const staging = mkdtempSync(join(root, 'preparing-'))
    try {
      const bundle = join(staging, `${productName}.app`)
      cpSync(source, bundle, { recursive: true, verbatimSymlinks: true })
      const plist = join(bundle, 'Contents', 'Info.plist')
      for (const name of ['CFBundleName', 'CFBundleDisplayName']) {
        try { execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${name} ${productName}`, plist], { stdio: 'pipe' }) }
        catch { execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${name} string ${productName}`, plist], { stdio: 'pipe' }) }
      }
      execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', bundle], { stdio: 'pipe' })
      // Keep the development executable named Electron so process.defaultApp remains true.
      // The app bundle and runtime process title still use the canonical product name.
      renameSync(bundle, target)
      writeFileSync(join(root, 'ready'), version)
    } finally { rmSync(staging, { recursive: true, force: true }) }
  }
  return join(target, 'Contents', 'MacOS', 'Electron')
}

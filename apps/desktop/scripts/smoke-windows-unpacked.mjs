import { createRequire } from 'node:module'
import { access } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { runElectronPackageProbe } from './electron-package-probe.mjs'

if (process.platform !== 'win32') throw new Error(`Windows package probe requires win32, received ${process.platform}`)

const repositoryRoot = resolve(import.meta.dirname, '../../..')
const unpackedRoot = join(repositoryRoot, '.artifacts', 'desktop-windows', 'win-unpacked')
const executable = join(unpackedRoot, 'Open DeepSeek Harness Desktop.exe')
const asarPath = join(unpackedRoot, 'resources', 'app.asar')
const require = createRequire(import.meta.url)
const electronBuilderRoot = dirname(require.resolve('electron-builder/package.json'))
const { listPackage } = require(require.resolve('@electron/asar', { paths: [electronBuilderRoot] }))

await access(executable)
await access(asarPath)

const requiredPackages = [
  '@deepseek-ai/dsh-subprocess',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-http-proxy',
]
const asarEntries = new Set(listPackage(asarPath).map(entry => entry.replaceAll('\\', '/')))
const runtimeLock = '/scripts/primary-runtime-lock.json'
if (!asarEntries.has(runtimeLock)) throw new Error(`Packaged app.asar is missing ${runtimeLock}`)
for (const packageName of requiredPackages) {
  const manifest = `/node_modules/${packageName}/package.json`
  if (!asarEntries.has(manifest)) throw new Error(`Packaged app.asar is missing ${manifest}`)
}

async function runProbe(argument, marker, timeoutMs = 30_000) {
  const result = await runElectronPackageProbe({ executable, args: [argument], marker, timeoutMs })
  console.log(`${marker}\n${result.entryLog}`)
}

await runProbe('--dsh-native-smoke', 'DSH_NATIVE_SMOKE_READY')
await runProbe('--dsh-main-import-smoke', 'DSH_MAIN_IMPORT_SMOKE_READY')
// Client launch, range cleanup, CLI task, and final observer cleanup have separate deadlines.
await runProbe('--dsh-managed-cli-smoke', 'DSH_MANAGED_CLI_SMOKE_READY', 60_000)
console.log(`Windows app.asar contains ${requiredPackages.join(', ')}`)

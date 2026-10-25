/** Qualify the actual Windows ZIP payload through its native Electron entrypoints. */
import { spawnSync } from 'node:child_process'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Fixed extraction and probe steps; paths reach PowerShell through environment values. */
export function windowsZipSteps(archive, destination) {
  return [
    { command: 'pwsh', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      "$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath $env:DSH_ZIP_ARCHIVE -DestinationPath $env:DSH_ZIP_DESTINATION"],
    env: { DSH_ZIP_ARCHIVE: resolve(archive), DSH_ZIP_DESTINATION: resolve(destination) }, timeout: 300_000 },
    { command: process.execPath, args: [join(import.meta.dirname, 'verify-prebuilt-profile.mjs'), join(destination, 'resources')], timeout: 300_000 },
    { command: process.execPath, args: [join(import.meta.dirname, 'smoke-windows-unpacked.mjs'), destination], timeout: 180_000 },
  ]
}

/** Reject extraction, missing support resources or any failed native probe before acceptance. */
export async function qualifyWindowsZip(archive, destination, run = spawnSync) {
  for (const [index, step] of windowsZipSteps(archive, destination).entries()) {
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/KEY|TOKEN|SECRET|PASSWORD/iu.test(name)))
    const result = run(step.command, step.args, { env: { ...env, ...step.env }, stdio: 'inherit', windowsHide: true, timeout: step.timeout })
    if (result.error !== undefined) throw result.error
    if (result.status !== 0 || result.signal !== null) throw new Error(`Windows ZIP qualification failed (${result.status}, ${result.signal})`)
    if (index === 0) {
      for (const filename of ['START-REPAIR.cmd', 'START-ALL-USERS-REPAIR.cmd', 'README.md', 'README.zh.md']) {
        await access(join(destination, 'resources/support/windows-install-repair', filename))
      }
    }
  }
}

async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Windows ZIP qualification requires native Windows x64')
  const archive = resolve(import.meta.dirname, '../../../.artifacts/desktop-windows/DeepSeek-Harness-windows-x64.zip')
  const destination = await mkdtemp(join(tmpdir(), 'DSH ZIP 中文 '))
  try {
    await qualifyWindowsZip(archive, destination)
    console.log('Windows ZIP: extracted Profile, native entry, main import and managed CLI passed in a Chinese/space path')
  } finally {
    await rm(destination, { recursive: true, force: true })
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) await main()

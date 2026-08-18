/** Materialize a packaged Harness runtime where Node can resolve ESM packages. */

import { access, mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'

export interface PackagedRuntimeOptions {
  archivePath: string
  destination: string
  archiveRoot: string
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/** Return whether a previously extracted runtime matches the current layout contract. */
export async function isPackagedRuntimeReady(destination: string): Promise<boolean> {
  return await exists(join(destination, 'lib', 'bin.js'))
    && await exists(join(destination, 'node_modules'))
    && await exists(join(destination, 'node_modules', '@deepseek-ai', 'cosmokit'))
    && await exists(join(destination, 'package-runtime', 'bin', 'node'))
    && await exists(join(destination, 'package-runtime', 'bin', 'pnpm'))
    && await exists(join(destination, '.desktop-runtime-v3'))
}

function extractArchive(archivePath: string, destination: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('tar', ['-xzf', archivePath, '-C', destination], { windowsHide: true })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`desktop: runtime archive extraction failed code=${String(code)} signal=${String(signal)}`))
    })
  })
}

/**
 * Extract the bundled production closure once into user data.
 * ESM resolves bare package imports only through a real node_modules hierarchy,
 * so it cannot run directly from Electron Builder's filtered extra resources.
 */
export async function ensurePackagedRuntime(options: PackagedRuntimeOptions): Promise<string> {
  if (await isPackagedRuntimeReady(options.destination)) return options.destination

  await mkdir(dirname(options.destination), { recursive: true })
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-desktop-runtime-'))
  try {
    await extractArchive(options.archivePath, temporary)
    const extracted = join(temporary, options.archiveRoot)
    if (!await isPackagedRuntimeReady(extracted)) {
      throw new Error('desktop: packaged runtime archive is incomplete')
    }
    await rm(options.destination, { recursive: true, force: true })
    await rename(extracted, options.destination)
    return options.destination
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

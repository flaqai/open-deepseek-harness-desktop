/** Remove package files that cannot be used by one packaged Desktop target. */

import { existsSync } from 'node:fs'
import { readFile, readdir, rm, unlink } from 'node:fs/promises'
import { basename, isAbsolute, join, relative } from 'node:path'

function packageAllows(values, target) {
  if (!Array.isArray(values)) return true
  const positive = values.filter(value => typeof value === 'string' && !value.startsWith('!'))
  const negative = values.filter(value => typeof value === 'string' && value.startsWith('!')).map(value => value.slice(1))
  return !negative.includes(target) && (positive.length === 0 || positive.includes(target))
}

function packageSupportsTarget(manifest, target) {
  return packageAllows(manifest.os, target.platform) && packageAllows(manifest.cpu, target.arch)
}

/** Remove only legacy-deploy links to known workspace packages outside the production closure. */
export async function removeExtraneousWorkspaceLinks(nodeModules, workspaceNames, productionNames) {
  if (!isAbsolute(nodeModules) || basename(nodeModules) !== 'node_modules') throw new Error('workspace link policy requires an absolute node_modules path')
  const workspace = new Set(workspaceNames)
  const production = new Set(productionNames)
  let removed = 0
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        const parts = relative(nodeModules, path).split(/[\\/]/u)
        const packageParts = parts.slice(parts.lastIndexOf('node_modules') + 1)
        const nameParts = packageParts[0]?.startsWith('@') ? 2 : 1
        const name = packageParts.join('/')
        if (packageParts.length === nameParts && workspace.has(name) && !production.has(name)) {
          await unlink(path)
          removed += 1
        }
      } else if (entry.isDirectory()) await visit(path)
    }
  }
  await visit(nodeModules)
  return removed
}

/**
 * Identify files absent from the immutable packaged runtime on one target.
 * @param {string} path - Path relative to the staged node_modules directory.
 * @param {{ platform: string, arch: string }} target - Runtime platform and architecture.
 * @param {string} officePackage - Selected native Office engine package name.
 * @returns {string | undefined} Exclusion reason, if the path can be omitted.
 */
export function desktopRuntimeFileExclusion(path, target, officePackage) {
  const parts = path.split(/[\\/]/u)
  if (parts.some(part => ['.bin', '.pnpm', '.modules.yaml', '.pnpm-workspace-state-v1.json'].includes(part))) {
    return 'package-manager metadata'
  }
  const file = parts.at(-1) ?? ''
  const packageParts = parts.slice(parts.lastIndexOf('node_modules') + 1)
  const nameParts = packageParts[0]?.startsWith('@') ? 2 : 1
  const name = packageParts.slice(0, nameParts).join('/')
  const entry = packageParts.slice(nameParts).join('/')
  if (name.startsWith('@deepseek-ai/libreoffice-kit-') && name !== officePackage) return 'LibreOffice other platform'
  if (name === 'node-pty' && entry.startsWith('prebuilds/')) {
    const platform = packageParts[nameParts + 1]
    if (platform !== undefined && platform !== `${target.platform}-${target.arch}`) return 'node-pty other platform'
    if (file.endsWith('.pdb')) return 'node-pty debug symbols'
  }
  if (name === '@mixmark-io/domino' && (entry === 'test' || entry.startsWith('test/'))) return 'Domino test fixtures'
  if (name === 'fs-ext' && /^build\/(?:Release|Debug)\/(?:obj(?:\/|$)|fs_ext\.(?:exp|lib|pdb|iobj|ipdb)$)/u.test(entry)) {
    return 'fs-ext compiler output'
  }
  if (name === 'fs-ext' && /^build\/(?:binding\.sln|config\.gypi|fs_ext\.vcxproj(?:\.filters)?)$/u.test(entry)) {
    return 'fs-ext build configuration'
  }
  if (name === '@koromix/koffi-win32-x64' && entry === 'win32_x64/koffi.lib') return 'Koffi import library'
  if (/\.(?:[cm]?[jt]s|css)\.map$/u.test(file)) return 'source map'
  if (/\.d\.[cm]?ts$/u.test(file)) return 'TypeScript declaration'
  if (/\.tsbuildinfo$/u.test(file)) return 'TypeScript build cache'
  return undefined
}

/**
 * Prune the staged production dependency tree before it is archived.
 * @param {string} nodeModules - Absolute path to the staged node_modules tree.
 * @param {{ platform: string, arch: string }} target - Runtime platform and architecture.
 * @param {string} officePackage - Selected native Office engine package name.
 * @returns {Promise<{ files: number, directories: number, packages: number }>}
 */
export async function pruneDesktopRuntime(nodeModules, target, officePackage) {
  if (!isAbsolute(nodeModules) || basename(nodeModules) !== 'node_modules') {
    throw new Error(`desktop runtime policy requires an absolute node_modules path: ${nodeModules}`)
  }
  const counters = { files: 0, directories: 0, packages: 0 }
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const reason = desktopRuntimeFileExclusion(relative(nodeModules, path), target, officePackage)
      if (reason !== undefined) {
        await rm(path, { recursive: entry.isDirectory(), force: true })
        counters[entry.isDirectory() ? 'directories' : 'files'] += 1
        continue
      }
      if (!entry.isDirectory()) continue
      const manifestPath = join(path, 'package.json')
      if (existsSync(manifestPath)) {
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
        if (!packageSupportsTarget(manifest, target)) {
          await rm(path, { recursive: true, force: true })
          counters.packages += 1
          continue
        }
        // The engine's published data, executable, licenses and notices stay intact.
        if (manifest.name === officePackage) continue
      }
      await visit(path)
    }
  }
  await visit(nodeModules)
  return counters
}

/** Read installed plugin identities from a selected Harness home for offline export. */

import { lstat, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { valid, validRange } from 'semver'
import { extractImportedPluginRestorePlan } from './imported-plugin-restore.ts'
import { inspectImportedPluginArchive } from './imported-plugin-local-source.ts'
import { downloadPortablePluginArchive, type PortablePluginFetch } from './portable-plugin-download.ts'
import {
  preparePortablePluginBundle,
  type PortablePluginBundleManifest,
  type PortablePluginOfflineInstall,
  type PortablePluginTarget,
} from './portable-plugin-bundle.ts'

export interface PortablePluginSourceCandidate {
  readonly packageName: string
  readonly version: string
  readonly source: 'registry' | 'local-archive'
  readonly archive?: string
}

export interface PortablePluginSourceOmission {
  readonly packageName: string
  readonly reason: 'external-tool' | 'missing-installation' | 'invalid-installation' | 'custom-source' | 'missing-archive'
}

export interface PortablePluginSourcePlan {
  readonly candidates: readonly PortablePluginSourceCandidate[]
  readonly omitted: readonly PortablePluginSourceOmission[]
  readonly sourceIssues: readonly string[]
}

function within(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

/** Include only installed bundle packages whose source can be reproduced without copying node_modules. */
export async function planPortablePluginSources(dshHome: string): Promise<PortablePluginSourcePlan> {
  const restore = await extractImportedPluginRestorePlan(dshHome)
  const profile = join(dshHome, 'profiles', 'web')
  const canonicalProfile = await realpath(profile).catch(() => undefined)
  const canonicalHome = await realpath(dshHome).catch(() => undefined)
  const candidates: PortablePluginSourceCandidate[] = []
  const omitted: PortablePluginSourceOmission[] = []
  for (const entry of restore.entries) {
    if (entry.category !== 'plugin') {
      omitted.push({ packageName: entry.packageName, reason: 'external-tool' })
      continue
    }
    let installed: { name?: unknown; version?: unknown }
    try {
      const path = join(profile, 'node_modules', ...entry.packageName.split('/'), 'package.json')
      const actual = await realpath(path)
      if (canonicalProfile === undefined || !within(canonicalProfile, actual) || !(await lstat(actual)).isFile()) {
        omitted.push({ packageName: entry.packageName, reason: 'invalid-installation' })
        continue
      }
      installed = JSON.parse(await readFile(actual, 'utf8')) as { name?: unknown; version?: unknown }
    } catch (error) {
      omitted.push({
        packageName: entry.packageName,
        reason: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing-installation' : 'invalid-installation',
      })
      continue
    }
    if (installed.name !== entry.packageName || typeof installed.version !== 'string'
      || valid(installed.version) !== installed.version) {
      omitted.push({ packageName: entry.packageName, reason: 'invalid-installation' })
      continue
    }
    if (validRange(entry.declaredSpec) !== null || /^(?:latest|next|beta|alpha|canary)$/u.test(entry.declaredSpec)) {
      candidates.push({ packageName: entry.packageName, version: installed.version, source: 'registry' })
      continue
    }
    if (entry.declaredSpec.startsWith('file:') && entry.declaredSpec.toLowerCase().endsWith('.tgz')) {
      let archive: string
      try {
        archive = resolve(profile, decodeURIComponent(entry.declaredSpec.slice('file:'.length)))
      } catch {
        omitted.push({ packageName: entry.packageName, reason: 'missing-archive' })
        continue
      }
      if (canonicalHome === undefined || !within(dshHome, archive)) {
        omitted.push({ packageName: entry.packageName, reason: 'custom-source' })
        continue
      }
      try {
        const archiveActual = await realpath(archive)
        if (!within(canonicalHome, archiveActual)) {
          omitted.push({ packageName: entry.packageName, reason: 'custom-source' })
          continue
        }
        const archiveManifest = await inspectImportedPluginArchive(archive, entry.packageName)
        if (archiveManifest.version === installed.version) {
          candidates.push({ packageName: entry.packageName, version: installed.version, source: 'local-archive', archive })
          continue
        }
      } catch {
        // A missing, linked, or malformed archive is reported as unavailable below.
      }
      omitted.push({ packageName: entry.packageName, reason: 'missing-archive' })
      continue
    }
    omitted.push({ packageName: entry.packageName, reason: 'custom-source' })
  }
  return { candidates, omitted, sourceIssues: restore.sourceIssues }
}

/** Fetch original registry archives on the source host; never copy a live node_modules tree. */
export async function exportPortablePluginsFromHome(
  dshHome: string,
  outputDirectory: string,
  target: PortablePluginTarget,
  actualHost: PortablePluginTarget,
  selectedPackageNames: readonly string[],
  registry: string,
  install: PortablePluginOfflineInstall,
  request?: PortablePluginFetch,
): Promise<{ readonly manifest: PortablePluginBundleManifest; readonly sourcePlan: PortablePluginSourcePlan }> {
  const sourcePlan = await planPortablePluginSources(dshHome)
  if (sourcePlan.sourceIssues.length > 0) {
    throw new Error('desktop: source Profile has unresolved plugin manifest issues')
  }
  const selected = new Set(selectedPackageNames)
  if (selected.size === 0 || selected.size !== selectedPackageNames.length) {
    throw new TypeError('desktop: select at least one distinct portable plugin')
  }
  const candidates = sourcePlan.candidates.filter(candidate => selected.has(candidate.packageName))
  if (candidates.length !== selected.size) {
    throw new Error('desktop: selected portable plugin is unavailable or has an unsupported source')
  }
  const downloads: Array<{ cleanup(): Promise<void> }> = []
  try {
    const archives = []
    for (const candidate of candidates) {
      if (candidate.source === 'local-archive' && candidate.archive !== undefined) {
        archives.push({ packageName: candidate.packageName, version: candidate.version, archive: candidate.archive })
      } else {
        const downloaded = await downloadPortablePluginArchive(registry, candidate.packageName, candidate.version, request)
        downloads.push(downloaded)
        archives.push({ packageName: candidate.packageName, version: candidate.version, archive: downloaded.archive })
      }
    }
    return {
      manifest: await preparePortablePluginBundle(outputDirectory, target, actualHost, archives, registry, install),
      sourcePlan,
    }
  } finally {
    await Promise.all(downloads.map(download => download.cleanup()))
  }
}

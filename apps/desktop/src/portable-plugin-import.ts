/** Match an offline bundle to a copied Profile without changing user data. */

import { join } from 'node:path'
import { readImportedPluginRestorePlan } from './imported-plugin-restore.ts'
import {
  rehearsePortablePluginBundle,
  verifyPreparedPortablePluginBundle,
  type PortablePluginOfflineInstall,
  type PortablePluginTarget,
} from './portable-plugin-bundle.ts'

export interface PortablePluginImportPlan {
  readonly ready: readonly { packageName: string; version: string; archive: string; restoreId: string }[]
  readonly skipped: readonly { packageName: string; reason: 'not-in-restore-plan' | 'already-provided' | 'not-pending' }[]
}

/** Reject a partial or foreign bundle, then prove it resolves offline on the target before offering installation. */
export async function planPortablePluginImport(
  dshHome: string,
  bundleDirectory: string,
  actualHost: PortablePluginTarget,
  install: PortablePluginOfflineInstall,
): Promise<PortablePluginImportPlan> {
  const bundle = await verifyPreparedPortablePluginBundle(bundleDirectory)
  await rehearsePortablePluginBundle(bundleDirectory, actualHost, install)
  const restore = await readImportedPluginRestorePlan(dshHome)
  if (restore === undefined) throw new Error('desktop: copied Profile has no valid plugin restore plan')
  const ready: PortablePluginImportPlan['ready'][number][] = []
  const skipped: PortablePluginImportPlan['skipped'][number][] = []
  for (const artifact of bundle.artifacts) {
    const entry = restore.entries.find(candidate => candidate.packageName === artifact.packageName && candidate.category === 'plugin')
    if (entry === undefined) skipped.push({ packageName: artifact.packageName, reason: 'not-in-restore-plan' })
    else if (entry.state === 'provided') skipped.push({ packageName: artifact.packageName, reason: 'already-provided' })
    else if (entry.state !== 'pending' && entry.state !== 'failed') {
      skipped.push({ packageName: artifact.packageName, reason: 'not-pending' })
    } else ready.push({
      packageName: artifact.packageName,
      version: artifact.version,
      archive: join(bundleDirectory, artifact.file),
      restoreId: entry.restoreId,
    })
  }
  return { ready, skipped }
}

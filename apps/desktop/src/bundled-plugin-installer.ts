/** Policy-aware coordinator for trusted plugins carried by desktop packages. */

import { randomUUID } from 'node:crypto'
import {
  assertBundledPluginManifestEntry,
  seedBundledPlugin,
  type BundledPluginManifestEntry,
  type SeedBundledPluginResult,
} from './bundled-plugin-seed.ts'

export interface BundledPluginManifest {
  readonly schema: 2
  readonly plugins: readonly BundledPluginManifestEntry[]
}

export type BundledPluginInstallPhase = 'running' | 'succeeded' | 'failed'

export interface BundledPluginInstallSnapshot {
  readonly installId: string
  readonly profile: string
  readonly packageSpec: string
  readonly command: string
  readonly phase: BundledPluginInstallPhase
  readonly exitCode?: number | null
  readonly diagnostic?: string
}

export type BundledPluginStartResult =
  | { readonly handled: false }
  | { readonly handled: true; readonly snapshot: BundledPluginInstallSnapshot }

export interface BundledPluginInstallerOptions {
  readonly manifest: BundledPluginManifest
  readonly resourcesDirectory: string
  readonly dshHome: string
  readonly install: (archivePath: string, entry: BundledPluginManifestEntry) => Promise<void>
  readonly onFailure?: (error: unknown) => Promise<void>
  readonly createId?: () => string
}

interface InstallJob {
  snapshot: BundledPluginInstallSnapshot
  readonly target: string
}

/** Exact UI request represented by one bundled manifest entry. */
export function bundledPluginRequestSpec(entry: BundledPluginManifestEntry): string {
  return entry.registrySpec ?? `${entry.packageName}@${entry.version}`
}

/** Prefer updateable package identity, retaining the verified archive as fallback. */
export async function installBundledPluginSource(
  entry: BundledPluginManifestEntry,
  archivePath: string,
  installSpec: (packageSpec: string, preferOffline: boolean) => Promise<void>,
  onRegistryFailure?: (error: unknown) => void,
): Promise<'registry' | 'archive'> {
  if (entry.registrySpec !== undefined) {
    try {
      await installSpec(entry.registrySpec, true)
      return 'registry'
    } catch (error) {
      onRegistryFailure?.(error)
    }
  }
  await installSpec(archivePath, false)
  return 'archive'
}

function errorDiagnostic(error: unknown): string {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  return message.slice(-4000)
}

function assertManifest(manifest: BundledPluginManifest): void {
  if (manifest.schema !== 2 || !Array.isArray(manifest.plugins)) {
    throw new TypeError('desktop: unsupported bundled plugin manifest')
  }
  const requests = new Set<string>()
  for (const entry of manifest.plugins) {
    assertBundledPluginManifestEntry(entry)
    const request = `${entry.profile}\0${bundledPluginRequestSpec(entry)}`
    if (requests.has(request)) throw new TypeError(`desktop: duplicate bundled plugin request ${entry.packageName}`)
    requests.add(request)
  }
}

/**
 * Own startup seeding and explicit on-demand installs without exposing a
 * generic package or filesystem bridge to the renderer.
 */
export class BundledPluginInstaller {
  private readonly jobs = new Map<string, InstallJob>()
  private readonly activeTargets = new Map<string, string>()
  private readonly options: BundledPluginInstallerOptions

  constructor(options: BundledPluginInstallerOptions) {
    assertManifest(options.manifest)
    this.options = options
  }

  /** Install startup entries in manifest order while isolating failures. */
  async seedStartup(): Promise<ReadonlyArray<{ entry: BundledPluginManifestEntry; result?: SeedBundledPluginResult }>> {
    const results: Array<{ entry: BundledPluginManifestEntry; result?: SeedBundledPluginResult }> = []
    for (const entry of this.options.manifest.plugins) {
      if (entry.installPolicy !== 'startup') continue
      try {
        const result = await this.seed(entry, false)
        results.push({ entry, result })
      } catch (error) {
        results.push({ entry })
        try {
          await this.options.onFailure?.(error)
        } catch {
          // Logging must not prevent later independent startup entries.
        }
      }
    }
    return results
  }

  /** Start only an exact manual entry; all other registry requests stay Host-owned. */
  startManual(profile: string, packageSpec: string): BundledPluginStartResult {
    const entry = this.options.manifest.plugins.find(candidate => (
      candidate.installPolicy === 'manual'
      && candidate.profile === profile
      && bundledPluginRequestSpec(candidate) === packageSpec
    ))
    if (entry === undefined) return { handled: false }

    const target = `${profile}\0${packageSpec}`
    const activeId = this.activeTargets.get(target)
    if (activeId !== undefined) {
      const active = this.jobs.get(activeId)
      if (active !== undefined) return { handled: true, snapshot: active.snapshot }
    }

    const installId = `desktop-bundled:${this.options.createId?.() ?? randomUUID()}`
    const snapshot: BundledPluginInstallSnapshot = {
      installId,
      profile,
      packageSpec,
      command: `dsh plugin --profile ${profile} add ${packageSpec}`,
      phase: 'running',
    }
    const job: InstallJob = { snapshot, target }
    this.jobs.set(installId, job)
    this.activeTargets.set(target, installId)
    void this.runManual(job, entry)
    return { handled: true, snapshot }
  }

  /** Poll a desktop-owned job; fabricated or expired ids are rejected. */
  getInstall(installId: string): BundledPluginInstallSnapshot {
    if (!installId.startsWith('desktop-bundled:')) {
      throw new TypeError('desktop: invalid bundled plugin install id')
    }
    const job = this.jobs.get(installId)
    if (job === undefined) throw new Error('desktop: bundled plugin install not found')
    return job.snapshot
  }

  private async seed(entry: BundledPluginManifestEntry, force: boolean): Promise<SeedBundledPluginResult> {
    return seedBundledPlugin({
      entry,
      resourcesDirectory: this.options.resourcesDirectory,
      dshHome: this.options.dshHome,
      install: this.options.install,
      force,
    })
  }

  private async runManual(job: InstallJob, entry: BundledPluginManifestEntry): Promise<void> {
    try {
      await this.seed(entry, true)
      job.snapshot = { ...job.snapshot, phase: 'succeeded', exitCode: 0 }
    } catch (error) {
      job.snapshot = { ...job.snapshot, phase: 'failed', exitCode: 1, diagnostic: errorDiagnostic(error) }
      try {
        await this.options.onFailure?.(error)
      } catch {
        // The settled job remains pollable even when diagnostics cannot persist.
      }
    } finally {
      this.activeTargets.delete(job.target)
    }
  }
}

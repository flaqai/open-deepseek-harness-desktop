/** Policy-aware coordinator for trusted plugins carried by desktop packages. */

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  assertBundledPluginManifestEntry,
  bundledPluginSeedIsSettled,
  hasBundledPluginQuarantineRecord,
  hasLegacyBundledPluginSeedMarker,
  hasBundledPluginSeedMarker,
  seedBundledPlugin,
  type BundledPluginManifestEntry,
  type BundledPluginSeedProgress,
  type BundledPluginSeedStage,
  type SeedBundledPluginResult,
} from './bundled-plugin-seed.ts'

export interface BundledPluginManifest {
  readonly schema: 2
  readonly plugins: readonly BundledPluginManifestEntry[]
}

type BundledPluginInstallPhase = 'running' | 'succeeded' | 'failed'

export interface BundledPluginInstallSnapshot {
  readonly installId: string
  readonly profile: string
  readonly packageSpec: string
  readonly command: string
  readonly phase: BundledPluginInstallPhase
  readonly stage: BundledPluginSeedStage
  readonly progress: number
  readonly exitCode?: number | null
  readonly diagnostic?: string
}

export type BundledPluginStartResult =
  | { readonly handled: false }
  | { readonly handled: true; readonly snapshot: BundledPluginInstallSnapshot }

export type BundledPluginDeferredStartResult =
  | { readonly handled: false }
  | { readonly handled: true; readonly snapshot?: BundledPluginInstallSnapshot }

export interface BundledPluginInstallerOptions {
  readonly manifest: BundledPluginManifest
  readonly resourcesDirectory: string
  readonly dshHome: string
  readonly install: (archivePath: string, entry: BundledPluginManifestEntry) => Promise<void>
  readonly prepare?: (entry: BundledPluginManifestEntry) => Promise<void>
  readonly onFailure?: (error: unknown, entry: BundledPluginManifestEntry) => Promise<void>
  readonly withStartupTransaction?: <T>(
    entry: BundledPluginManifestEntry,
    operation: () => Promise<T>,
  ) => Promise<T>
  readonly startupBudgetMs?: number
  readonly now?: () => number
  readonly shouldAttemptStartup?: (entry: BundledPluginManifestEntry) => Promise<boolean>
  readonly onStartupSuccess?: (entry: BundledPluginManifestEntry) => Promise<void>
  readonly onManagedMutationStart?: (entry: BundledPluginManifestEntry) => void
  readonly onManagedMutationSettled?: (entry: BundledPluginManifestEntry) => void
  readonly createId?: () => string
  readonly repairLegacyMarkers?: boolean
}

/** One startup plugin's real seed milestone, including its manifest position. */
export interface BundledPluginStartupProgress extends BundledPluginSeedProgress {
  readonly entry: BundledPluginManifestEntry
  readonly index: number
  readonly total: number
}

/**
 * Resolve the trusted bundled-plugin directory for packaged and source launches.
 * @param packaged - Whether Electron is running from an installed application.
 * @param resourcesPath - Electron resources directory used by packaged builds.
 * @param sourceRoot - Repository root used by development builds.
 * @returns Directory containing the checked manifest and plugin archives.
 */
export function resolveBundledPluginResourcesDirectory(
  packaged: boolean,
  resourcesPath: string,
  sourceRoot: string,
): string {
  return packaged
    ? join(resourcesPath, 'bundled-plugins')
    : join(sourceRoot, 'apps', 'desktop', 'bundled-plugins')
}

interface InstallJob {
  snapshot: BundledPluginInstallSnapshot
  readonly target: string
}

/** Exact UI request represented by one bundled manifest entry. */
function bundledPluginRequestSpec(entry: BundledPluginManifestEntry): string {
  return entry.registrySpec ?? `${entry.packageName}@${entry.version}`
}

/** Install the verified archive carried by the desktop package without registry access. */
export async function installBundledPluginSource(
  _entry: BundledPluginManifestEntry,
  archivePath: string,
  installSpec: (packageSpec: string, preferOffline: boolean) => Promise<void>,
): Promise<'archive'> {
  await installSpec(archivePath, false)
  return 'archive'
}

function errorDiagnostic(error: unknown): string {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  return message.slice(-4000)
}

function assertManifest(manifest: BundledPluginManifest): void {
  const requests = new Set<string>()
  for (const entry of manifest.plugins) {
    assertBundledPluginManifestEntry(entry)
    const request = `${entry.profile}\0${bundledPluginRequestSpec(entry)}`
    if (requests.has(request)) throw new TypeError(`desktop: duplicate bundled plugin request ${entry.packageName}`)
    requests.add(request)
  }
}

/** Parse untrusted JSON into the exact bundled-plugin allowlist schema. */
export function parseBundledPluginManifest(value: unknown): BundledPluginManifest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('desktop: unsupported bundled plugin manifest')
  }
  const candidate = value as Record<string, unknown>
  if (candidate.schema !== 2 || !Array.isArray(candidate.plugins)) {
    throw new TypeError('desktop: unsupported bundled plugin manifest')
  }
  for (const entry of candidate.plugins) assertBundledPluginManifestEntry(entry)
  const manifest: BundledPluginManifest = { schema: 2, plugins: candidate.plugins }
  assertManifest(manifest)
  return manifest
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

  /**
   * Install startup entries in manifest order while reporting their real seed milestones.
   * @param onProgress - Optional presentation observer; exceptions cannot interrupt installation.
   * @returns One result per startup entry, including isolated failures without a result.
   */
  async seedStartup(
    onProgress?: (progress: BundledPluginStartupProgress) => void,
  ): Promise<ReadonlyArray<{ entry: BundledPluginManifestEntry; result?: SeedBundledPluginResult }>> {
    const results: Array<{ entry: BundledPluginManifestEntry; result?: SeedBundledPluginResult }> = []
    const entries = this.options.manifest.plugins.filter(entry => entry.installPolicy === 'startup')
    const deadline = (this.options.now?.() ?? Date.now()) + (this.options.startupBudgetMs ?? 120_000)
    for (const [index, entry] of entries.entries()) {
      const report = (progress: BundledPluginSeedProgress): void => {
        try {
          onProgress?.({ ...progress, entry, index, total: entries.length })
        } catch {
          // A presentation observer cannot interrupt plugin installation.
        }
      }
      try {
        if (await bundledPluginSeedIsSettled(
          this.options.dshHome,
          entry,
          this.options.repairLegacyMarkers ?? false,
        )) {
          report({ stage: 'configuring', progress: 100 })
          results.push({ entry, result: 'already-seeded' })
          await this.options.onStartupSuccess?.(entry)
          continue
        }
        if (this.options.shouldAttemptStartup !== undefined
          && !await this.options.shouldAttemptStartup(entry)) {
          report({ stage: 'configuring', progress: 100 })
          results.push({ entry })
          continue
        }
        if ((this.options.now?.() ?? Date.now()) >= deadline) {
          report({ stage: 'configuring', progress: 100 })
          results.push({ entry })
          continue
        }
        report({ stage: 'verifying', progress: 0 })
        const result = this.options.withStartupTransaction === undefined
          ? await this.seed(entry, false, report)
          : await this.options.withStartupTransaction(entry, () => this.seed(entry, false, report))
        if (result === 'already-seeded') report({ stage: 'configuring', progress: 100 })
        results.push({ entry, result })
        await this.options.onStartupSuccess?.(entry)
      } catch (error) {
        results.push({ entry })
        try {
          await this.options.onFailure?.(error, entry)
        } catch {
          // Logging must not prevent later independent startup entries.
        }
      }
    }
    return results
  }

  /** Start an explicit bundled request; newer registry versions stay Host-owned. */
  startManual(profile: string, packageSpec: string): BundledPluginStartResult {
    const entry = this.findManual(profile, packageSpec)
    if (entry === undefined) return { handled: false }

    return this.startJob(entry, true)
  }

  /** Start an entry after the shell is ready while preserving a prior uninstall marker. */
  async startDeferred(profile: string, packageSpec: string): Promise<BundledPluginDeferredStartResult> {
    const entry = this.findManual(profile, packageSpec)
    if (entry === undefined) return { handled: false }
    if (await hasBundledPluginSeedMarker(this.options.dshHome, entry)
      && (!this.options.repairLegacyMarkers
        || !await hasLegacyBundledPluginSeedMarker(this.options.dshHome, entry))) return { handled: true }
    if (await hasBundledPluginQuarantineRecord(this.options.dshHome, entry)) return { handled: true }
    return this.startJob(entry, false)
  }

  private findManual(profile: string, packageSpec: string): BundledPluginManifestEntry | undefined {
    return this.options.manifest.plugins.find(candidate => (
      candidate.installPolicy !== 'diagnostic'
      && candidate.profile === profile
      && (bundledPluginRequestSpec(candidate) === packageSpec || candidate.packageName === packageSpec)
    ))
  }

  private startJob(entry: BundledPluginManifestEntry, force: boolean): BundledPluginStartResult {
    const packageSpec = bundledPluginRequestSpec(entry)
    const profile = entry.profile

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
      stage: 'verifying',
      progress: 0,
    }
    const job: InstallJob = { snapshot, target }
    this.jobs.set(installId, job)
    this.activeTargets.set(target, installId)
    void this.runJob(job, entry, force)
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

  private async seed(
    entry: BundledPluginManifestEntry,
    force: boolean,
    onProgress?: (progress: BundledPluginSeedProgress) => void,
  ): Promise<SeedBundledPluginResult> {
    return seedBundledPlugin({
      entry,
      resourcesDirectory: this.options.resourcesDirectory,
      dshHome: this.options.dshHome,
      install: this.options.install,
      ...(this.options.prepare === undefined ? {} : { prepare: this.options.prepare }),
      force,
      repairLegacyMarker: this.options.repairLegacyMarkers ?? false,
      ...(onProgress === undefined ? {} : { onProgress }),
    })
  }

  private async runJob(job: InstallJob, entry: BundledPluginManifestEntry, force: boolean): Promise<void> {
    this.options.onManagedMutationStart?.(entry)
    try {
      await this.seed(entry, force, (progress) => {
        if (job.snapshot.phase !== 'running') return
        job.snapshot = { ...job.snapshot, ...progress }
      })
      job.snapshot = { ...job.snapshot, phase: 'succeeded', stage: 'configuring', progress: 100, exitCode: 0 }
    } catch (error) {
      job.snapshot = { ...job.snapshot, phase: 'failed', exitCode: 1, diagnostic: errorDiagnostic(error) }
      try {
        await this.options.onFailure?.(error, entry)
      } catch {
        // The settled job remains pollable even when diagnostics cannot persist.
      }
    } finally {
      this.activeTargets.delete(job.target)
      try { this.options.onManagedMutationSettled?.(entry) } catch {
        // Snapshot scheduling cannot change the already-settled install result.
      }
    }
  }
}

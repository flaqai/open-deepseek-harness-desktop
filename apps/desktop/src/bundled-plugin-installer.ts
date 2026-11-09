/** Policy-aware coordinator for trusted plugins carried by desktop packages. */

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { inspectLegacyBundledPluginSources, repairLegacyBundledPluginSources } from './legacy-bundled-plugin-sources.ts'
import { CandidatePreparationError } from './candidate-preparation.ts'
import {
  assertBundledPluginManifestEntry,
  bundledPluginSeedIsSettled,
  hasBundledPluginQuarantineRecord,
  seedBundledPlugin,
  type BundledPluginManifestEntry,
  type BundledPluginReconciliation,
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
  readonly sourceDshHome?: string
  readonly install: (archivePath: string, entry: BundledPluginManifestEntry) => Promise<void>
  readonly prepare?: (entry: BundledPluginManifestEntry) => Promise<void>
  readonly onFailure?: (error: unknown, entry: BundledPluginManifestEntry) => Promise<void>
  readonly withStartupTransaction?: <T>(
    entry: BundledPluginManifestEntry,
    operation: () => Promise<T>,
  ) => Promise<T>
  readonly withManagedTransaction?: <T>(
    entry: BundledPluginManifestEntry,
    operation: () => Promise<T>,
  ) => Promise<T>
  readonly startupBudgetMs?: number
  /** First start attempts every entry; per-command deadlines still apply. */
  readonly requireCompleteStartup?: boolean
  readonly isStartupCancelled?: () => boolean
  readonly now?: () => number
  readonly shouldAttemptStartup?: (entry: BundledPluginManifestEntry) => Promise<boolean>
  readonly onStartupSuccess?: (entry: BundledPluginManifestEntry) => Promise<void>
  readonly onStartupResult?: (entry: BundledPluginManifestEntry, result: SeedBundledPluginResult) => Promise<void>
  readonly onReconciled?: (result: BundledPluginReconciliation) => void
  /** Report unattempted entries without treating them as failed installs or starting cooldown. */
  readonly onStartupDeferred?: (entry: BundledPluginManifestEntry, reason: 'budget' | 'cooldown' | 'preparation-failed') => Promise<void>
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

  /** Trusted web presets available for an explicitly reviewed installation-source repair. */
  repairEntries(): readonly BundledPluginManifestEntry[] {
    return this.options.manifest.plugins.filter(entry => entry.profile === 'web' && entry.installPolicy === 'startup')
  }

  /**
   * Describe every missing archive and whether a trusted bundled replacement exists.
   * @param home - Profile home inspected without modifications.
   * @returns Exact replacement versions and user sources requiring a different repair.
   */
  async getSourceRepairPlan(home: string): Promise<{
    targets: readonly { packageName: string; version: string }[]
    blocked: readonly { packageName: string }[]
  }> {
    const entries = this.repairEntries()
    const issues = await inspectLegacyBundledPluginSources({ home, entries })
    const targets: Array<{ packageName: string; version: string }> = []
    const blocked: Array<{ packageName: string }> = []
    for (const issue of issues) {
      const entry = entries.find(item => item.packageName === issue.packageName)
      if (entry === undefined) blocked.push({ packageName: issue.packageName })
      else targets.push({ packageName: entry.packageName, version: entry.version })
    }
    return { targets, blocked }
  }

  /**
   * Adopt all explicitly approved missing preset sources before any dependency install.
   * @param home - Owned transaction candidate home under the caller's mutation lease.
   * @param targets - Complete exact package/version list reviewed by the user.
   * @returns Verified candidate archives and their trusted manifest entries.
   */
  async repairSourcesInCandidate(
    home: string, targets: readonly { packageName: string; version: string }[],
  ): Promise<readonly { archivePath: string; entry: BundledPluginManifestEntry }[]> {
    const plan = await this.getSourceRepairPlan(home)
    if (plan.blocked.length !== 0) throw new Error('desktop: custom plugin sources require repair before bundled source replacement')
    const identity = (items: readonly { packageName: string; version: string }[]): string =>
      JSON.stringify(items.map(item => `${item.packageName}@${item.version}`).sort())
    if (targets.length === 0 || new Set(targets.map(item => item.packageName)).size !== targets.length
      || identity(targets) !== identity(plan.targets)) throw new Error('desktop: reviewed source repair plan is stale or untrusted')
    const entries = this.repairEntries().filter(entry => targets.some(item => item.packageName === entry.packageName))
    const result = await repairLegacyBundledPluginSources({ home, entries,
      sourceDshHome: this.options.sourceDshHome ?? this.options.dshHome,
      resourcesDirectory: this.options.resourcesDirectory, approvedPackages: targets.map(item => item.packageName) })
    if (result.repaired.length !== targets.length || result.unresolved.length !== 0) throw new Error('desktop: source repair did not complete')
    return entries.map(entry => ({ archivePath: join(home, 'bundled-plugins', entry.archive), entry }))
  }

  /**
   * Adopt one preset when it is the only missing archive source.
   * @param home - Owned transaction candidate home.
   * @param packageName - Exact package selected in the repair confirmation.
   * @param expectedVersion - Current bundled version the user reviewed.
   * @returns Verified candidate archive and trusted manifest entry.
   */
  async repairSourceInCandidate(
    home: string, packageName: string, expectedVersion: string,
  ): Promise<{ archivePath: string; entry: BundledPluginManifestEntry }> {
    if (!this.repairEntries().some(entry => entry.packageName === packageName && entry.version === expectedVersion)) {
      throw new Error('desktop: source repair package or version is not bundled')
    }
    const result = await this.repairSourcesInCandidate(home, [{ packageName, version: expectedVersion }])
    const replacement = result[0]
    if (replacement === undefined) throw new Error('desktop: source repair did not complete')
    return replacement
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
    let preparationFailed = false
    for (const [index, entry] of entries.entries()) {
      if (this.options.isStartupCancelled?.()) throw new Error('desktop: startup preparation cancelled')
      const report = (progress: BundledPluginSeedProgress): void => {
        try {
          onProgress?.({ ...progress, entry, index, total: entries.length })
        } catch {
          // A presentation observer cannot interrupt plugin installation.
        }
      }
      try {
        if (preparationFailed) {
          results.push({ entry })
          await this.options.onStartupDeferred?.(entry, 'preparation-failed')
          continue
        }
        if (!this.options.requireCompleteStartup && await bundledPluginSeedIsSettled(
          this.options.dshHome,
          entry,
          this.options.repairLegacyMarkers ?? false,
          this.options.sourceDshHome ?? this.options.dshHome,
        )) {
          report({ stage: 'configuring', progress: 100 })
          results.push({ entry, result: 'verified' })
          await this.options.onStartupResult?.(entry, 'verified')
          await this.options.onStartupSuccess?.(entry)
          continue
        }
        if (!this.options.requireCompleteStartup && this.options.shouldAttemptStartup !== undefined
          && !await this.options.shouldAttemptStartup(entry)) {
          report({ stage: 'configuring', progress: 100 })
          results.push({ entry })
          await this.options.onStartupDeferred?.(entry, 'cooldown')
          continue
        }
        if (!this.options.requireCompleteStartup && (this.options.now?.() ?? Date.now()) >= deadline) {
          report({ stage: 'configuring', progress: 100 })
          results.push({ entry })
          await this.options.onStartupDeferred?.(entry, 'budget')
          continue
        }
        report({ stage: 'verifying', progress: 0 })
        const result = this.options.withStartupTransaction === undefined
          ? await this.seed(entry, this.options.requireCompleteStartup ?? false, report)
          : await this.options.withStartupTransaction(entry, () => this.seed(entry, this.options.requireCompleteStartup ?? false, report))
        if (result === 'verified' || result === 'removed' || result === 'unresolved') {
          report({ stage: 'configuring', progress: 100 })
        }
        results.push({ entry, result })
        await this.options.onStartupResult?.(entry, result)
        if (result !== 'unresolved') await this.options.onStartupSuccess?.(entry)
      } catch (error) {
        if (this.options.isStartupCancelled?.()) throw error
        if (error instanceof CandidatePreparationError) preparationFailed = true
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
    if (await bundledPluginSeedIsSettled(
      this.options.dshHome,
      entry,
      this.options.repairLegacyMarkers ?? false,
      this.options.sourceDshHome ?? this.options.dshHome,
    )) return { handled: true }
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

  private startJob(entry: BundledPluginManifestEntry, restoreBundledVersion: boolean): BundledPluginStartResult {
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
    void this.runJob(job, entry, restoreBundledVersion)
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
    restoreBundledVersion: boolean,
    onProgress?: (progress: BundledPluginSeedProgress) => void,
  ): Promise<SeedBundledPluginResult> {
    return seedBundledPlugin({
      entry,
      resourcesDirectory: this.options.resourcesDirectory,
      dshHome: this.options.dshHome,
      sourceDshHome: this.options.sourceDshHome ?? this.options.dshHome,
      install: this.options.install,
      ...(this.options.prepare === undefined ? {} : { prepare: this.options.prepare }),
      restoreBundledVersion,
      repairLegacyMarker: this.options.repairLegacyMarkers ?? false,
      ...(this.options.onReconciled === undefined ? {} : { onReconciled: this.options.onReconciled }),
      ...(onProgress === undefined ? {} : { onProgress }),
    })
  }

  private async runJob(
    job: InstallJob,
    entry: BundledPluginManifestEntry,
    restoreBundledVersion: boolean,
  ): Promise<void> {
    this.options.onManagedMutationStart?.(entry)
    try {
      const operation = () => this.seed(entry, restoreBundledVersion, (progress) => {
        if (job.snapshot.phase !== 'running') return
        job.snapshot = { ...job.snapshot, ...progress }
      })
      if (this.options.withManagedTransaction === undefined) await operation()
      else await this.options.withManagedTransaction(entry, operation)
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

/** Read the narrow plugin inventory shown by the Desktop recovery page. */

import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import semver from 'semver'
import type { ProfileRecoveryDiagnostic } from './profile-recovery-diagnostic.ts'
import type { PluginSnapshotSummary } from './plugin-snapshot-manager.ts'

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/iu
const MAX_MANIFEST_BYTES = 1024 * 1024

/** Recovery-safe installation-source category without a local filesystem path. */
export type RecoveryPluginSource = 'registry' | 'bundled' | 'local' | 'other'

/** One directly installed external plugin presented by the recovery page. */
export interface RecoveryPluginSummary {
  readonly packageName: string
  readonly version?: string
  readonly source: RecoveryPluginSource
  readonly status: 'attention' | 'unverified' | 'paused'
  readonly installation: 'installed' | 'missing' | 'unverified'
  readonly activation: 'unverified' | 'paused'
  readonly recordedDiagnosticCode?: string
  readonly repairVersion?: string
  readonly diagnosticCode?: string
  readonly rollbackVersion?: string
}

/**
 * Resolve the most recent retained lower version of one plugin; safety snapshots are excluded.
 * @param plugin - Current direct dependency identity and resolved version.
 * @param snapshots - Host-owned snapshot catalog; source paths never enter the renderer.
 * @returns Exact install target, or undefined when no restorable previous version is known.
 */
export function recoveryPluginRollbackTarget(
  plugin: RecoveryPluginSummary,
  snapshots: readonly PluginSnapshotSummary[],
): { version: string; packageSpec: string } | undefined {
  if (plugin.version === undefined || semver.valid(plugin.version) === null) return undefined
  for (const snapshot of [...snapshots].filter(item => item.kind !== 'safety').sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const previous = snapshot.packages.find(item => item.name === plugin.packageName)
    if (previous?.version === undefined || semver.valid(previous.version) === null
      || !semver.lt(previous.version, plugin.version)) continue
    if (previous.source === 'registry') {
      return { version: previous.version, packageSpec: `${plugin.packageName}@${previous.version}` }
    }
  }
  return undefined
}

/** Complete recovery-page inventory; installation-owned bundles stay protected. */
export interface RecoveryPluginInventory {
  readonly plugins: readonly RecoveryPluginSummary[]
  readonly protectedCount: number
}

interface ProfileManifest {
  readonly dependencies?: Record<string, unknown>
  readonly dsh?: { readonly profile?: { readonly bundles?: unknown[] } }
}

interface DiagnosticReport {
  readonly schema?: unknown
  readonly profile?: unknown
  readonly issues?: Array<{
    readonly code?: unknown
    readonly attribution?: { readonly rootPackage?: unknown }
  }>
}

async function readJson(path: string): Promise<unknown> {
  const stat = await lstat(path)
  if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) throw new Error('desktop: recovery metadata is unavailable')
  return JSON.parse(await readFile(path, 'utf8'))
}

function classifySource(spec: string, dshHome: string): RecoveryPluginSource {
  if (spec.startsWith('file:')) {
    const normalized = spec.slice('file:'.length).replaceAll('\\', '/')
    const bundled = join(dshHome, 'bundled-plugins').replaceAll('\\', '/')
    return normalized.startsWith(`${bundled}/`) ? 'bundled' : 'local'
  }
  if (spec.startsWith('link:') || spec.startsWith('workspace:')) return 'local'
  if (/^(?:[~^<>=*]|\d|npm:)/u.test(spec)) return 'registry'
  return 'other'
}

async function installedPackage(
  profileDir: string, packageName: string,
): Promise<{ readonly version?: string; readonly installation: RecoveryPluginSummary['installation'] }> {
  try {
    const value = await readJson(join(profileDir, 'node_modules', ...packageName.split('/'), 'package.json'))
    if (value === null || typeof value !== 'object') return { installation: 'unverified' }
    const manifest = value as { name?: unknown; version?: unknown }
    if (manifest.name !== packageName || typeof manifest.version !== 'string') return { installation: 'unverified' }
    return { version: manifest.version, installation: 'installed' }
  } catch (error) {
    return { installation: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unverified' }
  }
}

async function diagnosticPackages(dshHome: string): Promise<Map<string, string>> {
  try {
    const value = await readJson(join(dshHome, 'profile-health', 'web.diagnostics.json'))
    if (value === null || typeof value !== 'object') return new Map()
    const report = value as DiagnosticReport
    if (report.schema !== 'dsh/profile-diagnostic/v2' || report.profile !== 'web' || !Array.isArray(report.issues)) {
      return new Map()
    }
    const result = new Map<string, string>()
    for (const issue of report.issues) {
      const packageName = issue.attribution?.rootPackage
      if (typeof packageName !== 'string' || !PACKAGE_NAME.test(packageName)
        || typeof issue.code !== 'string' || !/^[a-z0-9._-]{1,120}$/iu.test(issue.code)) continue
      result.set(packageName, issue.code)
    }
    return result
  } catch {
    return new Map()
  }
}

/**
 * Read only direct Profile dependencies and installation-owned bundle count.
 * @param dshHome - Active Harness home selected by Desktop.
 * @param context - Current paused state and live failure evidence, separate from saved reports.
 * @returns Redacted plugin inventory suitable for the recovery renderer.
 */
export async function readRecoveryPluginInventory(
  dshHome: string,
  context: {
    readonly profilePaused?: boolean
    readonly failure?: ProfileRecoveryDiagnostic
    readonly repairVersions?: Readonly<Record<string, string>>
  } = {},
): Promise<RecoveryPluginInventory> {
  const profileDir = join(dshHome, 'profiles', 'web')
  const value = await readJson(join(profileDir, 'package.json'))
  if (value === null || typeof value !== 'object') throw new Error('desktop: invalid Web Profile manifest')
  const manifest = value as ProfileManifest
  const dependencies = Object.entries(manifest.dependencies ?? {})
    .filter((entry): entry is [string, string] => PACKAGE_NAME.test(entry[0]) && typeof entry[1] === 'string')
  const dependencyNames = new Set(dependencies.map(([packageName]) => packageName))
  const bundleOrder = (manifest.dsh?.profile?.bundles ?? [])
    .filter((item): item is string => typeof item === 'string')
  const order = new Map(bundleOrder.map((packageName, index) => [packageName, index]))
  const diagnostics = await diagnosticPackages(dshHome)
  const plugins = await Promise.all(dependencies.map(async ([packageName, spec]) => {
    const recordedDiagnosticCode = diagnostics.get(packageName)
    const missingArchive = context.failure?.missingArchive
    let sourceArchive: string | undefined
    if (spec.startsWith('file:')) {
      try { sourceArchive = decodeURIComponent(spec.slice(5)).replaceAll('\\', '/').split('/').at(-1) } catch { /* Invalid locators remain unverified. */ }
    }
    const missingSource = context.failure?.category === 'missing-local-archive' && missingArchive !== undefined
      && (context.failure.rootPackage === undefined || context.failure.rootPackage === packageName)
      && sourceArchive === missingArchive
    const blockedOperation = context.failure?.blockedPackage === packageName
    const diagnosticCode = missingSource ? 'desktop.plugin-archive-missing' : blockedOperation ? 'desktop.plugin-operation-blocked' : undefined
    const repairVersion = missingSource ? context.repairVersions?.[packageName] : undefined
    const { version, installation } = await installedPackage(profileDir, packageName)
    return {
      packageName,
      ...(version === undefined ? {} : { version }),
      source: classifySource(spec, dshHome),
      status: diagnosticCode !== undefined ? 'attention' as const : context.profilePaused === true ? 'paused' as const : 'unverified' as const,
      installation,
      activation: context.profilePaused === true ? 'paused' as const : 'unverified' as const,
      ...(recordedDiagnosticCode === undefined ? {} : { recordedDiagnosticCode }),
      ...(repairVersion === undefined ? {} : { repairVersion }),
      ...(diagnosticCode === undefined ? {} : { diagnosticCode }),
    }
  }))
  plugins.sort((left, right) => {
    const rank = (status: RecoveryPluginSummary['status']): number => status === 'attention' ? 0 : 1
    if (rank(left.status) !== rank(right.status)) return rank(left.status) - rank(right.status)
    const leftIndex = order.get(left.packageName) ?? Number.MAX_SAFE_INTEGER
    const rightIndex = order.get(right.packageName) ?? Number.MAX_SAFE_INTEGER
    return leftIndex - rightIndex || left.packageName.localeCompare(right.packageName)
  })
  const protectedCount = new Set(bundleOrder.filter(packageName => !dependencyNames.has(packageName))).size
  return { plugins, protectedCount }
}

/** Validate the only renderer-supplied value accepted by plugin removal. */
export function isRecoveryPluginPackageName(value: unknown): value is string {
  return typeof value === 'string' && PACKAGE_NAME.test(value)
}

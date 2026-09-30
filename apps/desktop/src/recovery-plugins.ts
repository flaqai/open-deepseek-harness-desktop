/** Read the narrow plugin inventory shown by the Desktop recovery page. */

import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/iu
const MAX_MANIFEST_BYTES = 1024 * 1024

/** Recovery-safe installation-source category without a local filesystem path. */
export type RecoveryPluginSource = 'registry' | 'bundled' | 'local' | 'other'

/** One directly installed external plugin presented by the recovery page. */
export interface RecoveryPluginSummary {
  readonly packageName: string
  readonly version?: string
  readonly source: RecoveryPluginSource
  readonly status: 'attention' | 'normal'
  readonly diagnosticCode?: string
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

async function installedVersion(profileDir: string, packageName: string): Promise<string | undefined> {
  try {
    const value = await readJson(join(profileDir, 'node_modules', ...packageName.split('/'), 'package.json'))
    if (value === null || typeof value !== 'object') return undefined
    const manifest = value as { name?: unknown; version?: unknown }
    if (manifest.name !== packageName || typeof manifest.version !== 'string') return undefined
    return manifest.version
  } catch {
    return undefined
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
      if (typeof packageName !== 'string' || !PACKAGE_NAME.test(packageName) || typeof issue.code !== 'string') continue
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
 * @returns Redacted plugin inventory suitable for the recovery renderer.
 */
export async function readRecoveryPluginInventory(dshHome: string): Promise<RecoveryPluginInventory> {
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
    const diagnosticCode = diagnostics.get(packageName)
    const version = await installedVersion(profileDir, packageName)
    return {
      packageName,
      ...(version === undefined ? {} : { version }),
      source: classifySource(spec, dshHome),
      status: diagnosticCode === undefined ? 'normal' as const : 'attention' as const,
      ...(diagnosticCode === undefined ? {} : { diagnosticCode }),
    }
  }))
  plugins.sort((left, right) => {
    if (left.status !== right.status) return left.status === 'attention' ? -1 : 1
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

/** Verify immutable provider pins independently from the current core release. */
import assert from 'node:assert/strict'
import semver from 'semver'
import type { DesktopExternalToolId, ExternalToolCompatibilityManifest } from '../src/external-tool-compatibility-manifest.ts'

/** Current workspace provider identity and its exact runtime dependency. */
export interface ExternalToolSourceProvider {
  readonly name: string
  readonly version: string
  readonly dependencies: Readonly<Record<string, string>>
}

/** Published metadata used to verify the pinned provider's runtime and core requirements. */
export interface ExternalToolPublishedProvider {
  readonly name?: unknown
  readonly version?: unknown
  readonly dependencies?: Readonly<Record<string, string>>
  readonly engines?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
}

/** Bind the review to the immutable provider version and the current runtime dependency.
 * @param manifest - Reviewed Desktop manifest, unchanged after publication.
 * @param toolId - Provider being checked.
 * @param provider - Current source provider, whose core release can advance independently.
 */
export function assertExternalToolSourcePins(
  manifest: ExternalToolCompatibilityManifest,
  toolId: DesktopExternalToolId,
  provider: ExternalToolSourceProvider,
): void {
  const coordinate = manifest.tools[toolId]
  assert.equal(coordinate.packageName, provider.name, 'external-tool gate: provider identity drifted')
  assert.equal(manifest.reviewedSourceVersion, coordinate.version,
    `external-tool gate: ${toolId} review must identify its pinned provider source version`)
  assert.equal(coordinate.runtimePackage.version, provider.dependencies[coordinate.runtimePackage.packageName],
    `external-tool gate: ${toolId} reviewed runtime must match the current source baseline`)
}

/** Reject a pinned provider whose published requirements do not accept the current core.
 * @param manifest - Immutable provider and runtime pins.
 * @param toolId - Provider being checked.
 * @param provider - Current source provider identity and core version.
 * @param published - Registry metadata for the exact pinned provider.
 */
export function assertExternalToolPublishedProvider(
  manifest: ExternalToolCompatibilityManifest,
  toolId: DesktopExternalToolId,
  provider: ExternalToolSourceProvider,
  published: ExternalToolPublishedProvider,
): void {
  assertExternalToolSourcePins(manifest, toolId, provider)
  const coordinate = manifest.tools[toolId]
  assert.equal(published.name, coordinate.packageName, 'external-tool gate: published provider identity drifted')
  assert.equal(published.version, coordinate.version, 'external-tool gate: published provider version drifted')
  assert.equal(published.dependencies?.[coordinate.runtimePackage.packageName], coordinate.runtimePackage.version,
    `external-tool gate: ${coordinate.packageName} must depend on the reviewed runtime version`)
  assert.notEqual(semver.valid(provider.version), null, 'external-tool gate: current core version must be semantic')
  const requirements = published.engines !== undefined && Object.hasOwn(published.engines, 'dsh')
    ? [['engines.dsh', published.engines.dsh] as const]
    : Object.entries(published.peerDependencies ?? {}).filter(([name]) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))
  assert.notEqual(requirements.length, 0, `external-tool gate: ${coordinate.packageName} declares no DSH compatibility requirement`)
  for (const [name, range] of requirements) {
    assert.ok(typeof range === 'string' && range.trim() !== ''
      && semver.satisfies(provider.version, range, { includePrerelease: true }),
    `external-tool gate: ${coordinate.packageName}@${coordinate.version} requires ${name} ${JSON.stringify(range)}, `
      + `which does not accept current core ${provider.version}; prepare a new Desktop version and reviewed manifest before release`)
  }
}

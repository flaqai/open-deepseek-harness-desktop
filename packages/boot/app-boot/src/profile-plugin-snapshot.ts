/** Durable, content-verified rollback points for one Profile plugin stack. */

import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { compare, valid } from 'semver'
import { resolveProfileDir, type ProfileManifest } from './profile.ts'

/** On-disk protocol for a locally retained plugin rollback point. */
export const PROFILE_PLUGIN_SNAPSHOT_SCHEMA = 'dsh/profile-plugin-snapshot/v1' as const

/** Why a snapshot exists and how retention treats it. */
export type ProfilePluginSnapshotKind = 'automatic' | 'manual' | 'bootable' | 'safety'

/** Stable automatic mutation classes shown by the desktop UI. */
export type ProfilePluginSnapshotTrigger =
  | 'plugin-add'
  | 'plugin-remove'
  | 'plugin-update'
  | 'plugin-install'
  | 'build-approval'
  | 'diagnostic-repair'
  | 'quarantine-retry'
  | 'startup-seed'
  | 'manual'
  | 'successful-startup'
  | 'restore-safety'
  | 'other-plugin-mutation'

/** One dependency projected without exposing its raw package specifier. */
export interface ProfilePluginSnapshotPackage {
  readonly name: string
  readonly source: 'registry' | 'git' | 'local' | 'other'
  readonly version?: string
}

/** Immutable file retained inside one snapshot directory. */
export interface ProfilePluginSnapshotFile {
  readonly relativePath: string
  readonly existed: boolean
  readonly sha256?: string
  readonly bytes?: number
}

/** Complete trusted metadata stored beside a snapshot payload. */
export interface ProfilePluginSnapshotRecord {
  readonly schema: typeof PROFILE_PLUGIN_SNAPSHOT_SCHEMA
  readonly snapshotId: string
  readonly profile: string
  readonly kind: ProfilePluginSnapshotKind
  readonly trigger: ProfilePluginSnapshotTrigger
  readonly label?: string
  readonly createdAt: string
  readonly fingerprint: string
  readonly packages: readonly ProfilePluginSnapshotPackage[]
  readonly bundles: readonly string[]
  readonly files: readonly ProfilePluginSnapshotFile[]
  readonly offlineState: 'best-effort' | 'local-source-missing'
  readonly applicationVersion?: string
  readonly nodeVersion: string
  readonly pnpmVersion?: string
}

/** Snapshot returned by creation, including an in-memory automatic deduplication hint. */
export interface CreatedProfilePluginSnapshot extends ProfilePluginSnapshotRecord {
  /** True when an identical retained snapshot was reused and no new payload was written. */
  readonly deduplicated?: true
}

/** Renderer-safe difference between a snapshot and the active Profile. */
export interface ProfilePluginSnapshotDifference {
  readonly added: readonly string[]
  readonly removed: readonly string[]
  readonly changed: readonly string[]
  readonly versionChanges: readonly ProfilePluginSnapshotVersionChange[]
}

/** One package version transition that restoring the snapshot would perform. */
export interface ProfilePluginSnapshotVersionChange {
  readonly name: string
  readonly currentVersion?: string
  readonly snapshotVersion?: string
  readonly direction: 'upgrade' | 'downgrade' | 'change'
}

/** Snapshot metadata plus a current-state comparison. */
export interface ProfilePluginSnapshotSummary extends ProfilePluginSnapshotRecord {
  readonly difference: ProfilePluginSnapshotDifference
}

/** Inputs for one local rollback point. */
export interface CreateProfilePluginSnapshotOptions {
  readonly home?: string
  readonly profile: string
  readonly kind: ProfilePluginSnapshotKind
  readonly trigger: ProfilePluginSnapshotTrigger
  readonly label?: string
  readonly applicationVersion?: string
  readonly pnpmVersion?: string
  readonly now?: () => Date
  readonly snapshotId?: string
}

/** Common Profile selection for snapshot operations. */
export interface ProfilePluginSnapshotOptions {
  readonly home?: string
  readonly profile: string
}

/** Restore result before pnpm materializes the selected dependency graph. */
export interface RestoredProfilePluginSnapshot {
  readonly snapshot: ProfilePluginSnapshotRecord
  readonly restoredFiles: readonly string[]
}

const SNAPSHOT_DIRECTORY = join('plugin-snapshots', 'v1')
const SNAPSHOT_METADATA = 'snapshot.json'
const SNAPSHOT_FILES = 'files'
const SNAPSHOT_LOCK = '.profile-plugin-mutation'
const AUTOMATIC_RETENTION = 10
const SNAPSHOT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const PROFILE_NAME = /^[A-Za-z0-9._~-]{1,64}$/u
const LABEL_MAX_LENGTH = 80
const FIXED_FILES = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
] as const
const HOME_FILES = [
  'quarantine/profile-plugins.json',
  'imported-plugin-restore.v1.json',
  'bundled-plugins/snapshot-version-hold.json',
] as const

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function assertProfile(profile: string): void {
  if (!PROFILE_NAME.test(profile) || profile === '.' || profile === '..') {
    throw new TypeError(`dsh: invalid Profile snapshot name ${JSON.stringify(profile)}`)
  }
}

function assertSnapshotId(snapshotId: string): void {
  if (!SNAPSHOT_ID.test(snapshotId)) {
    throw new TypeError(`dsh: invalid plugin snapshot id ${JSON.stringify(snapshotId)}`)
  }
}

function normalizeLabel(label: string | undefined): string | undefined {
  if (label === undefined) return undefined
  const normalized = label.trim()
  if (normalized.length === 0 || normalized.length > LABEL_MAX_LENGTH || /[\0\r\n]/u.test(normalized)) {
    throw new TypeError('dsh: plugin snapshot label must contain 1 to 80 single-line characters')
  }
  return normalized
}

function snapshotRoot(home: string): string {
  return join(home, SNAPSHOT_DIRECTORY)
}

function safeSnapshotRoot(home: string, create: boolean): string {
  const root = snapshotRoot(home)
  if (!existsSync(root)) {
    if (!create) throw new Error('dsh: plugin snapshot root is unavailable')
    mkdirSync(root, { recursive: true, mode: 0o700 })
  }
  const status = lstatSync(root)
  if (!status.isDirectory() || status.isSymbolicLink()) {
    throw new Error(`dsh: plugin snapshot root is unsafe: ${root}`)
  }
  return root
}

function snapshotDirectory(home: string, snapshotId: string): string {
  assertSnapshotId(snapshotId)
  return join(snapshotRoot(home), snapshotId)
}

function assertInside(root: string, candidate: string): void {
  const path = relative(resolve(root), resolve(candidate))
  if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new Error(`dsh: plugin snapshot path escapes its root: ${candidate}`)
  }
}

function assertPhysicalInside(root: string, candidate: string): void {
  const physicalRoot = realpathSync(root)
  let existing = candidate
  while (!existsSync(existing)) {
    const parent = dirname(existing)
    if (parent === existing) throw new Error(`dsh: plugin snapshot path is unavailable: ${candidate}`)
    existing = parent
  }
  const physicalPath = realpathSync(existing)
  const path = relative(physicalRoot, physicalPath)
  if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new Error(`dsh: plugin snapshot path physically escapes its root: ${candidate}`)
  }
}

function writePrivateFile(path: string, content: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, content, { flag: 'wx', mode: 0o600 })
}

function atomicReplace(path: string, content: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, content, { flag: 'wx', mode: 0o600 })
    renameSync(temporary, path)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}

function regularFileBytes(path: string): Buffer | undefined {
  if (!existsSync(path)) return undefined
  const status = lstatSync(path)
  if (!status.isFile()) throw new Error(`dsh: plugin snapshot refuses non-file source ${path}`)
  return readFileSync(path)
}

function managedFiles(home: string, profile: string): Array<{ relativePath: string; source: string }> {
  const profileDir = resolveProfileDir(profile, home)
  const files = [
    ...FIXED_FILES.map(name => ({ relativePath: `profiles/${profile}/${name}`, source: join(profileDir, name) })),
    ...HOME_FILES.map(name => ({ relativePath: name, source: join(home, name) })),
  ]
  const bundledState = join(home, 'bundled-plugins')
  if (existsSync(bundledState)) {
    const status = lstatSync(bundledState)
    if (!status.isDirectory() || status.isSymbolicLink()) {
      throw new Error(`dsh: plugin snapshot refuses unsafe bundled-plugin state at ${bundledState}`)
    }
    for (const entry of readdirSync(bundledState, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.seeded.json')) continue
      files.push({
        relativePath: `bundled-plugins/${entry.name}`,
        source: join(bundledState, entry.name),
      })
    }
  }
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

function packageSource(spec: string): ProfilePluginSnapshotPackage['source'] {
  if (/^(?:file|link|workspace):/u.test(spec) || /^(?:\.{0,2}[/\\]|[/\\])/u.test(spec)) return 'local'
  if (/^(?:git|git\+|github:|https?:\/\/.*\.git(?:#|$))/iu.test(spec)) return 'git'
  if (/^(?:\^|~|>=?|<=?|=|\*|latest|next|beta|alpha|[0-9])/u.test(spec)) return 'registry'
  return 'other'
}

function packageVersion(spec: string): string | undefined {
  return /^(?:\^|~|=)?(?<version>[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?)/u.exec(spec)?.groups?.version
}

function readManifest(path: string): ProfileManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as ProfileManifest
}

function packageProjection(manifest: ProfileManifest): ProfilePluginSnapshotPackage[] {
  return Object.entries(manifest.dependencies ?? {}).map(([name, spec]) => {
    const source = packageSource(spec)
    const version = source === 'registry' ? packageVersion(spec) : undefined
    return { name, source, ...(version === undefined ? {} : { version }) }
  })
}

function localSourcePath(profileDir: string, spec: string): string | undefined {
  const withoutProtocol = /^(?:file|link):(?<path>.*)$/u.exec(spec)?.groups?.path ?? spec
  if (!/^(?:\.{0,2}[/\\]|[/\\]|[A-Za-z]:[/\\])/u.test(withoutProtocol)) return undefined
  return isAbsolute(withoutProtocol) ? withoutProtocol : resolve(profileDir, withoutProtocol)
}

function offlineState(profileDir: string, manifest: ProfileManifest): ProfilePluginSnapshotRecord['offlineState'] {
  for (const spec of Object.values(manifest.dependencies ?? {})) {
    if (packageSource(spec) !== 'local') continue
    const path = localSourcePath(profileDir, spec)
    if (path === undefined || !existsSync(path)) return 'local-source-missing'
  }
  return 'best-effort'
}

function fingerprint(files: readonly ProfilePluginSnapshotFile[]): string {
  return sha256(files.map(file => `${file.relativePath}\0${file.existed ? file.sha256 : '-'}\n`).join(''))
}

function validSnapshotFile(value: unknown): value is ProfilePluginSnapshotFile {
  if (typeof value !== 'object' || value === null) return false
  const file = value as Record<string, unknown>
  return typeof file.relativePath === 'string' && typeof file.existed === 'boolean'
    && (!file.existed || (typeof file.sha256 === 'string' && /^[0-9a-f]{64}$/u.test(file.sha256)
      && typeof file.bytes === 'number' && Number.isSafeInteger(file.bytes) && file.bytes >= 0))
}

function validSnapshotPackage(value: unknown): value is ProfilePluginSnapshotPackage {
  if (typeof value !== 'object' || value === null) return false
  const pkg = value as Record<string, unknown>
  return typeof pkg.name === 'string' && typeof pkg.source === 'string'
    && ['registry', 'git', 'local', 'other'].includes(pkg.source)
    && (pkg.version === undefined || typeof pkg.version === 'string')
}

function readRecord(home: string, snapshotId: string): ProfilePluginSnapshotRecord {
  const root = safeSnapshotRoot(home, false)
  const directory = snapshotDirectory(home, snapshotId)
  assertInside(root, directory)
  if (!existsSync(directory)) throw new Error(`dsh: plugin snapshot metadata is unavailable: ${snapshotId}`)
  const directoryStatus = lstatSync(directory)
  if (!directoryStatus.isDirectory() || directoryStatus.isSymbolicLink()) {
    throw new Error(`dsh: plugin snapshot directory is unsafe: ${snapshotId}`)
  }
  const metadataPath = join(directory, SNAPSHOT_METADATA)
  if (!existsSync(metadataPath) || lstatSync(metadataPath).isSymbolicLink()) {
    throw new Error(`dsh: plugin snapshot metadata is unavailable: ${snapshotId}`)
  }
  const value = JSON.parse(readFileSync(metadataPath, 'utf8')) as Partial<ProfilePluginSnapshotRecord>
  if (value.schema !== PROFILE_PLUGIN_SNAPSHOT_SCHEMA || value.snapshotId !== snapshotId
    || typeof value.profile !== 'string' || !PROFILE_NAME.test(value.profile)
    || !['automatic', 'manual', 'bootable', 'safety'].includes(value.kind ?? '')
    || ![
      'plugin-add', 'plugin-remove', 'plugin-update', 'plugin-install', 'build-approval',
      'diagnostic-repair', 'quarantine-retry', 'startup-seed', 'manual', 'successful-startup',
      'restore-safety', 'other-plugin-mutation',
    ].includes(value.trigger ?? '')
    || !Array.isArray(value.files) || !Array.isArray(value.packages) || !Array.isArray(value.bundles)
    || typeof value.createdAt !== 'string' || Number.isNaN(Date.parse(value.createdAt))
    || typeof value.fingerprint !== 'string' || !/^[0-9a-f]{64}$/u.test(value.fingerprint)
    || !['best-effort', 'local-source-missing'].includes(value.offlineState ?? '')
    || value.nodeVersion === undefined || typeof value.nodeVersion !== 'string'
    || (value.label !== undefined && typeof value.label !== 'string')
    || (value.applicationVersion !== undefined && typeof value.applicationVersion !== 'string')
    || (value.pnpmVersion !== undefined && typeof value.pnpmVersion !== 'string')) {
    throw new Error(`dsh: invalid plugin snapshot metadata: ${snapshotId}`)
  }
  const files: readonly unknown[] = value.files
  const packages: readonly unknown[] = value.packages
  const bundles: readonly unknown[] = value.bundles
  if (!files.every(validSnapshotFile)
    || new Set(files.map(file => file.relativePath)).size !== files.length
    || !packages.every(validSnapshotPackage)
    || !bundles.every(bundle => typeof bundle === 'string')) {
    throw new Error(`dsh: invalid plugin snapshot metadata: ${snapshotId}`)
  }
  return value as ProfilePluginSnapshotRecord
}

function snapshotPayloadIsValid(home: string, record: ProfilePluginSnapshotRecord): boolean {
  try {
    const payloadRoot = join(snapshotDirectory(home, record.snapshotId), SNAPSHOT_FILES)
    for (const file of record.files) {
      if (!allowedSnapshotFile(record.profile, file.relativePath)) return false
      if (!file.existed) continue
      const payload = join(payloadRoot, file.relativePath)
      assertInside(payloadRoot, payload)
      assertPhysicalInside(payloadRoot, payload)
      const bytes = regularFileBytes(payload)
      if (bytes === undefined || bytes.length !== file.bytes || sha256(bytes) !== file.sha256) return false
    }
    return true
  } catch {
    return false
  }
}

function currentFingerprint(
  home: string,
  profile: string,
  relativePaths?: readonly string[],
): string | undefined {
  const manifest = join(resolveProfileDir(profile, home), 'package.json')
  if (!existsSync(manifest)) return undefined
  const selected = relativePaths === undefined
    ? managedFiles(home, profile)
    : relativePaths.map((relativePath) => {
      if (!allowedSnapshotFile(profile, relativePath)) {
        throw new Error(`dsh: plugin snapshot contains unmanaged path ${relativePath}`)
      }
      const source = join(home, relativePath)
      assertInside(home, source)
      assertPhysicalInside(home, source)
      return { relativePath, source }
    })
  const files = selected.map(({ relativePath, source }) => {
    const bytes = regularFileBytes(source)
    return bytes === undefined
      ? { relativePath, existed: false as const }
      : { relativePath, existed: true as const, sha256: sha256(bytes), bytes: bytes.length }
  })
  return fingerprint(files)
}

function pruneAutomaticSnapshots(home: string, profile: string): void {
  const automatic = listProfilePluginSnapshots({ home, profile })
    .filter(snapshot => snapshot.kind === 'automatic')
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  for (const snapshot of automatic.slice(AUTOMATIC_RETENTION)) {
    rmSync(snapshotDirectory(home, snapshot.snapshotId), { recursive: true, force: true })
  }
}

/**
 * Capture the current plugin source state without copying installed modules.
 * @param options - Profile identity, retention kind, and local presentation metadata.
 * @returns Immutable snapshot metadata.
 */
export function createProfilePluginSnapshot(
  options: CreateProfilePluginSnapshotOptions,
): CreatedProfilePluginSnapshot {
  assertProfile(options.profile)
  const home = options.home ?? resolveDshHome()
  const profileDir = resolveProfileDir(options.profile, home)
  const manifestPath = join(profileDir, 'package.json')
  if (!existsSync(manifestPath)) throw new Error(`dsh: Profile ${options.profile} is not initialized`)
  const label = normalizeLabel(options.label)
  const snapshotId = options.snapshotId ?? randomUUID()
  assertSnapshotId(snapshotId)
  const root = safeSnapshotRoot(home, true)
  const destination = snapshotDirectory(home, snapshotId)
  if (existsSync(destination)) throw new Error(`dsh: plugin snapshot already exists: ${snapshotId}`)
  const captured = managedFiles(home, options.profile).map((file) => {
    assertPhysicalInside(home, file.source)
    const bytes = regularFileBytes(file.source)
    const metadata: ProfilePluginSnapshotFile = bytes === undefined
      ? { relativePath: file.relativePath, existed: false }
      : { relativePath: file.relativePath, existed: true, sha256: sha256(bytes), bytes: bytes.length }
    return { ...file, bytes, metadata }
  })
  const capturedFingerprint = fingerprint(captured.map(file => file.metadata))
  if (options.kind === 'automatic') {
    const duplicate = listProfilePluginSnapshots({ home, profile: options.profile })
      .find(snapshot => snapshot.kind !== 'safety'
        && snapshot.fingerprint === capturedFingerprint)
    if (duplicate !== undefined) return { ...duplicate, deduplicated: true }
  }
  const temporary = join(root, `.${snapshotId}.${process.pid}.tmp`)
  mkdirSync(temporary, { mode: 0o700 })
  try {
    const files: ProfilePluginSnapshotFile[] = []
    for (const file of captured) {
      files.push(file.metadata)
      if (file.bytes === undefined) continue
      const payload = join(temporary, SNAPSHOT_FILES, file.relativePath)
      assertInside(join(temporary, SNAPSHOT_FILES), payload)
      writePrivateFile(payload, file.bytes)
    }
    const manifest = readManifest(manifestPath)
    const record: ProfilePluginSnapshotRecord = {
      schema: PROFILE_PLUGIN_SNAPSHOT_SCHEMA,
      snapshotId,
      profile: options.profile,
      kind: options.kind,
      trigger: options.trigger,
      ...(label === undefined ? {} : { label }),
      createdAt: (options.now ?? (() => new Date()))().toISOString(),
      fingerprint: capturedFingerprint,
      packages: packageProjection(manifest),
      bundles: [...manifest.dsh?.profile?.bundles ?? []],
      files,
      offlineState: offlineState(profileDir, manifest),
      ...(options.applicationVersion === undefined ? {} : { applicationVersion: options.applicationVersion }),
      nodeVersion: process.version,
      ...(options.pnpmVersion === undefined ? {} : { pnpmVersion: options.pnpmVersion }),
    }
    writePrivateFile(join(temporary, SNAPSHOT_METADATA), `${JSON.stringify(record, undefined, 2)}\n`)
    renameSync(temporary, destination)
    if (options.kind === 'bootable') {
      for (const previous of listProfilePluginSnapshots({ home, profile: options.profile })) {
        if (previous.kind === 'bootable' && previous.snapshotId !== snapshotId) {
          rmSync(snapshotDirectory(home, previous.snapshotId), { recursive: true, force: true })
        }
      }
    }
    if (options.kind === 'automatic') pruneAutomaticSnapshots(home, options.profile)
    return record
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true })
    throw error
  }
}

function packageMap(packages: readonly ProfilePluginSnapshotPackage[]): Map<string, ProfilePluginSnapshotPackage> {
  return new Map(packages.map(entry => [entry.name, entry]))
}

function difference(
  snapshot: readonly ProfilePluginSnapshotPackage[],
  current: readonly ProfilePluginSnapshotPackage[],
): ProfilePluginSnapshotDifference {
  const before = packageMap(snapshot)
  const after = packageMap(current)
  const added = [...after.keys()].filter(name => !before.has(name)).sort()
  const removed = [...before.keys()].filter(name => !after.has(name)).sort()
  const changed = [...before.keys()].filter((name) => {
    const left = before.get(name)
    const right = after.get(name)
    return right !== undefined && (left?.source !== right.source || left.version !== right.version)
  }).sort()
  const versionChanges = changed.map((name): ProfilePluginSnapshotVersionChange => {
    const snapshotVersion = before.get(name)?.version
    const currentVersion = after.get(name)?.version
    let direction: ProfilePluginSnapshotVersionChange['direction'] = 'change'
    if (snapshotVersion !== undefined && currentVersion !== undefined
      && valid(snapshotVersion) !== null && valid(currentVersion) !== null) {
      const order = compare(snapshotVersion, currentVersion)
      if (order > 0) direction = 'upgrade'
      if (order < 0) direction = 'downgrade'
    }
    return {
      name,
      ...(currentVersion === undefined ? {} : { currentVersion }),
      ...(snapshotVersion === undefined ? {} : { snapshotVersion }),
      direction,
    }
  })
  return { added, removed, changed, versionChanges }
}

/**
 * List valid snapshots for one Profile, newest first.
 * @param options - Profile and optional Harness home.
 * @returns Renderer-safe records with current-state differences.
 */
export function listProfilePluginSnapshots(
  options: ProfilePluginSnapshotOptions,
): ProfilePluginSnapshotSummary[] {
  assertProfile(options.profile)
  const home = options.home ?? resolveDshHome()
  const root = snapshotRoot(home)
  if (!existsSync(root)) return []
  safeSnapshotRoot(home, false)
  let current: ProfilePluginSnapshotPackage[] = []
  const manifestPath = join(resolveProfileDir(options.profile, home), 'package.json')
  if (existsSync(manifestPath)) current = packageProjection(readManifest(manifestPath))
  const output: ProfilePluginSnapshotSummary[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !SNAPSHOT_ID.test(entry.name)) continue
    try {
      const record = readRecord(home, entry.name)
      if (record.profile !== options.profile) continue
      if (!snapshotPayloadIsValid(home, record)) continue
      output.push({ ...record, difference: difference(record.packages, current) })
    } catch {
      // A damaged snapshot stays unavailable instead of hiding healthy entries.
    }
  }
  return output.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

/**
 * Remove one user-selected snapshot. Safety points are retained until their restore journal settles.
 * @param options - Profile identity and opaque snapshot id.
 * @returns Whether a matching snapshot was removed.
 */
export function removeProfilePluginSnapshot(
  options: ProfilePluginSnapshotOptions & { readonly snapshotId: string },
): boolean {
  const home = options.home ?? resolveDshHome()
  const record = readRecord(home, options.snapshotId)
  if (record.profile !== options.profile) throw new Error('dsh: plugin snapshot belongs to another Profile')
  if (record.kind === 'safety') throw new Error('dsh: an active restore safety point cannot be removed')
  if (record.kind === 'bootable') throw new Error('dsh: the last successful startup snapshot cannot be removed')
  rmSync(snapshotDirectory(home, options.snapshotId), { recursive: true, force: true })
  return true
}

/**
 * Delete an automatic pre-change point when its operation made no managed-file change.
 * @param options - Profile and snapshot identity.
 * @returns The retained record, or undefined when the unchanged point was removed.
 */
export function finalizeProfilePluginSnapshot(
  options: ProfilePluginSnapshotOptions & {
    readonly snapshotId: string
    readonly preserveIfUnchanged?: boolean
  },
): ProfilePluginSnapshotRecord | undefined {
  const home = options.home ?? resolveDshHome()
  const record = readRecord(home, options.snapshotId)
  if (record.profile !== options.profile) throw new Error('dsh: plugin snapshot belongs to another Profile')
  if (record.kind === 'automatic'
    && currentFingerprint(home, options.profile, record.files.map(file => file.relativePath)) === record.fingerprint) {
    if (options.preserveIfUnchanged === true) return record
    rmSync(snapshotDirectory(home, options.snapshotId), { recursive: true, force: true })
    return undefined
  }
  return record
}

function allowedSnapshotFile(profile: string, relativePath: string): boolean {
  return FIXED_FILES.some(name => relativePath === `profiles/${profile}/${name}`)
    || HOME_FILES.includes(relativePath as typeof HOME_FILES[number])
    || /^bundled-plugins\/[A-Za-z0-9._~-]+\.seeded\.json$/u.test(relativePath)
}

/**
 * Restore only plugin-stack source files after verifying every retained byte.
 * The caller owns Harness suspension, pnpm materialization, health validation, and rollback.
 * @param options - Profile and opaque snapshot identity.
 * @returns Restored record and paths for diagnostics.
 */
export function restoreProfilePluginSnapshotFiles(
  options: ProfilePluginSnapshotOptions & { readonly snapshotId: string },
): RestoredProfilePluginSnapshot {
  const home = options.home ?? resolveDshHome()
  const record = readRecord(home, options.snapshotId)
  if (record.profile !== options.profile) throw new Error('dsh: plugin snapshot belongs to another Profile')
  const directory = snapshotDirectory(home, options.snapshotId)
  const payloads = new Map<string, Buffer>()
  for (const file of record.files) {
    if (!allowedSnapshotFile(options.profile, file.relativePath)) {
      throw new Error(`dsh: plugin snapshot contains unmanaged path ${file.relativePath}`)
    }
    const destination = join(home, file.relativePath)
    assertInside(home, destination)
    assertPhysicalInside(home, destination)
    if (!file.existed) continue
    const payload = join(directory, SNAPSHOT_FILES, file.relativePath)
    assertInside(join(directory, SNAPSHOT_FILES), payload)
    assertPhysicalInside(join(directory, SNAPSHOT_FILES), payload)
    const bytes = regularFileBytes(payload)
    if (bytes === undefined || sha256(bytes) !== file.sha256 || bytes.length !== file.bytes) {
      throw new Error(`dsh: plugin snapshot checksum mismatch: ${file.relativePath}`)
    }
    payloads.set(file.relativePath, bytes)
  }
  const expectedSeedMarkers = new Set(record.files
    .filter(file => file.existed && file.relativePath.startsWith('bundled-plugins/'))
    .map(file => basename(file.relativePath)))
  const bundledState = join(home, 'bundled-plugins')
  if (existsSync(bundledState)) {
    assertPhysicalInside(home, bundledState)
    const bundledStatus = lstatSync(bundledState)
    if (!bundledStatus.isDirectory() || bundledStatus.isSymbolicLink()) {
      throw new Error(`dsh: plugin snapshot refuses unsafe bundled-plugin state at ${bundledState}`)
    }
    for (const entry of readdirSync(bundledState, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.seeded.json') && !expectedSeedMarkers.has(entry.name)) {
        unlinkSync(join(bundledState, entry.name))
      }
    }
  }
  const restoredFiles: string[] = []
  for (const file of record.files) {
    const destination = join(home, file.relativePath)
    assertPhysicalInside(home, destination)
    if (!file.existed) {
      rmSync(destination, { force: true })
      restoredFiles.push(file.relativePath)
      continue
    }
    const bytes = payloads.get(file.relativePath)
    if (bytes === undefined) throw new Error(`dsh: plugin snapshot payload is unavailable: ${file.relativePath}`)
    atomicReplace(destination, bytes)
    restoredFiles.push(file.relativePath)
  }
  if (record.kind !== 'safety') {
    const versions = record.files.flatMap((file) => {
      if (!file.existed || !file.relativePath.startsWith('bundled-plugins/')
        || !file.relativePath.endsWith('.seeded.json')) return []
      const bytes = payloads.get(file.relativePath)
      if (bytes === undefined) return []
      try {
        const marker = JSON.parse(bytes.toString('utf8')) as { version?: unknown }
        if (typeof marker.version !== 'string') return []
        return [{ seedId: basename(file.relativePath, '.seeded.json'), version: marker.version }]
      } catch {
        return []
      }
    })
    const versionHold = join(home, 'bundled-plugins', 'snapshot-version-hold.json')
    assertPhysicalInside(home, versionHold)
    atomicReplace(versionHold, `${JSON.stringify({
      schema: 1,
      snapshotId: record.snapshotId,
      versions,
    }, undefined, 2)}\n`)
    restoredFiles.push('bundled-plugins/snapshot-version-hold.json')
  }
  return { snapshot: record, restoredFiles }
}

/**
 * Remove the short-lived safety point after its restore journal commits or rolls back.
 * @param options - Profile identity and safety snapshot id.
 * @returns Whether the safety point was removed.
 */
export function settleProfilePluginSafetySnapshot(
  options: ProfilePluginSnapshotOptions & { readonly snapshotId: string },
): boolean {
  const home = options.home ?? resolveDshHome()
  const record = readRecord(home, options.snapshotId)
  if (record.profile !== options.profile) throw new Error('dsh: plugin snapshot belongs to another Profile')
  if (record.kind !== 'safety') throw new Error('dsh: only a restore safety point can be settled')
  rmSync(snapshotDirectory(home, options.snapshotId), { recursive: true, force: true })
  return true
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

function wait(delayMs: number): void {
  const signal = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))
  Atomics.wait(signal, 0, 0, delayMs)
}

/**
 * Acquire the cross-process mutation lock shared by CLI and Electron recovery.
 * @param options - Profile identity, wait budget, and optional Harness home.
 * @returns Idempotent release callback.
 */
export function acquireProfilePluginMutationLock(
  options: ProfilePluginSnapshotOptions & { readonly waitMs?: number },
): () => void {
  assertProfile(options.profile)
  const home = options.home ?? resolveDshHome()
  const root = safeSnapshotRoot(home, true)
  const lockPath = join(root, `${SNAPSHOT_LOCK}.${options.profile}.lock`)
  const deadline = Date.now() + (options.waitMs ?? 5_000)
  for (;;) {
    try {
      const descriptor = openSync(lockPath, 'wx', 0o600)
      writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`)
      closeSync(descriptor)
      let released = false
      return () => {
        if (released) return
        released = true
        rmSync(lockPath, { force: true })
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      try {
        const owner = JSON.parse(readFileSync(lockPath, 'utf8')) as { pid?: unknown }
        if (typeof owner.pid === 'number' && Number.isInteger(owner.pid) && !processExists(owner.pid)) {
          rmSync(lockPath, { force: true })
          continue
        }
      } catch {
        // An unreadable owner remains authoritative; another process may still be writing it.
      }
      if (Date.now() >= deadline) {
        throw new Error(`dsh: another process is changing Profile ${options.profile}; close it and retry`)
      }
      wait(50)
    }
  }
}

/**
 * Retain the Profile lock across short-lived CLI children for one desktop-owned batch.
 * The recorded owner must remain alive; a later normal lock acquisition removes a dead lease.
 * @param options - Profile identity, desktop owner process, and unguessable lease token.
 */
export function beginProfilePluginMutationLease(
  options: ProfilePluginSnapshotOptions & { readonly ownerPid: number; readonly token: string },
): void {
  assertProfile(options.profile)
  if (!Number.isSafeInteger(options.ownerPid) || options.ownerPid <= 0 || !processExists(options.ownerPid)) {
    throw new TypeError('dsh: invalid plugin mutation lease owner')
  }
  assertSnapshotId(options.token)
  const home = options.home ?? resolveDshHome()
  const root = safeSnapshotRoot(home, true)
  const lockPath = join(root, `${SNAPSHOT_LOCK}.${options.profile}.lock`)
  const content = `${JSON.stringify({
    pid: options.ownerPid,
    token: options.token,
    createdAt: new Date().toISOString(),
  })}\n`
  try {
    const descriptor = openSync(lockPath, 'wx', 0o600)
    try {
      writeFileSync(descriptor, content)
    } finally {
      closeSync(descriptor)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const current = JSON.parse(readFileSync(lockPath, 'utf8')) as { pid?: unknown; token?: unknown }
    if (current.pid !== process.pid || current.token !== undefined) {
      throw new Error(`dsh: another process is changing Profile ${options.profile}; cannot begin startup batch`)
    }
    writeFileSync(lockPath, content, { flag: 'w', mode: 0o600 })
  }
}

/**
 * Release a desktop-owned cross-process mutation lease using its unguessable token.
 * @param options - Profile identity and the token that created the lease.
 */
export function endProfilePluginMutationLease(
  options: ProfilePluginSnapshotOptions & { readonly token: string },
): void {
  assertProfile(options.profile)
  assertSnapshotId(options.token)
  const home = options.home ?? resolveDshHome()
  const lockPath = join(safeSnapshotRoot(home, false), `${SNAPSHOT_LOCK}.${options.profile}.lock`)
  const owner = JSON.parse(readFileSync(lockPath, 'utf8')) as { token?: unknown }
  if (owner.token !== options.token) throw new Error('dsh: plugin mutation lease token does not match')
  unlinkSync(lockPath)
}

/**
 * Verify that the caller holds the desktop-owned mutation lease for a Profile.
 * @param options - Profile identity and the unguessable lease token.
 */
export function assertProfilePluginMutationLease(
  options: ProfilePluginSnapshotOptions & { readonly token: string },
): void {
  assertProfile(options.profile)
  assertSnapshotId(options.token)
  const home = options.home ?? resolveDshHome()
  const lockPath = join(safeSnapshotRoot(home, false), `${SNAPSHOT_LOCK}.${options.profile}.lock`)
  const owner = JSON.parse(readFileSync(lockPath, 'utf8')) as { pid?: unknown; token?: unknown }
  if (owner.token !== options.token || typeof owner.pid !== 'number' || !processExists(owner.pid)) {
    throw new Error('dsh: plugin mutation lease is unavailable or no longer owned by a live process')
  }
}

/**
 * Serialize one synchronous plugin mutation with snapshot creation and cleanup.
 * @param options - Automatic snapshot metadata.
 * @param operation - Profile mutation to run while holding the lock.
 * @returns Operation result.
 */
export function withAutomaticProfilePluginSnapshot<T>(
  options: Omit<CreateProfilePluginSnapshotOptions, 'kind'>,
  operation: () => T,
): T {
  const home = options.home ?? resolveDshHome()
  const release = acquireProfilePluginMutationLock({ home, profile: options.profile, waitMs: 30_000 })
  let snapshot: CreatedProfilePluginSnapshot | undefined
  try {
    if (existsSync(join(resolveProfileDir(options.profile, home), 'package.json'))) {
      snapshot = createProfilePluginSnapshot({ ...options, home, kind: 'automatic' })
    }
    return operation()
  } finally {
    try {
      if (snapshot !== undefined) finalizeProfilePluginSnapshot({
        home,
        profile: options.profile,
        snapshotId: snapshot.snapshotId,
        preserveIfUnchanged: snapshot.deduplicated === true,
      })
    } finally {
      release()
    }
  }
}

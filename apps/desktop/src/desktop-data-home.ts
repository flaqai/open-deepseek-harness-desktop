/** Resolve and initialize the desktop-owned Harness data home. */

import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  chmod, copyFile, lstat, mkdir, readFile, readdir, rename, rm, writeFile,
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parseDocument } from 'yaml'
import {
  extractImportedPluginRestorePlan,
  writeImportedPluginRestorePlan,
} from './imported-plugin-restore.ts'

const DESKTOP_DATA_DIRECTORY = 'open-deepseek-harness-desktop'
const SETUP_SCHEMA = 'open-deepseek-harness-desktop/data-home-setup/v1'
const COMMUNITY_PROFILE_IDENTITY_SCHEMA = 'flaqai/open-deepseek-harness-desktop/profile-identity/v1'
/** Product-owned identity record stored inside community desktop Harness homes. */
export const COMMUNITY_PROFILE_IDENTITY_FILE = '.open-deepseek-harness-desktop.json'
const ONBOARDING_SETTINGS_NAMESPACE = 'ui-onboarding'
export const IMPORTED_ONBOARDING_RESET_VERSION = '1'
export const PORTABLE_PLUGIN_RESTORE_VERSION = '1'
export const PORTABLE_PLUGIN_TRANSFER_FILENAME = 'portable-plugin-transfer.tgz'
const MAX_PORTABLE_PLUGIN_TRANSFER_BYTES = 5 * 1024 * 1024 * 1024

async function portableTransferHash(path: string): Promise<string> {
  const metadata = await lstat(path)
  if (!metadata.isFile() || metadata.size > MAX_PORTABLE_PLUGIN_TRANSFER_BYTES) {
    throw new Error('desktop: offline plugin transfer is not a bounded regular file')
  }
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}
const IMPORTABLE_ENTRIES = Object.freeze([
  '.agent-presets',
  '.credentials.yaml',
  'AGENTS.md',
  'dsh-pocket/token',
  'dsh-pocket/token-lan',
  'integrations',
  'pet.json',
  'sessions',
  'settings.yaml',
  'skills',
  'storages',
])
const RECOGNIZABLE_ENTRIES = Object.freeze([
  ...IMPORTABLE_ENTRIES,
  'profiles/web/package.json',
  'profiles/web/pnpm-workspace.yaml',
])

/**
 * Resolve an optional application-data root used only by isolated development launches.
 * Installed applications always retain Electron's platform application-data root.
 * @param appData - Electron's platform application-data root.
 * @param packaged - Whether this is an installed application.
 * @param environment - Launch environment containing an optional development override.
 * @returns The normalized application-data root.
 */
export function resolveDesktopApplicationDataRoot(
  appData: string,
  packaged: boolean,
  environment: Record<string, string | undefined>,
): string {
  const configured = environment.DSH_DESKTOP_DEV_APP_DATA?.trim()
  if (packaged || configured === undefined || configured.length === 0) return appData
  if (!isAbsolute(configured)) {
    throw new Error('DSH_DESKTOP_DEV_APP_DATA must be an absolute path.')
  }
  return resolve(configured)
}

/** Stable paths selected before Electron acquires its single-instance lock. */
export interface DesktopDataHomeLayout {
  readonly desktopRoot: string
  readonly communityDesktopRoot: string
  readonly dshHome: string
  readonly officialDshHome: string
  readonly logs: string
  readonly sessionData: string
  readonly setupFile: string
  readonly explicitDshHome: boolean
}

/** Result of importing supported user state from the official Harness home. */
export interface DesktopDataImportResult {
  readonly copied: readonly string[]
  readonly skippedSymlinks: readonly string[]
  readonly restorablePlugins: number
  readonly pluginRestoreIssues: readonly string[]
}

/** A recognized Harness home selected as a first-run source. */
export interface DesktopDataHomeSource {
  readonly path: string
  readonly entries: readonly string[]
}

/** Durable first-run decision kept outside the selected Harness home. */
export interface DesktopDataHomeSetup {
  readonly schema: typeof SETUP_SCHEMA
  readonly mode: 'fresh' | 'created' | 'imported' | 'copied' | 'reused' | 'existing' | 'explicit'
  readonly dshHome: string
  readonly source?: string
  readonly importedOnboardingReset?: string
  readonly portablePluginRestore?: string
  readonly completedAt: string
}

/** Older community copies contain a complete Profile and predate portable restore plans. */
export function shouldPreserveLegacyCopiedProfile(
  setup: DesktopDataHomeSetup | undefined,
): boolean {
  return setup?.mode === 'copied' && setup.portablePluginRestore !== PORTABLE_PLUGIN_RESTORE_VERSION
}

/** User-facing classification of the active Harness home. */
export type DesktopDataHomeKind = 'desktop' | 'official' | 'custom' | 'external'

/** Current and built-in Harness-home choices exposed through the desktop bridge. */
export interface DesktopDataHomeStatus {
  readonly activePath: string
  readonly activeKind: DesktopDataHomeKind
  readonly desktopPath: string
  readonly officialPath: string
  readonly officialAvailable: boolean
  readonly managedExternally: boolean
}

/** A validated switch that can be persisted before a complete application restart. */
export interface DesktopDataHomeSwitchDecision {
  readonly changed: boolean
  readonly path: string
  readonly setup: DesktopDataHomeSetup
}

/** Opaque renderer request for one of the built-in homes or a native-dialog selection. */
export type DesktopDataHomeSwitchRequest =
  | { readonly kind: 'desktop' }
  | { readonly kind: 'official' }
  | { readonly kind: 'custom'; readonly selectionId: string }
  | { readonly kind: 'create'; readonly selectionId: string }

/** Native picker purpose selected by the fixed renderer controls. */
export type DesktopDataHomeSelectionKind = 'existing' | 'empty'

/** Native directory-picker result; selected paths can be activated only through the opaque id. */
export type DesktopDataHomeSelectionResult =
  | { readonly status: 'cancelled' }
  | { readonly status: 'invalid' | 'not-empty' | 'unreadable'; readonly path: string }
  | {
    readonly status: 'selected'
    readonly selectionKind: DesktopDataHomeSelectionKind
    readonly selectionId: string
    readonly path: string
    readonly entries: readonly string[]
  }

/** A recovery-page directory classified entirely by the trusted main process. */
export type DesktopDataHomeRecoverySelection =
  | {
    readonly kind: 'existing'
    readonly path: string
    readonly entries: readonly string[]
  }
  | { readonly kind: 'empty'; readonly path: string }

/** Result returned before Electron begins a complete restart. */
export interface DesktopDataHomeSwitchResult {
  readonly restarting: boolean
  readonly activePath: string
}

/** Resolve only a setup record that is safe for the current desktop layout. */
export function resolveRecordedDesktopDataHome(
  layout: DesktopDataHomeLayout,
  setup: DesktopDataHomeSetup | undefined,
): string | undefined {
  if (setup?.mode === 'reused'
    && setup.source === setup.dshHome
    && isAbsolute(setup.dshHome)) return setup.dshHome
  if (setup?.mode === 'created'
    && setup.source === undefined
    && isAbsolute(setup.dshHome)) return setup.dshHome
  if ((setup?.mode === 'imported' || setup?.mode === 'copied')
    && typeof setup.source === 'string'
    && isAbsolute(setup.source)
    && isAbsolute(setup.dshHome)) return setup.dshHome
  if (setup?.dshHome === layout.dshHome) return layout.dshHome
  return undefined
}

function expandHome(path: string, homeDirectory: string): string {
  if (path === '~') return homeDirectory
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homeDirectory, path.slice(2))
  return path
}

/**
 * Resolve repository-named desktop paths while preserving an explicit DSH_HOME override.
 * @param appData - Electron's platform application-data root.
 * @param homeDirectory - Operating-system user home.
 * @param packaged - Whether this is an installed application.
 * @param environment - Launch environment containing an optional DSH_HOME.
 * @returns Independent desktop, Harness, log, and setup paths.
 */
export function resolveDesktopDataHomeLayout(
  appData: string,
  homeDirectory: string,
  packaged: boolean,
  environment: Record<string, string | undefined>,
): DesktopDataHomeLayout {
  const installedDesktopRoot = join(appData, DESKTOP_DATA_DIRECTORY)
  const developmentDesktopRoot = join(installedDesktopRoot, 'development')
  const desktopRoot = packaged ? installedDesktopRoot : developmentDesktopRoot
  const communityDesktopRoot = packaged ? developmentDesktopRoot : installedDesktopRoot
  const configured = environment.DSH_HOME?.trim()
  const explicitDshHome = configured !== undefined && configured.length > 0
  const dshHome = explicitDshHome
    ? resolve(expandHome(configured, homeDirectory))
    : join(desktopRoot, 'dsh-home')
  return {
    desktopRoot,
    communityDesktopRoot,
    dshHome,
    officialDshHome: join(homeDirectory, '.dsh'),
    logs: join(desktopRoot, 'logs'),
    sessionData: join(desktopRoot, 'session-data'),
    setupFile: join(desktopRoot, 'data-home-setup.json'),
    explicitDshHome,
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/**
 * Return whether the official home contains any supported import source.
 * @param officialDshHome - Official Harness home to inspect.
 * @returns Whether at least one allowlisted entry exists.
 */
export async function hasImportableDesktopData(officialDshHome: string): Promise<boolean> {
  for (const entry of IMPORTABLE_ENTRIES) {
    if (await pathExists(join(officialDshHome, entry))) return true
  }
  return false
}

async function recognizedDesktopDataEntries(dshHome: string): Promise<readonly string[]> {
  let metadata
  try {
    metadata = await lstat(dshHome)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  if (!metadata.isDirectory()) return []
  const entries: string[] = []
  for (const entry of RECOGNIZABLE_ENTRIES) {
    if (await pathExists(join(dshHome, entry))) entries.push(entry)
  }
  return entries
}

async function hasCommunityProfileIdentity(dshHome: string): Promise<boolean> {
  try {
    const value = JSON.parse(await readFile(join(dshHome, COMMUNITY_PROFILE_IDENTITY_FILE), 'utf8')) as unknown
    return typeof value === 'object'
      && value !== null
      && 'schema' in value
      && value.schema === COMMUNITY_PROFILE_IDENTITY_SCHEMA
      && 'instanceId' in value
      && typeof value.instanceId === 'string'
      && /^[0-9a-f-]{36}$/u.test(value.instanceId)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return false
    throw error
  }
}

/**
 * Mark a data home as created or adopted by this community desktop distribution.
 * @param dshHome - Harness home owned by a completed or in-progress desktop setup.
 * @returns A promise that resolves after a valid identity record is present.
 */
export async function ensureCommunityProfileIdentity(dshHome: string): Promise<void> {
  if (await hasCommunityProfileIdentity(dshHome)) return
  await mkdir(dshHome, { recursive: true, mode: 0o700 })
  const path = join(dshHome, COMMUNITY_PROFILE_IDENTITY_FILE)
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify({
    schema: COMMUNITY_PROFILE_IDENTITY_SCHEMA,
    instanceId: randomUUID(),
    createdAt: new Date().toISOString(),
  }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, path)
}

async function setupClaimsCommunityHome(desktopRoot: string, dshHome: string): Promise<boolean> {
  const setup = await readDesktopDataHomeSetup(join(desktopRoot, 'data-home-setup.json'))
  return setup !== undefined
    && isAbsolute(setup.dshHome)
    && sameDesktopPath(setup.dshHome, dshHome)
}

/**
 * Resolve a selected Harness home or its `.dsh` child when recognized data exists.
 * @param candidate - Directory selected by the user or the default `~/.dsh` path.
 * @returns The normalized Harness home and recognized entries, or undefined when neither location is valid.
 */
export async function resolveDesktopDataHomeSource(candidate: string): Promise<DesktopDataHomeSource | undefined> {
  const direct = resolve(candidate)
  const directEntries = await recognizedDesktopDataEntries(direct)
  if (directEntries.length > 0) return { path: direct, entries: directEntries }
  const nested = join(direct, '.dsh')
  const nestedEntries = await recognizedDesktopDataEntries(nested)
  return nestedEntries.length > 0 ? { path: nested, entries: nestedEntries } : undefined
}

/**
 * Resolve a product-identified community desktop root or actual Harness home.
 * A present setup record is authoritative: invalid or missing recorded data never falls back to stale local data.
 * @param candidate - Directory selected by the native picker.
 * @returns Recognized actual data path, excluding desktop logs and caches, or undefined.
 */
export async function resolveCommunityDataHomeSource(candidate: string): Promise<DesktopDataHomeSource | undefined> {
  const root = resolve(candidate)
  const setupPath = join(root, 'data-home-setup.json')
  if (await pathExists(setupPath)) {
    const setup = await readDesktopDataHomeSetup(setupPath)
    if (setup === undefined || !isAbsolute(setup.dshHome)) return undefined
    const entries = await recognizedDesktopDataEntries(setup.dshHome)
    return entries.length > 0 ? { path: resolve(setup.dshHome), entries } : undefined
  }
  const directEntries = await recognizedDesktopDataEntries(root)
  if (directEntries.length > 0
    && (await hasCommunityProfileIdentity(root) || await setupClaimsCommunityHome(dirname(root), root))) {
    return { path: root, entries: directEntries }
  }
  const nested = join(root, 'dsh-home')
  const entries = await recognizedDesktopDataEntries(nested)
  if (entries.length > 0 && await hasCommunityProfileIdentity(nested)) return { path: nested, entries }
  return undefined
}

/**
 * Resolve recognizable legacy community data only when no product identity evidence exists.
 * Present identity or setup records remain authoritative even when malformed or foreign, so
 * this compatibility path cannot bypass a failed identity check.
 * @param candidate - Directory selected by the native picker.
 * @returns Recognized actual data path eligible for explicit user confirmation, or undefined.
 */
export async function resolveUnidentifiedCommunityDataHomeSource(
  candidate: string,
): Promise<DesktopDataHomeSource | undefined> {
  const root = resolve(candidate)
  if (await pathExists(join(root, 'data-home-setup.json'))) return undefined

  const directEntries = await recognizedDesktopDataEntries(root)
  if (directEntries.length > 0) {
    if (await pathExists(join(root, COMMUNITY_PROFILE_IDENTITY_FILE))) return undefined
    if (await pathExists(join(dirname(root), 'data-home-setup.json'))) return undefined
    return { path: root, entries: directEntries }
  }

  const nested = join(root, 'dsh-home')
  const nestedEntries = await recognizedDesktopDataEntries(nested)
  if (nestedEntries.length === 0) return undefined
  if (await pathExists(join(nested, COMMUNITY_PROFILE_IDENTITY_FILE))) return undefined
  return { path: nested, entries: nestedEntries }
}

/** Resolve an existing empty directory that can become a new Harness home.
 * @param candidate - Native-picker-selected directory.
 * @returns The normalized directory, or undefined when it is not empty.
 */
export async function resolveEmptyDesktopDataHome(candidate: string): Promise<string | undefined> {
  const path = resolve(candidate)
  return (await readdir(path)).length === 0 ? path : undefined
}

/**
 * Classify one startup-recovery selection without accepting arbitrary nonempty directories.
 * Recognized Harness homes win over the empty-directory case, including a selected parent
 * whose supported data lives in its `.dsh` child.
 * @param candidate - Native-picker-selected directory.
 * @returns A supported existing Harness home, an empty new home, or undefined.
 */
export async function resolveDesktopDataHomeRecoverySelection(
  candidate: string,
): Promise<DesktopDataHomeRecoverySelection | undefined> {
  const source = await resolveDesktopDataHomeSource(candidate)
  if (source !== undefined) {
    return { kind: 'existing', path: source.path, entries: source.entries }
  }
  const empty = await resolveEmptyDesktopDataHome(candidate)
  return empty === undefined ? undefined : { kind: 'empty', path: empty }
}

/**
 * Return whether a target Harness home already contains user or plugin state.
 * @param dshHome - Independent Harness home to inspect.
 * @returns Whether the directory exists and is nonempty.
 */
export async function hasDesktopData(dshHome: string): Promise<boolean> {
  try {
    return (await readdir(dshHome)).length > 0
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function desktopOwnedDshHome(layout: DesktopDataHomeLayout): string {
  return join(layout.desktopRoot, 'dsh-home')
}

function sameDesktopPath(left: string, right: string): boolean {
  const normalizedLeft = resolve(left)
  const normalizedRight = resolve(right)
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

function nestedDesktopPath(parent: string, candidate: string): boolean {
  const relationship = relative(resolve(parent), resolve(candidate))
  return relationship !== ''
    && relationship !== '..'
    && !relationship.startsWith(`..${sep}`)
    && !isAbsolute(relationship)
}

/** Return whether two Harness homes are equal or nested within each other.
 * @param left - First normalized or user-selected Harness home.
 * @param right - Second normalized or user-selected Harness home.
 * @returns Whether copying between the paths could recurse or replace source data.
 */
export function desktopDataHomesOverlap(left: string, right: string): boolean {
  return sameDesktopPath(left, right)
    || nestedDesktopPath(left, right)
    || nestedDesktopPath(right, left)
}

/** Inspect the active home without changing or initializing any directory.
 * @param layout - Stable desktop and official paths.
 * @param activePath - Harness home used by the current Electron process.
 * @returns Current mode plus availability of the built-in choices.
 */
export async function inspectDesktopDataHomeStatus(
  layout: DesktopDataHomeLayout,
  activePath: string,
): Promise<DesktopDataHomeStatus> {
  const desktopPath = desktopOwnedDshHome(layout)
  let officialAvailable = false
  try {
    const officialSource = await resolveDesktopDataHomeSource(layout.officialDshHome)
    officialAvailable = officialSource !== undefined && sameDesktopPath(officialSource.path, layout.officialDshHome)
  } catch {
    // An unreadable official home remains unavailable until its permissions are repaired.
  }
  const normalizedActive = resolve(activePath)
  const activeKind: DesktopDataHomeKind = layout.explicitDshHome
    ? 'external'
    : sameDesktopPath(normalizedActive, desktopPath)
      ? 'desktop'
      : sameDesktopPath(normalizedActive, layout.officialDshHome)
        ? 'official'
        : 'custom'
  return {
    activePath: normalizedActive,
    activeKind,
    desktopPath,
    officialPath: layout.officialDshHome,
    officialAvailable,
    managedExternally: layout.explicitDshHome,
  }
}

/** Resolve a requested existing-home switch without copying or deleting data.
 * @param layout - Stable desktop and official paths.
 * @param activePath - Harness home used by the current Electron process.
 * @param target - Built-in target, existing home, or empty directory selected through the native dialog.
 * @returns The setup record to persist before restarting the application.
 */
export async function resolveDesktopDataHomeSwitch(
  layout: DesktopDataHomeLayout,
  activePath: string,
  target: { readonly kind: 'desktop' }
    | { readonly kind: 'official' }
    | { readonly kind: 'custom' | 'create'; readonly path: string },
): Promise<DesktopDataHomeSwitchDecision> {
  if (layout.explicitDshHome) {
    throw new Error('desktop: DSH_HOME is managed by the launch environment')
  }
  if (target.kind === 'desktop') {
    const path = desktopOwnedDshHome(layout)
    const mode: DesktopDataHomeSetup['mode'] = await hasDesktopData(path) ? 'existing' : 'fresh'
    return {
      changed: !sameDesktopPath(path, activePath),
      path,
      setup: desktopDataHomeSetup(mode, path),
    }
  }
  if (target.kind === 'create') {
    const path = await resolveEmptyDesktopDataHome(target.path)
    if (path === undefined) throw new Error('desktop: selected directory is not empty')
    return {
      changed: !sameDesktopPath(path, activePath),
      path,
      setup: desktopDataHomeSetup('created', path),
    }
  }
  const candidate = target.kind === 'official' ? layout.officialDshHome : target.path
  const source = await (target.kind === 'official'
    ? resolveDesktopDataHomeSource(candidate)
    : resolveCommunityDataHomeSource(candidate))
  if (source === undefined) {
    throw new Error(target.kind === 'official'
      ? 'desktop: the official DSH home is unavailable'
      : 'desktop: selected directory is not a recognized DSH home')
  }
  if (target.kind === 'official' && !sameDesktopPath(source.path, layout.officialDshHome)) {
    throw new Error('desktop: the official DSH home is unavailable')
  }
  return {
    changed: !sameDesktopPath(source.path, activePath),
    path: source.path,
    setup: desktopDataHomeSetup('reused', source.path, source.path),
  }
}

async function copySafeTree(
  source: string,
  destination: string,
  relative: string,
  skippedSymlinks: string[],
): Promise<void> {
  const metadata = await lstat(source)
  if (metadata.isSymbolicLink()) {
    skippedSymlinks.push(relative)
    return
  }
  if (metadata.isDirectory()) {
    await mkdir(destination, { recursive: true, mode: 0o700 })
    const entries = await readdir(source)
    entries.sort()
    for (const entry of entries) {
      await copySafeTree(
        join(source, entry),
        join(destination, entry),
        join(relative, entry),
        skippedSymlinks,
      )
    }
    return
  }
  if (!metadata.isFile()) return
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
  await copyFile(source, destination)
  await chmod(destination, 0o600)
}

/**
 * Remove the source installation's onboarding acknowledgement from an imported settings document.
 * @param path - Staged settings file copied from the official Harness home.
 * @returns A promise settled after the independent copy is ready for first-run onboarding.
 */
async function resetImportedOnboardingSettings(path: string): Promise<boolean> {
  if (!await pathExists(path)) return false
  const document = parseDocument(await readFile(path, 'utf8'), { prettyErrors: true })
  if (document.errors.length > 0) {
    throw new Error(`desktop: imported settings are invalid YAML: ${document.errors[0]?.message ?? 'unknown parse error'}`)
  }
  if (!document.delete(ONBOARDING_SETTINGS_NAMESPACE)) return false
  await writeFile(path, document.toString())
  return true
}

/**
 * Reset onboarding copied into an independent desktop Harness home.
 * @param dshHome - Independent desktop Harness home created by import.
 * @returns Whether an imported acknowledgement was removed.
 */
export function resetImportedDesktopOnboarding(dshHome: string): Promise<boolean> {
  return resetImportedOnboardingSettings(join(dshHome, 'settings.yaml'))
}

/**
 * Atomically copy supported configuration and history without copying plugin runtimes.
 * @param sourceDshHome - Existing official or community desktop DSH source.
 * @param targetDshHome - Empty repository-owned destination.
 * @returns Copied roots and any deliberately skipped symlinks.
 */
async function copyIndependentDesktopData(
  sourceDshHome: string,
  targetDshHome: string,
  resetOnboarding: boolean,
  portableTransfer?: { readonly path: string; readonly sha256: string },
): Promise<DesktopDataImportResult> {
  if (desktopDataHomesOverlap(sourceDshHome, targetDshHome)) {
    throw new Error('desktop: source and isolated Harness homes must not overlap')
  }
  if (await hasDesktopData(targetDshHome)) {
    throw new Error(`desktop: refusing to copy into non-empty Harness home ${targetDshHome}`)
  }
  const staging = join(dirname(targetDshHome), `.${basename(targetDshHome)}.copy-${process.pid}-${Date.now()}`)
  const copied: string[] = []
  const skippedSymlinks: string[] = []
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { recursive: true, mode: 0o700 })
  try {
    for (const entry of IMPORTABLE_ENTRIES) {
      const source = join(sourceDshHome, entry)
      if (!await pathExists(source)) continue
      const skippedBefore = skippedSymlinks.length
      await copySafeTree(source, join(staging, entry), entry, skippedSymlinks)
      if (skippedSymlinks.length === skippedBefore) copied.push(entry)
    }
    if (resetOnboarding) await resetImportedOnboardingSettings(join(staging, 'settings.yaml'))
    const restorePlan = await extractImportedPluginRestorePlan(sourceDshHome)
    await writeImportedPluginRestorePlan(staging, restorePlan)
    if (portableTransfer !== undefined) {
      if (await portableTransferHash(portableTransfer.path) !== portableTransfer.sha256) {
        throw new Error('desktop: selected offline plugin transfer changed before import')
      }
      const copied = join(staging, PORTABLE_PLUGIN_TRANSFER_FILENAME)
      await copyFile(portableTransfer.path, copied)
      if (await portableTransferHash(copied) !== portableTransfer.sha256) {
        throw new Error('desktop: offline plugin transfer changed during import')
      }
    }
    if (await pathExists(targetDshHome)) await rm(targetDshHome, { recursive: true })
    await rename(staging, targetDshHome)
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
  const restorePlan = await readFile(join(targetDshHome, 'imported-plugin-restore.v1.json'), 'utf8')
    .then(value => JSON.parse(value) as { entries: unknown[]; sourceIssues: string[] })
  return {
    copied,
    skippedSymlinks,
    restorablePlugins: restorePlan.entries.length,
    pluginRestoreIssues: restorePlan.sourceIssues,
  }
}

/** Convert supported official Harness data into an independent desktop configuration. */
export function importOfficialDesktopData(
  officialDshHome: string,
  targetDshHome: string,
  portableTransfer?: { readonly path: string; readonly sha256: string },
): Promise<DesktopDataImportResult> {
  return copyIndependentDesktopData(officialDshHome, targetDshHome, true, portableTransfer)
}

/** Import compatible community desktop data without plugin runtimes or replaying onboarding. */
export function copyCommunityDesktopData(
  communityDshHome: string,
  targetDshHome: string,
  portableTransfer?: { readonly path: string; readonly sha256: string },
): Promise<DesktopDataImportResult> {
  return copyIndependentDesktopData(communityDshHome, targetDshHome, false, portableTransfer)
}

/**
 * Read a valid desktop data-home setup record.
 * @param path - Repository-owned setup record path.
 * @returns The validated record, or undefined when absent or corrupt.
 */
export async function readDesktopDataHomeSetup(path: string): Promise<DesktopDataHomeSetup | undefined> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as Partial<DesktopDataHomeSetup>
    if (value.schema !== SETUP_SCHEMA
      || (value.mode !== 'fresh'
        && value.mode !== 'created'
        && value.mode !== 'imported'
        && value.mode !== 'copied'
        && value.mode !== 'reused'
        && value.mode !== 'existing'
        && value.mode !== 'explicit')
      || typeof value.dshHome !== 'string'
      || typeof value.completedAt !== 'string'
      || (value.source !== undefined && typeof value.source !== 'string')
      || (value.importedOnboardingReset !== undefined
        && value.importedOnboardingReset !== IMPORTED_ONBOARDING_RESET_VERSION)
      || (value.portablePluginRestore !== undefined
        && value.portablePluginRestore !== PORTABLE_PLUGIN_RESTORE_VERSION)) return undefined
    return value as DesktopDataHomeSetup
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return undefined
    throw error
  }
}

/**
 * Atomically persist the completed first-run data-home decision.
 * @param path - Repository-owned setup record path.
 * @param setup - Complete schema-valid decision.
 * @returns A promise settled after the atomic rename.
 */
export async function writeDesktopDataHomeSetup(path: string, setup: DesktopDataHomeSetup): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(setup, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, path)
}

/**
 * Create a schema-valid setup record for the selected data mode.
 * @param mode - Fresh, created, imported, copied, reused, existing, or explicit selection.
 * @param dshHome - Absolute Harness home selected for this launch mode.
 * @param source - Optional official import source.
 * @returns A timestamped durable setup record.
 */
export function desktopDataHomeSetup(
  mode: DesktopDataHomeSetup['mode'],
  dshHome: string,
  source?: string,
): DesktopDataHomeSetup {
  return {
    schema: SETUP_SCHEMA,
    mode,
    dshHome,
    ...(source === undefined ? {} : { source }),
    ...(mode === 'imported' ? { importedOnboardingReset: IMPORTED_ONBOARDING_RESET_VERSION } : {}),
    ...(mode === 'copied' ? { portablePluginRestore: PORTABLE_PLUGIN_RESTORE_VERSION } : {}),
    completedAt: new Date().toISOString(),
  }
}

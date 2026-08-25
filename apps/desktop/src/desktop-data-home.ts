/** Resolve and initialize the desktop-owned Harness data home. */

import {
  chmod, copyFile, lstat, mkdir, readFile, readdir, rename, rm, writeFile,
} from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

const DESKTOP_DATA_DIRECTORY = 'open-deepseek-harness-desktop'
const SETUP_SCHEMA = 'open-deepseek-harness-desktop/data-home-setup/v1'
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

/** Stable paths selected before Electron acquires its single-instance lock. */
export interface DesktopDataHomeLayout {
  readonly desktopRoot: string
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
}

/** Durable first-run decision kept outside the selected Harness home. */
export interface DesktopDataHomeSetup {
  readonly schema: typeof SETUP_SCHEMA
  readonly mode: 'fresh' | 'imported' | 'reused' | 'existing' | 'explicit'
  readonly dshHome: string
  readonly source?: string
  readonly completedAt: string
}

/** Resolve only a setup record that is safe for the current desktop layout. */
export function resolveRecordedDesktopDataHome(
  layout: DesktopDataHomeLayout,
  setup: DesktopDataHomeSetup | undefined,
): string | undefined {
  if (setup?.mode === 'reused'
    && setup.dshHome === layout.officialDshHome
    && setup.source === layout.officialDshHome) return layout.officialDshHome
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
  const desktopRoot = packaged
    ? join(appData, DESKTOP_DATA_DIRECTORY)
    : join(appData, DESKTOP_DATA_DIRECTORY, 'development')
  const configured = environment.DSH_HOME?.trim()
  const explicitDshHome = configured !== undefined && configured.length > 0
  const dshHome = explicitDshHome
    ? resolve(expandHome(configured, homeDirectory))
    : join(desktopRoot, 'dsh-home')
  return {
    desktopRoot,
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
 * Atomically copy supported configuration and history without importing plugin runtimes.
 * @param officialDshHome - Existing official `~/.dsh` source.
 * @param targetDshHome - Empty repository-owned destination.
 * @returns Copied roots and any deliberately skipped symlinks.
 */
export async function importOfficialDesktopData(
  officialDshHome: string,
  targetDshHome: string,
): Promise<DesktopDataImportResult> {
  if (resolve(officialDshHome) === resolve(targetDshHome)) {
    throw new Error('desktop: official and isolated Harness homes must differ')
  }
  if (await hasDesktopData(targetDshHome)) {
    throw new Error(`desktop: refusing to import into non-empty Harness home ${targetDshHome}`)
  }
  const staging = join(dirname(targetDshHome), `.${basename(targetDshHome)}.import-${process.pid}-${Date.now()}`)
  const copied: string[] = []
  const skippedSymlinks: string[] = []
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { recursive: true, mode: 0o700 })
  try {
    for (const entry of IMPORTABLE_ENTRIES) {
      const source = join(officialDshHome, entry)
      if (!await pathExists(source)) continue
      const skippedBefore = skippedSymlinks.length
      await copySafeTree(source, join(staging, entry), entry, skippedSymlinks)
      if (skippedSymlinks.length === skippedBefore) copied.push(entry)
    }
    if (await pathExists(targetDshHome)) await rm(targetDshHome, { recursive: true })
    await rename(staging, targetDshHome)
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
  return { copied, skippedSymlinks }
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
        && value.mode !== 'imported'
        && value.mode !== 'reused'
        && value.mode !== 'existing'
        && value.mode !== 'explicit')
      || typeof value.dshHome !== 'string'
      || typeof value.completedAt !== 'string'
      || (value.source !== undefined && typeof value.source !== 'string')) return undefined
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
 * @param mode - Fresh, imported, reused, existing, or explicit selection.
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
    completedAt: new Date().toISOString(),
  }
}

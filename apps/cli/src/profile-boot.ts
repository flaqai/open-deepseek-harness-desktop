/**
 * Shared profile boot for every `dsh` surface: resolve the profile, stack its
 * patch layers (bundle layers in `dsh.profile.bundles` order, the profile's
 * own `cordis.patch.yml`, `--patch` overlays, the telemetry switch), mount the
 * tree over the profile's empty root config, apply its selected patch-reload
 * lifecycle, and wire fail-loud plus bounded shutdown.
 *
 * App flags are not the launcher's business: the invocation's inner arguments
 * are provided to the tree through `ctx.cmdlineArgs`, where any injected app
 * plugin may read the same immutable snapshot.
 * @module @deepseek-ai/dsh/profile-boot
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { FiberState, type Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import {
  boot,
  acquireProfilePluginMutationLock,
  createProfilePluginSnapshot,
  finalizeProfilePluginSnapshot,
  composeEntries,
  DEFAULT_PROFILE_BUNDLES,
  healProfilesModuleFallback,
  initProfile,
  installFailLoud,
  loadDiagnosticProfile,
  loadOptionalPatches,
  loadOverlayPatches,
  loadProfile,
  classifyProfileDiagnostic,
  createProfileDiagnosticReport,
  readProfileDiagnosticReport,
  readProfileManifest,
  inspectProfileBundleEntryOwnership,
  inspectUnresolvableProfileBundleEntries,
  quarantineProfilePluginAfterLoadFailure,
  repairProfileDependencies,
  resolveProfileDir,
  PROFILE_PATCH_FILENAME,
  PROFILE_TEMPLATES,
  watchUserPatches,
  writeProfileDiagnosticReport,
  type Profile,
  type ProfileBundleEntryOwnership,
  type ProfileDiagnostic,
  type UnresolvableProfileBundleEntry,
  prepareDiagnosticRuntimeDirectories,
  prepareDiagnosticSettingsDocument,
} from '@deepseek-ai/dsh-app-boot'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { installProxyFromEnvironment } from '@deepseek-ai/dsh-http-proxy'
import { DSH_LAUNCH_ENVIRONMENT_KEY, type LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { provideCmdline, type AppReady } from '@deepseek-ai/dsh-cmdline'
import { createProcessShutdown, type ProcessShutdown } from './process-shutdown.ts'
import { INSTALL_ANCHOR } from './install-anchor.ts'
import { runProfilePackageManager } from './profile-package-manager.ts'
import { withDesktopCodexProxy } from './desktop-codex-proxy.ts'

const NAME = 'dsh'

/** Launcher-owned readiness signal committed only after boot and host setup succeed. */
function createAppReady(): { service: AppReady; commit(): void } {
  let ready = false
  const listeners = new Set<() => void>()
  return {
    service: {
      onReady(listener) {
        if (ready) {
          listener()
          return () => {}
        }
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    commit() {
      if (ready) return
      ready = true
      for (const listener of [...listeners]) listener()
      listeners.clear()
    },
  }
}

/**
 * The home-level user patch layer (`$DSH_HOME/cordis.patch.yml`), applied
 * over every profile's own layer. Resolved per call, not at module load:
 * `$DSH_HOME` may be set by the test or launcher after import.
 * @returns the absolute patch-file path.
 */
export function homePatchPath(): string {
  return join(resolveDshHome(), PROFILE_PATCH_FILENAME)
}


/** The session-telemetry row id the DSH_TELEMETRY_DISABLED switch targets. */
const TELEMETRY_ROW_ID = 'session-telemetry-otel'

/** The empty root entry list every profile tree patches over. */
const PROFILE_ROOT_CONFIG = `# dsh profile root — an empty entry list. The tree is composed as patches:
# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any
# --patch overlays. Edit cordis.patch.yml, not this file.
[]
`

/** Root config filename inside a profile directory. */
export const PROFILE_ROOT_FILENAME = 'cordis.yml'

/**
 * Return the installation-maintained shared module fallback anchor used by a
 * diagnostic Profile. It intentionally sits above the active Profile so bare
 * imports cannot see that Profile's third-party node_modules.
 * @param profileDir - Absolute active Profile directory.
 * @returns File URL whose parent lookup begins at `$DSH_HOME/profiles/node_modules`.
 */
export function diagnosticProfileModuleBaseUrl(profileDir: string): string {
  return pathToFileURL(join(profileDir, '..', 'package.json')).href
}

/**
 * Initialize a missing profile from one shipped template. This copies only
 * the template's bundle list and patch-reload policy; local state from the
 * same-named shipped profile is not read, and no inheritance metadata is
 * persisted. Shipped profile names are reserved, and the target directory is
 * claimed exclusively so existing or concurrent state is never reused.
 * @param name - the new profile name.
 * @param fromDefaultProfile - shipped profile template to copy.
 * @param home - Harness home containing the profile directory.
 * @throws when the template is unknown, the target name is shipped, or the target directory exists.
 */
export function initializeProfileFromDefault(
  name: string,
  fromDefaultProfile: string,
  home: string = resolveDshHome(),
): void {
  const dir = resolveProfileDir(name, home)
  const template = Object.hasOwn(PROFILE_TEMPLATES, fromDefaultProfile)
    ? PROFILE_TEMPLATES[fromDefaultProfile]
    : undefined
  if (template === undefined) {
    const expected = Object.keys(PROFILE_TEMPLATES).sort().map(value => JSON.stringify(value)).join(', ')
    throw new Error(
      `${NAME}: unknown default profile ${JSON.stringify(fromDefaultProfile)}; expected one of ${expected}`,
    )
  }
  if (Object.hasOwn(PROFILE_TEMPLATES, name)) {
    throw new Error(
      `${NAME}: profile ${JSON.stringify(name)} is shipped and cannot be a custom profile target; `
      + 'omit --from-default-profile to use it',
    )
  }
  mkdirSync(dirname(dir), { recursive: true })
  try {
    mkdirSync(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const manifestPath = join(dir, 'package.json')
    if (existsSync(manifestPath)) {
      throw new Error(
        `${NAME}: profile ${JSON.stringify(name)} already exists at ${manifestPath}; `
        + 'omit --from-default-profile to use it',
      )
    }
    throw new Error(
      `${NAME}: profile directory ${dir} already exists; choose an unused profile name`,
    )
  }
  try {
    initProfile(dir, template.bundles, template.patchReload)
  } catch (error) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `${NAME}: profile initialization failed and ${dir} could not be removed`,
      )
    }
    throw error
  }
}

/**
 * Resolve the telemetry opt-out switch into its boot patch. ANY non-empty
 * value (including `'0'`/`'false'`) disables: a privacy switch prefers
 * off-by-mistake over on-by-mistake. A composition without the telemetry row
 * exports nothing, so the switch is then trivially satisfied and no patch is
 * generated — custom profiles need not mount telemetry to run with the
 * switch set.
 * @param disabledEnv - the raw `DSH_TELEMETRY_DISABLED` value (`undefined` when unset).
 * @param hasRow - whether the composition carries the telemetry row.
 * @returns the disable patch, or `undefined` when no hard-disable patch is required.
 */
export function resolveTelemetryPatch(disabledEnv: string | undefined, hasRow: boolean): PatchOptions | undefined {
  if ((disabledEnv ?? '') === '' || !hasRow) return undefined
  return { id: TELEMETRY_ROW_ID, disabled: true }
}

/** A package name reserved for modules supplied by the running Harness installation. */
const IN_BOX_PACKAGE_PREFIX = '@deepseek-ai/dsh-'

/** Third-party modules that own process-global routes/services and cannot be mounted twice. */
const SINGLETON_PLUGIN_MODULES = new Set(['dsh-better-sidebar'])

/**
 * Temporarily disable later duplicate rows for known third-party singleton plugins.
 *
 * Better Sidebar was historically mounted from a hand-written profile patch and is
 * now also available as a bundle. Keeping both rows active makes both instances
 * register `/sidebar/api`, which aborts the entire profile before diagnostics can
 * render. The first enabled row remains authoritative; only later duplicates are
 * disabled in memory, so user configuration is preserved and can still be edited.
 *
 * @param patchLayers - effective patch layers in application order.
 * @returns id-targeted disable overlays for later singleton duplicates.
 */
export function quarantineDuplicateSingletonLoaderEntries(
  patchLayers: readonly (readonly PatchOptions[])[],
): PatchOptions[] {
  const firstByModule = new Map<string, string>()
  const recovered: PatchOptions[] = []
  for (const row of composeEntries(patchLayers.map(layer => [...layer]))) {
    if (typeof row.id !== 'string' || typeof row.name !== 'string'
      || !SINGLETON_PLUGIN_MODULES.has(row.name) || row.disabled === true) continue
    const first = firstByModule.get(row.name)
    if (first === undefined) {
      firstByModule.set(row.name, row.id)
      continue
    }
    if (first === row.id) continue
    recovered.push({ id: row.id, disabled: true })
    process.stderr.write(
      `${NAME}: temporarily disabled duplicate singleton loader entry ${JSON.stringify(row.id)} (${row.name}); `
      + `entry ${JSON.stringify(first)} already owns this plugin. Remove the legacy duplicate from cordis.patch.yml.\n`,
    )
  }
  return recovered
}

/**
 * Return temporary disable patches for stale user loader rows that name an
 * in-box package no longer supplied by this Harness installation.
 *
 * A development checkout can be upgraded while its private profile survives
 * between runs.  In that case an old user `cordis.patch.yml` can insert a
 * removed client module (for example a retired UI package).  Letting that one
 * row reach Loader makes the complete Host fail to boot.  We deliberately
 * constrain this recovery to user-introduced `@deepseek-ai/dsh-*` rows:
 * third-party packages and shipped bundle rows retain their ordinary
 * fail-loud behaviour, and fixing or restoring the package re-enables the
 * row on the next launch without rewriting user configuration.
 *
 * @param bundlePatches - patches owned by the current installation.
 * @param userPatches - profile and home patches owned by the user.
 * @param profileDir - module-resolution anchor for the active profile.
 * @param resolveModule - injectable resolver for focused tests.
 * @returns id-targeted disable patches safe to append as the highest layer.
 */
export function quarantineStaleInBoxLoaderEntries(
  bundlePatches: readonly PatchOptions[],
  userPatches: readonly PatchOptions[],
  profileDir: string,
  resolveModule: (name: string) => void = (name) => { createRequire(join(profileDir, 'package.json')).resolve(name) },
): PatchOptions[] {
  const bundleRows = new Map<string, EntryOptions>()
  for (const row of composeEntries([[...bundlePatches]])) {
    if (typeof row.id === 'string') bundleRows.set(row.id, row)
  }
  const recovered: PatchOptions[] = []
  for (const row of composeEntries([[...bundlePatches], [...userPatches]])) {
    if (typeof row.id !== 'string' || typeof row.name !== 'string' || !row.name.startsWith(IN_BOX_PACKAGE_PREFIX)) continue
    // A bundle row with the same module name belongs to the running app. Do
    // not hide an incomplete/corrupt installation behind profile recovery.
    if (bundleRows.get(row.id)?.name === row.name) continue
    try {
      resolveModule(row.name)
    } catch {
      recovered.push({ id: row.id, disabled: true })
      process.stderr.write(
        `${NAME}: temporarily disabled stale user loader entry ${JSON.stringify(row.id)} (${row.name}); `
        + 'the running Harness no longer provides that in-box module. Restore or update the user patch to re-enable it.\n',
      )
    }
  }
  return recovered
}

/**
 * Load a resolved profile for `name` and (re)write the empty root config. The
 * root is always rewritten: the whole composition is patch layers, and the
 * vendored Loader's tree write-back (a plugin self-disposing persists the
 * current tree) can bake composed rows into this file — which would duplicate
 * every bundle insert on the next boot. The file exists on disk only because
 * the Loader needs a real include root to anchor `baseUrl` at the profile
 * directory (the config dump anchors on the same file, so both compose over
 * the identical base).
 * @param name - the profile name.
 * @param userLayer - `false` skips parsing `cordis.patch.yml` (the default dump).
 * @param fromDefaultProfile - shipped template used once to initialize a missing profile.
 * @returns the loaded profile.
 * @throws when explicit initialization names an unknown template or an existing profile.
 */
export function prepareProfile(name: string, userLayer = true, fromDefaultProfile?: string): Profile {
  if (fromDefaultProfile !== undefined) initializeProfileFromDefault(name, fromDefaultProfile)
  const profile = loadProfile(NAME, name, INSTALL_ANCHOR, undefined, { userLayer })
  writeFileSync(join(profile.dir, PROFILE_ROOT_FILENAME), PROFILE_ROOT_CONFIG)
  return profile
}

/** Load the installation-owned diagnostic composition without parsing user-owned Profile files. */
function prepareDiagnosticProfile(name: string): Profile {
  const profile = loadDiagnosticProfile(NAME, name, INSTALL_ANCHOR)
  writeFileSync(join(profile.dir, PROFILE_ROOT_FILENAME), PROFILE_ROOT_CONFIG)
  return profile
}

/** One profile's patch layers, in application order. */
interface ComposedProfile {
  profile: Profile
  /** Bundle layers concatenated — the part below the user layers on a live reload. */
  bundlePatches: PatchOptions[]
  /** The home-level user layer (`$DSH_HOME/cordis.patch.yml`), applied after the profile's own. */
  homePatches: PatchOptions[]
  /** Layers above the user layers on a live reload: `--patch` overlays and the telemetry switch. */
  overlays: PatchOptions[]
  /** Invocation-owned data root removed when diagnostic safe mode settles. */
  diagnosticRuntimeRoot?: string
}

/** The full patch stack of one composed profile, in application order. */
function allPatches(composed: ComposedProfile): PatchOptions[] {
  return withDesktopCodexProxy([
    ...composed.bundlePatches,
    ...composed.profile.patches,
    ...composed.homePatches,
    ...composed.overlays,
  ], process.env)
}

/**
 * Load `name` and compose its effective patch stack: bundle layers in
 * `dsh.profile.bundles` order (a base-backed profile gets the base bundle's
 * platform-gated shell rows), the profile's user layer, the home-level user
 * layer (`$DSH_HOME/cordis.patch.yml` — machine-local preferences that apply
 * to every profile, so it outranks the per-profile layer), `--patch` overlays,
 * then the telemetry switch.
 * @param name - the profile name.
 * @param patchFiles - `--patch` overlay paths, in argv order.
 * @returns the profile and its patch layers.
 */
async function composeProfile(
  name: string,
  patchFiles: readonly string[],
  safeMode: boolean,
  fromDefaultProfile?: string,
): Promise<ComposedProfile> {
  const profile = safeMode ? prepareDiagnosticProfile(name) : prepareProfile(name, true, fromDefaultProfile)
  await healProfilesModuleFallback({ installAnchor: INSTALL_ANCHOR, profile })
  const homePatches = safeMode ? [] : loadOptionalPatches(NAME, homePatchPath()) ?? []
  const diagnosticSettings = safeMode ? prepareDiagnosticSettingsDocument() : undefined
  const diagnosticRuntime = safeMode ? prepareDiagnosticRuntimeDirectories() : undefined
  const overlays: PatchOptions[] = diagnosticRuntime === undefined
    ? patchFiles.flatMap(file => loadOverlayPatches(NAME, resolve(file)))
    : [
      { id: 'settings', config: { path: diagnosticSettings, watch: false } },
      { id: 'session-persistence-jsonl', config: { root: diagnosticRuntime.sessions } },
      { id: 'storage-json', config: { root: diagnosticRuntime.storages } },
      { id: 'attachment-local', config: { dshHome: diagnosticRuntime.root } },
    ]
  const bundlePatches = profile.layers.flatMap(layer => layer.patches)
  const staleLoaderQuarantine = safeMode
    ? []
    : quarantineStaleInBoxLoaderEntries(bundlePatches, [...profile.patches, ...homePatches], profile.dir)
  const duplicateSingletonQuarantine = safeMode
    ? []
    : quarantineDuplicateSingletonLoaderEntries([
      bundlePatches,
      profile.patches,
      homePatches,
      overlays,
      staleLoaderQuarantine,
    ])
  const rows = new Map<string, EntryOptions>()
  for (const row of composeEntries([
    bundlePatches,
    profile.patches,
    homePatches,
    overlays,
    staleLoaderQuarantine,
    duplicateSingletonQuarantine,
  ])) {
    if (typeof row.id === 'string') rows.set(row.id, row)
  }
  const composedOverlays = [...overlays, ...staleLoaderQuarantine, ...duplicateSingletonQuarantine]
  const telemetryPatch = resolveTelemetryPatch(process.env.DSH_TELEMETRY_DISABLED, rows.has(TELEMETRY_ROW_ID))
  if (telemetryPatch !== undefined) composedOverlays.push(telemetryPatch)
  return {
    profile,
    bundlePatches,
    homePatches,
    overlays: composedOverlays,
    ...(diagnosticRuntime === undefined ? {} : { diagnosticRuntimeRoot: diagnosticRuntime.root }),
  }
}

/** Options for {@link runProfile}. */
export interface RunProfileOptions {
  /** This run's frozen environment snapshot, provided before any entry mounts. */
  environment: LaunchEnvironmentSnapshot
  /** The profile name to boot. */
  profile: string
  /** Shipped template used once to initialize a missing profile. */
  fromDefaultProfile?: string | undefined
  /** `--patch` overlay paths, in argv order. */
  patchFiles: readonly string[]
  /** The invocation's inner arguments, handed to the tree through `ctx.cmdlineArgs`. */
  args: readonly string[]
  /** Start only installation-owned bundles and omit every user-owned layer. */
  safeMode?: boolean
  /** Emit a stable desktop-supervisor marker when ordinary startup fails. */
  safeModeOnFailure?: boolean
}

function startupFailurePhase(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (/pnpm|dependency|lockfile|node_modules|profile manifest/iu.test(message)) return 'preflight' as const
  // The outer boot wrapper says "plugin tree failed to load" for every
  // composition failure. Preserve the more specific Loader lifecycle stage
  // before considering that generic import wording.
  if (/failed to apply|apply loader entry/iu.test(message)) return 'apply' as const
  if (/cannot resolve|ERR_MODULE_NOT_FOUND|failed to (?:load|import)|missed the module table/iu.test(message)) {
    return 'import' as const
  }
  if (/did not activate|pending \(waiting|activation/iu.test(message)) return 'activate' as const
  return 'compose' as const
}

const LOADER_IMPORT_FAILURE = /failed to import loader entry\s+([^\s(:]+)(?:\s+\(([^)\r\n]+)\))?/giu
const LOADER_ENTRY_FAILURE = /failed to (import|apply) loader entry\s+([^\s(:]+)(?:\s+\(([^)\r\n]+)\))?/giu
const CLIENT_MODULE_UNAVAILABLE = new RegExp(
  String.raw`client-modules:\s*require\([^\r\n]+\).*?`
  + String.raw`(?:missed the module table|not a materialized module|no registered package factory)`,
  'isu',
)
const MISSING_IMPORTED_MODULE = /(?:require\(|Cannot find (?:package|module)\s+)["']([^"']+)["']/giu
const MISSING_IMPORTED_EXPORT = /The requested module\s+["']([^"']+)["']\s+does not provide an export named\s+["']([^"']+)["']/iu

function boundedLoaderToken(value: string | undefined, maxLength: number): string | undefined {
  return value === undefined || value === '' || /[\0\r\n]/u.test(value)
    ? undefined
    : value.slice(0, maxLength)
}

function startupErrorChain(error: unknown): string {
  const messages: string[] = []
  const seen = new Set<unknown>()
  const visit = (current: unknown): void => {
    if (current === undefined || seen.has(current)) return
    seen.add(current)
    if (current instanceof Error) {
      messages.push(current.message)
      if (current instanceof AggregateError) {
        for (const nested of current.errors) visit(nested)
      }
      visit(current.cause)
      return
    }
    if (typeof current === 'string') messages.push(current)
  }
  visit(error)
  return messages.join('\n')
}

function loaderEntryFailures(error: unknown): readonly {
  stage: 'import' | 'apply'
  entryId: string
  moduleName: string
}[] {
  const found = new Map<string, { stage: 'import' | 'apply'; entryId: string; moduleName: string }>()
  for (const match of startupErrorChain(error).matchAll(LOADER_ENTRY_FAILURE)) {
    const stage = match[1]
    const entryId = boundedLoaderToken(match[2], 512)
    const moduleName = boundedLoaderToken(match[3], 512)
    if ((stage !== 'import' && stage !== 'apply') || entryId === undefined || moduleName === undefined) continue
    found.set(`${stage}\0${entryId}\0${moduleName}`, { stage, entryId, moduleName })
  }
  return [...found.values()]
}

/**
 * Attribute the deepest Loader import or apply wrapper in a startup failure.
 * Patch provenance must still prove the owning bundle before recovery mutates
 * the Profile; the plugin's own exception text is never trusted for identity.
 * @param error - startup exception and optional cause chain.
 * @returns Stable Loader identity and lifecycle stage, when present.
 */
export function loaderEntryFailure(
  error: unknown,
): {
  readonly stage: 'import' | 'apply'
  readonly entryId: string
  readonly moduleName: string
} | undefined {
  return loaderEntryFailures(error).at(-1)
}

/**
 * Attribute the deepest synchronous Loader module-resolution failure.
 * @param error - startup exception and optional cause chain.
 * @returns the Loader identity only when the cause chain proves a missing module.
 */
export function loaderClientModuleFailure(
  error: unknown,
): {
  readonly entryId: string
  readonly moduleName: string
  readonly dependencyModule?: string
  readonly missingExport?: string
} | undefined {
  const diagnostic = startupErrorChain(error)
  if (!CLIENT_MODULE_UNAVAILABLE.test(diagnostic)
    && !/ERR_MODULE_NOT_FOUND|Cannot find (?:package|module)/iu.test(diagnostic)
    && !MISSING_IMPORTED_EXPORT.test(diagnostic)) return undefined
  const match = [...diagnostic.matchAll(LOADER_IMPORT_FAILURE)].at(-1)
  if (match?.[1] === undefined || match[2] === undefined) return undefined
  const missingExport = diagnostic.match(MISSING_IMPORTED_EXPORT)
  const dependencyModule = boundedLoaderToken(missingExport?.[1], 512)
  const missingExportName = boundedLoaderToken(missingExport?.[2], 256)
  if (missingExport !== null && (dependencyModule === undefined || missingExportName === undefined)) return undefined
  return {
    entryId: match[1],
    moduleName: match[2],
    ...(dependencyModule === undefined ? {} : { dependencyModule }),
    ...(missingExportName === undefined ? {} : { missingExport: missingExportName }),
  }
}

function loaderMissingDependency(error: unknown, loaderModule: string): string | undefined {
  const diagnostic = startupErrorChain(error)
  const candidates = [...diagnostic.matchAll(MISSING_IMPORTED_MODULE)]
    .map(match => match[1])
    .filter((value): value is string => value !== undefined && value !== loaderModule)
  return candidates.at(-1)
}

function deduplicateStartupIssues(issues: readonly ProfileDiagnostic[]): ProfileDiagnostic[] {
  const seen = new Set<string>()
  return issues.filter((issue) => {
    const key = `${issue.code}\0${issue.attribution?.rootPackage ?? ''}\0${issue.attribution?.entryId ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Decide whether a failed normal Profile can improve by omitting user-owned layers. */
export function isDeterministicSafeModeFailure(issue: ProfileDiagnostic): boolean {
  return issue.code !== 'pnpm.network'
    && issue.code !== 'pnpm.registry-auth'
    && issue.code !== 'pnpm.minimum-release-age'
    && issue.code !== 'profile.unknown'
    && issue.code !== 'runtime.launch-invalid'
}

function configuredExternalBundles(profile: string): string[] {
  try {
    const profileDir = resolveProfileDir(profile)
    const configured = readProfileManifest(NAME, profileDir).dsh?.profile?.bundles ?? []
    const installationOwned = new Set(PROFILE_TEMPLATES[profile]?.bundles ?? DEFAULT_PROFILE_BUNDLES)
    return configured.filter(bundle => !installationOwned.has(bundle))
  } catch {
    return []
  }
}

/**
 * Re-throw a watcher-setup failure unless a shutdown already owns the tree:
 * a signal aborted this invocation, or an app requested exit (`ctx.appExit`
 * from a fast one-shot) and the root's disposal rejected the in-flight setup
 * await. Either way the failure describes a tree that is exiting as asked,
 * not a broken watch.
 * @param ctx - the booted root context.
 * @param signal - this invocation's signal-shutdown fact.
 * @param error - the setup failure.
 */
function suppressShutdownError(ctx: Context, signal: AbortSignal, error: unknown): void {
  if (signal.aborted) return
  if (ctx.fiber.state !== FiberState.ACTIVE || ctx.get('loader') === undefined) return
  throw error
}

/**
 * Boot one profile invocation end to end and leave process lifetime to the
 * mounted plugins (or to a one-shot runner the composition mounts).
 * @param options - environment snapshot, profile name, overlays, and the booted app's own arguments.
 * @returns the settled root context and the shutdown controller.
 */
async function runProfileAttempt(options: RunProfileOptions): Promise<{ ctx: Context; shutdown: ProcessShutdown }> {
  const safeMode = options.safeMode === true
  const profileDir = resolveProfileDir(options.profile)
  if (!safeMode && existsSync(join(profileDir, 'package.json'))) {
    await healProfilesModuleFallback({ installAnchor: INSTALL_ANCHOR })
    const dependencyHealth = repairProfileDependencies({
      binName: NAME,
      profile: options.profile,
      installAnchor: INSTALL_ANCHOR,
      runPackageManager: args => runProfilePackageManager(profileDir, args),
    })
    if (dependencyHealth.status === 'failed') {
      throw new Error(
        `${NAME}: profile ${options.profile} has unresolved shared Host dependency conflicts: `
        + (dependencyHealth.diagnostic ?? JSON.stringify(dependencyHealth.conflicts)),
      )
    }
    if (dependencyHealth.status === 'repaired' || dependencyHealth.status === 'quarantined') {
      process.stderr.write(`${NAME}: profile dependency health ${JSON.stringify(dependencyHealth)}\n`)
    }
  }
  // Before the first plugin mounts and before anything can issue a request: Node's fetch ignores the
  // proxy environment on its own, so every profile would otherwise connect directly. Resolving from
  // the launcher's snapshot — not `process.env` — is what lets a proxy declared in a `.env` layer
  // work, which the NODE_USE_ENV_PROXY flag cannot do because Node samples the environment at start.
  const disposeProxy = await installProxyFromEnvironment(
    options.environment,
    (message) => { process.stderr.write(`${NAME}: ${message}\n`) },
  )

  let composed: ComposedProfile
  try {
    composed = await composeProfile(options.profile, options.patchFiles, safeMode, options.fromDefaultProfile)
  } catch (error) {
    await disposeProxy()
    throw error
  }
  const app: { current?: Context } = {}
  const appReady = createAppReady()
  const shutdown = createProcessShutdown(async () => {
    try {
      await app.current?.fiber.dispose()
    } finally {
      try {
        await disposeProxy()
      } finally {
        if (composed.diagnosticRuntimeRoot !== undefined) {
          rmSync(composed.diagnosticRuntimeRoot, { recursive: true, force: true })
        }
      }
    }
  })
  const signalShutdown = new AbortController()
  const interrupt = (code: number): void => {
    signalShutdown.abort()
    shutdown.interrupt(code)
  }
  // Signals own teardown throughout the startup window, not only after boot()
  // settles: an inserted provider can publish before sibling rows finish mounting.
  // SIGTERM is a supervisor's ordinary stop request and exits 0 on every
  // surface — the launcher does not know whether the app considered its work
  // complete; SIGINT is a user interrupt and reports 130.
  process.on('SIGTERM', () => { interrupt(0) })
  process.on('SIGINT', () => { interrupt(130) })
  installFailLoud(NAME, process, async () => {
    await app.current?.fiber.dispose()
  })

  const rootConfig = join(composed.profile.dir, PROFILE_ROOT_FILENAME)
  // Recomposition for the live user layers: bundle layers below, overlays
  // above, so a user edit can never displace them. Parsed app arguments are
  // not in here at all — they live in app-provided services that survive a
  // recomposition. BOTH
  // user files are re-read per generation (the HMR watcher hands us only the
  // changed file's patches, which one of the reads duplicates — fresh reads
  // keep the two watchers from stitching in each other's stale copy).
  // Fresh clones per generation: the include pushes `insert` rows into the
  // mounted tree BY REFERENCE and later id-targeted patches mutate those
  // objects in place. Reusing one parsed patch object across applications
  // would bake a user override into the bundle's in-memory insert row, so
  // removing the override could never revert the row to the bundle default.
  const composeLive = (): PatchOptions[] => structuredClone(withDesktopCodexProxy([
    ...composed.bundlePatches,
    ...loadOptionalPatches(NAME, composed.profile.patchPath) ?? [],
    ...loadOptionalPatches(NAME, homePatchPath()) ?? [],
    ...composed.overlays,
  ], process.env))
  // Cloned for the same insert-aliasing reason as composeLive: the boot
  // application must not mutate the objects later reloads recompose from.
  let ctx: Context
  try {
    ctx = await boot(NAME, rootConfig, structuredClone(allPatches(composed)), (hostCtx) => {
      app.current = hostCtx
      // Before any config-tree entry mounts, so plugins resolve all launch-time
      // environment values from the same immutable provenance snapshot.
      hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, options.environment)
      // The command line and bounded exit request are launcher facts available
      // to every app plugin that injects the argument snapshot.
      provideCmdline(hostCtx, {
        args: options.args,
        exit: code => void shutdown.shutdown(code),
        ready: appReady.service,
      })
    }, safeMode ? diagnosticProfileModuleBaseUrl(composed.profile.dir) : undefined)
  } catch (error) {
    try {
      await disposeProxy()
    } finally {
      if (composed.diagnosticRuntimeRoot !== undefined) {
        rmSync(composed.diagnosticRuntimeRoot, { recursive: true, force: true })
      }
    }
    throw error
  }
  app.current = ctx
  if (safeMode) {
    const current = readProfileDiagnosticReport(options.profile)
    const enteredAt = new Date().toISOString()
    writeProfileDiagnosticReport(createProfileDiagnosticReport(
      options.profile,
      current?.issues ?? [],
      {
        safeMode: {
          enteredAt,
          skippedBundles: configuredExternalBundles(options.profile),
          skippedUserLayers: true,
          skippedUserSettings: true,
          skippedUserSessions: true,
          skippedUserStorage: true,
        },
      },
    ))
    process.stderr.write(`${NAME}: diagnostic safe mode active for profile ${JSON.stringify(options.profile)}\n`)
  }
  // A surface can dispose the whole tree while boot or this post-boot watcher
  // setup is still in flight — a signal, or a fast one-shot's appExit. Loader
  // presence and fiber state own liveness; the initial check skips a tree
  // that already exited, and the catch below re-checks for an exit that
  // landed mid-setup. Watching is unconditional: a one-shot surface exits
  // through its bounded shutdown, which disposes the watchers before the
  // loop drains.
  if (!safeMode && composed.profile.patchReload === 'live'
    && !signalShutdown.signal.aborted
    && ctx.fiber.state === FiberState.ACTIVE
    && ctx.get('loader') !== undefined) {
    try {
      // Config-only HMR for the live profile patch layer: dsh-base disables
      // module reload by default, so when no profile explicitly enabled that
      // service, mount a watch-only instance with no module roots —
      // cordis.patch.yml edits stay live without replacing source modules. A
      // silent skip would break the documented reload contract. HMR injects
      // the timer service, which a bare custom profile may not mount either.
      if (ctx.get('hmr') === undefined) {
        if (ctx.get('timer') === undefined) {
          await ctx.loader.create({ name: '@deepseek-ai/cordis-plugin-timer' })
        }
        await ctx.loader.create({ name: '@deepseek-ai/cordis-plugin-hmr', config: { root: [] } })
      }
      await watchUserPatches(ctx, {
        binName: NAME,
        filename: composed.profile.patchPath,
        compose: composeLive,
      })
      await watchUserPatches(ctx, {
        binName: NAME,
        filename: homePatchPath(),
        compose: composeLive,
      })
    } catch (error) {
      suppressShutdownError(ctx, signalShutdown.signal, error)
    }
  }
  if (!signalShutdown.signal.aborted
    && ctx.fiber.state === FiberState.ACTIVE
    && ctx.get('loader') !== undefined) {
    appReady.commit()
  }
  return { ctx, shutdown }
}

/**
 * Boot one Profile and retain a structured failure for desktop safe-mode recovery.
 * @param options - Profile composition, application arguments, and optional recovery policy.
 * @returns Settled root context and shutdown controller.
 */
export async function runProfile(options: RunProfileOptions): Promise<{ ctx: Context; shutdown: ProcessShutdown }> {
  try {
    return await runProfileAttempt(options)
  } catch (error) {
    const entryFailures = options.safeMode === true ? [] : loaderEntryFailures(error)
    const entryFailure = entryFailures.at(-1)
    const loaderFailure = options.safeMode === true ? undefined : loaderClientModuleFailure(error)
    let ownedFailure: UnresolvableProfileBundleEntry | undefined
    let ownedEntry: ProfileBundleEntryOwnership | undefined
    try {
      const healthOptions = {
        binName: NAME,
        profile: options.profile,
        installAnchor: INSTALL_ANCHOR,
      }
      ownedFailure = loaderFailure === undefined ? undefined : inspectUnresolvableProfileBundleEntries(healthOptions)
        .find(failure => failure.entryId === loaderFailure.entryId && failure.moduleName === loaderFailure.moduleName)
      const attributable = loaderFailure ?? entryFailure
      if (ownedFailure === undefined && attributable !== undefined) {
        const owner = inspectProfileBundleEntryOwnership(
          healthOptions,
          attributable.entryId,
          attributable.moduleName,
        )
        ownedEntry = owner
        const missingModule = loaderFailure === undefined
          ? undefined
          : loaderMissingDependency(error, loaderFailure.moduleName)
        if (owner !== undefined && loaderFailure !== undefined && missingModule !== undefined) {
          ownedFailure = {
            ...owner,
            failureKind: 'loader-dependency',
            missingModule,
            importerPackage: loaderFailure.moduleName,
          }
        } else if (owner !== undefined && loaderFailure !== undefined
          && loaderFailure.dependencyModule !== undefined
          && loaderFailure.missingExport !== undefined) {
          ownedFailure = {
            ...owner,
            failureKind: 'loader-dependency',
            missingModule: loaderFailure.dependencyModule,
            importerPackage: loaderFailure.moduleName,
          }
        }
      }
      const ownerships = entryFailures
        .map(failure => inspectProfileBundleEntryOwnership(
          healthOptions,
          failure.entryId,
          failure.moduleName,
        ))
        .filter((owner): owner is ProfileBundleEntryOwnership => owner !== undefined)
      const owners = new Set(ownerships.map(owner => owner.rootPackage))
      if (owners.size === 1) {
        ownedEntry = ownerships.find(owner => (
          owner.entryId === loaderFailure?.entryId && owner.moduleName === loaderFailure.moduleName
        )) ?? ownerships.at(-1)
      } else if (owners.size > 1) {
        // Several external bundles failed in the same Loader aggregate. There
        // is no unique responsibility, so automatic startup quarantine must
        // fail closed instead of choosing one by error ordering.
        ownedEntry = undefined
        ownedFailure = undefined
      }
    } catch {
      ownedFailure = undefined
      ownedEntry = undefined
    }
    const externalBundle = ownedFailure?.rootPackage ?? ownedEntry?.rootPackage ?? (
      loaderFailure !== undefined
        && loaderFailure.missingExport === undefined
        && configuredExternalBundles(options.profile).includes(loaderFailure.moduleName)
        ? loaderFailure.moduleName
        : undefined
    )
    const issueValue = ownedFailure?.failureKind === 'loader-dependency'
      ? new Error(
        loaderFailure?.missingExport === undefined
          ? `loader dependency unavailable: Loader module ${ownedFailure.moduleName} imports unavailable dependency ${ownedFailure.missingModule ?? '<unknown>'}`
          : `loader dependency unavailable: Loader module ${ownedFailure.moduleName} expects export ${loaderFailure.missingExport} from ${ownedFailure.missingModule ?? '<unknown>'}, but the installed dependency does not provide it`,
        { cause: error instanceof Error ? error : undefined },
      )
      : error
    const issue = classifyProfileDiagnostic({
      source: options.safeMode === true ? 'runtime' : 'profile',
      phase: startupFailurePhase(error),
      value: issueValue,
      home: resolveDshHome(),
      ...(entryFailure === undefined
        ? {}
        : {
          attribution: {
            entryId: entryFailure.entryId,
            moduleName: entryFailure.moduleName,
            ...(ownedFailure?.missingModule === undefined ? {} : { missingModule: ownedFailure.missingModule }),
            ...(loaderFailure?.missingExport === undefined ? {} : { missingExport: loaderFailure.missingExport }),
            ...(ownedFailure?.importerPackage === undefined ? {} : { importerPackage: ownedFailure.importerPackage }),
            ...(ownedFailure === undefined ? {} : { configKind: 'profile-patch' as const }),
            ...(externalBundle === undefined ? {} : { rootPackage: externalBundle }),
          },
        }),
    })
    let quarantined = false
    const pendingActivation = existsSync(join(resolveDshHome(), 'plugin-transactions', options.profile, 'pending.json'))
    if (options.safeModeOnFailure === true && externalBundle !== undefined && !pendingActivation) {
      const profileDir = resolveProfileDir(options.profile)
      let release: (() => void) | undefined
      try {
        release = acquireProfilePluginMutationLock({ profile: options.profile, waitMs: 0, operationKind: 'startup-quarantine' })
      } catch {
        // The original Loader incident remains primary; a concurrent writer
        // owns recovery, so startup must not mutate its Profile underneath it.
        process.stderr.write(`${NAME}: startup quarantine deferred because the Profile mutation lock is unavailable\n`)
      }
      if (release !== undefined) {
        let snapshot: ReturnType<typeof createProfilePluginSnapshot> | undefined
        try {
          snapshot = createProfilePluginSnapshot({ profile: options.profile, kind: 'automatic', trigger: 'diagnostic-repair' })
          const outcome = quarantineProfilePluginAfterLoadFailure({
            binName: NAME,
            profile: options.profile,
            installAnchor: INSTALL_ANCHOR,
            runPackageManager: args => runProfilePackageManager(profileDir, args),
          }, externalBundle, issue, loaderFailure === undefined
            ? 'loader-lifecycle-failed'
            : ownedFailure === undefined
              ? 'client-module-unavailable'
              : ownedFailure.failureKind === 'loader-dependency'
                ? 'loader-dependency-unavailable'
                : 'loader-module-unresolvable')
          quarantined = outcome.status === 'quarantined'
        } catch {
          // Retain the original classified Loader incident when backup or repair fails.
          process.stderr.write(`${NAME}: startup quarantine could not retain a safety point or complete repair; original incident retained\n`)
        } finally {
          try {
            if (snapshot !== undefined) finalizeProfilePluginSnapshot({
              profile: options.profile, snapshotId: snapshot.snapshotId, preserveIfUnchanged: snapshot.deduplicated === true,
            })
          } catch {
            // Snapshot cleanup must not replace the original startup incident.
            process.stderr.write(`${NAME}: startup quarantine snapshot cleanup deferred\n`)
          } finally { release() }
        }
      }
      if (quarantined) {
        process.stderr.write(`${NAME}: quarantined startup-incompatible plugin ${JSON.stringify({
          schema: 'dsh/profile-diagnostic/v2',
          packageName: externalBundle,
          entryId: entryFailure?.entryId,
          code: issue.code,
        })}\n`)
      }
    }
    let previous: readonly ProfileDiagnostic[] = []
    try {
      previous = readProfileDiagnosticReport(options.profile)?.issues ?? []
    } catch {
      // The fresh report below replaces an unreadable diagnostic file; user Profile data is untouched.
    }
    if (!quarantined) {
      writeProfileDiagnosticReport(createProfileDiagnosticReport(
        options.profile,
        deduplicateStartupIssues([...previous, issue]),
      ))
    }
    if (!quarantined
      && options.safeMode !== true
      && options.safeModeOnFailure === true
      && isDeterministicSafeModeFailure(issue)) {
      process.stderr.write(`${NAME}: profile safe mode eligible ${JSON.stringify({
        schema: 'dsh/profile-diagnostic/v2',
        code: issue.code,
      })}\n`)
    }
    throw error
  }
}

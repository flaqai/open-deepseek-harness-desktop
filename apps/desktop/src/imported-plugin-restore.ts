/** Safe, one-shot restoration metadata extracted from an official Web Profile. */

import { randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isMap, parseDocument, YAMLMap } from 'yaml'

const IMPORTED_PLUGIN_RESTORE_FILENAME = 'imported-plugin-restore.v1.json'
const IMPORTED_PLUGIN_RESTORE_SCHEMA = 'open-deepseek-harness-desktop/imported-plugin-restore/v1'

const OFFICIAL_BUNDLES = new Set(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
const EXTERNAL_TOOLS: ReadonlyMap<string, 'codex' | 'claude-code'> = new Map([
  ['@deepseek-ai/dsh-subagent-codex', 'codex'],
  ['@deepseek-ai/dsh-subagent-claude-code', 'claude-code'],
] as const)
const PACKAGE_NAME = /^(?:@[^/@\s]+\/[^@\s]+|[^/@\s]+)$/u
const LOCAL_SPEC_PROTOCOL = /^(?:file|link|workspace|path):/iu
const REGISTRY_SPEC = /^(?:[~^<>=*]|\d|v\d|latest$|next$|beta$|alpha$|rc$)/iu
const GIT_SPEC = /^(?:github:|git\+https:\/\/|git\+ssh:\/\/|git@github\.com:)/iu
const SECRET_HINT = /(?:[?&](?:token|access_token|auth)=|https?:\/\/[^/@\s]+:[^/@\s]+@)/iu

export type ImportedPluginRestoreState =
  | 'pending'
  | 'installing'
  | 'provided'
  | 'succeeded'
  | 'failed'
  | 'ignored'

type ImportedPluginSourceAvailability =
  | 'checking'
  | 'available'
  | 'unavailable'
  | 'unknown'
  | 'provided'

export interface ImportedPluginSourceCheckResult {
  readonly availability: Exclude<ImportedPluginSourceAvailability, 'checking' | 'provided'>
  readonly diagnostic?: string
}

type ImportedPluginUnsupportedReason =
  | 'local-source'
  | 'credentialed-source'
  | 'invalid-spec'

export interface ImportedPluginRestoreEntry {
  readonly restoreId: string
  readonly packageName: string
  readonly packageSpec: string
  readonly declaredSpec: string
  readonly category: 'plugin' | 'external-tool'
  readonly tool?: 'codex' | 'claude-code'
  readonly defaultSelected: boolean
  readonly recoverable: boolean
  readonly unsupportedReason?: ImportedPluginUnsupportedReason
  readonly state: ImportedPluginRestoreState
  readonly diagnostic?: string
}

export interface ImportedPluginRestorePlan {
  readonly schema: typeof IMPORTED_PLUGIN_RESTORE_SCHEMA
  readonly profile: 'web'
  readonly createdAt: string
  readonly firstPromptDismissed: boolean
  readonly ignored: boolean
  readonly allowBuildsApplied: boolean
  readonly sourceIssues: readonly string[]
  readonly allowBuilds: Readonly<Record<string, boolean>>
  readonly entries: readonly ImportedPluginRestoreEntry[]
}

export interface ImportedPluginRestoreSnapshot extends ImportedPluginRestorePlan {
  readonly entries: readonly ImportedPluginRestoreRuntimeEntry[]
  readonly active: boolean
  readonly sourceCheckActive: boolean
  readonly restartRequired: boolean
}

interface ImportedPluginRestoreRuntimeEntry extends ImportedPluginRestoreEntry {
  readonly availability: ImportedPluginSourceAvailability
  readonly availabilityDiagnostic?: string
}

interface SourceProfileManifest {
  readonly dependencies?: Record<string, unknown>
  readonly dsh?: { readonly profile?: { readonly bundles?: unknown } }
}

function boundedDiagnostic(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/((?:token|password|secret|api[_-]?key))\s*[:=]\s*\S+/giu, '$1=[redacted]')
    .replace(/(https?:\/\/)[^/@\s:]+:[^/@\s]+@/giu, '$1[redacted]@')
    .slice(0, 2000)
}

/** Classify package-manager failures conservatively so network trouble never means "missing". */
export function classifyImportedPluginSourceFailure(
  diagnostic: string,
  timedOut = false,
): ImportedPluginSourceCheckResult {
  const bounded = boundedDiagnostic(diagnostic)
  const temporaryFailure = new RegExp([
    'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ERR_PNPM_META_FETCH_FAIL',
    'ERR_PNPM_FETCH_401', 'ERR_PNPM_FETCH_403', '429', 'rate.?limit', 'authentication', 'authorization',
  ].join('|'), 'iu')
  if (timedOut || temporaryFailure.test(diagnostic)) {
    return { availability: 'unknown', diagnostic: bounded }
  }
  const absentSource = new RegExp([
    'ERR_PNPM_FETCH_404', 'ERR_PNPM_NO_MATCHING_VERSION', 'No matching version', 'repository not found',
    'remote ref does not exist', "couldn['’]t find remote ref", 'not found in the registry',
  ].join('|'), 'iu')
  if (absentSource.test(diagnostic)) {
    return { availability: 'unavailable', diagnostic: bounded }
  }
  return { availability: 'unknown', diagnostic: bounded }
}

function classifySpec(spec: string): { recoverable: boolean; reason?: ImportedPluginUnsupportedReason } {
  const windowsAbsolute = /^[A-Za-z]:/u.test(spec) && (spec[2] === '/' || spec[2] === '\\')
  if (LOCAL_SPEC_PROTOCOL.test(spec) || windowsAbsolute || spec.startsWith('/') || spec.startsWith('\\')
    || spec.startsWith('./') || spec.startsWith('../')) {
    return { recoverable: false, reason: 'local-source' }
  }
  if (SECRET_HINT.test(spec)) return { recoverable: false, reason: 'credentialed-source' }
  if (spec.startsWith('npm:') || REGISTRY_SPEC.test(spec) || GIT_SPEC.test(spec)) return { recoverable: true }
  return { recoverable: false, reason: 'invalid-spec' }
}

function packageRequest(packageName: string, declaredSpec: string): string {
  return `${packageName}@${declaredSpec}`
}

function githubRepositoryIdentity(spec: string): string | undefined {
  const normalized = spec.trim().replace(/^git\+/u, '')
  const shorthand = /^github:(?<repository>[^#]+)(?:#(?<fragment>.*))?$/iu.exec(normalized)
  const url = /^(?:https?|git|ssh):\/\/(?:git@)?github\.com[/:](?<repository>[^#]+)(?:#(?<fragment>.*))?$/iu.exec(normalized)
    ?? /^git@github\.com:(?<repository>[^#]+)(?:#(?<fragment>.*))?$/iu.exec(normalized)
  const match = shorthand ?? url
  const repository = match?.groups?.repository?.replace(/\.git$/iu, '').replace(/^\/+|\/+$/gu, '')
  if (repository === undefined || repository.split('/').length !== 2) return undefined
  const path = /(?:^|&)path:\/?(?<path>[^&]+)(?:&|$)/u.exec(match?.groups?.fragment ?? '')?.groups?.path
  return `github:${repository.toLowerCase()}${path === undefined ? '' : `#path:${path.replace(/\/+$/gu, '').toLowerCase()}`}`
}

function npmAliasIdentity(spec: string): string | undefined {
  return /^npm:(?<name>@[^/@\s]+\/[^@\s]+|[^@\s]+)@/u.exec(spec)?.groups?.name
}

/** Whether one existing dependency already provides a restore entry's package identity. */
export function dependencyMatchesImportedRestore(
  dependencyName: string,
  dependencySpec: string,
  entry: Pick<ImportedPluginRestoreEntry, 'packageName' | 'declaredSpec'>,
): boolean {
  if (dependencyName === entry.packageName) return true
  const alias = npmAliasIdentity(entry.declaredSpec)
  if (alias !== undefined && npmAliasIdentity(dependencySpec) === alias) return true
  const repository = githubRepositoryIdentity(entry.declaredSpec)
  return repository !== undefined && githubRepositoryIdentity(dependencySpec) === repository
}

async function regularFile(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isFile()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function safeProfileDirectory(officialDshHome: string): Promise<string | undefined> {
  const profiles = join(officialDshHome, 'profiles')
  const web = join(profiles, 'web')
  try {
    const profilesMetadata = await lstat(profiles)
    const webMetadata = await lstat(web)
    return profilesMetadata.isDirectory() && !profilesMetadata.isSymbolicLink()
      && webMetadata.isDirectory() && !webMetadata.isSymbolicLink()
      ? web
      : undefined
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function readExternalToolDefaults(settingsPath: string): Promise<Record<'codex' | 'claude-code', boolean>> {
  const defaults = { codex: false, 'claude-code': false }
  if (!await regularFile(settingsPath)) return defaults
  try {
    const document = parseDocument(await readFile(settingsPath, 'utf8'))
    if (document.errors.length > 0) return defaults
    defaults.codex = document.getIn(['agent-presets', 'externalTools', 'codex']) === true
      || document.getIn(['externalTools', 'codex']) === true
    defaults['claude-code'] = document.getIn(['agent-presets', 'externalTools', 'claudeCode']) === true
      || document.getIn(['externalTools', 'claudeCode']) === true
    return defaults
  } catch {
    return defaults
  }
}

async function readAllowBuilds(path: string, issues: string[]): Promise<Record<string, boolean>> {
  if (!await regularFile(path)) return {}
  try {
    const document = parseDocument(await readFile(path, 'utf8'))
    if (document.errors.length > 0) throw new Error(document.errors[0]?.message ?? 'invalid YAML')
    const value = document.get('allowBuilds', true)
    if (value === undefined) return {}
    if (!isMap(value)) throw new Error('allowBuilds must be a YAML mapping')
    const result: Record<string, boolean> = {}
    for (const [key, enabled] of Object.entries(value.toJSON() as Record<string, unknown>)) {
      if ((enabled === true || enabled === false) && key.length <= 4096) result[key] = enabled
    }
    return result
  } catch (error) {
    issues.push(`pnpm-workspace.yaml: ${boundedDiagnostic(error)}`)
    return {}
  }
}

/** Extract a portable restore plan without reading or copying plugin runtime content. */
export async function extractImportedPluginRestorePlan(
  officialDshHome: string,
  createId: () => string = randomUUID,
): Promise<ImportedPluginRestorePlan> {
  const issues: string[] = []
  const profileDir = await safeProfileDirectory(officialDshHome)
  const toolDefaults = await readExternalToolDefaults(join(officialDshHome, 'settings.yaml'))
  const allowBuilds = profileDir === undefined
    ? {}
    : await readAllowBuilds(join(profileDir, 'pnpm-workspace.yaml'), issues)
  const entries: ImportedPluginRestoreEntry[] = []
  const manifestPath = profileDir === undefined ? undefined : join(profileDir, 'package.json')
  if (manifestPath !== undefined && await regularFile(manifestPath)) {
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as SourceProfileManifest
      const dependencies = manifest.dependencies
      const bundles = manifest.dsh?.profile?.bundles
      if (dependencies !== undefined && (typeof dependencies !== 'object' || Array.isArray(dependencies))) {
        throw new Error('dependencies must be an object')
      }
      if (bundles !== undefined && !Array.isArray(bundles)) throw new Error('dsh.profile.bundles must be an array')
      for (const packageNameValue of Array.isArray(bundles) ? bundles : []) {
        if (typeof packageNameValue !== 'string' || OFFICIAL_BUNDLES.has(packageNameValue)) continue
        if (!PACKAGE_NAME.test(packageNameValue)) continue
        const declaredSpec = dependencies?.[packageNameValue]
        if (typeof declaredSpec !== 'string') continue
        const classification = classifySpec(declaredSpec)
        const tool = EXTERNAL_TOOLS.get(packageNameValue)
        entries.push({
          restoreId: createId(),
          packageName: packageNameValue,
          packageSpec: packageRequest(packageNameValue, declaredSpec),
          declaredSpec,
          category: tool === undefined ? 'plugin' : 'external-tool',
          ...(tool === undefined ? {} : { tool }),
          defaultSelected: tool === undefined ? classification.recoverable : toolDefaults[tool],
          recoverable: classification.recoverable,
          ...(classification.reason === undefined ? {} : { unsupportedReason: classification.reason }),
          state: 'pending',
        })
      }
    } catch (error) {
      issues.push(`profiles/web/package.json: ${boundedDiagnostic(error)}`)
    }
  }
  return {
    schema: IMPORTED_PLUGIN_RESTORE_SCHEMA,
    profile: 'web',
    createdAt: new Date().toISOString(),
    firstPromptDismissed: false,
    ignored: false,
    allowBuildsApplied: false,
    sourceIssues: issues,
    allowBuilds,
    entries,
  }
}

/** Atomically save a restore plan with user-only permissions. */
export async function writeImportedPluginRestorePlan(
  dshHome: string,
  plan: ImportedPluginRestorePlan,
): Promise<void> {
  await mkdir(dshHome, { recursive: true, mode: 0o700 })
  const path = join(dshHome, IMPORTED_PLUGIN_RESTORE_FILENAME)
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 })
  await chmod(temporary, 0o600)
  await rename(temporary, path)
}

/** Read and minimally validate the desktop-owned restore plan. */
export async function readImportedPluginRestorePlan(dshHome: string): Promise<ImportedPluginRestorePlan | undefined> {
  const path = join(dshHome, IMPORTED_PLUGIN_RESTORE_FILENAME)
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as Partial<ImportedPluginRestorePlan>
    const rawAllowBuilds: unknown = value.allowBuilds
    if (value.schema !== IMPORTED_PLUGIN_RESTORE_SCHEMA || value.profile !== 'web'
      || typeof value.createdAt !== 'string' || typeof value.firstPromptDismissed !== 'boolean'
      || typeof value.ignored !== 'boolean' || typeof value.allowBuildsApplied !== 'boolean'
      || !Array.isArray(value.sourceIssues) || value.sourceIssues.some(issue => typeof issue !== 'string')
      || !Array.isArray(value.entries) || rawAllowBuilds === null || typeof rawAllowBuilds !== 'object') return undefined
    const allowBuilds: Record<string, boolean> = {}
    for (const [key, enabled] of Object.entries(rawAllowBuilds as Record<string, unknown>)) {
      if ((enabled !== true && enabled !== false) || key.length > 4096) return undefined
      allowBuilds[key] = enabled
    }
    const entries: ImportedPluginRestoreEntry[] = []
    const ids = new Set<string>()
    for (const raw of value.entries) {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
      const entry = raw as Partial<ImportedPluginRestoreEntry>
      if (typeof entry.restoreId !== 'string' || entry.restoreId.length < 1 || ids.has(entry.restoreId)
        || typeof entry.packageName !== 'string' || !PACKAGE_NAME.test(entry.packageName)
        || typeof entry.declaredSpec !== 'string' || entry.packageSpec !== packageRequest(entry.packageName, entry.declaredSpec)
        || (entry.category !== 'plugin' && entry.category !== 'external-tool')
        || typeof entry.defaultSelected !== 'boolean' || typeof entry.recoverable !== 'boolean'
        || !['pending', 'installing', 'provided', 'succeeded', 'failed', 'ignored'].includes(String(entry.state))) return undefined
      const classification = classifySpec(entry.declaredSpec)
      if (entry.recoverable !== classification.recoverable || entry.unsupportedReason !== classification.reason) return undefined
      const knownTool = EXTERNAL_TOOLS.get(entry.packageName)
      if ((knownTool === undefined && (entry.category !== 'plugin' || entry.tool !== undefined))
        || (knownTool !== undefined && (entry.category !== 'external-tool' || entry.tool !== knownTool))) return undefined
      if (entry.diagnostic !== undefined && (typeof entry.diagnostic !== 'string' || entry.diagnostic.length > 4000)) return undefined
      ids.add(entry.restoreId)
      entries.push(entry as ImportedPluginRestoreEntry)
    }
    return { ...(value as ImportedPluginRestorePlan), allowBuilds, entries }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return undefined
    throw error
  }
}

/** Merge imported exact build rules while preserving comments and every explicit denial. */
export async function mergeImportedAllowBuilds(
  profileDir: string,
  imported: Readonly<Record<string, boolean>>,
): Promise<boolean> {
  if (Object.keys(imported).length === 0) return false
  const path = join(profileDir, 'pnpm-workspace.yaml')
  const source = await readFile(path, 'utf8')
  const document = parseDocument(source)
  if (document.errors.length > 0) throw new Error(`desktop: cannot merge allowBuilds: ${document.errors[0]?.message ?? 'invalid YAML'}`)
  let allowBuilds = document.get('allowBuilds', true)
  if (allowBuilds === undefined) {
    allowBuilds = new YAMLMap()
    document.set('allowBuilds', allowBuilds)
  }
  if (!isMap(allowBuilds)) throw new Error('desktop: target allowBuilds must be a YAML mapping')
  let changed = false
  for (const [key, sourceValue] of Object.entries(imported)) {
    const targetValue = allowBuilds.get(key)
    if (targetValue !== undefined && targetValue !== true && targetValue !== false) continue
    const merged = targetValue !== false && sourceValue
    if (targetValue !== merged) {
      allowBuilds.set(key, merged)
      changed = true
    }
  }
  if (!changed) return false
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, document.toString(), { mode: 0o600 })
  await rename(temporary, path)
  return true
}

export interface ImportedPluginRestoreManagerOptions {
  readonly dshHome: string
  readonly providedDependencies: Readonly<Record<string, string>>
  readonly install: (packageSpecs: readonly string[]) => Promise<string>
  readonly inspectSource?: (packageSpec: string) => Promise<ImportedPluginSourceCheckResult>
  readonly mergeAllowBuilds?: (profileDir: string, rules: Readonly<Record<string, boolean>>) => Promise<boolean>
  readonly withMutation: <T>(operation: () => Promise<T>, expectedPackages: readonly string[]) => Promise<T>
}

/** Own opaque-id validation and one candidate activation for each selected batch. */
export class ImportedPluginRestoreManager {
  private plan: ImportedPluginRestorePlan | undefined
  private active = false
  private sourceCheckActive = false
  private readonly sourceAvailability = new Map<string, ImportedPluginSourceCheckResult>()
  private readonly options: ImportedPluginRestoreManagerOptions

  constructor(options: ImportedPluginRestoreManagerOptions) {
    this.options = options
  }

  async prepare(): Promise<void> {
    const loaded = await readImportedPluginRestorePlan(this.options.dshHome)
    if (loaded === undefined) return
    const entries = loaded.entries.map((entry): ImportedPluginRestoreEntry => {
      if (Object.entries(this.options.providedDependencies).some(([name, spec]) => (
        dependencyMatchesImportedRestore(name, spec, entry)
      ))) {
        const { diagnostic: _diagnostic, ...rest } = entry
        return { ...rest, state: 'provided' }
      }
      return entry.state === 'installing'
        ? { ...entry, state: 'failed', diagnostic: 'The previous restore was interrupted.' }
        : entry
    })
    let next: ImportedPluginRestorePlan = { ...loaded, entries }
    if (!next.allowBuildsApplied) {
      try {
        await (this.options.mergeAllowBuilds ?? mergeImportedAllowBuilds)(
          join(this.options.dshHome, 'profiles', 'web'), next.allowBuilds,
        )
        next = { ...next, allowBuildsApplied: true }
      } catch (error) {
        next = { ...next, sourceIssues: [...next.sourceIssues, `allowBuilds merge: ${boundedDiagnostic(error)}`] }
      }
    }
    this.plan = next
    await writeImportedPluginRestorePlan(this.options.dshHome, next)
  }

  snapshot(): ImportedPluginRestoreSnapshot | undefined {
    return this.plan === undefined ? undefined : {
      ...this.plan,
      entries: this.plan.entries.map((entry): ImportedPluginRestoreRuntimeEntry => {
        if (entry.state === 'provided') return { ...entry, availability: 'provided' }
        const checked = this.sourceAvailability.get(entry.restoreId)
        if (checked !== undefined) return {
          ...entry,
          availability: checked.availability,
          ...(checked.diagnostic === undefined ? {} : { availabilityDiagnostic: checked.diagnostic }),
        }
        return {
          ...entry,
          availability: entry.recoverable ? 'checking' : 'unavailable',
        }
      }),
      active: this.active,
      sourceCheckActive: this.sourceCheckActive,
      restartRequired: false,
    }
  }

  /** Start a bounded-concurrency, read-only source check without delaying startup. */
  startSourceCheck(): ImportedPluginRestoreSnapshot | undefined {
    if (this.plan === undefined || this.sourceCheckActive || this.options.inspectSource === undefined) return this.snapshot()
    const entries = this.plan.entries.filter(entry => entry.state !== 'provided' && entry.recoverable)
    if (entries.length === 0) return this.snapshot()
    this.sourceCheckActive = true
    for (const entry of entries) this.sourceAvailability.delete(entry.restoreId)
    void this.runSourceCheck(entries)
    return this.snapshot()
  }

  private async runSourceCheck(entries: readonly ImportedPluginRestoreEntry[]): Promise<void> {
    let cursor = 0
    const worker = async (): Promise<void> => {
      while (cursor < entries.length) {
        const entry = entries[cursor++]
        if (entry === undefined) return
        try {
          const result = await this.options.inspectSource?.(entry.packageSpec)
          this.sourceAvailability.set(entry.restoreId, result ?? { availability: 'unknown' })
        } catch (error) {
          this.sourceAvailability.set(entry.restoreId, {
            availability: 'unknown',
            diagnostic: boundedDiagnostic(error),
          })
        }
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(3, entries.length) }, worker))
    } finally {
      this.sourceCheckActive = false
    }
  }

  async dismissPrompt(): Promise<ImportedPluginRestoreSnapshot | undefined> {
    if (this.plan === undefined) return undefined
    this.plan = { ...this.plan, firstPromptDismissed: true }
    await writeImportedPluginRestorePlan(this.options.dshHome, this.plan)
    return this.snapshot()
  }

  async ignorePending(): Promise<ImportedPluginRestoreSnapshot | undefined> {
    if (this.plan === undefined) return undefined
    this.plan = {
      ...this.plan,
      firstPromptDismissed: true,
      ignored: true,
      entries: this.plan.entries.map(entry => entry.state === 'pending' ? { ...entry, state: 'ignored' as const } : entry),
    }
    await writeImportedPluginRestorePlan(this.options.dshHome, this.plan)
    return this.snapshot()
  }

  async start(restoreIds: readonly string[]): Promise<ImportedPluginRestoreSnapshot> {
    if (this.plan === undefined) throw new Error('desktop: imported plugin restore plan is unavailable')
    if (this.active) throw new Error('desktop: imported plugin restore is already running')
    const ids = new Set(restoreIds)
    if (restoreIds.length === 0 || ids.size !== restoreIds.length || restoreIds.some(id => typeof id !== 'string')) {
      throw new TypeError('desktop: invalid imported plugin restore ids')
    }
    for (const id of ids) {
      const entry = this.plan.entries.find(candidate => candidate.restoreId === id)
      if (entry === undefined || !entry.recoverable || (entry.state !== 'pending' && entry.state !== 'failed')) {
        throw new TypeError('desktop: imported plugin restore id is not selectable')
      }
      const availability = this.sourceAvailability.get(id)?.availability
      if (availability === 'unavailable') throw new TypeError('desktop: imported plugin source is unavailable')
      if (this.options.inspectSource !== undefined && availability === undefined) {
        throw new TypeError('desktop: imported plugin source has not been checked')
      }
    }
    this.active = true
    this.plan = { ...this.plan, firstPromptDismissed: true, ignored: false }
    try {
      await writeImportedPluginRestorePlan(this.options.dshHome, this.plan)
    } catch (error) {
      this.active = false
      throw error
    }
    void this.run(ids)
    return this.snapshot() as ImportedPluginRestoreSnapshot
  }

  /** Install one host-validated local archive through the standard plugin flow. */
  async installLocal(restoreId: string, archivePath: string): Promise<ImportedPluginRestoreSnapshot> {
    if (this.plan === undefined) throw new Error('desktop: imported plugin restore plan is unavailable')
    if (this.active) throw new Error('desktop: imported plugin restore is already running')
    const entry = this.requireLocalEntry(restoreId)
    this.active = true
    this.plan = { ...this.plan, firstPromptDismissed: true, ignored: false }
    try {
      const diagnostic = await this.mutate([entry.packageName], async () => {
        await this.update(entry.restoreId, { state: 'installing', diagnostic: null })
        return this.options.install([archivePath])
      })
      await this.update(entry.restoreId, {
        state: 'succeeded',
        ...(diagnostic.trim() === '' ? {} : { diagnostic: diagnostic.slice(-2000) }),
      })
    } catch (error) {
      await this.update(entry.restoreId, { state: 'failed', diagnostic: boundedDiagnostic(error) })
    } finally {
      this.active = false
    }
    return this.snapshot() as ImportedPluginRestoreSnapshot
  }

  /** Install one validated offline selection through a single candidate activation. */
  async installPortable(
    selected: readonly { readonly restoreId: string; readonly packageName: string; readonly archive: string }[],
    install: (archives: readonly string[]) => Promise<string>,
  ): Promise<ImportedPluginRestoreSnapshot> {
    if (this.plan === undefined) throw new Error('desktop: imported plugin restore plan is unavailable')
    if (this.active) throw new Error('desktop: imported plugin restore is already running')
    const ids = new Set(selected.map(item => item.restoreId))
    if (selected.length === 0 || ids.size !== selected.length) throw new TypeError('desktop: invalid portable plugin selection')
    for (const item of selected) {
      const entry = this.requireLocalEntry(item.restoreId)
      if (entry.packageName !== item.packageName) throw new TypeError('desktop: portable plugin identity changed')
    }
    this.active = true
    this.plan = { ...this.plan, firstPromptDismissed: true, ignored: false }
    try {
      const diagnostic = await this.mutate(selected.map(item => item.packageName), async () => {
        for (const item of selected) await this.update(item.restoreId, { state: 'installing', diagnostic: null })
        return install(selected.map(item => item.archive))
      })
      for (const item of selected) await this.update(item.restoreId, {
        state: 'succeeded',
        ...(diagnostic.trim() === '' ? {} : { diagnostic: diagnostic.slice(-2000) }),
      })
    } catch (error) {
      const diagnostic = selected.length > 1
        ? `Batch rolled back: ${boundedDiagnostic(error)}` : boundedDiagnostic(error)
      for (const item of selected) await this.update(item.restoreId, { state: 'failed', diagnostic })
    } finally {
      this.active = false
    }
    return this.snapshot() as ImportedPluginRestoreSnapshot
  }

  /** Resolve the package identity for a local picker without exposing filesystem access to the renderer. */
  localEntry(restoreId: string): Pick<ImportedPluginRestoreEntry, 'packageName' | 'declaredSpec'> {
    const entry = this.requireLocalEntry(restoreId)
    return { packageName: entry.packageName, declaredSpec: entry.declaredSpec }
  }

  private requireLocalEntry(restoreId: string): ImportedPluginRestoreEntry {
    if (this.plan === undefined || typeof restoreId !== 'string') {
      throw new TypeError('desktop: invalid imported plugin restore id')
    }
    const entry = this.plan.entries.find(candidate => candidate.restoreId === restoreId)
    if (entry === undefined || entry.category !== 'plugin'
      || (entry.state !== 'pending' && entry.state !== 'failed')) {
      throw new TypeError('desktop: imported plugin restore id does not accept a local source')
    }
    return entry
  }

  private async run(ids: ReadonlySet<string>): Promise<void> {
    const selected = (this.plan?.entries ?? []).filter(entry => ids.has(entry.restoreId))
    try {
      let diagnostic = ''
      try {
        diagnostic = await this.mutate(selected.map(entry => entry.packageName), async () => {
          for (const original of selected) {
            await this.update(original.restoreId, { state: 'installing', diagnostic: null })
          }
          return this.options.install(selected.map(entry => entry.packageSpec))
        })
      } catch (error) {
        const failure = selected.length > 1
          ? `Batch rolled back: ${boundedDiagnostic(error)}`
          : boundedDiagnostic(error)
        for (const original of selected) {
          await this.update(original.restoreId, {
            state: 'failed',
            diagnostic: failure,
          })
        }
        return
      }
      for (const original of selected) {
        await this.update(original.restoreId, {
          state: 'succeeded',
          ...(diagnostic.trim() === '' ? {} : { diagnostic: diagnostic.slice(-2000) }),
        })
      }
    } finally {
      this.active = false
    }
  }

  private mutate<T>(packageNames: readonly string[], operation: () => Promise<T>): Promise<T> {
    return this.options.withMutation(operation, packageNames)
  }

  private async update(
    restoreId: string,
    patch: { readonly state: ImportedPluginRestoreState; readonly diagnostic?: string | null },
  ): Promise<void> {
    if (this.plan === undefined) return
    this.plan = {
      ...this.plan,
      entries: this.plan.entries.map((entry): ImportedPluginRestoreEntry => {
        if (entry.restoreId !== restoreId) return entry
        if (patch.diagnostic === null) {
          const { diagnostic: _diagnostic, ...rest } = entry
          return { ...rest, state: patch.state }
        }
        return patch.diagnostic === undefined
          ? { ...entry, state: patch.state }
          : { ...entry, state: patch.state, diagnostic: patch.diagnostic }
      }),
    }
    await writeImportedPluginRestorePlan(this.options.dshHome, this.plan)
  }
}

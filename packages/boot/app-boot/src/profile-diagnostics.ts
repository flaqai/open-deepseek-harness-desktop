/** Structured, redacted diagnostics for profile package and Cordis failures. */

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** Durable schema written for current Profile problems. */
export const PROFILE_DIAGNOSTIC_SCHEMA = 'dsh/profile-diagnostic/v2' as const

/** Subsystem that reported one Profile problem. */
export type ProfileDiagnosticSource = 'pnpm' | 'profile' | 'loader' | 'cordis-runtime' | 'runtime' | 'config' | 'session'

/** Operation phase in which one Profile problem became observable. */
export type ProfileDiagnosticPhase =
  | 'preflight'
  | 'install'
  | 'resolve'
  | 'compose'
  | 'import'
  | 'apply'
  | 'activate'
  | 'runtime'
  | 'repair'

/** User-facing urgency of one Profile problem. */
export type ProfileDiagnosticSeverity = 'info' | 'warning' | 'blocked' | 'security'

/** Guarded operation the product may offer for one Profile problem. */
export type ProfileDiagnosticAction =
  | 'retry'
  | 'repair'
  | 'approve-build'
  | 'isolate'
  | 'restore'
  | 'open-config'
  | 'reset-config'
  | 'export'

/** Stable product category independent of pnpm and Cordis message wording. */
export type ProfileDiagnosticCode =
  | 'pnpm.build-script-blocked'
  | 'pnpm.minimum-release-age'
  | 'pnpm.unexpected-store'
  | 'pnpm.network'
  | 'pnpm.registry-auth'
  | 'pnpm.lockfile'
  | 'pnpm.integrity'
  | 'pnpm.version-resolution'
  | 'pnpm.runtime-version'
  | 'pnpm.peer-dependency'
  | 'pnpm.supply-chain'
  | 'pnpm.invalid-dependency'
  | 'pnpm.config-parse'
  | 'pnpm.patch-failed'
  | 'profile.host-version-incompatible'
  | 'profile.host-dependency-conflict'
  | 'profile.orphaned-bundle'
  | 'profile.bundle-invalid'
  | 'profile.module-resolution'
  | 'profile.immutable-agent-input-mutation'
  | 'profile.session-api-incompatible'
  | 'profile.session-persistence-migration'
  | 'session.persistence-corrupt'
  | 'loader.dependency-unavailable'
  | 'profile.patch-invalid'
  | 'profile.quarantine-removal-residue'
  | 'loader.duplicate-entry'
  | 'loader.duplicate-registration'
  | 'loader.unresolved-injection'
  | 'loader.lifecycle-failed'
  | 'loader.rollback-failed'
  | 'config.credentials-invalid'
  | 'config.settings-invalid'
  | 'runtime.launch-invalid'
  | 'profile.unknown'

/** Client-safe attribution that never carries an absolute local path. */
export interface ProfileDiagnosticAttribution {
  readonly rootPackage?: string
  readonly dependencyChain?: readonly string[]
  readonly entryId?: string
  readonly moduleName?: string
  readonly missingModule?: string
  readonly missingExport?: string
  readonly importerPackage?: string
  readonly hostVersion?: string
  readonly supportedHostVersions?: readonly string[]
  readonly recommendedHostVersion?: string
  readonly configKind?: 'profile-manifest' | 'workspace' | 'lockfile' | 'profile-patch' | 'home-patch' | 'credentials' | 'settings'
}

/** One current Profile problem with bounded, redacted evidence. */
export interface ProfileDiagnostic {
  readonly diagnosticId: string
  readonly code: ProfileDiagnosticCode
  readonly nativeCode?: string
  readonly source: ProfileDiagnosticSource
  readonly phase: ProfileDiagnosticPhase
  readonly severity: ProfileDiagnosticSeverity
  readonly attribution?: ProfileDiagnosticAttribution
  readonly buildApprovalKey?: string
  readonly actions: readonly ProfileDiagnosticAction[]
  readonly evidence: readonly string[]
}

/** Facts about the isolated process that serves recovery tools after normal startup fails. */
export interface ProfileDiagnosticModeState {
  readonly enteredAt: string
  readonly skippedBundles: readonly string[]
  readonly skippedUserLayers: boolean
  readonly skippedUserSettings?: boolean
  readonly skippedUserSessions?: boolean
  readonly skippedUserStorage?: boolean
}

/** Durable collection consumed by diagnostic-mode startup and trusted diagnostics clients. */
export interface ProfileDiagnosticReport {
  readonly schema: typeof PROFILE_DIAGNOSTIC_SCHEMA
  readonly profile: string
  readonly generatedAt: string
  readonly status: 'issues' | 'diagnostic-mode' | 'safe-mode'
  readonly issues: readonly ProfileDiagnostic[]
  readonly diagnosticMode?: ProfileDiagnosticModeState
  /** Legacy v2 field accepted only while reading reports created by older desktop builds. */
  readonly safeMode?: ProfileDiagnosticModeState
}

/** Inputs used to classify a thrown error or subprocess diagnostic. */
export interface ClassifyProfileDiagnosticOptions {
  readonly source: ProfileDiagnosticSource
  readonly phase: ProfileDiagnosticPhase
  readonly value: unknown
  readonly attribution?: ProfileDiagnosticAttribution
  readonly home?: string
}

interface DiagnosticRule {
  readonly code: ProfileDiagnosticCode
  readonly source?: ProfileDiagnosticSource
  readonly severity: ProfileDiagnosticSeverity
  readonly actions: readonly ProfileDiagnosticAction[]
  readonly nativeCodes?: readonly string[]
  readonly pattern?: RegExp
}

/** Stable rule metadata safe to include in support exports. */
export interface ProfileDiagnosticRuleSummary {
  readonly code: ProfileDiagnosticCode
  readonly severity: ProfileDiagnosticSeverity
  readonly actions: readonly ProfileDiagnosticAction[]
  readonly nativeCodes: readonly string[]
}

const MAX_EVIDENCE_BYTES = 8 * 1024
const PROFILE_HEALTH_DIRECTORY = 'profile-health'
const SECRET_VALUE = /\b(api[ _-]?key|token|password|secret|authorization|cookie)(\s*[:=]\s*)([^\s,;]+)/giu
const DEEPSEEK_KEY = /\bsk-[a-z0-9_-]{8,}\b/giu
const WINDOWS_USER_PATH = /[A-Z]:\\Users\\[^\\\r\n]+/giu
const POSIX_USER_PATH = /\/(?:Users|home)\/[^/\r\n]+/gu
const PNPM_CODE = /\bERR_PNPM_[A-Z0-9_]+\b/u
const NODE_CODE = /\b(?:ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EACCES|EPERM|EBUSY|ENOENT|ERR_FS_EISDIR)\b/u
const RETAINED_BUILD_KEY = /^dsh: pnpm allowBuilds key (".*")$/mu
const LOADER_ENTRY = /failed to (?:apply|import) loader entry\s+([^\s(:]+)(?:\s+\(([^)\r\n]+)\))?/giu
const FAILED_MODULE = /plugin\(s\) failed to load:\s*([^,\s]+)/iu

const RULES: readonly DiagnosticRule[] = [
  {
    code: 'pnpm.build-script-blocked', severity: 'security', actions: ['approve-build', 'isolate', 'export'],
    nativeCodes: ['ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED', 'ERR_PNPM_IGNORED_BUILDS'],
    pattern: /build scripts?|prepare script|allowBuilds/iu,
  },
  {
    code: 'pnpm.minimum-release-age', severity: 'security', actions: ['retry', 'export'],
    nativeCodes: ['ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION', 'ERR_PNPM_NO_MATURE_MATCHING_VERSION', 'ERR_PNPM_MISSING_TIME'],
    pattern: /minimum release age|minimumReleaseAge/iu,
  },
  {
    code: 'pnpm.unexpected-store', severity: 'blocked', actions: ['repair', 'export'],
    nativeCodes: ['ERR_PNPM_UNEXPECTED_STORE', 'ERR_PNPM_UNEXPECTED_VIRTUAL_STORE', 'ERR_PNPM_STORE_BREAKING_CHANGE'],
    pattern: /unexpected (?:virtual )?store|store location/iu,
  },
  {
    code: 'pnpm.registry-auth', severity: 'blocked', actions: ['retry', 'export'],
    nativeCodes: ['ERR_PNPM_FETCH_401', 'ERR_PNPM_FETCH_403'], pattern: /\b(?:401|403)\b.*(?:registry|fetch)|unauthorized|forbidden/iu,
  },
  {
    code: 'pnpm.network', severity: 'warning', actions: ['retry', 'export'],
    pattern: /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network|registry mirror/iu,
  },
  {
    code: 'pnpm.lockfile', severity: 'blocked', actions: ['repair', 'export'],
    nativeCodes: [
      'ERR_PNPM_OUTDATED_LOCKFILE', 'ERR_PNPM_LOCKFILE_MISSING_DEPENDENCY',
      'ERR_PNPM_LOCKFILE_BREAKING_CHANGE', 'ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND',
    ], pattern: /lockfile|lock file|importer/iu,
  },
  {
    code: 'pnpm.integrity', severity: 'security', actions: ['retry', 'export'],
    nativeCodes: [
      'ERR_PNPM_TARBALL_INTEGRITY', 'ERR_PNPM_BAD_TARBALL_SIZE',
      'ERR_PNPM_UNEXPECTED_PKG_CONTENT_IN_STORE', 'ERR_PNPM_MODIFIED_DEPENDENCY',
    ], pattern: /integrity|tarball|package content.*store/iu,
  },
  {
    code: 'pnpm.patch-failed', severity: 'blocked', actions: ['open-config', 'export'],
    nativeCodes: ['ERR_PNPM_PATCH_FAILED'], pattern: /patch.*failed/iu,
  },
  {
    code: 'pnpm.runtime-version', severity: 'blocked', actions: ['repair', 'export'],
    nativeCodes: ['ERR_PNPM_INVALID_NODE_VERSION', 'ERR_PNPM_UNSUPPORTED_ENGINE', 'ERR_PNPM_MODULES_BREAKING_CHANGE'],
    pattern: /unsupported engine|node version|modules.*breaking change/iu,
  },
  {
    code: 'pnpm.peer-dependency', severity: 'blocked', actions: ['repair', 'isolate', 'export'],
    nativeCodes: ['ERR_PNPM_PEER_DEP_ISSUES', 'ERR_PNPM_DEDUPE_CHECK_ISSUES'], pattern: /peer dependenc|dedupePeerDependents/iu,
  },
  {
    code: 'pnpm.supply-chain', severity: 'security', actions: ['retry', 'export'],
    nativeCodes: ['ERR_PNPM_TRUST_DOWNGRADE', 'ERR_PNPM_INVALID_CONVERGENCE_OVERRIDE'],
    pattern: /trust downgrade|supply-chain|convergence override|exotic subdep/iu,
  },
  {
    code: 'pnpm.version-resolution', severity: 'blocked', actions: ['retry', 'open-config', 'export'],
    nativeCodes: [
      'ERR_PNPM_NO_MATCHING_VERSION', 'ERR_PNPM_NO_MATCHING_VERSION_INSIDE_WORKSPACE',
      'ERR_PNPM_MISMATCHED_RELEASE_CHANNEL',
    ], pattern: /no matching version|workspace.*version|release channel/iu,
  },
  {
    code: 'pnpm.invalid-dependency', severity: 'blocked', actions: ['open-config', 'export'],
    nativeCodes: ['ERR_PNPM_INVALID_DEPENDENCY_NAME', 'ERR_PNPM_SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER'],
    pattern: /invalid dependency|not supported by any resolver/iu,
  },
  {
    code: 'pnpm.config-parse', severity: 'blocked', actions: ['open-config', 'export'],
    nativeCodes: ['ERR_PNPM_YAML_PARSE', 'ERR_PNPM_JSON_PARSE', 'ERR_PNPM_JSON5_PARSE'],
    pattern: /pnpm-workspace\.yaml|yaml parse|json5? parse/iu,
  },
  {
    code: 'config.credentials-invalid', source: 'config', severity: 'blocked', actions: ['open-config', 'export'],
    pattern: /credentials(?:\.yaml|-local)?.*(?:must be|invalid|parse)|value for ["']version["']/iu,
  },
  {
    code: 'config.settings-invalid', source: 'config', severity: 'blocked',
    actions: ['open-config', 'reset-config', 'export'],
    pattern: /settings-file:\s*(?:invalid document|.*must be a map)|settings\.ya?ml.*(?:DUPLICATE_KEY|YAMLParseError|JSON)/iu,
  },
  {
    code: 'profile.bundle-invalid', source: 'profile', severity: 'blocked', actions: ['isolate', 'open-config', 'export'],
    pattern: /profile bundle.*(?:declares no dsh\.bundle|dsh\.bundle.*invalid)|bundle patch/iu,
  },
  {
    code: 'profile.session-persistence-migration', source: 'profile', severity: 'blocked',
    actions: ['open-config', 'export'],
    pattern: /@deepseek-ai\/dsh-session-persistence-sqlite/iu,
  },
  {
    code: 'session.persistence-corrupt', source: 'session', severity: 'blocked', actions: ['export'],
    pattern: /corrupt (?:Zstandard )?session log|stored session .* failed validation|stored log is corrupt/iu,
  },
  {
    code: 'loader.dependency-unavailable', source: 'loader', severity: 'blocked', actions: ['isolate', 'export'],
    pattern: /loader dependency unavailable|loader module .* imports unavailable dependency/iu,
  },
  {
    code: 'profile.module-resolution', source: 'profile', severity: 'blocked', actions: ['repair', 'isolate', 'export'],
    pattern: new RegExp([
      'cannot resolve profile bundle',
      'plugin\\(s\\) failed to load',
      'could not be resolved',
      'module not found',
      'ERR_MODULE_NOT_FOUND',
      'failed to import loader entry',
      'missed the module table',
      'not a materialized module',
      'no registered package factory',
    ].join('|'), 'iu'),
  },
  {
    code: 'profile.immutable-agent-input-mutation', source: 'cordis-runtime', severity: 'blocked', actions: ['isolate', 'export'],
    pattern: /immutable agent input mutation|Cannot assign to read only property ['"](?:text|content|messages)['"] of object/iu,
  },
  {
    code: 'profile.session-api-incompatible', source: 'profile', severity: 'blocked', actions: ['open-config', 'export'],
    pattern: /(?:session|agent\.session)\.events is not iterable|legacy Session\.events API/iu,
  },
  {
    code: 'profile.patch-invalid', source: 'profile', severity: 'blocked', actions: ['open-config', 'export'],
    pattern: /cordis\.patch\.yml|home patch|patch target|!!js|top-level YAML array|empty patch/iu,
  },
  {
    code: 'profile.quarantine-removal-residue', source: 'profile', severity: 'warning', actions: ['repair', 'export'],
  },
  {
    code: 'loader.duplicate-entry', source: 'loader', severity: 'blocked', actions: ['isolate', 'open-config', 'export'],
    pattern: /duplicate loader entry|duplicate entry id/iu,
  },
  {
    code: 'loader.duplicate-registration', source: 'loader', severity: 'blocked', actions: ['isolate', 'open-config', 'export'],
    pattern: /already registered|config path.*registered|duplicate (?:service|route|prompt|registration)/iu,
  },
  {
    code: 'loader.unresolved-injection', source: 'loader', severity: 'blocked', actions: ['isolate', 'open-config', 'export'],
    pattern: /pending \(waiting for services?|unresolved (?:service|injection)|missing required service/iu,
  },
  {
    code: 'loader.rollback-failed', source: 'loader', severity: 'blocked', actions: ['isolate', 'export'],
    pattern: /rollback failed|failed to (?:remove|move|update) loader entry/iu,
  },
  {
    code: 'loader.lifecycle-failed', source: 'loader', severity: 'blocked', actions: ['retry', 'isolate', 'export'],
    pattern: /failed to apply loader entry|did not activate|plugin tree failed to load|activation failed|fiber state/iu,
  },
  {
    code: 'runtime.launch-invalid', source: 'runtime', severity: 'blocked', actions: ['repair', 'export'],
    pattern: /pnpm not found|DSH_PNPM_BIN|Harness exited before becoming ready|node\.exe|runtime.*unavailable/iu,
  },
]

/**
 * Return the current rule vocabulary without exposing message-matching expressions.
 * @returns Stable rule metadata suitable for a redacted support export.
 */
export function profileDiagnosticRuleCatalog(): readonly ProfileDiagnosticRuleSummary[] {
  const summaries = new Map<ProfileDiagnosticCode, ProfileDiagnosticRuleSummary>()
  for (const rule of RULES) {
    summaries.set(rule.code, {
      code: rule.code,
      severity: rule.severity,
      actions: rule.actions,
      nativeCodes: rule.nativeCodes ?? [],
    })
  }
  summaries.set('profile.unknown', {
    code: 'profile.unknown',
    severity: 'blocked',
    actions: ['export'],
    nativeCodes: [],
  })
  return [...summaries.values()]
}

function sourceForRule(rule: DiagnosticRule, fallback: ProfileDiagnosticSource): ProfileDiagnosticSource {
  if (rule.source !== undefined) return rule.source
  return rule.code.startsWith('pnpm.') ? 'pnpm' : fallback
}

function errorChain(value: unknown): string[] {
  const messages: string[] = []
  const seen = new Set<unknown>()
  let current: unknown = value
  while (!seen.has(current)) {
    seen.add(current)
    if (current instanceof Error) {
      messages.push(current.stack ?? current.message)
      current = current.cause
      if (current === undefined) break
      continue
    }
    if (typeof current === 'string') messages.push(current)
    else if (current !== undefined) {
      try {
        const serialized: unknown = JSON.stringify(current)
        messages.push(typeof serialized === 'string' ? serialized : '<unserializable diagnostic>')
      } catch {
        messages.push('<unserializable diagnostic>')
      }
    }
    break
  }
  return messages
}

function inferredAttribution(
  diagnostic: string,
  supplied: ProfileDiagnosticAttribution | undefined,
): ProfileDiagnosticAttribution | undefined {
  const loader = [...diagnostic.matchAll(LOADER_ENTRY)].at(-1)
  const failedModule = FAILED_MODULE.exec(diagnostic)?.[1]
  const entryId = supplied?.entryId ?? loader?.[1]
  const moduleName = supplied?.moduleName ?? loader?.[2] ?? failedModule
  const boundedEntry = entryId?.slice(0, 256)
  const boundedModule = moduleName?.slice(0, 512)
  if (supplied === undefined && boundedEntry === undefined && boundedModule === undefined) return undefined
  return {
    ...supplied,
    ...(boundedEntry === undefined ? {} : { entryId: boundedEntry }),
    ...(boundedModule === undefined ? {} : { moduleName: boundedModule }),
  }
}

/**
 * Remove credentials and user-home details from one bounded diagnostic.
 * @param value - Untrusted subprocess or exception text.
 * @param home - Optional Harness home replaced with `$DSH_HOME` before generic path redaction.
 * @returns Client-safe evidence with at most 8 KiB.
 */
export function sanitizeProfileDiagnostic(value: string, home?: string): string {
  let sanitized = value
  if (home !== undefined && home !== '') sanitized = sanitized.replaceAll(home, '$DSH_HOME')
  sanitized = sanitized
    .replace(SECRET_VALUE, (_match, label: string, separator: string) => `${label}${separator}[REDACTED]`)
    .replace(DEEPSEEK_KEY, '[REDACTED]')
    .replace(WINDOWS_USER_PATH, '%USERPROFILE%')
    .replace(POSIX_USER_PATH, '$HOME')
  const encoded = Buffer.from(sanitized)
  return encoded.length <= MAX_EVIDENCE_BYTES
    ? sanitized
    : encoded.subarray(encoded.length - MAX_EVIDENCE_BYTES).toString('utf8')
}

/**
 * Classify a thrown error or package-manager diagnostic without trusting its wording as an action.
 * @param options - Failure source, phase, value, and optional client-safe attribution.
 * @returns One stable issue whose evidence is bounded and redacted.
 */
export function classifyProfileDiagnostic(options: ClassifyProfileDiagnosticOptions): ProfileDiagnostic {
  const evidence = errorChain(options.value).map(value => sanitizeProfileDiagnostic(value, options.home))
  const combined = evidence.join('\n')
  const nativeCode = PNPM_CODE.exec(combined)?.[0] ?? NODE_CODE.exec(combined)?.[0]
  const rule = RULES.find(candidate => (
    candidate.nativeCodes?.includes(nativeCode ?? '') === true
      || candidate.pattern?.test(combined) === true
  ))
  const buildApprovalKey = rule?.code === 'pnpm.build-script-blocked'
    ? extractProfileBuildApprovalKey(combined)
    : undefined
  const actions = rule?.code === 'pnpm.build-script-blocked' && buildApprovalKey === undefined
    ? rule.actions.filter(action => action !== 'approve-build')
    : (rule?.actions ?? ['export'])
  const attribution = inferredAttribution(combined, options.attribution)
  return {
    diagnosticId: randomUUID(),
    code: rule?.code ?? 'profile.unknown',
    ...(nativeCode === undefined ? {} : { nativeCode }),
    source: rule === undefined ? options.source : sourceForRule(rule, options.source),
    phase: options.phase,
    severity: rule?.severity ?? 'blocked',
    ...(attribution === undefined ? {} : { attribution }),
    ...(buildApprovalKey === undefined ? {} : { buildApprovalKey }),
    actions,
    evidence,
  }
}

/**
 * Read the exact reviewed build key retained by the package-manager adapter.
 * @param diagnostic - Bounded pnpm diagnostic produced by the product CLI.
 * @returns Exact key, or undefined when the failure cannot support an approval action.
 */
export function extractProfileBuildApprovalKey(diagnostic: string): string | undefined {
  const serialized = RETAINED_BUILD_KEY.exec(diagnostic)?.[1]
  if (serialized === undefined) return undefined
  try {
    const value: unknown = JSON.parse(serialized)
    return typeof value === 'string' && value.length > 0 ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Build one explicit issue for a dependency identity conflict.
 * @param rootPackage - Direct profile package that owns the conflicting edge.
 * @param dependencyChain - Installed dependency path ending at the Host package.
 * @returns Client-safe blocked issue.
 */
export function profileDependencyConflictDiagnostic(
  rootPackage: string,
  dependencyChain: readonly string[],
): ProfileDiagnostic {
  return {
    diagnosticId: randomUUID(),
    code: 'profile.host-dependency-conflict',
    source: 'profile',
    phase: 'preflight',
    severity: 'blocked',
    attribution: { rootPackage, dependencyChain },
    actions: ['repair', 'isolate', 'export'],
    evidence: [],
  }
}

/**
 * Build one explicit issue for a plugin declaration that excludes the running Harness version.
 * @param packageName - Active external plugin package.
 * @param hostVersion - Running Harness package version.
 * @param supportedHostVersions - Exact versions accepted by the plugin declaration.
 * @param recommendedHostVersion - Optional preferred Host version from that declaration.
 * @returns Client-safe blocked issue discovered before plugin code executes.
 */
export function profileHostCompatibilityDiagnostic(
  packageName: string,
  hostVersion: string,
  supportedHostVersions: readonly string[],
  recommendedHostVersion?: string,
): ProfileDiagnostic {
  return {
    diagnosticId: randomUUID(),
    code: 'profile.host-version-incompatible',
    source: 'profile',
    phase: 'preflight',
    severity: 'blocked',
    attribution: {
      rootPackage: packageName,
      hostVersion,
      supportedHostVersions,
      ...(recommendedHostVersion === undefined ? {} : { recommendedHostVersion }),
    },
    actions: ['isolate', 'export'],
    evidence: [],
  }
}

/**
 * Build one explicit issue for a configured bundle with no manageable dependency.
 * @param packageName - Bundle package retained by the Profile manifest.
 * @returns Client-safe blocked issue.
 */
export function orphanedBundleDiagnostic(packageName: string): ProfileDiagnostic {
  return {
    diagnosticId: randomUUID(),
    code: 'profile.orphaned-bundle',
    source: 'profile',
    phase: 'preflight',
    severity: 'blocked',
    attribution: { rootPackage: packageName },
    actions: ['repair', 'isolate', 'export'],
    evidence: [],
  }
}

/**
 * Build one repairable issue for derived state left after a quarantined plugin was removed.
 * @param packageName - Inactive plugin named by the stale quarantine report.
 * @param evidence - Bounded state components that still reference the plugin.
 * @returns Client-safe warning whose only mutation is the guarded Profile repair.
 */
export function quarantineRemovalResidueDiagnostic(
  packageName: string,
  evidence: readonly string[],
): ProfileDiagnostic {
  return {
    diagnosticId: randomUUID(),
    code: 'profile.quarantine-removal-residue',
    source: 'profile',
    phase: 'preflight',
    severity: 'warning',
    attribution: { rootPackage: packageName },
    actions: ['repair', 'export'],
    evidence,
  }
}

/**
 * Build one current issue for a plugin retained outside the active Profile.
 * @param packageName - Quarantined root plugin.
 * @param reason - Core quarantine decision.
 * @param hostCompatibility - Optional package-declared Host compatibility retained by preflight.
 * @returns Client-safe issue with actions appropriate to the retained state.
 */
export function quarantinedPluginDiagnostic(
  packageName: string,
  reason: 'incompatible-host-version' | 'incompatible-host-dependency' | 'convergence-failed' | 'orphaned-bundle' | 'build-script-blocked' | 'client-module-unavailable' | 'loader-module-unresolvable' | 'loader-dependency-unavailable' | 'loader-entry-collision' | 'loader-lifecycle-failed',
  hostCompatibility?: {
    readonly hostVersion: string
    readonly supportedHostVersions: readonly string[]
    readonly recommendedHostVersion?: string
  },
): ProfileDiagnostic {
  const code = reason === 'incompatible-host-version'
    ? 'profile.host-version-incompatible'
    : reason === 'orphaned-bundle'
      ? 'profile.orphaned-bundle'
      : reason === 'build-script-blocked'
        ? 'pnpm.build-script-blocked'
        : reason === 'loader-dependency-unavailable'
          ? 'loader.dependency-unavailable'
          : reason === 'loader-entry-collision'
            ? 'loader.duplicate-entry'
            : reason === 'loader-lifecycle-failed'
              ? 'loader.lifecycle-failed'
              : reason === 'client-module-unavailable' || reason === 'loader-module-unresolvable'
                ? 'profile.module-resolution'
                : 'profile.host-dependency-conflict'
  return {
    diagnosticId: randomUUID(),
    code,
    source: reason === 'build-script-blocked'
      ? 'pnpm'
      : reason === 'loader-entry-collision'
        ? 'loader'
        : 'profile',
    phase: 'repair',
    severity: reason === 'build-script-blocked' ? 'security' : 'blocked',
    attribution: {
      rootPackage: packageName,
      ...(hostCompatibility === undefined
        ? {}
        : {
          hostVersion: hostCompatibility.hostVersion,
          supportedHostVersions: hostCompatibility.supportedHostVersions,
          ...(hostCompatibility.recommendedHostVersion === undefined
            ? {}
            : { recommendedHostVersion: hostCompatibility.recommendedHostVersion }),
        }),
    },
    actions: reason === 'build-script-blocked'
      ? ['approve-build', 'restore', 'export']
      : ['restore', 'export'],
    evidence: [],
  }
}

/**
 * Build one attributable diagnostic for an external Bundle that reuses an
 * installation-owned Loader entry id.
 * @param packageName - Direct external Bundle package.
 * @param entryId - Colliding Loader entry id.
 * @param moduleName - External module inserted at that id.
 * @param installationPackage - Shipped Bundle that already owns the id.
 * @param installationModuleName - Shipped module inserted at that id.
 * @returns A blocked issue safe for automatic external-plugin quarantine.
 */
export function profileLoaderEntryCollisionDiagnostic(
  packageName: string,
  entryId: string,
  moduleName: string,
  installationPackage: string,
  installationModuleName: string,
): ProfileDiagnostic {
  return {
    diagnosticId: randomUUID(),
    code: 'loader.duplicate-entry',
    source: 'loader',
    phase: 'apply',
    severity: 'blocked',
    attribution: {
      rootPackage: packageName,
      entryId,
      moduleName,
      configKind: 'profile-patch',
    },
    actions: ['repair', 'isolate', 'open-config', 'export'],
    evidence: [
      `External Bundle ${packageName} inserts Loader entry ${entryId} (${moduleName}), already owned by installation Bundle ${installationPackage} (${installationModuleName})`,
    ],
  }
}

function profileDiagnosticReportPath(home: string, profile: string): string {
  return join(home, PROFILE_HEALTH_DIRECTORY, `${profile}.diagnostics.json`)
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(temporary, content, { flag: 'wx', mode: 0o600 })
  renameSync(temporary, path)
}

/**
 * Construct one versioned report for current issues or diagnostic-mode availability.
 * @param profile - Profile whose startup or package operation failed.
 * @param issues - Current client-safe issues.
 * @param options - Optional diagnostic-mode facts and deterministic test clock.
 * @returns Complete durable report.
 */
export function createProfileDiagnosticReport(
  profile: string,
  issues: readonly ProfileDiagnostic[],
  options: {
    readonly now?: () => Date
    readonly diagnosticMode?: ProfileDiagnosticModeState
  } = {},
): ProfileDiagnosticReport {
  return {
    schema: PROFILE_DIAGNOSTIC_SCHEMA,
    profile,
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    status: options.diagnosticMode === undefined ? 'issues' : 'diagnostic-mode',
    issues,
    ...(options.diagnosticMode === undefined ? {} : { diagnosticMode: options.diagnosticMode }),
  }
}

/**
 * Persist the current Profile issues with an owner-only temporary file and atomic rename.
 * @param report - Complete versioned diagnostic report.
 * @param home - Harness home; defaults to {@link resolveDshHome}.
 */
export function writeProfileDiagnosticReport(
  report: ProfileDiagnosticReport,
  home: string = resolveDshHome(),
): void {
  atomicWrite(profileDiagnosticReportPath(home, report.profile), `${JSON.stringify(report, undefined, 2)}\n`)
}

/**
 * Read current Profile issues without accepting an unsupported on-disk schema.
 * @param profile - Profile whose report should be read.
 * @param home - Harness home; defaults to {@link resolveDshHome}.
 * @returns Current report, or undefined when no issue is retained.
 */
export function readProfileDiagnosticReport(
  profile: string,
  home: string = resolveDshHome(),
): ProfileDiagnosticReport | undefined {
  const path = profileDiagnosticReportPath(home, profile)
  if (!existsSync(path)) return undefined
  const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<ProfileDiagnosticReport>
  if (value.schema !== PROFILE_DIAGNOSTIC_SCHEMA || value.profile !== profile || !Array.isArray(value.issues)) {
    throw new Error(`dsh: unsupported profile diagnostic report ${path}`)
  }
  return value as ProfileDiagnosticReport
}

/**
 * Remove resolved current issues while retaining repair and quarantine history.
 * @param profile - Profile whose current issue report should be removed.
 * @param home - Harness home; defaults to {@link resolveDshHome}.
 * @returns True when a current issue report existed.
 */
export function clearProfileDiagnosticReport(
  profile: string,
  home: string = resolveDshHome(),
): boolean {
  const path = profileDiagnosticReportPath(home, profile)
  if (!existsSync(path)) return false
  unlinkSync(path)
  return true
}

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ProfileDiagnostic, ProfileDiagnosticRuleSummary } from '@deepseek-ai/dsh-app-boot'

/** Stable Loader-tree identity of one configured plugin entry. */
export type PluginEntryId = Branded<'PluginEntryId'>

/** Lifecycle state of an entry's root Fiber, or null when it has no live root Fiber. */
export type PluginFiberPhase =
  | 'pending'
  | 'loading'
  | 'active'
  | 'failed'
  | 'unloading'
  | null

/** One non-group Loader entry exposed to trusted clients. */
export interface PluginInventoryEntry {
  readonly entryId: PluginEntryId
  /** Exact module specifier imported by the Loader entry. */
  readonly moduleName: string
  /** Effective Loader enablement, including disabled ancestor groups. */
  readonly enabled: boolean
  readonly fiberPhase: PluginFiberPhase
}

/** Effective enablement of one preset composition row. */
export type PresetPluginEnablement = boolean | 'conditional'

/** One plugin row an agent preset's composition names. */
export interface AgentPresetPluginRow {
  /** Composition row id, or null when the row declares none. */
  readonly entryId: string | null
  /** Module specifier the row names. */
  readonly moduleName: string
  /**
   * Effective enablement, including disabled ancestor groups. `'conditional'`
   * marks a `!!js` disabled expression on a composition no session has
   * mounted, which only a Loader context can decide.
   */
  readonly enabled: PresetPluginEnablement
  /** The row's own `!!js` disabled expression, when it carries one. */
  readonly condition?: string
  /** Root-fiber phase when the composition is live; null otherwise. */
  readonly fiberPhase: PluginFiberPhase
}

/** One agent preset's identity and flattened composition in the inventory. */
export interface AgentPresetPluginGroup {
  /** Stable preset id. */
  readonly id: string
  /** Whether the deployment ships the preset or the user owns it. */
  readonly trust: 'system' | 'user'
  /** Display name the preset published; a reader falls back to the id. */
  readonly name?: string
  /** Whether a session naming no preset composes this one. */
  readonly isDefault: boolean
  /** Why this preset's composition cannot be read; absent when rows answer. */
  readonly broken?: string
  /** Plugin rows in composition order; empty when the preset is broken. */
  readonly rows: readonly AgentPresetPluginRow[]
}

/** Point-in-time inventory returned by the plugin inventory Remote. */
export interface PluginInventorySnapshot {
  readonly entries: readonly PluginInventoryEntry[]
  /** Per-preset compositions when an agent-preset roster is available. */
  readonly agentPresets?: readonly AgentPresetPluginGroup[]
  readonly dependencyHealth: PluginDependencyHealthSnapshot
}

/** Client-safe shared Host dependency conflict projection. */
export interface PluginDependencyConflict {
  readonly rootPackage: string
  readonly dependencyChain: readonly string[]
  readonly dependency: string
  readonly declaredRange: string
  readonly declaredIn: 'dependencies' | 'optionalDependencies'
  readonly hostVersion: string
  readonly compatible: boolean
}

/** Client-safe projection of one explicit plugin-to-Harness compatibility mismatch. */
export interface PluginHostCompatibilityIssue {
  readonly hostVersion: string
  readonly supportedHostVersions: readonly string[]
  readonly recommendedHostVersion?: string
  readonly previewTag?: string
}

/** Client-safe retained repair result. */
export interface PluginDependencyRepairNotice {
  readonly status: 'repaired' | 'quarantined' | 'failed'
  readonly conflicts: readonly PluginDependencyConflict[]
  readonly diagnostic?: string
  readonly issues: readonly ProfileDiagnostic[]
}

/** Client-safe durable quarantine record. */
export interface PluginQuarantineRecord {
  readonly quarantineId: string
  readonly profile: string
  readonly packageName: string
  readonly packageSpec: string
  readonly installedVersion?: string
  readonly quarantinedAt: string
  readonly reason: 'incompatible-host-version' | 'incompatible-host-dependency' | 'convergence-failed' | 'orphaned-bundle' | 'build-script-blocked' | 'client-module-unavailable' | 'loader-module-unresolvable' | 'loader-dependency-unavailable' | 'loader-entry-collision' | 'loader-lifecycle-failed'
  readonly hostCompatibility?: PluginHostCompatibilityIssue
  readonly buildApprovalKey?: string
  readonly conflicts: readonly PluginDependencyConflict[]
}

/** Dependency-health state shown by trusted clients. */
export interface PluginDependencyHealthSnapshot {
  readonly lastRepair: PluginDependencyRepairNotice | null
  readonly quarantined: readonly PluginQuarantineRecord[]
  readonly issues: readonly ProfileDiagnostic[]
  readonly diagnosticMode: {
    readonly enteredAt: string
    readonly skippedBundles: readonly string[]
    readonly skippedUserLayers: boolean
    readonly skippedUserSettings?: boolean
    readonly skippedUserSessions?: boolean
    readonly skippedUserStorage?: boolean
  } | null
}

/** One Loader bundle that remains configured without a manageable profile dependency. */
export interface PluginOrphanedBundle {
  readonly profile: string
  readonly packageName: string
  readonly bundleIndex: number
  readonly installedVersion?: string
}

/** Client-safe result returned by the core profile dependency doctor. */
export interface PluginDependencyDoctorReport {
  readonly schema: 'dsh/profile-dependency-repair/v1'
  readonly diagnosticSchema: 'dsh/profile-diagnostic/v2'
  readonly profile: string
  readonly status: 'healthy' | 'repaired' | 'quarantined' | 'failed'
  readonly conflicts: readonly PluginDependencyConflict[]
  readonly orphanedBundles: readonly PluginOrphanedBundle[]
  readonly quarantined: readonly PluginQuarantineRecord[]
  readonly issues: readonly ProfileDiagnostic[]
  readonly diagnostic?: string
}

/** Stable identity of one background dependency-doctor operation. */
export type PluginDoctorId = Branded<'PluginDoctorId'>

/** Requested profile check mode. */
export interface PluginDoctorRequest {
  readonly profile: string
  readonly repair: boolean
}

/** Observable lifecycle of one current-profile dependency check. */
export interface PluginDoctorSnapshot {
  readonly doctorId: PluginDoctorId
  readonly profile: string
  readonly command: string
  readonly phase: 'running' | 'healthy' | 'issues' | 'repaired' | 'quarantined' | 'failed'
  readonly report?: PluginDependencyDoctorReport
  readonly exitCode?: number | null
  readonly diagnostic?: string
}

/** Opaque durable quarantine selection. */
export interface PluginQuarantineRequest {
  readonly quarantineId: string
}

/** Explicit approval of the exact build key retained by one quarantine. */
export interface PluginBuildApprovalRequest {
  readonly quarantineId: string
}

/** Explicit approval of a build key retained by a failed package operation. */
export interface PluginDiagnosticBuildApprovalRequest {
  readonly diagnosticId: string
}

/** Browser-boot failure that can be recovered only by deactivating its owning Profile bundle. */
export interface PluginClientLoadFailureRequest {
  /** Direct active Profile bundle named by the failed client Loader entry. */
  readonly packageName: string
  /** Opaque client Loader entry id retained only for diagnostic attribution. */
  readonly entryId: string
  /** Exact module request that the client module table could not satisfy. */
  readonly requestedModule: string
  /** Closed failure vocabulary; arbitrary browser errors cannot request quarantine. */
  readonly code: 'client-module-unavailable'
}

/** Result of one guarded browser-boot recovery transaction. */
export interface PluginClientLoadRecoveryResult {
  readonly packageName: string
  readonly status: 'quarantined' | 'failed'
  /** True when the Host accepted a bounded restart request after persisting quarantine. */
  readonly restartScheduled: boolean
}

/** Redacted, portable diagnostics export assembled by the trusted Host. */
export interface PluginDiagnosticExport {
  readonly schema: 'dsh/profile-diagnostic-export/v1'
  readonly diagnosticSchema: 'dsh/profile-diagnostic/v2'
  readonly rulesVersion: 2
  readonly rules: readonly ProfileDiagnosticRuleSummary[]
  readonly generatedAt: string
  readonly runtime: {
    readonly platform: string
    readonly architecture: string
    readonly node: string
  }
  readonly profile: string
  readonly diagnosticMode: PluginDependencyHealthSnapshot['diagnosticMode']
  readonly issues: readonly ProfileDiagnostic[]
  readonly quarantined: readonly PluginQuarantineRecord[]
  readonly entries: readonly PluginInventoryEntry[]
}

/** Profile whose retained repair notification should be dismissed. */
export interface PluginRepairNoticeRequest {
  readonly profile: string
}

/** Stable identity of one background profile-plugin installation. */
export type PluginInstallId = Branded<'PluginInstallId'>

/** Registry package request accepted by the profile plugin installer. */
export interface PluginInstallRequest {
  /** Profile that will receive the dependency and bundle layer. */
  readonly profile: string
  /** npm registry package specifier, optionally with a version or dist-tag. */
  readonly packageSpec: string
}

/** Exact registry package removal accepted by the profile plugin manager. */
export interface PluginUninstallRequest {
  /** Profile from which the dependency and bundle layer will be removed. */
  readonly profile: string
  /** Exact installed npm package name. Versions, paths, and URLs are rejected. */
  readonly packageName: string
}

/** Observable lifecycle of one package-manager process. */
export type PluginInstallPhase = 'running' | 'succeeded' | 'repaired' | 'quarantined' | 'failed'

/** Point-in-time state returned when starting or polling an installation. */
export interface PluginInstallSnapshot {
  readonly installId: PluginInstallId
  readonly profile: string
  readonly packageSpec: string
  /** Exact CLI command represented by the structured request. */
  readonly command: string
  readonly phase: PluginInstallPhase
  /** Exit code when the package-manager process settled normally. */
  readonly exitCode?: number | null
  /** Bounded package-manager output for local troubleshooting after failure. */
  readonly diagnostic?: string
}

/** Official native coding products exposed by the external-tools surface. */
export type ExternalToolId = 'codex' | 'claude-code'

/** Host connection state projected beside Profile Bundle installation state. */
export interface ExternalToolsSnapshot {
  readonly scope: 'complete-presets'
  readonly codex: boolean
  readonly claudeCode: boolean
}

/** Fixed-provider toggle accepted by the guarded managed-preset operation. */
export interface ExternalToolToggleRequest {
  readonly tool: ExternalToolId
  readonly enabled: boolean
}

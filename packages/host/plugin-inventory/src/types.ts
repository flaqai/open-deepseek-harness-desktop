import type { Branded } from '@deepseek-ai/dsh-brand'

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

/** Point-in-time inventory returned by the plugin inventory Remote. */
export interface PluginInventorySnapshot {
  readonly entries: readonly PluginInventoryEntry[]
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

/** Client-safe retained repair result. */
export interface PluginDependencyRepairNotice {
  readonly status: 'repaired' | 'quarantined' | 'failed'
  readonly conflicts: readonly PluginDependencyConflict[]
  readonly diagnostic?: string
}

/** Client-safe durable quarantine record. */
export interface PluginQuarantineRecord {
  readonly quarantineId: string
  readonly profile: string
  readonly packageName: string
  readonly packageSpec: string
  readonly installedVersion?: string
  readonly quarantinedAt: string
  readonly reason: 'incompatible-host-dependency' | 'convergence-failed' | 'orphaned-bundle'
  readonly conflicts: readonly PluginDependencyConflict[]
}

/** Dependency-health state shown by trusted clients. */
export interface PluginDependencyHealthSnapshot {
  readonly lastRepair: PluginDependencyRepairNotice | null
  readonly quarantined: readonly PluginQuarantineRecord[]
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
  readonly profile: string
  readonly status: 'healthy' | 'repaired' | 'quarantined' | 'failed'
  readonly conflicts: readonly PluginDependencyConflict[]
  readonly orphanedBundles: readonly PluginOrphanedBundle[]
  readonly quarantined: readonly PluginQuarantineRecord[]
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

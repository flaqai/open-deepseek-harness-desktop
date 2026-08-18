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
export type PluginInstallPhase = 'running' | 'succeeded' | 'failed'

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

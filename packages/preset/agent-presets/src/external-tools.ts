/** Per-agent projection of Host-connected coding products. */

/** External product providers currently supplied by official Profile Bundles. */
export type ExternalToolId = 'codex' | 'claude-code'

/** Settings persisted independently from any Session's Agent Preset. */
export interface ExternalToolSettings {
  /** Whether complete Agent Presets receive the Codex delegation tool. */
  codex?: boolean
  /** Whether complete Agent Presets receive the Claude Code delegation tool. */
  claudeCode?: boolean
}

/** Effective Host connection state returned to desktop clients. */
export interface ExternalToolsState {
  readonly scope: 'complete-presets'
  readonly codex: boolean
  readonly claudeCode: boolean
}

/** Official complete presets that accept the Host external-tool projection. */
export const EXTERNAL_TOOL_PRESETS: ReadonlySet<string> = new Set([
  'standard',
  'code',
  'cordis',
  // Compatibility with the desktop-managed preset used before connections
  // became a Host projection. A deployment that still carries the preset can
  // resume it; deployments that removed it fall back to `standard` in
  // AgentPresets.resolve().
  'external-tools',
])

/**
 * Whether a preset participates in the desktop external-tool projection.
 * @param presetId - live preset joined by the Agent.
 * @returns whether that shipped preset is a complete coding mode.
 */
export function acceptsExternalTools(presetId: string | undefined): boolean {
  return presetId !== undefined && EXTERNAL_TOOL_PRESETS.has(presetId)
}

/**
 * Resolve one product's effective setting.
 * @param settings - current user settings layer.
 * @param tool - product whose connection is read.
 * @returns whether the product is connected.
 */
export function externalToolEnabled(settings: ExternalToolSettings | undefined, tool: ExternalToolId): boolean {
  return tool === 'codex' ? settings?.codex === true : settings?.claudeCode === true
}

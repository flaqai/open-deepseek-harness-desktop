/** Retire the third-party settings entry only while the built-in MCP settings owner is active. */
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { composeEntries } from '@deepseek-ai/dsh-app-boot'

/**
 * Disable only legacy MCP panel rows, retaining their package and saved server configuration.
 * Conditional disabled expressions are not evaluated here; an uncertain built-in activation
 * leaves the legacy panel unchanged. Recompute from the source layers on startup and HMR.
 * @param patches Effective Profile patches after user overrides.
 * @returns Original patches, or detached appended overrides for the replaced panel rows.
 */
export function withBuiltinMcpSettings(patches: PatchOptions[]): PatchOptions[] {
  const rows = composeEntries([patches])
  const active = rows.some(row => row.name === '@deepseek-ai/dsh-mcp-settings'
    && (row.disabled === undefined || row.disabled === false || row.disabled === null))
  if (!active) return patches
  const overrides: PatchOptions[] = rows.flatMap(row =>
    row.name === '@dsh-plugins/mcp-panel' && typeof row.id === 'string' && row.disabled !== true
      ? [{ id: row.id, disabled: true }] : [])
  return overrides.length === 0 ? patches : [...patches, ...overrides]
}

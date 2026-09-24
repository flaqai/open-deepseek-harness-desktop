/** Desktop-owned compatibility resolution for official external-tool connectors. */

import type { ExperimentalCapabilityRecipe, PluginInstallRequest } from '@deepseek-ai/dsh-host-plugin-inventory/types'

/** Official external-tool connectors the reviewed Desktop manifest may install. */
export type OfficialExternalToolId = 'codex' | 'claude-code'

/** Experimental providers installed directly into the Web Profile. */
export type ExperimentalCapabilityInstallId =
  | 'browser-use-playwright'
  | 'browser-use-devtools'
  | 'browser-use-stagehand'
  | 'computer-use-native'
  | 'computer-use-mcp'

/** Closed external-tool set exposed by the settings page. */
export type InstallableExternalToolId =
  | OfficialExternalToolId
  | ExperimentalCapabilityInstallId
  | 'workbuddy'
  | 'auto-review'

interface DesktopExternalToolsBridge {
  resolve(toolId: OfficialExternalToolId): Promise<{
    readonly toolId: OfficialExternalToolId
    readonly packageSpec: string
  }>
}

/** Exact non-desktop fallback checked against the desktop source manifest by the release gate. */
export const BROWSER_FALLBACK_EXTERNAL_TOOL_SPECS: Readonly<Record<OfficialExternalToolId, string>> = {
  codex: '@deepseek-ai/dsh-subagent-codex@0.1.7-rc.1',
  'claude-code': '@deepseek-ai/dsh-subagent-claude-code@0.1.7-rc.1',
}

/** Reviewed direct-install packages. Exact versions remain network-installed, never bundled. */
export const DIRECT_EXTERNAL_TOOL_SPECS = {
  workbuddy: 'dsh-workbuddy-connect@0.5.0',
  'auto-review': '@deepseek-ai/dsh-experimental-auto-review@0.1.7-rc.1',
  'browser-use-playwright': '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp@0.1.7-rc.1',
  'browser-use-devtools': '@deepseek-ai/dsh-experimental-browser-use-chrome-devtools-mcp@0.1.7-rc.1',
  'browser-use-stagehand': '@deepseek-ai/dsh-experimental-browser-use-stagehand-native@0.1.7-rc.1',
  'computer-use-native': '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native@0.1.7-rc.1',
  'computer-use-mcp': '@deepseek-ai/dsh-experimental-computer-use-cua-driver-mcp@0.1.7-rc.1',
} as const satisfies Readonly<Record<Exclude<InstallableExternalToolId, OfficialExternalToolId>, string>>

function readDesktopExternalToolsBridge(): DesktopExternalToolsBridge | undefined {
  const desktop = (globalThis as typeof globalThis & { deepSeekHarnessDesktop?: unknown }).deepSeekHarnessDesktop
  if (desktop === null || typeof desktop !== 'object') return undefined
  const externalTools = (desktop as { externalTools?: unknown }).externalTools
  if (externalTools === null || typeof externalTools !== 'object') return undefined
  const candidate = externalTools as Partial<DesktopExternalToolsBridge>
  return typeof candidate.resolve === 'function' ? candidate as DesktopExternalToolsBridge : undefined
}

/**
 * Resolve a closed tool id; desktop clients never submit package coordinates to main.
 * @param toolId - Reviewed connector identity selected by the renderer.
 * @param experimentalCapability - Optional Host-owned recipe paired with an experimental provider.
 * @returns Fixed Web Profile install request from Desktop authority or the embedded fallback.
 */
export async function resolveExternalToolInstallRequest(
  toolId: InstallableExternalToolId,
  experimentalCapability?: ExperimentalCapabilityRecipe,
): Promise<PluginInstallRequest> {
  if (toolId !== 'codex' && toolId !== 'claude-code') {
    return {
      profile: 'web',
      packageSpec: DIRECT_EXTERNAL_TOOL_SPECS[toolId],
      ...(experimentalCapability === undefined ? {} : { experimentalCapability }),
    }
  }
  const resolution = await readDesktopExternalToolsBridge()?.resolve(toolId)
  return {
    profile: 'web',
    packageSpec: resolution?.packageSpec ?? BROWSER_FALLBACK_EXTERNAL_TOOL_SPECS[toolId],
  }
}

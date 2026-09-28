/** Conservative status projected to the floating-ball Settings page. */

import type { OrbComputerBackend } from './orb-settings.ts'
import type { RecoveryPluginSummary } from './recovery-plugins.ts'

/** A backend is selectable only when its runtime is installed and healthy. */
export type OrbBackendAvailability = 'ready' | 'not-installed' | 'unsupported' | 'unknown'

/** System grants that can be observed without requesting a new permission. */
export type OrbPermissionStatus = 'granted' | 'denied' | 'unknown'

/** Facts the UI may state without inferring unverified platform support. */
export interface OrbRuntimeStatus {
  readonly mode: 'local' | 'nas'
  readonly backendAvailability: Readonly<Record<OrbComputerBackend, OrbBackendAvailability>>
  readonly permission: {
    readonly screen: OrbPermissionStatus
    readonly accessibility: OrbPermissionStatus
  }
  readonly activeTasks: number
  readonly taskInspection: 'known' | 'unknown'
  readonly pendingRestart: boolean
  readonly selectionAvailable: boolean
  readonly backgroundAvailable: boolean
  readonly observationActive: boolean
}

/** Direct plugin package names, never accepted from the renderer. */
export const ORB_OFFICIAL_PACKAGES = Object.freeze({
  'official-native': '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native',
  'official-mcp': '@deepseek-ai/dsh-experimental-computer-use-cua-driver-mcp',
})

/** Inputs observed by the Desktop host, with unknown represented explicitly. */
export interface OrbRuntimeFacts {
  readonly mode: 'local' | 'nas'
  readonly authorBackendAvailable: boolean
  readonly plugins: readonly RecoveryPluginSummary[]
  readonly inventoryKnown: boolean
  readonly screen: OrbPermissionStatus
  readonly accessibility: OrbPermissionStatus
  readonly activeTasks: boolean | 'unknown'
  readonly pendingRestart: boolean
  readonly selectionEnabled: boolean
  readonly selectionShortcutReady: boolean
  readonly observationActive: boolean
}

/** Project live host facts without claiming unsupported native platforms are ready.
 * @param facts - Live installation, task, permission, and local-mode facts.
 * @returns A redacted UI status.
 */
export function orbRuntimeStatus(facts: OrbRuntimeFacts): OrbRuntimeStatus {
  const installed = (backend: keyof typeof ORB_OFFICIAL_PACKAGES): OrbBackendAvailability => (
    facts.mode === 'nas' ? 'unsupported' : !facts.inventoryKnown ? 'unknown' : facts.plugins.some(plugin => plugin.packageName === ORB_OFFICIAL_PACKAGES[backend]
      && plugin.version !== undefined && plugin.status === 'normal') ? 'ready' : 'not-installed'
  )
  return {
    mode: facts.mode,
    backendAvailability: {
      orb: facts.mode === 'local' && facts.authorBackendAvailable ? 'ready' : 'unsupported',
      'official-native': installed('official-native'),
      'official-mcp': installed('official-mcp'),
    },
    permission: { screen: facts.screen, accessibility: facts.accessibility },
    activeTasks: facts.activeTasks === true ? 1 : 0,
    taskInspection: facts.activeTasks === 'unknown' ? 'unknown' : 'known',
    pendingRestart: facts.pendingRestart,
    selectionAvailable: facts.mode === 'local' && facts.selectionEnabled && facts.selectionShortcutReady
      && facts.activeTasks === false,
    backgroundAvailable: false,
    observationActive: facts.mode === 'local' && facts.observationActive,
  }
}

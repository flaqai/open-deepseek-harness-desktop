/** Renderer-only adapter for the Desktop floating-ball IPC projection. */

/** Persisted settings projected from the trusted Desktop host. */
export interface OrbSettings {
  readonly visible: boolean
  readonly showAtStartup: boolean
  readonly selectionToolbar: boolean
  readonly backend: 'orb' | 'official-native' | 'official-mcp'
  readonly avatar: 'deepseek' | 'minimal'
  readonly anchor: 'left' | 'right'
}

/** UI-safe settings patch. */
export type OrbSettingsPatch = Partial<OrbSettings>

/** Host-observed availability; this snapshot never grants a local capability. */
export interface OrbRuntimeStatus {
  readonly mode: 'local' | 'nas'
  readonly backendAvailability: Readonly<Record<OrbSettings['backend'], 'ready' | 'not-installed' | 'unsupported' | 'unknown'>>
  readonly permission: Readonly<Record<'screen' | 'accessibility', 'granted' | 'denied' | 'unknown'>>
  readonly activeTasks: number
  readonly taskInspection?: 'known' | 'unknown'
  readonly pendingRestart: boolean
  readonly selectionAvailable: boolean
  readonly backgroundAvailable: boolean
  readonly observationActive?: boolean
}

/** State published by the plugin's single observable source. */
export type OrbSettingsView =
  | { readonly phase: 'unavailable' }
  | { readonly phase: 'loading' }
  | { readonly phase: 'error' }
  | { readonly phase: 'ready'; readonly settings: OrbSettings; readonly status?: OrbRuntimeStatus | undefined; readonly busy?: boolean; readonly error?: string | undefined }

/** Allowlisted Desktop bridge methods. */
export interface OrbDesktopBridge {
  get(): Promise<OrbSettings>
  update(patch: OrbSettingsPatch): Promise<OrbSettings>
  onChanged(callback: (settings: OrbSettings) => void): () => void
  getStatus?(): Promise<OrbRuntimeStatus>
  selectBackend?(backend: OrbSettings['backend']): Promise<OrbSettings>
}

/** Read the optional local bridge; remote NAS clients cannot invoke it.
 * @returns Desktop bridge, or undefined for Web and NAS.
 */
export function readOrbDesktopBridge(): OrbDesktopBridge | undefined {
  const desktop = (globalThis as typeof globalThis & { deepSeekHarnessDesktop?: unknown }).deepSeekHarnessDesktop
  if (typeof desktop !== 'object' || desktop === null || !('orb' in desktop)) return undefined
  const bridge = desktop.orb
  return typeof bridge === 'object' && bridge !== null && 'get' in bridge && 'update' in bridge && 'onChanged' in bridge
    && typeof bridge.get === 'function' && typeof bridge.update === 'function' && typeof bridge.onChanged === 'function'
    ? bridge as OrbDesktopBridge : undefined
}

/** Read the existing quick-restart action without adding a second orb-specific IPC route.
 * @returns Local Desktop restart method, or undefined outside its renderer.
 */
export function readOrbQuickRestart(): (() => Promise<{ restarting: true }>) | undefined {
  const desktop = (globalThis as typeof globalThis & { deepSeekHarnessDesktop?: unknown }).deepSeekHarnessDesktop
  if (typeof desktop !== 'object' || desktop === null || !('shell' in desktop)) return undefined
  const shell = desktop.shell
  if (typeof shell !== 'object' || shell === null || !('restart' in shell)) return undefined
  const action = shell.restart
  return typeof action === 'function' ? () => action.call(shell) as Promise<{ restarting: true }> : undefined
}

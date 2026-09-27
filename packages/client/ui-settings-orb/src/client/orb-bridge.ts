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

/** State published by the plugin's single observable source. */
export type OrbSettingsView =
  | { readonly phase: 'unavailable' }
  | { readonly phase: 'loading' }
  | { readonly phase: 'error' }
  | { readonly phase: 'ready'; readonly settings: OrbSettings; readonly error?: string }

/** Allowlisted Desktop bridge methods. */
export interface OrbDesktopBridge {
  get(): Promise<OrbSettings>
  update(patch: OrbSettingsPatch): Promise<OrbSettings>
  onChanged(callback: (settings: OrbSettings) => void): () => void
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

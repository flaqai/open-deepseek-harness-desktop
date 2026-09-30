/** Desktop color-scheme resolution before and around the hosted Web client. */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseDocument } from 'yaml'

/** Theme source understood by Electron and the desktop preload. */
export type DesktopThemeSource = 'system' | 'light' | 'dark'

const darkPreferences = new Set([
  'dark', 'ocean', 'moonlight', 'starlight', 'pirate', 'shinobi', 'rift',
])
const lightPreferences = new Set(['light', 'bubble', 'inspiration-collage'])

/**
 * Validate a value crossing the renderer-to-main theme IPC channel.
 * @param value - Candidate theme source.
 * @returns Whether the value is one of Electron's supported theme sources.
 */
export function isDesktopThemeSource(value: unknown): value is DesktopThemeSource {
  return value === 'system' || value === 'light' || value === 'dark'
}

/**
 * Resolve one persisted built-in theme preference to Electron's color source.
 * @param preference - Value read from the Host settings document.
 * @returns System following, or the light/dark base palette used by the theme.
 */
export function resolveDesktopThemeSource(preference: unknown): DesktopThemeSource {
  if (preference === 'system') return 'system'
  if (darkPreferences.has(String(preference))) return 'dark'
  if (lightPreferences.has(String(preference))) return 'light'
  return 'system'
}

/**
 * Read the desktop theme source without making presentation failure block startup.
 * @param dshHome - Active Harness home selected by the desktop data-home flow.
 * @param reportError - Receives malformed or unreadable settings failures.
 * @returns The stored theme source, or `system` when no valid preference exists.
 */
export async function readDesktopThemeSource(
  dshHome: string,
  reportError: (error: unknown) => void = () => {},
): Promise<DesktopThemeSource> {
  try {
    const contents = await readFile(join(dshHome, 'settings.yaml'), 'utf8')
    const document = parseDocument(contents, { prettyErrors: false })
    if (document.errors.length > 0) throw new Error(document.errors[0]?.message ?? 'invalid theme settings YAML')
    const value: unknown = document.toJS()
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'system'
    const theme = (value as Record<string, unknown>)['ui-theme']
    if (typeof theme !== 'object' || theme === null || Array.isArray(theme)) return 'system'
    return resolveDesktopThemeSource((theme as Record<string, unknown>).preference)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') reportError(error)
    return 'system'
  }
}

/**
 * Pick the opaque BrowserWindow background matching the effective scheme.
 * @param source - Current desktop theme source.
 * @param systemDark - Electron's resolved system appearance.
 * @returns A light or dark background color for pre-paint window pixels.
 */
export function desktopThemeBackground(source: DesktopThemeSource, systemDark: boolean): string {
  const dark = source === 'dark' || (source === 'system' && systemDark)
  return dark ? '#1b1b1a' : '#f4f2ed'
}

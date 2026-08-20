/** Durable preferences owned by the Electron desktop shell. */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** What an ordinary window close does. */
export type CloseBehavior = 'tray' | 'quit'

/** User-controlled desktop shell behavior. */
export interface DesktopPreferences {
  closeBehavior: CloseBehavior
  notificationsEnabled: boolean
  launchAtLoginEnabled: boolean
}

/** Desktop preference defaults used for a new or unreadable store. */
export const DEFAULT_DESKTOP_PREFERENCES: DesktopPreferences = Object.freeze({
  closeBehavior: 'tray',
  notificationsEnabled: true,
  launchAtLoginEnabled: false,
})

/** Fields accepted by the renderer preference update bridge. */
export type DesktopPreferencesPatch = Partial<DesktopPreferences>

/** Normalize data read from the durable JSON file. */
export function normalizeDesktopPreferences(raw: unknown): DesktopPreferences {
  const source = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
  return {
    closeBehavior: source.closeBehavior === 'quit' || source.closeBehavior === 'tray'
      ? source.closeBehavior
      : DEFAULT_DESKTOP_PREFERENCES.closeBehavior,
    notificationsEnabled: typeof source.notificationsEnabled === 'boolean'
      ? source.notificationsEnabled
      : DEFAULT_DESKTOP_PREFERENCES.notificationsEnabled,
    launchAtLoginEnabled: typeof source.launchAtLoginEnabled === 'boolean'
      ? source.launchAtLoginEnabled
      : DEFAULT_DESKTOP_PREFERENCES.launchAtLoginEnabled,
  }
}

/** Validate a renderer preference patch without accepting unknown keys. */
export function parseDesktopPreferencesPatch(raw: unknown): DesktopPreferencesPatch {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new TypeError('desktop: preference patch must be an object')
  }
  const source = raw as Record<string, unknown>
  const allowed = new Set(['closeBehavior', 'notificationsEnabled', 'launchAtLoginEnabled'])
  for (const key of Object.keys(source)) {
    if (!allowed.has(key)) throw new TypeError(`desktop: unknown preference ${key}`)
  }
  const patch: DesktopPreferencesPatch = {}
  if ('closeBehavior' in source) {
    if (source.closeBehavior !== 'tray' && source.closeBehavior !== 'quit') {
      throw new TypeError('desktop: closeBehavior must be tray or quit')
    }
    patch.closeBehavior = source.closeBehavior
  }
  if ('notificationsEnabled' in source) {
    if (typeof source.notificationsEnabled !== 'boolean') {
      throw new TypeError('desktop: notificationsEnabled must be boolean')
    }
    patch.notificationsEnabled = source.notificationsEnabled
  }
  if ('launchAtLoginEnabled' in source) {
    if (typeof source.launchAtLoginEnabled !== 'boolean') {
      throw new TypeError('desktop: launchAtLoginEnabled must be boolean')
    }
    patch.launchAtLoginEnabled = source.launchAtLoginEnabled
  }
  return patch
}

/** Read/write access to the desktop preference file. */
export interface DesktopPreferencesStore {
  read(): DesktopPreferences
  write(preferences: DesktopPreferences): void
}

/** Create an atomic JSON-backed preference store. */
export function createDesktopPreferencesStore(
  filePath: string,
  reportReadFailure: (error: unknown) => void = () => {},
): DesktopPreferencesStore {
  return {
    read() {
      try {
        return normalizeDesktopPreferences(JSON.parse(readFileSync(filePath, 'utf8')) as unknown)
      } catch (error) {
        const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
        if (code !== 'ENOENT') reportReadFailure(error)
        return { ...DEFAULT_DESKTOP_PREFERENCES }
      }
    },
    write(preferences) {
      mkdirSync(dirname(filePath), { recursive: true })
      const temporaryPath = `${filePath}.${process.pid}.tmp`
      writeFileSync(temporaryPath, `${JSON.stringify(preferences, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
      renameSync(temporaryPath, filePath)
    },
  }
}

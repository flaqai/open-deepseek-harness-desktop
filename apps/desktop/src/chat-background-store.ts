/** Durable desktop storage for the device-local chat background selection. */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const MAX_STORED_CHARACTERS = 3 * 1024 * 1024
const CUSTOM_IMAGE_PREFIX = 'data:image/webp;base64,'

/** Background value accepted from and returned to the trusted renderer. */
export interface DesktopChatBackground {
  /** Stable built-in or custom selection id. */
  id: string
  /** Validated custom WebP data URL. */
  url?: string
  /** Reserved subject placement supplied only by trusted built-in definitions. */
  layout?: 'focus-left' | 'focus-right'
}

const BACKGROUND_IDS = new Set([
  'none', 'deep-ocean', 'moon-whale', 'bubble-whale', 'idea-collage',
  'anime-starlight', 'pirate-horizon', 'shinobi-ember', 'rift-arena', 'custom',
])

/**
 * Validate a renderer or disk value without accepting arbitrary URLs or fields.
 * @param raw - untrusted IPC or parsed JSON value.
 * @returns canonical desktop background value.
 */
export function parseDesktopChatBackground(raw: unknown): DesktopChatBackground {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new TypeError('desktop: chat background must be an object')
  }
  const source = raw as Record<string, unknown>
  if (typeof source.id !== 'string' || !BACKGROUND_IDS.has(source.id)) {
    throw new TypeError('desktop: invalid chat background id')
  }
  if (source.id === 'custom') {
    if (
      typeof source.url !== 'string'
      || !source.url.startsWith(CUSTOM_IMAGE_PREFIX)
      || source.url.length > MAX_STORED_CHARACTERS
    ) {
      throw new TypeError('desktop: invalid custom chat background')
    }
    return { id: 'custom', url: source.url }
  }
  return { id: source.id }
}

/** Read/write access to the desktop-owned background file. */
export interface DesktopChatBackgroundStore {
  /** Read the last valid value, or no value when the file is absent or damaged. */
  read(): DesktopChatBackground | undefined
  /** Validate and atomically replace the durable value. */
  write(background: unknown): DesktopChatBackground
}

/**
 * Create an atomic JSON-backed background store under the desktop data directory.
 * @param filePath - application-owned persistence file.
 * @param reportReadFailure - observer for malformed or unreadable existing files.
 * @returns synchronous store used by Electron IPC handlers.
 */
export function createDesktopChatBackgroundStore(
  filePath: string,
  reportReadFailure: (error: unknown) => void = () => {},
): DesktopChatBackgroundStore {
  return {
    read() {
      try {
        return parseDesktopChatBackground(JSON.parse(readFileSync(filePath, 'utf8')))
      } catch (error) {
        const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
        if (code !== 'ENOENT') reportReadFailure(error)
        return undefined
      }
    },
    write(background) {
      const parsed = parseDesktopChatBackground(background)
      mkdirSync(dirname(filePath), { recursive: true })
      const temporaryPath = `${filePath}.${process.pid}.tmp`
      writeFileSync(temporaryPath, `${JSON.stringify(parsed)}\n`, { encoding: 'utf8', mode: 0o600 })
      renameSync(temporaryPath, filePath)
      return parsed
    },
  }
}

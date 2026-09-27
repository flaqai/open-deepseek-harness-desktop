/** Per-Harness-home floating-ball preferences. */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** The single Computer Use backend selected for one Profile. */
export type OrbComputerBackend = 'orb' | 'official-native' | 'official-mcp'
export type ManagedOrbComputerBackend = Exclude<OrbComputerBackend, 'orb'>

/** Persisted settings; the active home selects the backing file. */
export interface OrbSettings {
  readonly visible: boolean
  readonly showAtStartup: boolean
  readonly selectionToolbar: boolean
  readonly backend: OrbComputerBackend
  readonly avatar: 'deepseek' | 'minimal'
  readonly anchor: 'left' | 'right'
}

/** Defaults for a home that has not configured the floating ball. */
export const DEFAULT_ORB_SETTINGS: OrbSettings = Object.freeze({
  visible: false,
  showAtStartup: false,
  selectionToolbar: false,
  backend: 'orb',
  avatar: 'deepseek',
  anchor: 'right',
})

/** Preserve an existing community-managed official provider when the floating ball is first enabled.
 * @param patch - Web Profile patch text, if one exists.
 * @returns The provider already selected by the Profile, or the new-home default.
 */
export function initialOrbBackend(patch: string | undefined): OrbComputerBackend {
  if (patch === undefined) return 'orb'
  const start = '# BEGIN community-desktop:computer-use'
  const end = '# END community-desktop:computer-use'
  const from = patch.indexOf(start)
  const to = patch.indexOf(end, from + start.length)
  if (from < 0 || to < 0) return 'orb'
  const block = patch.slice(from + start.length, to)
  if (block.includes("name: '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native'")) return 'official-native'
  if (block.includes("name: '@deepseek-ai/dsh-experimental-computer-use-cua-driver-mcp'")) return 'official-mcp'
  return 'orb'
}

/** Allowlisted renderer changes to the per-home state. */
export type OrbSettingsPatch = Partial<OrbSettings>

/** Parse a renderer-supplied patch without accepting paths or arbitrary backend names.
 * @param input - IPC input.
 * @returns Validated patch.
 */
export function parseOrbSettingsPatch(input: unknown): OrbSettingsPatch {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError('desktop: orb settings patch must be an object')
  }
  const source = input as Record<string, unknown>
  const allowed = new Set<keyof OrbSettings>([
    'visible', 'showAtStartup', 'selectionToolbar', 'backend', 'avatar', 'anchor',
  ])
  for (const key of Object.keys(source)) {
    if (!allowed.has(key as keyof OrbSettings)) throw new TypeError(`desktop: unknown orb setting ${key}`)
  }
  for (const key of ['visible', 'showAtStartup', 'selectionToolbar'] as const) {
    if (key in source && typeof source[key] !== 'boolean') throw new TypeError(`desktop: invalid orb setting ${key}`)
  }
  if ('backend' in source && source.backend !== 'orb'
    && source.backend !== 'official-native' && source.backend !== 'official-mcp') {
    throw new TypeError('desktop: invalid orb backend')
  }
  if ('avatar' in source && source.avatar !== 'deepseek' && source.avatar !== 'minimal') {
    throw new TypeError('desktop: invalid orb avatar')
  }
  if ('anchor' in source && source.anchor !== 'left' && source.anchor !== 'right') {
    throw new TypeError('desktop: invalid orb anchor')
  }
  return source
}

/** Normalize a persisted JSON value independently for each supported field.
 * @param input - Parsed JSON.
 * @returns Safe settings.
 */
export function normalizeOrbSettings(input: unknown): OrbSettings {
  const value = typeof input === 'object' && input !== null && !Array.isArray(input)
    ? input as Record<string, unknown> : {}
  return {
    visible: typeof value.visible === 'boolean' ? value.visible : DEFAULT_ORB_SETTINGS.visible,
    showAtStartup: typeof value.showAtStartup === 'boolean' ? value.showAtStartup : DEFAULT_ORB_SETTINGS.showAtStartup,
    selectionToolbar: typeof value.selectionToolbar === 'boolean' ? value.selectionToolbar : DEFAULT_ORB_SETTINGS.selectionToolbar,
    backend: value.backend === 'official-native' || value.backend === 'official-mcp' ? value.backend : 'orb',
    avatar: value.avatar === 'minimal' ? 'minimal' : 'deepseek',
    anchor: value.anchor === 'left' ? 'left' : 'right',
  }
}

/** A file store scoped to an already-normalized DSH_HOME.
 * @param home - Active Harness data directory.
 * @returns Per-home read/write operations.
 */
export function createOrbSettingsStore(home: string): {
  read(): OrbSettings
  write(settings: OrbSettings): void
  readPendingBackend(): ManagedOrbComputerBackend | undefined
  writePendingBackend(backend: ManagedOrbComputerBackend): void
  clearPendingBackend(): void
} {
  const path = join(home, '.desktop-orb', 'settings-v1.json')
  const pendingPath = join(home, '.desktop-orb', 'pending-backend-v1.json')
  return {
    read() {
      try { return normalizeOrbSettings(JSON.parse(readFileSync(path, 'utf8'))) }
      catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          let patch: string | undefined
          try { patch = readFileSync(join(home, 'profiles', 'web', 'cordis.patch.yml'), 'utf8') }
          catch (patchError) {
            if (!(patchError instanceof Error && 'code' in patchError && patchError.code === 'ENOENT')) throw patchError
          }
          return { ...DEFAULT_ORB_SETTINGS, backend: initialOrbBackend(patch) }
        }
        throw error
      }
    },
    write(settings) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
      const temporary = `${path}.${process.pid}.tmp`
      writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
      renameSync(temporary, path)
    },
    readPendingBackend() {
      let value: unknown
      try { value = JSON.parse(readFileSync(pendingPath, 'utf8')) as unknown }
      catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
        throw error
      }
      if (typeof value !== 'object' || value === null || Array.isArray(value)
        || !('backend' in value) || (value.backend !== 'official-native'
          && value.backend !== 'official-mcp')) {
        throw new Error('desktop: malformed pending floating-ball backend')
      }
      return value.backend
    },
    writePendingBackend(backend) {
      mkdirSync(dirname(pendingPath), { recursive: true, mode: 0o700 })
      const temporary = `${pendingPath}.${process.pid}.tmp`
      writeFileSync(temporary, `${JSON.stringify({ backend })}\n`, { encoding: 'utf8', mode: 0o600 })
      renameSync(temporary, pendingPath)
    },
    clearPendingBackend() { rmSync(pendingPath, { force: true }) },
  }
}

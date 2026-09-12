/** Guarded recovery helpers for a user-owned settings document. */

import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

const PROFILE_HEALTH_DIRECTORY = 'profile-health'
const SETTINGS_FILENAME = 'settings.yaml'

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(temporary, content, { flag: 'wx', mode: 0o600 })
  renameSync(temporary, path)
}

/**
 * Materialize the empty settings document used only by diagnostic mode.
 * @param home - Selected Harness home.
 * @returns Absolute app-maintained diagnostic settings path.
 */
export function prepareDiagnosticSettingsDocument(home: string = resolveDshHome()): string {
  const path = join(home, PROFILE_HEALTH_DIRECTORY, 'diagnostic-mode-settings.yaml')
  if (existsSync(path)) unlinkSync(path)
  atomicWrite(path, '{}\n')
  return path
}

/** Isolated writable roots used by one diagnostic-mode process. */
export interface DiagnosticRuntimeDirectories {
  readonly root: string
  readonly sessions: string
  readonly storages: string
}

/**
 * Create an empty, invocation-owned data root for diagnostic mode.
 *
 * The recovery composition must not enumerate the active Session store: one
 * corrupt append-only artifact would otherwise crash both ordinary startup
 * and the fallback that is supposed to let the user repair it. Storage is
 * isolated with Sessions so Workspace bootstrap cannot persist an empty view
 * over the user's real metadata. The launcher removes the returned root after
 * the diagnostic process settles.
 * @param home - Selected Harness home.
 * @returns Empty owner-only runtime directories.
 */
export function prepareDiagnosticRuntimeDirectories(
  home: string = resolveDshHome(),
): DiagnosticRuntimeDirectories {
  const parent = join(home, PROFILE_HEALTH_DIRECTORY, 'diagnostic-mode-runtime')
  mkdirSync(parent, { recursive: true, mode: 0o700 })
  const root = mkdtempSync(join(parent, 'run-'))
  const sessions = join(root, 'sessions')
  const storages = join(root, 'storages')
  mkdirSync(sessions, { mode: 0o700 })
  mkdirSync(storages, { mode: 0o700 })
  return { root, sessions, storages }
}

/** Paths retained after replacing an invalid user settings document. */
export interface ResetInvalidSettingsResult {
  readonly documentPath: string
  readonly backupPath?: string
  readonly backupName?: string
}

/**
 * Back up the exact user settings bytes and replace the active document with
 * an empty valid map. The original is restored if the replacement cannot be
 * committed. Symlinks are rejected so this narrow recovery can never rewrite
 * an arbitrary target outside the selected Harness home.
 * @param home - Selected Harness home.
 * @param now - Clock used to create the collision-resistant backup label.
 * @returns Active document path and optional backup identity.
 */
export function backupAndResetInvalidSettings(
  home: string = resolveDshHome(),
  now: () => Date = () => new Date(),
): ResetInvalidSettingsResult {
  const documentPath = join(home, SETTINGS_FILENAME)
  if (!existsSync(documentPath)) {
    atomicWrite(documentPath, '{}\n')
    return { documentPath }
  }
  if (lstatSync(documentPath).isSymbolicLink()) {
    throw new Error('dsh: refusing to reset a symbolic-link settings document')
  }
  const stamp = now().toISOString().replace(/[:.]/gu, '-')
  const backupPath = join(home, `settings.before-reset.${stamp}.yaml`)
  renameSync(documentPath, backupPath)
  try {
    atomicWrite(documentPath, '{}\n')
  } catch (error) {
    if (existsSync(documentPath)) unlinkSync(documentPath)
    renameSync(backupPath, documentPath)
    throw error
  }
  return { documentPath, backupPath, backupName: basename(backupPath) }
}

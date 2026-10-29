import { permissionNames } from './locales/permission-names.ts'

/** Permission policy for the supervised Harness renderer. */

const CLIPBOARD_WRITE_PERMISSION = 'clipboard-sanitized-write'

const PROMPTABLE_PERMISSIONS = new Set([
  'ar', 'automatic-fullscreen', 'background-fetch', 'background-sync',
  'captured-surface-control', 'clipboard-read', 'deprecated-sync-clipboard-read',
  'display-capture', 'fileSystem', 'fullscreen', 'geolocation', 'geolocation-approximate',
  'hand-tracking', 'hid', 'idle-detection', 'keyboardLock', 'local-fonts',
  'local-network', 'local-network-access', 'loopback-network', 'media', 'mediaKeySystem',
  'midi', 'midiSysex', 'nfc', 'notifications', 'payment-handler',
  'periodic-background-sync', 'persistent-storage', 'pointerLock', 'screen-wake-lock',
  'sensors', 'serial', 'smart-card', 'speaker-selection', 'storage-access',
  'system-wake-lock', 'top-level-storage-access', 'usb', 'vr',
  'web-app-installation', 'web-printing', 'window-management',
])

export interface HarnessPermissionDetails {
  readonly mediaType?: 'video' | 'audio' | 'unknown'
  readonly mediaTypes?: readonly ('video' | 'audio')[]
}

/** Permissions intentionally handled outside this policy remain fail-closed. */
export function isPromptableHarnessPermission(permission: string): boolean {
  return PROMPTABLE_PERMISSIONS.has(permission)
}

/** Sanitized clipboard writes preserve the existing no-dialog copy UX. */
export function isSilentHarnessPermission(permission: string): boolean {
  return permission === CLIPBOARD_WRITE_PERMISSION
}

/**
 * Decide whether one renderer permission request is allowed.
 *
 * Promptable capabilities are admitted only from the main frame at the exact
 * supervised Harness origin. The caller still owns user consent; this function
 * never grants a promptable capability by itself.
 *
 * @param permission Electron permission name.
 * @param requestingUrl URL loaded by the requesting frame.
 * @param trustedOrigin Exact loopback origin selected by Harness readiness.
 * @param isMainFrame Whether the requesting frame is the top-level renderer.
 * @returns Whether the request may proceed to silent handling or user consent.
 */
export function isTrustedHarnessPermissionRequest(
  permission: string,
  requestingUrl: string | undefined,
  trustedOrigin: string | undefined,
  isMainFrame: boolean,
): boolean {
  if (
    (!isSilentHarnessPermission(permission) && !isPromptableHarnessPermission(permission))
    || requestingUrl === undefined
    || trustedOrigin === undefined
    // Chromium reports false for every File System Access permission check.
    || (!isMainFrame && permission !== 'fileSystem')
  ) return false

  try {
    return new URL(requestingUrl).origin === trustedOrigin
  } catch {
    return false
  }
}

/** Stable, least-privilege keys used for in-memory grants during one renderer run. */
export function harnessPermissionDecisionKeys(
  permission: string,
  details: HarnessPermissionDetails = {},
): readonly string[] {
  if (permission !== 'media') return [permission]
  const mediaTypes = details.mediaTypes ?? (details.mediaType === undefined ? [] : [details.mediaType])
  const known = [...new Set(mediaTypes.filter(type => type === 'audio' || type === 'video'))].sort()
  // Older Chromium request details may omit mediaTypes. In that case the dialog
  // explicitly names both capabilities before granting either one.
  return (known.length === 0 ? ['audio', 'video'] : known).map(type => `media:${type}`)
}

/** Human-readable capability name for the native consent dialog. */
export function harnessPermissionName(
  permission: string,
  details: HarnessPermissionDetails,
  language: string,
): string {
  const names = permissionNames(language)
  if (permission === 'media') {
    const keys = harnessPermissionDecisionKeys(permission, details)
    const key = keys.length === 1 ? keys[0] ?? 'media:both' : 'media:both'
    return names[key] ?? names['unknown'] ?? permission
  }
  return names[permission] ?? names['unknown'] ?? permission
}

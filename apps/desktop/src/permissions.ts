/** Permission policy for the supervised Harness renderer. */

const CLIPBOARD_WRITE_PERMISSION = 'clipboard-sanitized-write'

/**
 * Decide whether one renderer permission request is allowed.
 *
 * Only sanitized clipboard writes from the main frame at the exact supervised
 * Harness origin are permitted. Clipboard reads and every other permission stay
 * denied.
 *
 * @param permission Electron permission name.
 * @param requestingUrl URL loaded by the requesting frame.
 * @param trustedOrigin Exact loopback origin selected by Harness readiness.
 * @param isMainFrame Whether the requesting frame is the top-level renderer.
 * @returns Whether Electron should grant the permission.
 */
export function allowsHarnessPermission(
  permission: string,
  requestingUrl: string | undefined,
  trustedOrigin: string | undefined,
  isMainFrame: boolean,
): boolean {
  if (
    permission !== CLIPBOARD_WRITE_PERMISSION
    || requestingUrl === undefined
    || trustedOrigin === undefined
    || !isMainFrame
  ) return false

  try {
    return new URL(requestingUrl).origin === trustedOrigin
  } catch {
    return false
  }
}

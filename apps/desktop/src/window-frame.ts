/** Platform policy for native and custom desktop window frames. */

/**
 * Decide whether the desktop host replaces the operating-system title bar.
 *
 * macOS retains its native title bar and traffic lights. Windows and Linux use
 * the Harness title bar rendered by the sandboxed preload.
 *
 * @param platform Node platform identifier.
 * @returns Whether to create a frameless BrowserWindow with custom controls.
 */
export function usesCustomWindowFrame(platform: NodeJS.Platform): boolean {
  return platform === 'win32' || platform === 'linux'
}

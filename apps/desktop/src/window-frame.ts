/** Platform policy for native and custom desktop window frames. */

/** Height, in CSS pixels, reserved for the desktop-owned custom title bar. */
export const CUSTOM_WINDOW_TITLE_BAR_HEIGHT = 36

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

/**
 * Stamp a Harness URL with the custom-frame geometry consumed by Web plugins.
 *
 * macOS keeps the original URL because its native title bar does not overlap
 * the Web viewport. Windows and Linux declare the exact top inset so fixed or
 * full-viewport plugin layouts can yield the same space as normal document
 * content.
 *
 * @param rawUrl Harness Web URL.
 * @param platform Node platform identifier.
 * @returns URL carrying desktop custom-frame metadata when required.
 */
export function withCustomWindowFrameInset(rawUrl: string, platform: NodeJS.Platform): string {
  if (!usesCustomWindowFrame(platform)) return rawUrl
  const url = new URL(rawUrl)
  url.searchParams.set('dsh-desktop-mode', 'advanced')
  url.searchParams.set('dsh-desktop-platform', platform)
  url.searchParams.set('dsh-desktop-titlebar-inset', String(CUSTOM_WINDOW_TITLE_BAR_HEIGHT))
  return url.href
}

/** Canonical user-visible identity shared by source and packaged desktop builds. */
export const DESKTOP_PRODUCT_NAME = 'Open DeepSeek Harness Desktop'

/**
 * Keep upstream page titles useful while replacing its generic product title.
 * @param title - Title reported by the Harness renderer.
 * @returns Desktop-branded title for the native window surface.
 */
export function desktopWindowTitle(title: string): string {
  const normalized = title.trim()
  return normalized === '' || normalized === 'DeepSeek Harness' || normalized === 'Open DSH Desktop'
    ? DESKTOP_PRODUCT_NAME
    : title
}

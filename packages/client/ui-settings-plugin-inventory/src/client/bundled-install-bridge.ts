/** Optional packaged-desktop routing for allowlisted bundled plugin installs. */

import type {
  PluginInstallId,
  PluginInstallRequest,
  PluginInstallSnapshot,
} from '@deepseek-ai/dsh-host-plugin-inventory/types'

interface DesktopBundledPluginsBridge {
  startInstall(request: PluginInstallRequest): Promise<
    | { readonly handled: false }
    | { readonly handled: true; readonly snapshot: PluginInstallSnapshot }
  >
  getInstall(installId: string): Promise<PluginInstallSnapshot>
}

function readDesktopBundledPluginsBridge(): DesktopBundledPluginsBridge | undefined {
  const desktop = (globalThis as typeof globalThis & { deepSeekHarnessDesktop?: unknown }).deepSeekHarnessDesktop
  if (desktop === null || typeof desktop !== 'object') return undefined
  const bundledPlugins = (desktop as { bundledPlugins?: unknown }).bundledPlugins
  if (bundledPlugins === null || typeof bundledPlugins !== 'object') return undefined
  const candidate = bundledPlugins as Partial<DesktopBundledPluginsBridge>
  if (typeof candidate.startInstall !== 'function' || typeof candidate.getInstall !== 'function') return undefined
  return candidate as DesktopBundledPluginsBridge
}

/**
 * Prefer an exact packaged archive when main owns the request; otherwise use Host Remote.
 * @param request - Structured profile and package spec selected by the user.
 * @param fallback - Guarded Host Remote installer for requests outside the desktop allowlist.
 * @returns The desktop-owned or Host-owned installation snapshot.
 */
export async function startPluginInstall(
  request: PluginInstallRequest,
  fallback: (request: PluginInstallRequest) => Promise<PluginInstallSnapshot>,
): Promise<PluginInstallSnapshot> {
  const bridge = readDesktopBundledPluginsBridge()
  if (bridge !== undefined) {
    const result = await bridge.startInstall(request)
    if (result.handled) return result.snapshot
  }
  return fallback(request)
}

/**
 * Poll desktop-owned ids through Electron and ordinary ids through Host Remote.
 * @param installId - Stable id returned by the selected installation owner.
 * @param fallback - Guarded Host Remote poller for non-desktop ids.
 * @returns The current installation snapshot.
 */
export async function getPluginInstall(
  installId: PluginInstallId,
  fallback: (installId: PluginInstallId) => Promise<PluginInstallSnapshot>,
): Promise<PluginInstallSnapshot> {
  if (String(installId).startsWith('desktop-bundled:')) {
    const bridge = readDesktopBundledPluginsBridge()
    if (bridge === undefined) throw new Error('desktop bundled plugin bridge is unavailable')
    return bridge.getInstall(String(installId))
  }
  return fallback(installId)
}

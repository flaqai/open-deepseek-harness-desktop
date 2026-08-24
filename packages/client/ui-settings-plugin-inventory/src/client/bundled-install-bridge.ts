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
  startDeferred?(request: PluginInstallRequest): Promise<
    | { readonly handled: false }
    | { readonly handled: true; readonly snapshot?: DesktopBundledPluginInstallSnapshot }
  >
  getInstall(installId: string): Promise<PluginInstallSnapshot>
}

/** Coarse packaged-install milestones exposed by the desktop host. */
export interface DesktopBundledPluginInstallSnapshot extends PluginInstallSnapshot {
  readonly stage: 'verifying' | 'extracting' | 'configuring'
  readonly progress: number
}

interface DesktopShellBridge {
  openLog?(): Promise<unknown>
  restart?(): Promise<unknown>
}

/** Install the fixed source-mode fixture through the trusted Electron host. */
export async function installDesktopDiagnosticFixture(): Promise<string | undefined> {
  const desktop = (globalThis as typeof globalThis & { deepSeekHarnessDesktop?: unknown }).deepSeekHarnessDesktop
  if (desktop === null || typeof desktop !== 'object') return undefined
  const fixtures = (desktop as { diagnosticFixtures?: unknown }).diagnosticFixtures
  if (fixtures === null || typeof fixtures !== 'object') return undefined
  const install = (fixtures as { install?: unknown }).install
  if (typeof install !== 'function') return undefined
  const result = await (install as () => Promise<{ installed: true; diagnostic: string }>)()
  return result.diagnostic
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

function readDesktopShellBridge(): DesktopShellBridge | undefined {
  const desktop = (globalThis as typeof globalThis & { deepSeekHarnessDesktop?: unknown }).deepSeekHarnessDesktop
  if (desktop === null || typeof desktop !== 'object') return undefined
  const shell = (desktop as { shell?: unknown }).shell
  return shell !== null && typeof shell === 'object' ? shell as DesktopShellBridge : undefined
}

/** Start the first-run packaged Better Sidebar job without falling back to Host Remote. */
export async function startDeferredPluginInstall(
  request: PluginInstallRequest,
): Promise<DesktopBundledPluginInstallSnapshot | undefined> {
  const bridge = readDesktopBundledPluginsBridge()
  if (bridge?.startDeferred === undefined) return undefined
  const result = await bridge.startDeferred(request)
  return result.handled ? result.snapshot : undefined
}

/** Poll one desktop-owned deferred installation. */
export async function getDeferredPluginInstall(
  installId: PluginInstallId,
): Promise<DesktopBundledPluginInstallSnapshot> {
  const bridge = readDesktopBundledPluginsBridge()
  if (bridge === undefined) throw new Error('desktop bundled plugin bridge is unavailable')
  return bridge.getInstall(String(installId)) as Promise<DesktopBundledPluginInstallSnapshot>
}

/** Reveal the existing desktop Harness log without exposing a filesystem primitive. */
export async function openDesktopHarnessLog(): Promise<boolean> {
  const openLog = readDesktopShellBridge()?.openLog
  if (openLog === undefined) return false
  await openLog()
  return true
}

/** Ask the trusted desktop host to relaunch the application. */
export async function restartDesktopApplication(): Promise<boolean> {
  const restart = readDesktopShellBridge()?.restart
  if (restart === undefined) return false
  await restart()
  return true
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

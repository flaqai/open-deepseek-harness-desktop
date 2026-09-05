/** Optional Electron bridge for redacted desktop startup incidents. */

export interface StartupDiagnosticIncident {
  readonly incidentId: string
  readonly code: string
  readonly operation: string
  readonly packageName?: string
  readonly createdAt: string
  readonly actions: readonly string[]
}

/** Narrow desktop bridge used to inspect and repair startup incidents. */
export interface StartupDiagnosticsInjected {
  readonly list: () => Promise<readonly StartupDiagnosticIncident[]>
  readonly retry: (incidentId: string) => Promise<{
    readonly status: 'plugin-started' | 'restarting' | 'unsupported'
    readonly installId?: string
  }>
  readonly openLog: () => Promise<{ error: string }>
}

function readBridge(): StartupDiagnosticsInjected | undefined {
  const desktop = (globalThis as typeof globalThis & { deepSeekHarnessDesktop?: unknown }).deepSeekHarnessDesktop
  if (desktop === null || typeof desktop !== 'object') return undefined
  const diagnostics = (desktop as { startupDiagnostics?: unknown }).startupDiagnostics
  if (diagnostics === null || typeof diagnostics !== 'object') return undefined
  const candidate = diagnostics as Partial<StartupDiagnosticsInjected>
  if (typeof candidate.list !== 'function'
    || typeof candidate.retry !== 'function'
    || typeof candidate.openLog !== 'function') return undefined
  return candidate as StartupDiagnosticsInjected
}

/** Resolve a validated startup-diagnostics bridge when running inside Desktop.
 * @returns A restricted bridge in Electron, or `undefined` in a regular browser.
 */
export function desktopStartupDiagnosticsAvailable(): StartupDiagnosticsInjected | undefined {
  const bridge = readBridge()
  return bridge === undefined ? undefined : {
    list: () => bridge.list(),
    retry: incidentId => bridge.retry(incidentId),
    openLog: () => bridge.openLog(),
  }
}

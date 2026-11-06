/** Bounded diagnostics for the critical workspace slot; no renderer control is exposed. */
import { redactPersistentLogText } from './persistent-log.ts'

interface ConsoleMessage {
  level: string
  message: string
  sourceId: string
  lineNumber: number
  frame: unknown
}

interface RendererConsole {
  readonly mainFrame: unknown
  on(event: 'console-message', listener: (event: ConsoleMessage) => void): unknown
  removeListener(event: 'console-message', listener: (event: ConsoleMessage) => void): unknown
}

/**
 * Retain workspace-slot errors from the trusted application frame only.
 * @param renderer - Content renderer; guest frames are excluded.
 * @param trusted - Current navigation must still belong to the selected Harness.
 * @param append - Diagnostic sink; its failure cannot interrupt the application.
 * @param now - Monotonic-enough clock used to bound error bursts.
 * @returns Listener disposer.
 */
export function installWorkspaceRendererDiagnostics(
  renderer: RendererConsole,
  trusted: () => boolean,
  append: (message: string) => void,
  now: () => number = Date.now,
): () => void {
  let started = now()
  let count = 0
  const listener = (event: ConsoleMessage): void => {
    try {
      if (event.level !== 'error' || !event.message.startsWith("slot entry crashed in 'sidebar.workspaces':")
        || event.frame !== renderer.mainFrame || !trusted()) return
      const time = now()
      if (time - started >= 60_000 || time < started) { started = time; count = 0 }
      if (count >= 10) return
      count++
      // Retain the asset basename, never its credential-bearing URL or query.
      let asset = 'unknown'
      try { asset = new URL(event.sourceId).pathname.split('/').at(-1) || 'unknown' } catch { /* No URL is needed for recovery. */ }
      asset = asset.replace(/[\r\n\t]/gu, ' ').slice(0, 120)
      const message = redactPersistentLogText(event.message.slice(0, 12_000)).slice(0, 6_000)
      append(`workspace-slot-error ${asset}:${event.lineNumber}\n${message}`)
    } catch {
      // Diagnostics are observational; neither navigation nor persistence failure is fatal.
    }
  }
  renderer.on('console-message', listener)
  return () => { renderer.removeListener('console-message', listener) }
}

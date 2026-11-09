/** User-enabled download policy; installation and Harness lifecycle are outside this module. */
import type { DesktopReleaseStatus } from './release-checker.ts'

type AvailableRelease = Extract<DesktopReleaseStatus, { phase: 'available' }>

/** Starts a selected download once without turning polling into a cancellation/error retry loop. */
export class BackgroundReleaseDownloads {
  #enabled: boolean
  #selection: AvailableRelease | undefined
  #attempted = new Set<string>()
  #disposed = false

  /**
   * @param enabled - Persisted user choice; callers use false for an unset preference.
   * @param startDownload - Starts or joins the selected transfer; false defers a busy or unavailable target.
   */
  constructor(enabled: boolean, private readonly startDownload: () => boolean | void) { this.#enabled = enabled }

  /**
   * Observe authoritative release discovery; transient checks and errors do not revoke a selection.
   * @param release - Current checker result, never a renderer-selected artifact.
   */
  observe(release: DesktopReleaseStatus): void {
    if (this.#disposed) return
    if (release.phase === 'available') this.#selection = release
    else if (release.phase !== 'checking' && release.phase !== 'error' && release.phase !== 'idle') {
      this.#selection = undefined
    }
    this.#startIfAllowed()
  }

  /**
   * Apply user preference without cancelling an already started or manually requested transfer.
   * @param enabled - A false-to-true change explicitly permits another attempt for the selected version.
   */
  setEnabled(enabled: boolean): void {
    if (this.#disposed) return
    if (enabled && !this.#enabled) this.#attempted.clear()
    this.#enabled = enabled
    this.#startIfAllowed()
  }

  #startIfAllowed(): void {
    if (!this.#enabled || this.#selection === undefined) return
    const key = `${this.#selection.source ?? 'github'}:${this.#selection.tagName}:${this.#selection.latestVersion}`
    if (this.#attempted.has(key)) return
    // Mark before invoking the callback so a synchronous status subscriber cannot re-enter this attempt.
    this.#attempted.add(key)
    if (this.startDownload() === false) this.#attempted.delete(key)
  }

  /** Prevent late checker or cancelled-transfer completion from starting a replacement download. */
  dispose(): void { this.#disposed = true; this.#selection = undefined }
}

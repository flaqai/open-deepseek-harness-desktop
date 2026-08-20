/** Reactive owner of desktop bridge snapshots and operations. */

import type {
  CloseBehavior, DesktopBridge, DesktopCapabilities, DesktopPreferences, DesktopReleaseStatus,
} from './bridge.ts'

/** Immutable renderer state shared by the desktop settings and footer action. */
export interface DesktopShellSnapshot {
  capabilities: DesktopCapabilities | null
  preferences: DesktopPreferences | null
  release: DesktopReleaseStatus
  busy: boolean
  error: string | null
}

/** Small external store shared by the General row and sidebar badge. */
export class DesktopShellController {
  #snapshot: DesktopShellSnapshot = {
    capabilities: null,
    preferences: null,
    release: { phase: 'unsupported' },
    busy: false,
    error: null,
  }
  readonly #listeners = new Set<() => void>()
  #disposers: (() => void)[] = []

  constructor(readonly bridge: DesktopBridge) {}

  /** Read the current immutable desktop state.
   * @returns the current snapshot.
   */
  getSnapshot = (): DesktopShellSnapshot => this.#snapshot
  /** Subscribe to desktop-state changes. @param listener - callback invoked after publication. @returns the disposer. */
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  #publish(patch: Partial<DesktopShellSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...patch }
    for (const listener of [...this.#listeners]) {
      try { listener() } catch (error) { console.error('[ui-desktop-shell] snapshot listener failed', error) }
    }
  }

  /** Seed state from the bridge and subscribe to subsequent main-process publications. */
  start(): void {
    this.#disposers = [
      this.bridge.shell.onPreferences((preferences) => { this.#publish({ preferences }) }),
      this.bridge.releases.onStatus((release) => { this.#publish({ release }) }),
    ]
    void Promise.all([
      this.bridge.shell.getCapabilities(),
      this.bridge.shell.getPreferences(),
      this.bridge.releases.getStatus(),
    ]).then(([capabilities, preferences, release]) => {
      this.#publish({ capabilities, preferences, release })
    }).catch((error: unknown) => {
      this.#publish({ error: error instanceof Error ? error.message : String(error) })
    })
  }

  /** Remove bridge subscriptions and local observers. */
  dispose(): void {
    for (const dispose of this.#disposers.splice(0)) dispose()
    this.#listeners.clear()
  }

  /** Persist one validated preference patch.
   * @param patch - fields to change.
   */
  async setPreference(patch: Partial<DesktopPreferences>): Promise<void> {
    this.#publish({ busy: true, error: null })
    try {
      this.#publish({ preferences: await this.bridge.shell.updatePreferences(patch) })
    } catch (error) {
      this.#publish({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      this.#publish({ busy: false })
    }
  }

  /** Change ordinary window-close behavior.
   * @param behavior - hide to tray or quit.
   */
  setCloseBehavior(behavior: CloseBehavior): void { void this.setPreference({ closeBehavior: behavior }) }
  /** Enable or disable native lifecycle notifications.
   * @param enabled - desired notification state.
   */
  setNotifications(enabled: boolean): void { void this.setPreference({ notificationsEnabled: enabled }) }
  /** Enable or disable packaged macOS login launch.
   * @param enabled - desired login-launch state.
   */
  setLaunchAtLogin(enabled: boolean): void { void this.setPreference({ launchAtLoginEnabled: enabled }) }

  /** Ask the main process to refresh GitHub Release status. */
  async checkRelease(): Promise<void> {
    this.#publish({ error: null })
    try { this.#publish({ release: await this.bridge.releases.check() }) } catch (error) {
      this.#publish({ error: error instanceof Error ? error.message : String(error) })
    }
  }

  /** Open the currently selected repository-validated Release page. */
  async openRelease(): Promise<void> {
    const release = this.#snapshot.release
    if (release.phase !== 'available') return
    const result = await this.bridge.releases.openDownload(release.releaseUrl)
    if (result.error !== '') this.#publish({ error: result.error })
  }
}

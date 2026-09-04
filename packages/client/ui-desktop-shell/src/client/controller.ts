/** Reactive owner of desktop bridge snapshots and operations. */

import type {
  CloseBehavior, DesktopBridge, DesktopCapabilities, DesktopCliStatus, DesktopDataHomeSelectionResult,
  DesktopDataHomeSelectionKind, DesktopDataHomeStatus, DesktopDataHomeSwitchRequest, DesktopPreferences,
  DesktopReleaseDownloadStatus, DesktopReleaseStatus,
} from './bridge.ts'

/** Immutable renderer state shared by the desktop settings and footer action. */
export interface DesktopShellSnapshot {
  menuDestination?: 'data-home' | 'updates' | undefined
  capabilities: DesktopCapabilities | null
  preferences: DesktopPreferences | null
  release: DesktopReleaseStatus
  simulatedReleaseAvailable: boolean
  releaseDownload: DesktopReleaseDownloadStatus
  commandLine: DesktopCliStatus | null
  dataHome: DesktopDataHomeStatus | null
  dataHomeSelection: DesktopDataHomeSelectionResult | null
  restartPending: boolean
  busy: boolean
  error: string | null
}

/** Fixed presentation version used only by the development-mode update simulator. */
export const DEVELOPMENT_RELEASE_VERSION = '0.1.1-rc.3'

/** Small external store shared by the General row and sidebar badge. */
export class DesktopShellController {
  #snapshot: DesktopShellSnapshot = {
    capabilities: null,
    preferences: null,
    release: { phase: 'unsupported' },
    simulatedReleaseAvailable: false,
    releaseDownload: { phase: 'unsupported' },
    commandLine: null,
    dataHome: null,
    dataHomeSelection: null,
    restartPending: false,
    busy: false,
    error: null,
  }
  readonly #listeners = new Set<() => void>()
  #disposers: (() => void)[] = []

  constructor(readonly bridge: DesktopBridge) {}

  /** Queue or consume a native-menu destination after General Settings mounts.
   * @param destination - Existing panel to reveal, or undefined to consume the request.
   */
  navigate(destination?: 'data-home' | 'updates'): void { this.#publish({ menuDestination: destination }) }

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
      this.bridge.releases.onDownloadStatus((releaseDownload) => { this.#publish({ releaseDownload }) }),
    ]
    void Promise.all([
      this.bridge.shell.getCapabilities(),
      this.bridge.shell.getPreferences(),
      this.bridge.releases.getStatus(),
      this.bridge.releases.getDownloadStatus(),
      this.bridge.shell.getCommandLine(),
      this.bridge.shell.getDataHome(),
    ]).then(([capabilities, preferences, release, releaseDownload, commandLine, dataHome]) => {
      this.#publish({ capabilities, preferences, release, releaseDownload, commandLine, dataHome })
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

  /** Install or repair the packaged desktop `dsh` command.
   * @param force - whether a detected non-owned command may be shadowed.
   */
  async installCommandLine(force = false): Promise<void> {
    this.#publish({ busy: true, error: null })
    try {
      this.#publish({ commandLine: await this.bridge.shell.installCommandLine(force) })
    } catch (error) {
      this.#publish({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      this.#publish({ busy: false })
    }
  }

  /** Remove only the terminal registration owned by the desktop app. */
  async removeCommandLine(): Promise<void> {
    this.#publish({ busy: true, error: null })
    try {
      this.#publish({ commandLine: await this.bridge.shell.removeCommandLine() })
    } catch (error) {
      this.#publish({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      this.#publish({ busy: false })
    }
  }

  /** Open the native picker and retain its opaque validated selection.
   * @param kind - Whether the picker accepts an existing DSH home or an empty folder.
   */
  async chooseDataHome(kind: DesktopDataHomeSelectionKind): Promise<void> {
    this.#publish({ busy: true, error: null })
    try {
      this.#publish({ dataHomeSelection: await this.bridge.shell.chooseDataHome(kind) })
    } catch (error) {
      this.#publish({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      this.#publish({ busy: false })
    }
  }

  /** Persist one validated data-home choice and request a complete desktop restart.
   * @param request - Built-in target or opaque native-picker selection.
   */
  async switchDataHome(request: DesktopDataHomeSwitchRequest): Promise<void> {
    this.#publish({ busy: true, error: null })
    try {
      const result = await this.bridge.shell.switchDataHome(request)
      this.#publish({ restartPending: result.restarting })
    } catch (error) {
      this.#publish({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      this.#publish({ busy: false })
    }
  }

  /** Ask the main process to refresh GitHub Release status. */
  async checkRelease(): Promise<void> {
    this.#publish({ error: null })
    try { this.#publish({ release: await this.bridge.releases.check() }) } catch (error) {
      this.#publish({ error: error instanceof Error ? error.message : String(error) })
    }
  }

  /** Toggle the shared development-only update state used by every update surface. */
  toggleSimulatedRelease(): void {
    if (this.#snapshot.release.phase !== 'unsupported') return
    this.#publish({ simulatedReleaseAvailable: !this.#snapshot.simulatedReleaseAvailable })
  }

  /** Open the currently selected repository-validated Release page. */
  async openRelease(): Promise<void> {
    const release = this.#snapshot.release
    if (release.phase !== 'available') return
    const result = await this.bridge.releases.openDownload(release.releaseUrl)
    if (result.error !== '') this.#publish({ error: result.error })
  }

  /** Download and verify the installer selected by the main process. */
  async downloadRelease(): Promise<void> {
    this.#publish({ error: null })
    try {
      this.#publish({ releaseDownload: await this.bridge.releases.startDownload() })
    } catch (error) {
      this.#publish({ error: error instanceof Error ? error.message : String(error) })
    }
  }

  /** Cancel the active installer download. */
  async cancelReleaseDownload(): Promise<void> {
    try {
      this.#publish({ releaseDownload: await this.bridge.releases.cancelDownload() })
    } catch (error) {
      this.#publish({ error: error instanceof Error ? error.message : String(error) })
    }
  }

  /** Ask the operating system to open the checksum-verified installer. */
  async openInstaller(): Promise<void> {
    try {
      const result = await this.bridge.releases.openInstaller()
      if (result.error !== '') this.#publish({ error: result.error })
    } catch (error) {
      this.#publish({ error: error instanceof Error ? error.message : String(error) })
    }
  }
}

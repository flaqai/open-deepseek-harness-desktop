/** Reactive owner of desktop bridge snapshots and operations. */

import type {
  CloseBehavior, DesktopBridge, DesktopCapabilities, DesktopCliStatus, DesktopDataHomeStatus, DesktopPreferences,
  DesktopReleaseDownloadStatus, DesktopReleaseStatus,
  DesktopWebStatus,
} from './bridge.ts'
import { readDesktopLocalShell } from './bridge.ts'
import { DownloadNetworkProjection } from './download-network-projection.ts'

/** Immutable renderer state shared by the desktop settings and footer action. */
export interface DesktopShellSnapshot {
  menuDestination?: 'data-home' | 'updates' | 'download-network' | undefined
  capabilities: DesktopCapabilities | null
  preferences: DesktopPreferences | null
  release: DesktopReleaseStatus
  simulatedReleaseAvailable: boolean
  releaseDownload: DesktopReleaseDownloadStatus
  commandLine: DesktopCliStatus | null
  dataHome: DesktopDataHomeStatus | null
  desktopWeb: DesktopWebStatus
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
    desktopWeb: { phase: 'starting' },
    restartPending: false,
    busy: false,
    error: null,
  }
  readonly #listeners = new Set<() => void>()
  #disposers: (() => void)[] = []
  #downloadRequest: Promise<void> | undefined
  #downloadRevision = 0
  /** Renderer-owned projection for desktop download-routing settings. */
  readonly downloadNetwork: DownloadNetworkProjection | undefined

  constructor(private readonly bridge: DesktopBridge) {
    this.downloadNetwork = bridge.downloadNetwork === undefined
      ? undefined
      : new DownloadNetworkProjection(bridge.downloadNetwork)
  }

  /** Queue or consume a native-menu destination after General Settings mounts.
   * @param destination - Existing panel to reveal, or undefined to consume the request.
   */
  navigate(destination?: 'data-home' | 'updates' | 'download-network'): void { this.#publish({ menuDestination: destination }) }

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
    const downloadRevision = this.#downloadRevision
    this.#disposers = [
      this.bridge.shell.onPreferences((preferences) => { this.#publish({ preferences }) }),
      this.bridge.releases.onStatus((release) => { this.#publish({ release }) }),
      this.bridge.releases.onDownloadStatus((releaseDownload) => { this.#downloadRevision++; this.#publish({ releaseDownload }) }),
      this.bridge.desktopWeb.onStatus((desktopWeb) => { this.#publish({ desktopWeb }) }),
    ]
    this.downloadNetwork?.start()
    void Promise.all([
      this.bridge.shell.getCapabilities(),
      this.bridge.shell.getPreferences(),
      this.bridge.releases.getStatus(),
      this.bridge.releases.getDownloadStatus(),
    ]).then(async ([capabilities, preferences, release, releaseDownload]) => {
      const [commandLine, dataHome, desktopWeb] = capabilities.runtimeKind === 'nas'
        ? [null, null, { phase: 'error' as const, message: 'Open the paired NAS HTTPS address in a browser.' }]
        : await this.#readLocalStartupState()
      this.#publish({ capabilities, preferences, release,
        ...(downloadRevision === this.#downloadRevision ? { releaseDownload } : {}), commandLine, dataHome, desktopWeb })
    }).catch((error: unknown) => {
      this.#publish({ error: error instanceof Error ? error.message : String(error) })
    })
  }

  async #readLocalStartupState(): Promise<[DesktopCliStatus, DesktopDataHomeStatus, DesktopWebStatus]> {
    const shell = this.#requireLocalShell()
    return Promise.all([shell.getCommandLine(), shell.getDataHome(), this.bridge.desktopWeb.getStatus()])
  }

  #requireLocalShell() {
    const shell = readDesktopLocalShell(this.bridge.shell)
    if (shell === undefined) throw new Error('desktop: local shell capabilities are unavailable')
    return shell
  }

  /** Remove bridge subscriptions and local observers. */
  dispose(): void {
    this.downloadNetwork?.dispose()
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
  /** Enable or disable opening the local Web interface after each Harness start.
   * @param enabled - Desired automatic browser handoff.
   */
  setOpenBrowserOnStartup(enabled: boolean): void { void this.setPreference({ openBrowserOnStartup: enabled }) }

  /** Open the current Harness generation in the system browser. */
  async openDesktopWeb(): Promise<void> {
    this.#publish({ error: null })
    try { await this.bridge.desktopWeb.open() } catch (error) {
      this.#publish({ error: error instanceof Error ? error.message : String(error) })
    }
  }

  /** Install or repair the packaged desktop `dsh` command.
   * @param force - whether a detected non-owned command may be shadowed.
   */
  async installCommandLine(force = false): Promise<void> {
    this.#publish({ busy: true, error: null })
    try {
      this.#publish({ commandLine: await this.#requireLocalShell().installCommandLine(force) })
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
      this.#publish({ commandLine: await this.#requireLocalShell().removeCommandLine() })
    } catch (error) {
      this.#publish({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      this.#publish({ busy: false })
    }
  }

  /** Open the existing startup-recovery page from a source build. */
  async enterRecoveryMode(): Promise<void> {
    this.#publish({ busy: true, error: null })
    try {
      await this.#requireLocalShell().enterRecoveryMode()
    } catch (error) {
      this.#publish({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      this.#publish({ busy: false })
    }
  }

  /** Open the shared data-import chooser without changing the active configuration on return. */
  async openDataHomeChooser(): Promise<void> {
    this.#publish({ busy: true, error: null })
    try {
      const result = await this.#requireLocalShell().openDataHomeChooser()
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
  downloadRelease(): Promise<void> {
    if (this.#downloadRequest !== undefined) return this.#downloadRequest
    if (['resolving', 'switching', 'downloading', 'verifying', 'ready'].includes(this.#snapshot.releaseDownload.phase)) {
      return Promise.resolve()
    }
    this.#publish({ error: null })
    const downloadRevision = this.#downloadRevision
    this.#downloadRequest = this.bridge.releases.startDownload().then((releaseDownload) => {
      if (downloadRevision === this.#downloadRevision) this.#publish({ releaseDownload })
    }, (error: unknown) => {
      if (downloadRevision === this.#downloadRevision) {
        this.#publish({ error: error instanceof Error ? error.message : String(error) })
      }
    }).finally(() => { this.#downloadRequest = undefined })
    return this.#downloadRequest
  }

  /** Explicitly move an update retry to the other configured source. */
  async switchReleaseSource(): Promise<void> {
    const network = this.downloadNetwork
    if (network === undefined) return
    this.#publish({ busy: true, error: null })
    try {
      await network.switchApplicationSource()
      this.#publish({
        releaseDownload: { phase: 'idle' },
        release: await this.bridge.releases.check(),
      })
    } catch (error) {
      this.#publish({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      this.#publish({ busy: false })
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

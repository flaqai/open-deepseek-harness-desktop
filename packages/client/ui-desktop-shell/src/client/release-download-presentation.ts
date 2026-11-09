/** Shared update visibility across settings and sidebar controls. */
import type { DesktopReleaseDownloadStatus, DesktopReleaseStatus } from './bridge.ts'

/**
 * Preserve the main-process download while release discovery is temporarily checking or unavailable.
 * @param release - Latest metadata observation.
 * @param download - Main-process transfer or verified installer state.
 * @returns Matching ongoing state, or idle when a confirmed release supersedes it.
 */
export function selectedReleaseDownload(
  release: DesktopReleaseStatus, download: DesktopReleaseDownloadStatus,
): DesktopReleaseDownloadStatus {
  if (!('version' in download)) return download
  if (release.phase === 'available') return download.version === release.latestVersion ? download : { phase: 'idle' }
  if (release.phase === 'current' || release.phase === 'unsupported') return { phase: 'idle' }
  return download
}

/**
 * Project a compact translation key without hiding transfer state behind transient metadata checks.
 * @param download - Selected main-process download state.
 * @returns A progress, verification or installation-ready label, otherwise undefined.
 */
export function releaseDownloadLabel(download: DesktopReleaseDownloadStatus):
'release.background.downloading' | 'release.background.verifying' | 'release.background.ready' | undefined {
  if (['resolving', 'switching', 'downloading'].includes(download.phase)) return 'release.background.downloading'
  if (download.phase === 'verifying') return 'release.background.verifying'
  if (download.phase === 'ready') return 'release.background.ready'
  return undefined
}

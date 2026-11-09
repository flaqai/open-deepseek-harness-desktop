/** Compact, non-modal update progress at the bottom trailing corner of the desktop frame. */
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopShellSnapshot } from './controller.ts'
import { releaseDownloadLabel, selectedReleaseDownload } from './release-download-presentation.ts'
import css from './DesktopDownloadProgress.module.css'

/** Frame-scoped download state and explicit navigation; no installer or Agent operations. */
export interface DesktopDownloadProgressInjected {
  hooks: { desktopUpdate: HostObservable<DesktopShellSnapshot> }
  openUpdates(): void
}

export type DesktopDownloadProgressProps = PropsRuntime<'shell.overlay'> & PropsLocale<'desktop-shell'>
  & InjectFace<DesktopDownloadProgressInjected>

/** Show real download progress across navigation; clicking only opens update settings. */
export function DesktopDownloadProgress({ useDesktopUpdate, openUpdates, t }: DesktopDownloadProgressProps) {
  const state = useDesktopUpdate(value => value)
  const download = selectedReleaseDownload(state.release, state.releaseDownload)
  const key = releaseDownloadLabel(download)
  if (key === undefined) return null
  const percent = download.phase === 'downloading' && download.totalBytes > 0
    ? Math.min(100, Math.max(0, Math.floor(download.transferredBytes / download.totalBytes * 100))) : undefined
  const ready = download.phase === 'ready'
  const label = t(key)
  return <button type="button" className={css.indicator} onClick={openUpdates} title={label} aria-label={label}>
    <span className={css.label}>{label}</span>
    {ready ? <span aria-hidden="true">✓</span> : <>
      <progress className={css.progress} aria-label={t('release.download.progressLabel')}
        max={100} value={percent} />
      {percent !== undefined && <span className={css.percent}>{percent}%</span>}
    </>}
  </button>
}

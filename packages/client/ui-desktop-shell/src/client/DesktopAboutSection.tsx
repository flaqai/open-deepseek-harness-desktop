/** Community identity, release controls and feedback in one Desktop settings page. */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CommunityFeedbackBridge, CommunityFeedbackInput } from './bridge.ts'
import { DEVELOPMENT_RELEASE_VERSION, type DesktopShellController } from './controller.ts'
import type { DownloadNetworkProjection } from './download-network-projection.ts'
import { DownloadNetworkSettings } from './DownloadNetworkSettings.tsx'
import css from './DesktopShell.module.css'

export type DesktopAboutSectionProps = PropsRuntime<'settings.section'> & PropsLocale<'desktop-shell'> & {
  controller: DesktopShellController
  feedback: CommunityFeedbackBridge | undefined
  downloadNetwork: DownloadNetworkProjection | undefined
  openLink: (kind: 'github' | 'cnb' | 'issues') => Promise<void>
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

/** About section for the community desktop; the existing controller still owns update actions. */
export function DesktopAboutSection({ controller, feedback, downloadNetwork, openLink, t }: DesktopAboutSectionProps) {
  const subscribe = useCallback((listener: () => void) => controller.subscribe(listener), [controller])
  const getSnapshot = useCallback(() => controller.getSnapshot(), [controller])
  const state = useSyncExternalStore(subscribe, getSnapshot)
  const updateRow = useRef<HTMLElement>(null)
  useEffect(() => {
    if (state.capabilities === null || state.menuDestination !== 'updates') return
    let secondFrame = 0
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        updateRow.current?.scrollIntoView({ block: 'center' })
        controller.navigate()
      })
    })
    return () => {
      window.cancelAnimationFrame(firstFrame)
      if (secondFrame !== 0) window.cancelAnimationFrame(secondFrame)
    }
  }, [controller, state.capabilities, state.menuDestination])
  if (state.capabilities === null) return null
  const release = state.release
  const releaseDownload = state.releaseDownload
  const releaseText = release.phase === 'unsupported'
    ? state.simulatedReleaseAvailable
      ? t('release.developmentAvailable', { version: DEVELOPMENT_RELEASE_VERSION })
      : t('release.developmentCurrent')
    : release.phase === 'checking' ? t('release.checking')
      : release.phase === 'available' ? t('release.available', { version: release.latestVersion })
        : release.phase === 'current' ? t('release.current') : t('release.error')
  const selectedDownload = release.phase === 'available' && 'version' in releaseDownload
    && releaseDownload.version === release.latestVersion ? releaseDownload
    : releaseDownload.phase === 'idle' || releaseDownload.phase === 'unsupported' ? releaseDownload : { phase: 'idle' as const }
  const downloadActive = selectedDownload.phase === 'resolving' || selectedDownload.phase === 'switching'
    || selectedDownload.phase === 'downloading' || selectedDownload.phase === 'verifying'
  const downloadText = selectedDownload.phase === 'resolving' ? t('release.download.resolving')
    : selectedDownload.phase === 'switching' ? t(selectedDownload.resumeFromBytes === 0 && selectedDownload.transferredBytes > 0
      ? 'release.download.restarting' : 'release.download.switching')
      : selectedDownload.phase === 'downloading' ? t('release.download.progress', {
        percent: selectedDownload.percent, transferred: formatBytes(selectedDownload.transferredBytes),
        total: formatBytes(selectedDownload.totalBytes),
      })
        : selectedDownload.phase === 'verifying' ? t('release.download.verifying')
          : selectedDownload.phase === 'ready' ? t('release.download.ready', { file: selectedDownload.fileName })
            : selectedDownload.phase === 'cancelled' ? t('release.download.cancelled')
              : selectedDownload.phase === 'error' ? t('release.download.error', { message: selectedDownload.message }) : null
  const installerDownloadSupported = state.capabilities.packaged
    && (state.capabilities.platform === 'darwin' || state.capabilities.platform === 'win32')
  return <div className={css.group}>
    <section className={css.aboutIntro}>
      <h2>{t('about.title')}</h2>
      <p>{t('about.description')}</p>
      <p>{t('about.version', { version: state.capabilities.desktopVersion })}</p>
      <p>{t('about.harnessVersion', { version: process.env.DSH_CLIENT_VERSION ?? '—' })}</p>
      <div className={css.aboutLinks}>
        <Button variant="outline" onClick={() => { void openLink('github') }}>{t('about.github')}</Button>
        <Button variant="outline" onClick={() => { void openLink('cnb') }}>{t('about.cnb')}</Button>
      </div>
    </section>
    <section ref={updateRow} aria-labelledby="desktop-release-settings-title">
      {downloadNetwork !== undefined && <DownloadNetworkSettings projection={downloadNetwork} t={t} scope="application" />}
      <div className={`${css.row} ${css.aboutUpdateRow}`}>
        <div className={css.text}>
          <div id="desktop-release-settings-title" className={css.title}>{t('release.title')}</div>
          <div className={release.phase === 'error' ? css.error : css.description}>{releaseText}</div>
          {release.phase === 'available' && state.capabilities.platform === 'darwin' && state.capabilities.packaged
            && <div className={css.description}>{t('release.macosInstallHint')}</div>}
          {release.phase === 'available' && downloadText !== null
            && <div className={selectedDownload.phase === 'error' ? css.error : css.description}>{downloadText}</div>}
          {selectedDownload.phase === 'downloading' && <progress className={css.progress}
            aria-label={t('release.download.progressLabel')} value={selectedDownload.transferredBytes}
            max={selectedDownload.totalBytes} />}
        </div>
        <div className={css.actions}>
          {release.phase === 'unsupported' ? <Button variant={state.simulatedReleaseAvailable ? 'primary' : 'outline'}
            onClick={() => { controller.toggleSimulatedRelease() }}>
            {t(state.simulatedReleaseAvailable ? 'release.developmentOpen' : 'release.check')}
          </Button> : <>
            <Button variant="outline" disabled={release.phase === 'checking' || downloadActive}
              onClick={() => { void controller.checkRelease() }}>{t('release.check')}</Button>
            {selectedDownload.phase === 'error' && release.phase === 'available' && controller.downloadNetwork !== undefined
              && <Button variant="outline" disabled={state.busy} onClick={() => { void controller.switchReleaseSource() }}>
                {t('release.download.switchSource')}</Button>}
            {release.phase === 'available' && (installerDownloadSupported
              ? selectedDownload.phase === 'ready'
                ? <Button variant="primary" onClick={() => { void controller.openInstaller() }}>{t('release.download.open')}</Button>
                : downloadActive
                  ? <Button variant="outline" onClick={() => { void controller.cancelReleaseDownload() }}>{t('release.download.cancel')}</Button>
                  : <Button variant="primary" onClick={() => { void controller.downloadRelease() }}>
                    {t(selectedDownload.phase === 'error' || selectedDownload.phase === 'cancelled'
                      ? 'release.download.retry' : 'release.download.start')}</Button>
              : <Button variant="primary" onClick={() => { void controller.openRelease() }}>{t('release.open')}</Button>)}
          </>}
        </div>
      </div>
    </section>
    <FeedbackForm feedback={feedback} openIssues={() => openLink('issues')} t={t} />
    {state.error !== null && <div className={css.error} role="alert">{state.error}</div>}
  </div>
}

function FeedbackForm({ feedback, openIssues, t }: {
  feedback: CommunityFeedbackBridge | undefined
  openIssues: () => Promise<void>
  t: DesktopAboutSectionProps['t']
}) {
  const [enabled, setEnabled] = useState(false)
  const [kind, setKind] = useState<CommunityFeedbackInput['kind']>('bug')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [replyEmail, setReplyEmail] = useState('')
  const [phase, setPhase] = useState<'idle' | 'sending' | 'received' | 'rate-limited' | 'failed'>('idle')
  const [mailFailed, setMailFailed] = useState(false)
  const [mailOpened, setMailOpened] = useState(false)
  const requestId = useRef(randomUUID())
  const changeDraft = (): void => { requestId.current = randomUUID(); setPhase('idle') }
  useEffect(() => {
    let live = true
    void feedback?.status().then((status) => { if (live) setEnabled(status.enabled) }, () => { if (live) setEnabled(false) })
    return () => { live = false }
  }, [feedback])
  const draft = (): Omit<CommunityFeedbackInput, 'requestId'> => ({ kind, title, body,
    ...(replyEmail === '' ? {} : { replyEmail }) })
  const valid = title.trim().length >= 3 && title.length <= 120 && body.trim().length >= 10 && body.length <= 4_000
    && (replyEmail === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(replyEmail))
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!enabled || !valid || feedback === undefined || phase === 'sending' || phase === 'received') return
    setPhase('sending')
    void feedback.submit({ ...draft(), requestId: requestId.current }).then((result) => {
      setPhase(result.status === 'unavailable' ? 'failed' : result.status)
      if (result.status === 'received') requestId.current = randomUUID()
    }, () => { setPhase('failed') })
  }
  return <section className={css.feedbackSection} aria-labelledby="community-feedback-title">
    <h2 id="community-feedback-title">{t('about.feedback.title')}</h2>
    <p className={css.description}>{t('about.feedback.description')}</p>
    <form onSubmit={submit} className={css.feedbackForm}>
      <label>{t('about.feedback.kind')}<select value={kind} disabled={phase === 'sending'} onChange={(event) => { setKind(event.target.value as CommunityFeedbackInput['kind']); changeDraft() }}>
        <option value="bug">{t('about.feedback.kind.bug')}</option>
        <option value="idea">{t('about.feedback.kind.idea')}</option>
        <option value="other">{t('about.feedback.kind.other')}</option>
      </select></label>
      <label>{t('about.feedback.subject')}<input value={title} maxLength={120} required minLength={3} disabled={phase === 'sending'}
        onChange={(event) => { setTitle(event.target.value); changeDraft() }} /></label>
      <label>{t('about.feedback.body')}<textarea value={body} maxLength={4_000} required minLength={10} rows={4} disabled={phase === 'sending'}
        onChange={(event) => { setBody(event.target.value); changeDraft() }} /></label>
      <label>{t('about.feedback.email')}<input type="email" autoComplete="email" value={replyEmail} maxLength={254} disabled={phase === 'sending'}
        onChange={(event) => { setReplyEmail(event.target.value); changeDraft() }} /></label>
      <p className={css.description}>{t('about.feedback.privacy')}</p>
      {!enabled && <p className={css.description} role="status">{t('about.feedback.unavailable')}</p>}
      {phase !== 'idle' && <p className={phase === 'failed' || phase === 'rate-limited' ? css.error : css.description}
        role={phase === 'failed' ? 'alert' : 'status'}>{t(`about.feedback.${phase}`)}</p>}
      <div className={css.aboutLinks}>
        {enabled && <Button type="submit" disabled={!valid || phase === 'sending' || phase === 'received'}>{t('about.feedback.submit')}</Button>}
        <Button type="button" variant={enabled ? 'outline' : 'primary'} disabled={feedback === undefined} onClick={() => {
          setMailFailed(false)
          setMailOpened(false)
          void feedback?.openMail(draft()).then(() => { setMailOpened(true) }, () => { setMailFailed(true) })
        }}>{t('about.feedback.mail')}</Button>
        <Button type="button" variant="outline" onClick={() => { void openIssues() }}>{t('about.feedback.issues')}</Button>
      </div>
      {mailFailed && <p className={css.error} role="alert">{t('about.feedback.mailFailed')}</p>}
      {mailOpened && <p className={css.description} role="status">{t('about.feedback.mailOpened')}</p>}
    </form>
    <p className={css.description}>{t('about.feedback.address', { address: 'odsh_hecoococ@163.com' })}</p>
    <p className={css.description}>{t('about.feedback.noReply')}</p>
  </section>
}

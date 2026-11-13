/** Root overlay showing one Session export at a time in initiation order. */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SessionLogDownloadState } from './controller.ts'
import { NS } from './locales.ts'

/** Download state and dismissal bound into the root overlay entry. */
export interface SessionLogDownloadDialogInjected {
  hooks: {
    sessionLogDownload: ObservableSnapshot<SessionLogDownloadState>
    /** Whether this Peer may export the current Session's raw diagnostic log. */
    downloadAllowed: ObservableSnapshot<boolean>
  }
  dismiss: (sessionId: SessionId) => void
  setIncludeCustomInstructions: (sessionId: SessionId, include: boolean) => void
  setRemember: (sessionId: SessionId, remember: boolean) => void
  confirm: (sessionId: SessionId) => Promise<void>
}

/** Root runtime, localized copy, and injected download state and actions. */
export type SessionLogDownloadDialogProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<typeof NS>
  & InjectFace<SessionLogDownloadDialogInjected>

/**
 * Show the earliest open export independently of the displayed conversation.
 * @param props - root runtime, bound controller state, dismissal, and localized copy.
 * @returns one modal, or null when all exports are dismissed.
 */
export function SessionLogDownloadDialog({
  useSessionLogDownload, useDownloadAllowed, dismiss, setIncludeCustomInstructions, setRemember, confirm, t,
}: SessionLogDownloadDialogProps) {
  const allowed = useDownloadAllowed(value => value)
  const bySession = useSessionLogDownload(state => state.bySession)
  const pending = Object.entries(bySession)
    .filter((pair): pair is [string, NonNullable<typeof pair[1]>] => pair[1]?.open === true)
    .sort((a, b) => a[1].order - b[1].order)[0]
  if (pending === undefined) return null
  const [id, entry] = pending
  const sessionId = id as SessionId
  const { status } = entry
  const title = status === 'confirming' ? t('dialog.privacyTitle') : status === 'downloading'
    ? t('dialog.preparingTitle')
    : status === 'success' ? t('dialog.successTitle') : t('dialog.errorTitle')
  const description = status === 'confirming' ? t('dialog.privacyDescription') : status === 'downloading'
    ? t('dialog.preparingDescription')
    : status === 'success' ? t('dialog.successDescription') : entry.error || t('dialog.commandFailed')

  if (!allowed) return null
  return (
    <Modal
      open
      onClose={() => { dismiss(sessionId) }}
      title={title}
      description={`${t('dialog.session', { sessionId })} ${description}`}
      closeLabel={t('dialog.close')}
      footer={status === 'confirming'
        ? (
          <>
            <Button variant="outline" onClick={() => { dismiss(sessionId) }}>{t('dialog.cancel')}</Button>
            <Button variant="primary" onClick={() => { void confirm(sessionId) }}>{t('dialog.export')}</Button>
          </>
        )
        : <Button variant="primary" onClick={() => { dismiss(sessionId) }}>{t('dialog.close')}</Button>}
    >
      {status === 'confirming' && (
        <div>
          <label>
            <input
              type="checkbox"
              checked={entry.includeCustomInstructions === true}
              onChange={(event) => { setIncludeCustomInstructions(sessionId, event.currentTarget.checked) }}
            />
            {t('dialog.includeCustomInstructions')}
          </label>
          <label>
            <input
              type="checkbox"
              checked={entry.remember === true}
              onChange={(event) => { setRemember(sessionId, event.currentTarget.checked) }}
            />
            {t('dialog.rememberChoice')}
          </label>
          {entry.includeCustomInstructions === true && entry.remember === true && (
            <p role="alert">{t('dialog.includeRememberWarning')}</p>
          )}
        </div>
      )}
    </Modal>
  )
}

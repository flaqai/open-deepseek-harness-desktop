import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionLogDownloadState } from './controller.ts'
import { NS } from './locales.ts'

/** Browser operations and state injected into the Session Header contribution. */
export interface SessionLogDownloadDialogInjected {
  hooks: {
    sessionLogDownload: ObservableSnapshot<SessionLogDownloadState>
    /** Whether this Peer may export the current Session's raw diagnostic log. */
    downloadAllowed: ObservableSnapshot<boolean>
  }
  request: (sessionId: SessionId) => Promise<void>
  dismiss: (sessionId: SessionId) => void
  setIncludeCustomInstructions: (sessionId: SessionId, include: boolean) => void
  setRemember: (sessionId: SessionId, remember: boolean) => void
  confirm: (sessionId: SessionId) => Promise<void>
}

export type SessionLogDownloadDialogProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<typeof NS>
  & InjectFace<SessionLogDownloadDialogInjected>

/**
 * Modal shared by the Session Header download menu item and this browser's `/export` command.
 * @param props - Session runtime, bound controller state, actions, and localized copy.
 * @returns the modal portal contribution.
 */
export function SessionLogDownloadDialog({
  sessionId, useSessionLogDownload, useDownloadAllowed, dismiss, setIncludeCustomInstructions, setRemember, confirm, t,
}: SessionLogDownloadDialogProps) {
  const entry = useSessionLogDownload(state => state.bySession[String(sessionId)])
  const allowed = useDownloadAllowed(value => value)

  const status = entry?.status
  const open = entry?.open === true
  const error = status === 'error' ? entry?.error || t('dialog.commandFailed') : null
  const title = status === 'confirming'
    ? t('dialog.privacyTitle')
    : status === 'downloading'
      ? t('dialog.preparingTitle')
      : status === 'success' ? t('dialog.successTitle') : t('dialog.errorTitle')
  const description = status === 'confirming'
    ? t('dialog.privacyDescription')
    : status === 'downloading'
      ? t('dialog.preparingDescription')
      : status === 'success' ? t('dialog.successDescription') : error ?? t('dialog.commandFailed')

  if (!allowed) return null
  return (
    <Modal
      open={open}
      onClose={() => { dismiss(sessionId) }}
      title={title}
      description={description}
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
              checked={entry?.includeCustomInstructions === true}
              onChange={(event) => { setIncludeCustomInstructions(sessionId, event.currentTarget.checked) }}
            />
            {t('dialog.includeCustomInstructions')}
          </label>
          <label>
            <input
              type="checkbox"
              checked={entry?.remember === true}
              onChange={(event) => { setRemember(sessionId, event.currentTarget.checked) }}
            />
            {t('dialog.rememberChoice')}
          </label>
          {entry?.includeCustomInstructions === true && entry.remember === true && (
            <p role="alert">{t('dialog.includeRememberWarning')}</p>
          )}
        </div>
      )}
    </Modal>
  )
}

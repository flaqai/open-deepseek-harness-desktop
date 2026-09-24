import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { ConversationHeaderMenuContribution } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { Button, IconDownloadOutlineRegular, IconEllipsisOutlineRegular, IconPaperPlaneOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import { SessionLogDownloadDialog, type SessionLogDownloadDialogProps } from './Dialog.tsx'
import type { SessionLogDownloadDialogInjected } from './Dialog.tsx'
import css from './HeaderAction.module.css'

type RegisteredMenuContribution = ConversationHeaderMenuContribution & { readonly token: symbol }

const RESERVED_MENU_IDS = new Set(['download', 'feedback', 'extension-separator'])

/** Session download controls with observable feedback availability and a Session feedback action. */
export interface SessionLogDownloadHeaderInjected extends SessionLogDownloadDialogInjected {
  hooks: SessionLogDownloadDialogInjected['hooks'] & { feedbackAvailable: ObservableSnapshot<boolean> }
  /**
   * Open the existing Session feedback draft without recording feedback; no-op after the feedback plugin unloads.
   * @param sessionId - Session whose feedback form to open.
   */
  openFeedback: (sessionId: SessionId) => void
}

/** Session download props plus the optional feedback action. */
export type SessionLogDownloadHeaderProps = SessionLogDownloadDialogProps
  & InjectFace<SessionLogDownloadHeaderInjected>
  & PropsRenderSlots<'conversation.session.header.menu.item'>

/**
 * Render the Session Header menu with download and optional feedback actions.
 * @param props - Session runtime, download controller, and localized copy.
 * @returns the persistent Header action and Session-scoped dialog.
 */
export function SessionLogDownloadHeaderAction(props: SessionLogDownloadHeaderProps): ReactNode {
  const { sessionId, useSessionLogDownload, useFeedbackAvailable, request, openFeedback, renderSlot, t } = props
  const feedbackAvailable = useFeedbackAvailable(value => value)
  const entry = useSessionLogDownload(state => state.bySession[String(sessionId)])
  const busy = entry?.status === 'downloading'
  const [open, setOpen] = useState(false)
  const [menuContributions, setMenuContributions] = useState<ReadonlyMap<string, RegisteredMenuContribution>>(new Map())

  const registerMenuItem = useCallback((contribution: ConversationHeaderMenuContribution): (() => void) => {
    const ids = [contribution.item.id, ...(contribution.item.submenu?.map(item => item.id) ?? [])]
    if (contribution.item.id !== contribution.id
      || new Set(ids).size !== ids.length
      || ids.some(id => RESERVED_MENU_IDS.has(id))) return () => {}
    const token = Symbol(contribution.id)
    setMenuContributions(current => new Map(current).set(contribution.id, { ...contribution, token }))
    return () => {
      setMenuContributions((current) => {
        if (current.get(contribution.id)?.token !== token) return current
        const next = new Map(current)
        next.delete(contribution.id)
        return next
      })
    }
  }, [])

  const extensions = useMemo(() => [...menuContributions.values()].sort((left, right) => (
    (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id)
  )), [menuContributions])

  return (
    <>
      <Menu
        open={open}
        align="end"
        dense
        onClose={() => { setOpen(false) }}
        items={[
          { id: 'download', label: t('menu.download'), icon: <IconDownloadOutlineRegular />, disabled: busy },
          ...feedbackAvailable ? [{ id: 'feedback', label: t('menu.feedback'), icon: <IconPaperPlaneOutlineRegular /> }] : [],
          ...(extensions.length === 0 ? [] : [
            { type: 'separator' as const, id: 'extension-separator' },
            ...extensions.map(extension => extension.item),
          ]),
        ]}
        onSelect={(id) => {
          setOpen(false)
          if (id === 'download') {
            void request(sessionId)
            return
          }
          if (id === 'feedback') {
            if (feedbackAvailable) openFeedback(sessionId)
            return
          }
          const matches = extensions.filter(candidate => (
            candidate.item.id === id || candidate.item.submenu?.some(item => item.id === id) === true
          ))
          if (matches.length === 1) matches[0]?.onSelect(id)
        }}
        anchor={(
          <Button
            size="sm"
            className={css.moreButton}
            aria-label={t('header.more')}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-busy={busy}
            onClick={() => { setOpen(value => !value) }}
          >
            <IconEllipsisOutlineRegular />
          </Button>
        )}
      />
      {renderSlot('conversation.session.header.menu.item', { registerMenuItem })}
      <SessionLogDownloadDialog {...props} />
    </>
  )
}

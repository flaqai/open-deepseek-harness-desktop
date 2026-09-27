/** Compact transcript, history, and session controls in the floating window. */

import { useEffect, useRef, useState } from 'react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './OverlayChatRoot.module.css'

/** Callbacks projected from the existing Workspace navigation service. */
export interface OverlayChatInjected {
  startSession(): void
  openSession(id: SessionListState['ids'][number]): void
  collapse(): void
  openMain(): void
  onSelectionText?(callback: (text: string) => void): () => void
  insertSelection(text: string): boolean
}

/** Full framework-derived props for the overlay root. */
export type OverlayChatRootProps = PropsRuntime<'root'>
  & PropsRenderSlots<'main'>
  & PropsLocale<'orbChat'>
  & InjectFace<OverlayChatInjected>

/** Render one Session from the existing Client model without a parallel transcript store.
 * @param props - Root hooks, slot renderers, locale, and callbacks.
 * @returns Compact chat window.
 */
export function OverlayChatRoot({
  renderSlot, useSessions, t, startSession, openSession, collapse, openMain,
  onSelectionText, insertSelection,
}: OverlayChatRootProps) {
  const list = useSessions(state => state)
  const sessionId = list.ids.find(id => (list.byId[id]?.retainedBy.mainView ?? 0) > 0)
  const recent = list.ids.filter(id => list.byId[id]?.origin !== 'subagent').slice(0, 80)
  const running = recent.filter(id => list.byId[id]?.running).length
  const [pendingSelection, setPendingSelection] = useState<string | undefined>()
  const startingSession = useRef(false)
  useEffect(() => { if (sessionId !== undefined) startingSession.current = false }, [sessionId])
  useEffect(() => onSelectionText?.((text) => {
    if (text.trim() === '') return
    if (sessionId !== undefined && insertSelection(text)) return
    setPendingSelection(previous => previous === undefined ? text : `${previous}\n${text}`)
    if (sessionId === undefined && !startingSession.current) {
      startingSession.current = true
      startSession()
    }
  }), [onSelectionText, insertSelection, sessionId, startSession])
  useEffect(() => {
    if (pendingSelection !== undefined && sessionId !== undefined && insertSelection(pendingSelection)) {
      setPendingSelection(undefined)
    }
  }, [insertSelection, list, pendingSelection, sessionId])
  return (
    <main className={css.shell} data-overlay-chat="">
      <header className={css.header}>
        <span className={css.title}>{t('title')}</span>
        <button className={css.action} type="button" onClick={startSession}>{t('new')}</button>
        <button className={css.action} type="button" onClick={openMain}>{t('openMain')}</button>
        <button className={css.action} type="button" onClick={collapse}>{t('collapse')}</button>
      </header>
      <p className={css.activity} role="status">{running > 0 ? t('running', { count: running }) : t('idle')}</p>
      {pendingSelection !== undefined && <div className={css.selectionNotice} role="status"><span>{t('selectionPending')}</span><button className={css.action} type="button" onClick={() => { if (insertSelection(pendingSelection)) setPendingSelection(undefined) }}>{t('insertSelection')}</button></div>}
      <select
        className={css.history}
        aria-label={t('history')}
        value={sessionId ?? ''}
        onChange={(event) => {
          const id = recent.find(candidate => candidate === event.currentTarget.value)
          if (id !== undefined) openSession(id)
        }}
      >
        <option value="">{t('history')}</option>
        {recent.map(id => <option key={id} value={id}>{list.byId[id]?.displayTitle ?? t('untitled')}{list.byId[id]?.running ? ` · ${t('runningShort')}` : ''}</option>)}
      </select>
      <div className={css.conversation} data-conversation-scroll="">
        {renderSlot('main', {}, { entryKey: 'conversation' })}
      </div>
    </main>
  )
}

/** Compact transcript, history, and session controls in the floating window. */

import { useEffect, useRef, useState } from 'react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './OverlayChatRoot.module.css'
import type { OrbBackgroundClient, OrbBackgroundWorker } from './orb-background-client.ts'

/** Callbacks projected from the existing Workspace navigation service. */
export interface OverlayChatInjected {
  startSession(): void
  openSession(id: SessionListState['ids'][number]): void
  /** Desktop ensures and returns the Host-owned Session; the Client cannot claim ownership. */
  ensureCallerSession?(): Promise<string>
  collapse(): void
  openMain(): void
  onSelectionText?(callback: (text: string) => void): () => void
  insertSelection(text: string): boolean
  /** Available only after the local Host confirms its background route. */
  backgroundTasks?: OrbBackgroundClient
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
/* oxlint-disable typescript/unbound-method -- Framework callback props do not use `this`. */
export function OverlayChatRoot({
  renderSlot, useSessions, t, startSession, openSession, collapse, openMain,
  onSelectionText, insertSelection, ensureCallerSession, backgroundTasks,
}: OverlayChatRootProps) {
  /* oxlint-enable typescript/unbound-method */
  const list = useSessions(state => state)
  const sessionId = list.ids.find(id => (list.byId[id]?.retainedBy.mainView ?? 0) > 0)
  const recent = list.ids.filter(id => list.byId[id]?.origin !== 'subagent').slice(0, 80)
  const running = recent.filter(id => list.byId[id]?.running).length
  const [pendingSelection, setPendingSelection] = useState<string | undefined>()
  const [backgroundPhase, setBackgroundPhase] = useState<'checking' | 'available' | 'unavailable' | 'error'>('checking')
  const [workers, setWorkers] = useState<readonly OrbBackgroundWorker[]>([])
  const [task, setTask] = useState('')
  const [backgroundBusy, setBackgroundBusy] = useState(false)
  const [backgroundNeedsRefresh, setBackgroundNeedsRefresh] = useState(false)
  const [backgroundMessage, setBackgroundMessage] = useState('')
  const startingSession = useRef(false)
  const manualNavigation = useRef(0)
  const openSessionRef = useRef(openSession)
  openSessionRef.current = openSession
  const currentSelection = useRef(sessionId)
  currentSelection.current = sessionId
  useEffect(() => {
    if (ensureCallerSession === undefined) return
    const selectedBeforeEnsure = currentSelection.current
    const navigationBeforeEnsure = manualNavigation.current
    let cancelled = false
    void ensureCallerSession().then((ownedId) => {
      // A user selecting history while the Host answers always wins.
      if (!cancelled && currentSelection.current === selectedBeforeEnsure
        && manualNavigation.current === navigationBeforeEnsure) {
        openSessionRef.current(ownedId as SessionListState['ids'][number])
      }
    }).catch((error: unknown) => { console.warn('floating chat: owned Session unavailable', error) })
    return () => { cancelled = true }
  }, [ensureCallerSession])
  useEffect(() => { if (sessionId !== undefined) startingSession.current = false }, [sessionId])
  useEffect(() => onSelectionText?.((text) => {
    if (text.trim() === '') return
    if (sessionId !== undefined && insertSelection(text)) return
    setPendingSelection(previous => previous === undefined ? text : `${previous}\n${text}`)
    if (sessionId === undefined && ensureCallerSession === undefined && !startingSession.current) {
      startingSession.current = true
      startSession()
    }
  }), [onSelectionText, insertSelection, sessionId, startSession, ensureCallerSession])
  useEffect(() => {
    if (pendingSelection !== undefined && sessionId !== undefined && insertSelection(pendingSelection)) {
      setPendingSelection(undefined)
    }
  }, [insertSelection, list, pendingSelection, sessionId])
  useEffect(() => {
    if (backgroundTasks === undefined) return
    let cancelled = false
    void backgroundTasks.list().then((rows) => {
      if (cancelled) return
      if (rows === undefined) setBackgroundPhase('unavailable')
      else { setWorkers(rows); setBackgroundPhase('available') }
    }).catch(() => { if (!cancelled) setBackgroundPhase('error') })
    return () => { cancelled = true }
  }, [backgroundTasks])
  const refreshBackground = async (): Promise<readonly OrbBackgroundWorker[] | undefined> => {
    if (backgroundTasks === undefined) return undefined
    const rows = await backgroundTasks.list()
    if (rows === undefined) setBackgroundPhase('unavailable')
    else { setWorkers(rows); setBackgroundPhase('available'); setBackgroundNeedsRefresh(false) }
    return rows
  }
  const submitBackground = async (): Promise<void> => {
    if (backgroundTasks === undefined || task.trim() === '' || backgroundBusy || backgroundNeedsRefresh) return
    setBackgroundBusy(true)
    setBackgroundMessage('')
    try {
      const id = await backgroundTasks.submit(task.trim())
      const rows = await refreshBackground()
      if (rows === undefined || !rows.some(worker => worker.sessionId === id)) {
        throw new Error('orb background: submitted worker was not confirmed by Host list')
      }
      setTask('')
      setBackgroundMessage(t('backgroundQueued'))
    } catch {
      setBackgroundNeedsRefresh(true)
      setBackgroundMessage(t('backgroundSubmitUncertain'))
    } finally { setBackgroundBusy(false) }
  }
  const stopBackground = async (id: string): Promise<void> => {
    if (backgroundTasks === undefined || backgroundBusy) return
    setBackgroundBusy(true)
    setBackgroundMessage('')
    try {
      await backgroundTasks.stop(id)
      const rows = await refreshBackground()
      if (rows === undefined) throw new Error('orb background: stop result was not confirmed by Host list')
      setBackgroundMessage(t('backgroundStopped'))
    } catch { setBackgroundNeedsRefresh(true); setBackgroundMessage(t('backgroundStopUncertain')) }
    finally { setBackgroundBusy(false) }
  }
  return (
    <main className={css.shell} data-overlay-chat="">
      <header className={css.header}>
        <span className={css.title}>{t('title')}</span>
        <button className={css.action} type="button" onClick={() => { manualNavigation.current += 1; startSession() }}>{t('new')}</button>
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
          if (id !== undefined) { manualNavigation.current += 1; openSession(id) }
        }}
      >
        <option value="">{t('history')}</option>
        {recent.map(id => <option key={id} value={id}>{list.byId[id]?.displayTitle ?? t('untitled')}{list.byId[id]?.running ? ` · ${t('runningShort')}` : ''}</option>)}
      </select>
      {backgroundTasks !== undefined && backgroundPhase !== 'unavailable' && <section className={css.background} aria-label={t('backgroundTitle')}>
        <div className={css.backgroundHeader}>
          <span>{t('backgroundTitle')}</span>
          <button className={css.action} type="button" disabled={backgroundBusy} onClick={() => {
            void refreshBackground().catch(() => { setBackgroundPhase('error') })
          }}>{t('backgroundRefresh')}</button>
        </div>
        {backgroundPhase === 'checking' && <p className={css.backgroundHint} role="status">{t('backgroundChecking')}</p>}
        {backgroundPhase === 'error' && <p className={css.backgroundHint} role="alert">{t('backgroundUnavailable')}</p>}
        {backgroundPhase === 'available' && <>
          <form className={css.backgroundForm} onSubmit={(event) => { event.preventDefault(); void submitBackground() }}>
            <label htmlFor="orb-background-task">{t('backgroundTaskLabel')}</label>
            <textarea id="orb-background-task" value={task} maxLength={16_384} rows={2}
              onChange={(event) => { setTask(event.currentTarget.value) }} />
            <button className={css.backgroundSubmit} type="submit" disabled={backgroundBusy || backgroundNeedsRefresh || task.trim() === ''}>
              {backgroundBusy ? t('backgroundWorking') : t('backgroundSubmit')}
            </button>
          </form>
          {workers.length === 0 ? <p className={css.backgroundHint}>{t('backgroundEmpty')}</p> :
            <ul className={css.backgroundList}>{workers.map(worker => <li key={worker.sessionId}>
              <span className={css.backgroundWorker} title={list.byId[worker.sessionId as SessionListState['ids'][number]]?.displayTitle ?? worker.sessionId}>
                {list.byId[worker.sessionId as SessionListState['ids'][number]]?.displayTitle ?? `${t('backgroundWorker')} ${worker.sessionId.slice(-8)}`}
                {' · '}{worker.running ? t('runningShort') : t('backgroundIdle')}</span>
              <button className={css.action} type="button" onClick={() => { openSession(worker.sessionId as SessionListState['ids'][number]) }}>
                {t('backgroundOpen')}
              </button>
              {worker.running && <button className={css.action} type="button" disabled={backgroundBusy}
                onClick={() => { void stopBackground(worker.sessionId) }}>{t('backgroundStop')}</button>}
            </li>)}</ul>}
        </>}
        {backgroundMessage !== '' && <p className={css.backgroundHint} role="status">{backgroundMessage}</p>}
      </section>}
      <div className={css.conversation} data-conversation-scroll="">
        {renderSlot('main', {}, { entryKey: 'conversation' })}
      </div>
    </main>
  )
}

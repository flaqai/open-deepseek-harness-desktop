/** Compact transcript, history, and session controls in the floating window. */

import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './OverlayChatRoot.module.css'

/** Callbacks projected from the existing Workspace navigation service. */
export interface OverlayChatInjected {
  startSession(): void
  openSession(id: SessionListState['ids'][number]): void
  collapse(): void
  openMain(): void
}

/** Full framework-derived props for the overlay root. */
export type OverlayChatRootProps = PropsRuntime<'root'>
  & PropsRenderSlots<'conversation.view' | 'conversation.input.overlay'>
  & PropsLocale<'orbChat'>
  & InjectFace<OverlayChatInjected>

function ignoreView(_view: string, _focus: string): void {}
function ignoreRequest(): void {}

/** Render one Session from the existing Client model without a parallel transcript store.
 * @param props - Root hooks, slot renderers, locale, and callbacks.
 * @returns Compact chat window.
 */
export function OverlayChatRoot({
  renderSlot, SessionProvider, useSessions, t, startSession, openSession, collapse, openMain,
}: OverlayChatRootProps) {
  const list = useSessions(state => state)
  const sessionId = list.ids.find(id => (list.byId[id]?.retainedBy.mainView ?? 0) > 0)
  const recent = list.ids.filter(id => list.byId[id]?.origin !== 'subagent').slice(0, 80)
  return (
    <main className={css.shell} data-overlay-chat="">
      <header className={css.header}>
        <span className={css.title}>{t('title')}</span>
        <button className={css.action} type="button" onClick={startSession}>{t('new')}</button>
        <button className={css.action} type="button" onClick={openMain}>{t('openMain')}</button>
        <button className={css.action} type="button" onClick={collapse}>{t('collapse')}</button>
      </header>
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
        {recent.map(id => <option key={id} value={id}>{list.byId[id]?.displayTitle ?? t('untitled')}</option>)}
      </select>
      <div className={css.conversation} data-conversation-scroll="">
        <SessionProvider empty={() => <div className={css.empty}>{t('empty')}</div>}>
          {sessionId === undefined ? null : <>
            {renderSlot('conversation.view', {
              inspectCall: undefined,
              viewRequest: null,
              openView: ignoreView,
              completeViewRequest: ignoreRequest,
            }, { only: 'chat' })}
            <div className={css.inputOverlay}>{renderSlot('conversation.input.overlay', {})}</div>
          </>}
        </SessionProvider>
      </div>
    </main>
  )
}

/** Contextual actions rendered for eligible browser text selections. */

import {
  type PointerEvent as ReactPointerEvent, type ReactNode,
} from 'react'
import {
  IconCopyOutline16, IconNewChatOutline16, IconPlusOutline16, IconRefreshOutline16,
  IconCompareSplitOutlineRegular, Tooltip, Menu, MenuSurface,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import css from './SelectionActions.module.css'

/** Business face assembled by the client plugin. */
export interface SelectionActionsInjected {
  hooks: { appendAvailable: HostObservable<boolean> }
  notify: (text: string) => void
  copy: (text: string) => Promise<boolean>
  askInNewConversation: (workspaceId: WorkspaceId, draft: string) => Promise<void>
  askInSideConversation: (workspaceId: WorkspaceId, text: string) => Promise<void>
  appendToCurrent: (sessionId: SessionId, text: string) => void
  restartDesktop?: () => Promise<void>
}

/** Props assembled by the conversation text-interaction registration. */
export type SelectionActionsProps =
  PropsRuntime<'conversation.chat.text-interaction'>
  & PropsLocale<typeof NS>
  & InjectFace<SelectionActionsInjected>

/** Actions for one conversation-owned text interaction surface. */
export function SelectionActions({
  sessionId, trigger, readText, dismiss, useWorkspaces, useAppendAvailable, useAccess,
  useRemoteAccess, copy, askInNewConversation, askInSideConversation, appendToCurrent, restartDesktop, notify, t,
}: SelectionActionsProps) {
  const currentWorkspaceId = useWorkspaces(state =>
    state.items.find(workspace => workspace.sessionIds.includes(sessionId))?.workspaceId)
  const writable = useAccess('session/prompt')
  const canAsk = useRemoteAccess('session/create')
  const appendAvailable = useAppendAvailable(value => value) && writable && currentWorkspaceId !== undefined
  const text = readText()
  const mode = trigger === 'selection' ? 'toolbar' : 'menu'
  const close = dismiss
  const showToast = notify
  const preserveSelection = (event: ReactPointerEvent<HTMLButtonElement>): void => { event.preventDefault() }

  const onCopy = (): void => {
    if (text === null) return
    close()
    void copy(text).then(
      (accepted) => { showToast(t(accepted ? 'status.copied' : 'error.copy')) },
      () => { showToast(t('error.copy')) },
    )
  }

  const onAsk = (): void => {
    if (text === null || currentWorkspaceId === undefined || !canAsk) return
    close()
    void askInNewConversation(currentWorkspaceId, text).then(
      () => { showToast(t('status.newConversation')) },
      () => { showToast(t('error.action')) },
    )
  }

  const onAskAside = (): void => {
    if (text === null || currentWorkspaceId === undefined || !canAsk) return
    close()
    void askInSideConversation(currentWorkspaceId, text).then(
      () => { showToast(t('status.sideConversation')) },
      () => { showToast(t('error.action')) },
    )
  }

  const onAppend = (): void => {
    if (text === null || !appendAvailable) return
    close()
    try {
      appendToCurrent(sessionId, text)
      showToast(t('status.added'))
    } catch {
      showToast(t('error.action'))
    }
  }

  const onRestart = (): void => {
    if (restartDesktop === undefined) return
    close()
    void restartDesktop().catch(() => { showToast(t('error.restart')) })
  }

  const toolbarAction = (label: string, icon: ReactNode, onClick: () => void) => (
    <Tooltip label={label} side="top" delayMs={350}>
      <button type="button" className={css.action} aria-label={label} onPointerDown={preserveSelection} onClick={onClick}>
        {icon}
      </button>
    </Tooltip>
  )

  const menuItems = [
    { id: 'copy', label: t('action.copy'), icon: <IconCopyOutline16 />, run: onCopy },
    ...(currentWorkspaceId !== undefined && canAsk ? [
      { id: 'ask', label: t('action.ask'), icon: <IconNewChatOutline16 />, run: onAsk },
      { id: 'sideAsk', label: t('action.sideAsk'), icon: <IconCompareSplitOutlineRegular size={16} />, run: onAskAside },
    ] : []),
    ...(appendAvailable ? [{ id: 'append', label: t('action.append'), icon: <IconPlusOutline16 />, run: onAppend }] : []),
  ]
  const restartItems = restartDesktop === undefined ? [] : [
    { id: 'restart-separator', type: 'separator' as const },
    { id: 'restart', label: t('action.restart'), icon: <IconRefreshOutline16 /> },
  ]

  if (text === null) return null
  if (mode === 'menu') return (
    <div data-selection-actions="menu" aria-label={t('menu.aria')}>
      <Menu open anchor={null} contextual preserveSelection ariaLabel={t('menu.aria')} listClassName={css.menu}
        items={menuItems} footer={restartItems} onClose={close}
        onSelect={(id) => {
          if (id === 'restart') onRestart()
          else menuItems.find(item => item.id === id)?.run()
        }} />
    </div>
  )

  return (
    <MenuSurface className={`${css.surface} ${css.toolbar}`} role="toolbar"
      aria-label={t('toolbar.aria')} data-selection-actions="toolbar">
      {toolbarAction(t('action.copy'), <IconCopyOutline16 />, onCopy)}
      {currentWorkspaceId !== undefined && canAsk
        ? toolbarAction(t('action.ask'), <IconNewChatOutline16 />, onAsk)
        : null}
      {appendAvailable
        ? toolbarAction(t('action.append'), <IconPlusOutline16 />, onAppend)
        : null}
    </MenuSurface>
  )
}

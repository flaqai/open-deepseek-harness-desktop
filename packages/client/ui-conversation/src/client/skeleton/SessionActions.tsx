/** Session-level copy and removal controls for the conversation Header. */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ConversationNode, PartialAssistant } from '../contract/records.ts'
import type { ConversationSnapshot } from '../contract/snapshot.ts'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  Button, IconCheckOutline16, IconCopyOutline16, IconTrashOutline16, Modal, Tooltip, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import css from './SessionActions.module.css'

/** Session removal supplied to the official Session-log menu contribution. */
export interface SessionRemovalMenuItemInjected {
  /** Hide the current Session while retaining its durable log. */
  archive: () => Promise<void>
}

type SessionActionsProps = PropsLocale<'conversation'>
  & PropsRuntime<'conversation.session.header.utilities'>

type SessionRemovalMenuItemProps = SessionRemovalMenuItemInjected
  & PropsLocale<'conversation'>
  & PropsRuntime<'conversation.session.header.menu.item'>

type UserContent = Extract<ConversationNode, { kind: 'user' }>['content']

function contentText(content: UserContent): string {
  const parts: string[] = []
  for (const block of content) {
    switch (block.type) {
      case 'text': parts.push(block.text); break
      case 'image': parts.push('[Image]'); break
      case 'tool-call': parts.push(`[Tool: ${block.name}]`); break
      case 'reasoning': break
      default: parts.push('[Content]')
    }
  }
  return parts.filter(Boolean).join('\n')
}

/**
 * Convert the loaded visible message window to a portable plain-text transcript.
 * @param snapshot - current Session projection.
 * @param labels - localized speaker labels.
 * @returns user and assistant messages in durable event order.
 */
export function conversationTranscript(
  snapshot: ConversationSnapshot,
  labels: { readonly user: string; readonly assistant: string },
): string {
  const chat = (snapshot.views as { get(target: string): unknown }).get('chat') as {
    legacy?: { nodes?: readonly ConversationNode[]; partial?: PartialAssistant | null }
  } | undefined
  const lines: string[] = []
  for (const node of chat?.legacy?.nodes ?? []) {
    if (node.kind === 'user' || node.kind === 'steering') {
      const text = contentText(node.content).trim()
      if (text !== '') lines.push(`${labels.user}:\n${text}`)
    } else if (node.kind === 'assistant') {
      const text = node.blocks.flatMap((block) => {
        if (block.kind === 'text') return [block.text]
        if (block.kind === 'image') return ['[Image]']
        if (block.kind === 'tool-call') return [`[Tool: ${block.name}]`]
        return []
      }).join('\n').trim()
      if (text !== '') lines.push(`${labels.assistant}:\n${text}`)
    }
  }
  const partial = chat?.legacy?.partial
  if (partial !== undefined && partial !== null) {
    const text = partial.blocks.flatMap((block) => {
      if (block.kind === 'text') return [block.text]
      if (block.kind === 'image') return ['[Image]']
      if (block.kind === 'tool-call') return [`[Tool: ${block.name}]`]
      return []
    }).join('\n').trim()
    if (text !== '') lines.push(`${labels.assistant}:\n${text}`)
  }
  return lines.join('\n\n')
}

/**
 * Render the independent transcript-copy utility.
 * @param props - standard Session hooks and localized copy.
 * @returns the copy action.
 */
export function SessionActions({
  useConversation, t,
}: SessionActionsProps): ReactNode {
  const snapshot = useConversation(value => value)
  const [copied, setCopied] = useState(false)
  const copyPending = useRef(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copyEpoch = useRef(0)
  const transcript = useMemo(() => conversationTranscript(snapshot, {
    user: t('session.actions.speaker.user'),
    assistant: t('session.actions.speaker.assistant'),
  }), [snapshot, t])

  useEffect(() => () => {
    copyEpoch.current += 1
    copyPending.current = false
    if (copyTimer.current !== null) clearTimeout(copyTimer.current)
  }, [])

  const copy = (): void => {
    if (transcript === '' || copied || copyPending.current) return
    const epoch = copyEpoch.current
    copyPending.current = true
    void writeClipboard(transcript).then((ok) => {
      if (epoch !== copyEpoch.current) return
      copyPending.current = false
      if (!ok) return
      setCopied(true)
      copyTimer.current = window.setTimeout(() => {
        copyTimer.current = null
        setCopied(false)
      }, 1_000)
    })
  }

  return (
    <Tooltip label={copied ? t('copied') : t('session.actions.copy')} side="bottom">
      <button
        type="button"
        className={css.iconButton}
        aria-label={copied ? t('copied') : t('session.actions.copy')}
        disabled={transcript === ''}
        onClick={copy}
      >
        {copied ? <IconCheckOutline16 /> : <IconCopyOutline16 />}
      </button>
    </Tooltip>
  )
}

/** Contribute only "Delete session" to the official Session-log actions menu. */
export function SessionRemovalMenuItem({
  useSession, useRemoteAccess, registerMenuItem, archive, t,
}: SessionRemovalMenuItemProps): ReactNode {
  const allowed = useRemoteAccess('workspace/archiveSession')
  const running = useSession(value => value.running)
  const [confirmation, setConfirmation] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => allowed ? registerMenuItem({
    id: 'conversation-session-remove',
    order: 100,
    item: {
      id: 'conversation-session-remove',
      label: t('session.actions.remove'),
      icon: <IconTrashOutline16 />,
      danger: true,
      disabled: running,
    },
    onSelect: (id) => {
      if (id === 'conversation-session-remove') setConfirmation(true)
    },
  }) : undefined, [allowed, registerMenuItem, running, t])

  const close = (): void => {
    if (busy) return
    setConfirmation(false)
    setError(null)
  }

  const confirm = (): void => {
    if (busy) return
    setBusy(true)
    setError(null)
    void archive().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
      setBusy(false)
    })
  }

  if (!allowed) return null
  return (
    <Modal
      open={confirmation}
      onClose={close}
      closeLabel={t('session.actions.cancel')}
      title={t('session.actions.remove.title')}
      description={t('session.actions.remove.description')}
      footer={(
        <>
          <Button variant="outline" disabled={busy} onClick={close}>
            {t('session.actions.cancel')}
          </Button>
          <Button variant="outline" className={css.dangerAction} disabled={busy} onClick={confirm}>
            {busy ? t('session.actions.working') : t('session.actions.remove.confirm')}
          </Button>
        </>
      )}
    >
      {error !== null && <div className={css.error} role="alert">{error}</div>}
    </Modal>
  )
}

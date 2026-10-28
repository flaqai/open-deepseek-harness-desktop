/** Browser plugin owning ZIP download and Markdown copy state, plus feedback controls. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-message-feedback/client'
import type {} from '@deepseek-ai/dsh-api-remote-access/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SessionLogDownloadController } from './controller.ts'
import { SessionMarkdownCopyController } from './copy-controller.ts'
import { SessionMarkdownCopyToast, type SessionMarkdownCopyToastInjected } from './CopyToast.tsx'
import { SessionLogDownloadHeaderAction, type SessionLogDownloadHeaderInjected } from './HeaderAction.tsx'
import { en, ja, es, fr, de, ru, pt, NS, zh, type SessionLogDownloadKey } from './locales.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionLogDownload: SessionLogDownloadController
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'session-log-download': SessionLogDownloadKey
  }
}

export type { SessionLogDownloadEntry, SessionLogDownloadState } from './controller.ts'

export const inject = ['slots', 'locale', 'configForms', 'remoteAccess']

/**
 * Provide the download controller and mount its modal, the Markdown copy
 * controller and its root toast, and both Header actions.
 * @param ctx - browser context carrying slots and locale services.
 */
export function apply(ctx: ClientContext): void {
  const privacy = ctx.configForms.get<{
    diagnosticExport: { preference: 'ask' | 'include' | 'exclude' }
  }>('custom-instructions')
  const controller = new SessionLogDownloadController(undefined, undefined, {
    getPreference: () => privacy.getSnapshot().value?.diagnosticExport.preference ?? 'ask',
    setPreference: async (preference) => {
      if (!await privacy.mutate([{
        op: 'set', path: ['diagnosticExport', 'preference'], value: preference,
      }])) throw new Error('session export privacy preference was not saved')
    },
  })
  const copyController = new SessionMarkdownCopyController()
  ctx.provide('sessionLogDownload', controller)
  ctx.effect(() => async () => { await controller.dispose() }, 'session-log-download: browser download lifecycle')
  ctx.effect(() => async () => { await copyController.dispose() }, 'session-log-download: browser Markdown copy lifecycle')
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'session-log-download: browser dictionaries')
  const feedbackAvailable = createSnapshotStore(false)
  ctx.inject(['feedbackUi'], (scope: ClientContext) => {
    scope.effect(() => {
      feedbackAvailable.set(true)
      return () => { feedbackAvailable.set(false) }
    }, 'session-log-download: feedback availability')
  })
  ctx.on('command/executed', (sessionId, commandName, result) => {
    if (commandName === 'export' && result.kind === 'success'
      && ctx.remoteAccess.source('session', sessionId, 'sessionLog/download').getSnapshot()) void controller.download(sessionId)
  })
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'session-log-download.copy-toast',
    locale: NS,
    inject: (): SessionMarkdownCopyToastInjected => ({
      hooks: { sessionMarkdownCopy: copyController.store },
      dismiss: () => { copyController.dismiss() },
    }),
  }, SessionMarkdownCopyToast))
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'session-log-download',
    locale: NS,
    children: {
      'conversation.session.header.menu.item': { kind: 'list', scope: 'session' },
    },
    inject: (sessionId): SessionLogDownloadHeaderInjected => ({
      hooks: { sessionLogDownload: controller.store, sessionMarkdownCopy: copyController.store, feedbackAvailable,
        downloadAllowed: ctx.remoteAccess.source('session', sessionId, 'sessionLog/download') },
      request: (sessionId: SessionId) => controller.download(sessionId),
      copyMarkdown: (sessionId: SessionId) => copyController.copy(sessionId),
      dismiss: (sessionId: SessionId) => { controller.dismiss(sessionId) },
      setIncludeCustomInstructions: (sessionId, include) => {
        controller.setIncludeCustomInstructions(sessionId, include)
      },
      setRemember: (sessionId, remember) => { controller.setRemember(sessionId, remember) },
      confirm: sessionId => controller.confirm(sessionId),
      // The feedback plugin can unload between the menu render and this click.
      openFeedback: (sessionId: SessionId) => { ctx.get('feedbackUi')?.openSession(sessionId) },
    }),
  }, SessionLogDownloadHeaderAction))
}

export type { SessionLogDownloadDialogInjected, SessionLogDownloadDialogProps } from './Dialog.tsx'

/** Browser plugin owning ZIP download and Markdown copy state, plus feedback controls. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-message-feedback/client'
import type {} from '@deepseek-ai/dsh-api-remote-access/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-ui-context-menu/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { IconCopyOutlineRegular, IconDownloadOutlineRegular, IconPaperPlaneOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { SessionLogDownloadController } from './controller.ts'
import { SessionMarkdownCopyController } from './copy-controller.ts'
import { SessionMarkdownCopyToast, type SessionMarkdownCopyToastInjected } from './CopyToast.tsx'
import { SessionLogDownloadDialog, type SessionLogDownloadDialogInjected } from './Dialog.tsx'
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

export const inject = ['slots', 'locale', 'configForms', 'remoteAccess', 'contextMenus']

/**
 * Provide the download controller and mount its modal, the Markdown copy
 * controller and its root toast, and the shared Session menu actions.
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
  const pendingPermission = () => {
    const pending = Object.entries(controller.store.getSnapshot().bySession)
      .filter((pair): pair is [string, NonNullable<typeof pair[1]>] => pair[1]?.open === true)
      .sort((a, b) => a[1].order - b[1].order)[0]
    return pending === undefined ? undefined : ctx.remoteAccess.source('session', pending[0], 'sessionLog/download')
  }
  const downloadAllowed = {
    getSnapshot: () => pendingPermission()?.getSnapshot() === true,
    subscribe(listener: () => void) {
      let stopPermission = pendingPermission()?.subscribe(listener)
      const stopState = controller.store.subscribe(() => {
        stopPermission?.()
        stopPermission = pendingPermission()?.subscribe(listener)
        listener()
      })
      return () => { stopState(); stopPermission?.() }
    },
  }
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
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('contextMenu.icon', function* () {
    for (const [key, Icon] of Object.entries({
      'session-log-download.copy': IconCopyOutlineRegular,
      'session-log-download.download': IconDownloadOutlineRegular,
      'session-log-download.feedback': IconPaperPlaneOutlineRegular,
    })) yield ctx.slots.register({ name: 'contextMenu.icon', key }, Icon)
  })
  ctx.effect(() => ctx.contextMenus.register({
    id: 'session-log-download.export', target: 'sessionHeader', order: 100,
    observe: ({ sessionId }) => [controller.store, copyController.store, ctx.locale,
      ctx.remoteAccess.source('session', sessionId, 'sessionLog/download')],
    resolve: ({ sessionId }) => ctx.remoteAccess.source('session', sessionId, 'sessionLog/download').getSnapshot() ? [
      { id: 'copy', label: t('menu.copyMarkdown'), icon: { key: 'session-log-download.copy' },
        disabled: copyController.store.getSnapshot().copying, run: () => copyController.copy(sessionId) },
      { id: 'download', label: t('menu.download'), icon: { key: 'session-log-download.download' },
        disabled: controller.store.getSnapshot().bySession[sessionId]?.status === 'downloading',
        run: () => controller.download(sessionId) },
    ] : [],
  }), 'session-log-download: Header exports')
  ctx.effect(() => ctx.contextMenus.register({
    id: 'session-log-download.feedback', target: 'sessionHeader', order: 600,
    observe: () => [feedbackAvailable, ctx.locale],
    resolve: ({ sessionId }) => feedbackAvailable.getSnapshot() ? [{
      id: 'feedback', label: t('menu.feedback'), icon: { key: 'session-log-download.feedback' }, separatorBefore: true,
      // The feedback plugin can unload between menu preparation and selection.
      run: () => { ctx.get('feedbackUi')?.openSession(sessionId) },
    }] : [],
  }), 'session-log-download: Header feedback')
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
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'session-log-download',
    locale: NS,
    inject: (): SessionLogDownloadDialogInjected => ({
      hooks: { sessionLogDownload: controller.store, downloadAllowed },
      setIncludeCustomInstructions: (id, include) => { controller.setIncludeCustomInstructions(id, include) },
      setRemember: (id, remember) => { controller.setRemember(id, remember) },
      confirm: id => controller.confirm(id),
      dismiss: (sessionId: SessionId) => { controller.dismiss(sessionId) },
    }),
  }, SessionLogDownloadDialog))
}

export type { SessionLogDownloadDialogInjected, SessionLogDownloadDialogProps } from './Dialog.tsx'

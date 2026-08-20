/** Desktop-only official source update controls for the General settings page. */

import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsKey } from './locales.ts'
import css from './DesktopUpdateRow.module.css'

/** Renderer copy of the narrow Electron update status protocol. */
export interface DesktopSourceUpdateStatus {
  repository: string
  branch: string
  reason: 'ready' | 'current' | 'dirty' | 'diverged' | 'not-source-checkout' | 'check-failed'
  currentCommit?: string
  latestCommit?: string
  dirtyFiles: number
  detail?: string
}

/** Renderer copy of the narrow Electron update result protocol. */
export type DesktopSourceUpdateResult =
  | { ok: true; previousCommit: string; currentCommit: string; restartRequired: true }
  | { ok: false; status: DesktopSourceUpdateStatus; rollbackIncomplete?: boolean }

/** Restricted preload methods exposed only by the desktop application. */
export interface DesktopUpdateBridge {
  check(): Promise<DesktopSourceUpdateStatus>
  upgrade(expectedCommit: string): Promise<DesktopSourceUpdateResult>
  restart(): Promise<{ restarting: true }>
}

declare global {
  /** Desktop preload bridge when this client runs inside the Electron host. */
  var deepSeekHarnessDesktop: { updater?: DesktopUpdateBridge; shell?: unknown; releases?: unknown } | undefined
  interface Window {
    deepSeekHarnessDesktop?: { updater?: DesktopUpdateBridge; shell?: unknown; releases?: unknown }
  }
}

/** Desktop update row injection. */
export interface DesktopUpdateRowInjected {
  updater: DesktopUpdateBridge
}

/** Full desktop update row props. */
export type DesktopUpdateRowProps = PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings'> & DesktopUpdateRowInjected

function shortCommit(commit: string | undefined): string {
  return commit?.slice(0, 8) ?? '—'
}

function statusKey(status: DesktopSourceUpdateStatus): SettingsKey {
  return `update.status.${status.reason}`
}

/** Render official-branch status, confirmation, transactional upgrade, and restart controls. */
export function DesktopUpdateRow({ updater, t }: DesktopUpdateRowProps) {
  const [status, setStatus] = useState<DesktopSourceUpdateStatus | null>(null)
  const [phase, setPhase] = useState<'idle' | 'checking' | 'confirming' | 'updating' | 'updated'>('idle')
  const [failure, setFailure] = useState<string | null>(null)

  const check = async (): Promise<void> => {
    setPhase('checking')
    setFailure(null)
    try {
      setStatus(await updater.check())
    } catch (_bridgeFailure) {
      setFailure(t('update.bridgeFailed'))
    } finally {
      setPhase(current => current === 'checking' ? 'idle' : current)
    }
  }

  useEffect(() => { void check() }, [])

  const upgrade = async (): Promise<void> => {
    const commit = status?.latestCommit
    if (commit === undefined || phase === 'updating') return
    setPhase('updating')
    setFailure(null)
    try {
      const result = await updater.upgrade(commit)
      if (result.ok) {
        setStatus(current => current === null ? null : {
          ...current,
          currentCommit: result.currentCommit,
          latestCommit: result.currentCommit,
          reason: 'current',
        })
        setPhase('updated')
      } else {
        setStatus(result.status)
        setFailure(t(result.rollbackIncomplete
          ? 'update.rollbackIncomplete'
          : result.status.reason === 'check-failed'
            ? 'update.failed'
            : 'update.recheck'))
        setPhase('idle')
      }
    } catch (_bridgeFailure) {
      setFailure(t('update.bridgeFailed'))
      setPhase('idle')
    }
  }

  const busy = phase === 'checking' || phase === 'updating'
  return (
    <section className={css.card} aria-labelledby="desktop-update-title">
      <div className={css.heading}>
        <div>
          <div id="desktop-update-title" className={css.title}>{t('update.title')}</div>
          <div className={css.description}>{t('update.description')}</div>
        </div>
        <span className={css.sourceBadge}>{t('update.official')}</span>
      </div>

      <div className={css.sourceLine}>
        <a href="https://github.com/deepseek-ai/deepseek-harness" target="_blank" rel="noreferrer">
          deepseek-ai/deepseek-harness
        </a>
        <code>{status?.branch ?? 'master'}</code>
      </div>

      <div className={css.commits}>
        <span>{t('update.current')} <code>{shortCommit(status?.currentCommit)}</code></span>
        <span>{t('update.latest')} <code>{shortCommit(status?.latestCommit)}</code></span>
      </div>

      <div className={css.status} role="status">
        {phase === 'checking'
          ? t('update.checking')
          : phase === 'updating'
            ? t('update.updating')
            : phase === 'updated'
              ? t('update.updated')
              : status === null
                ? t('update.notChecked')
                : t(statusKey(status))}
      </div>
      {status?.reason === 'dirty' && (
        <div className={css.hint}>{t('update.dirtyCount').replace('{count}', String(status.dirtyFiles))}</div>
      )}
      {status?.detail !== undefined && <div className={css.error} role="alert">{status.detail}</div>}
      {failure !== null && <div className={css.error} role="alert">{failure}</div>}

      <div className={css.actions}>
        <Button variant="outline" disabled={busy} onClick={() => { void check() }}>
          {t('update.check')}
        </Button>
        {phase === 'updated' ? (
          <Button variant="primary" onClick={() => { void updater.restart() }}>
            {t('update.restart')}
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={busy || status?.reason !== 'ready'}
            onClick={() => { setPhase('confirming') }}
          >
            {t('update.upgrade')}
          </Button>
        )}
      </div>

      <div className={css.safety}>{t('update.safety')}</div>

      <Modal
        open={phase === 'confirming'}
        onClose={() => { setPhase('idle') }}
        closeLabel={t('update.cancel')}
        title={t('update.confirm.title')}
        description={t('update.confirm.description').replace('{commit}', shortCommit(status?.latestCommit))}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setPhase('idle') }}>{t('update.cancel')}</Button>
            <Button variant="primary" onClick={() => { void upgrade() }}>{t('update.confirm')}</Button>
          </>
        )}
      >
        <p className={css.confirmNote}>{t('update.confirm.note')}</p>
      </Modal>
    </section>
  )
}

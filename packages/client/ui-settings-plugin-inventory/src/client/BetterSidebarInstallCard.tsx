/** First-run progress surface for the packaged Better Sidebar archive. */

import { useEffect, useState, type ReactNode } from 'react'
import type { PluginInstallId, PluginInstallRequest } from '@deepseek-ai/dsh-host-plugin-inventory/types'
import { Button, IconCheckOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopBundledPluginInstallSnapshot } from './bundled-install-bridge.ts'
import css from './BetterSidebarInstallCard.module.css'

const REQUEST: PluginInstallRequest = { profile: 'web', packageSpec: 'dsh-better-sidebar@0.15.2' }
const STAGES = ['verifying', 'extracting', 'configuring'] as const
type InstallStage = typeof STAGES[number]

/** Desktop capabilities used by the deferred-install card. */
export interface BetterSidebarInstallCardInjected {
  startInstall: (request: PluginInstallRequest) => Promise<DesktopBundledPluginInstallSnapshot | undefined>
  getInstall: (installId: PluginInstallId) => Promise<DesktopBundledPluginInstallSnapshot>
  openLog: () => Promise<boolean>
  restart: () => Promise<boolean>
}

/** Props assembled by the root shell overlay slot. */
export type BetterSidebarInstallCardProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<'settings.pluginInventory'>
  & InjectFace<BetterSidebarInstallCardInjected>

function stageState(stage: InstallStage, current: InstallStage): 'done' | 'active' | 'pending' {
  const index = STAGES.indexOf(stage)
  const currentIndex = STAGES.indexOf(current)
  if (index < currentIndex) return 'done'
  return index === currentIndex ? 'active' : 'pending'
}

/** Render a non-blocking, uninstall-aware Better Sidebar preparation card. */
export function BetterSidebarInstallCard({
  t,
  startInstall,
  getInstall,
  openLog,
  restart,
}: BetterSidebarInstallCardProps): ReactNode {
  const [snapshot, setSnapshot] = useState<DesktopBundledPluginInstallSnapshot>()
  const [startFailed, setStartFailed] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let current = true
    setStartFailed(false)
    void startInstall(REQUEST).then(
      (next) => { if (current) setSnapshot(next) },
      () => { if (current) setStartFailed(true) },
    )
    return () => { current = false }
  }, [attempt, startInstall])

  useEffect(() => {
    if (snapshot?.phase !== 'running') return
    let current = true
    const timer = window.setTimeout(() => {
      void getInstall(snapshot.installId).then(
        (next) => { if (current) setSnapshot(next) },
        () => { if (current) setStartFailed(true) },
      )
    }, 700)
    return () => { current = false; window.clearTimeout(timer) }
  }, [getInstall, snapshot])

  useEffect(() => {
    if (snapshot?.phase === 'succeeded' || snapshot?.phase === 'failed' || startFailed) setHidden(false)
  }, [snapshot?.phase, startFailed])

  if (hidden || (snapshot === undefined && !startFailed)) return null

  const failed = startFailed || snapshot?.phase === 'failed'
  const succeeded = snapshot?.phase === 'succeeded'
  const currentStage = snapshot?.stage ?? 'verifying'
  const progress = snapshot?.progress ?? 0
  const status = failed
    ? t('deferredSidebar.status.failed')
    : succeeded
      ? t('deferredSidebar.status.succeeded')
      : t(`deferredSidebar.status.${currentStage}`)

  return (
    <aside className={css.card} role="status" aria-live="polite" data-better-sidebar-install={snapshot?.phase ?? 'failed'}>
      <h2 className={css.title}>{t('deferredSidebar.title')}</h2>
      <ol className={css.steps} data-stage={succeeded ? 'complete' : currentStage} aria-label={t('deferredSidebar.steps')}>
        {STAGES.map((stage) => {
          const state = succeeded ? 'done' : stageState(stage, currentStage)
          return (
            <li key={stage} className={css.step} data-state={state}>
              <span className={css.marker} aria-hidden="true">
                {state === 'done' ? <IconCheckOutline16 size={14} /> : null}
              </span>
              <span>{t(`deferredSidebar.stage.${stage}`)}</span>
            </li>
          )
        })}
      </ol>
      <p className={css.status}>{status}{!failed && !succeeded ? ` · ${progress}%` : ''}</p>
      <progress className={css.progress} max={100} value={progress} aria-label={status} />
      <p className={css.helper}>
        {failed ? t('deferredSidebar.help.failed') : t('deferredSidebar.help.restart')}
      </p>
      <div className={css.actions}>
        {failed ? (
          <Button variant="outline" onClick={() => { setSnapshot(undefined); setAttempt(value => value + 1) }}>
            {t('deferredSidebar.action.retry')}
          </Button>
        ) : succeeded ? (
          <Button variant="outline" onClick={() => { setHidden(true) }}>{t('deferredSidebar.action.later')}</Button>
        ) : (
          <Button variant="outline" onClick={() => { setHidden(true) }}>{t('deferredSidebar.action.hide')}</Button>
        )}
        {succeeded ? (
          <Button className={css.primaryAction} variant="outline" onClick={() => { void restart() }}>{t('deferredSidebar.action.restart')}</Button>
        ) : (
          <Button className={css.primaryAction} variant="outline" onClick={() => { void openLog() }}>{t('deferredSidebar.action.log')}</Button>
        )}
      </div>
    </aside>
  )
}

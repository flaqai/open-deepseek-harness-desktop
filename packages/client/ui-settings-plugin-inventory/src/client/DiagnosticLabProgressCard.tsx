/** Global Diagnostics Lab progress card that survives Harness renderer reloads. */

import { useEffect, useState, type ReactNode } from 'react'
import { Button, IconCheckOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DiagnosticLabInjected } from './DiagnosticLabPanel.tsx'
import type { PluginInventoryLocaleKey } from './locales.ts'
import type { DiagnosticLabRunSnapshot, DiagnosticLabScenarioId } from './bundled-install-bridge.ts'
import css from './DiagnosticLabProgressCard.module.css'

interface DiagnosticLabProgressCardProps extends Pick<DiagnosticLabInjected, 'current' | 'getRun' | 'cancel' | 'restoreAll' | 'subscribe'> {
  readonly t: (key: PluginInventoryLocaleKey) => string
}

const STEPS = ['baseline', 'inject', 'detect', 'repair', 'verify', 'retain'] as const
const SCENARIO_TITLES: Record<DiagnosticLabScenarioId, PluginInventoryLocaleKey> = {
  'host-shadow-compatible': 'lab.scenario.hostCompatible.title',
  'host-shadow-incompatible': 'lab.scenario.hostIncompatible.title',
  'orphaned-bundle': 'lab.scenario.orphan.title',
  'quarantine-removal-residue': 'lab.scenario.quarantineRemoval.title',
  'client-module-unavailable': 'lab.scenario.clientModule.title',
  'loader-package-name-mismatch': 'lab.scenario.loaderPackageNameMismatch.title',
  'startup-operation-timeout': 'lab.scenario.startupTimeout.title',
  'loader-dependency-unavailable': 'lab.scenario.loaderDependency.title',
  'settings-invalid': 'lab.scenario.settingsInvalid.title',
  'module-resolution-missing': 'lab.scenario.module.title',
  'patch-invalid': 'lab.scenario.patch.title',
  'loader-duplicate': 'lab.scenario.duplicate.title',
  'loader-lifecycle-failure': 'lab.scenario.lifecycle.title',
  'build-script-blocked': 'lab.scenario.build.title',
  'interrupted-repair': 'lab.scenario.interrupted.title',
}

function terminal(phase: DiagnosticLabRunSnapshot['phase']): boolean {
  return phase === 'active' || phase === 'restored' || phase === 'failed' || phase === 'cancelled'
}

/** Render a bottom-right job card backed by the Electron-owned run. */
export function DiagnosticLabProgressCard({
  current,
  getRun,
  cancel,
  restoreAll,
  subscribe,
  t,
}: DiagnosticLabProgressCardProps): ReactNode {
  const [snapshot, setSnapshot] = useState<DiagnosticLabRunSnapshot>()
  const [hiddenRunId, setHiddenRunId] = useState<string>()

  useEffect(() => {
    let alive = true
    void current().then((value) => { if (alive) setSnapshot(value) })
    return () => { alive = false }
  }, [current])

  useEffect(() => subscribe(setSnapshot), [subscribe])

  useEffect(() => {
    if (snapshot === undefined || terminal(snapshot.phase)) return
    const timer = window.setTimeout(() => { void getRun(snapshot.runId).then(setSnapshot) }, 700)
    return () => { window.clearTimeout(timer) }
  }, [getRun, snapshot])

  if (snapshot === undefined || hiddenRunId === snapshot.runId) return null
  const progress = snapshot.totalSteps === 0 ? 0 : Math.min(100, Math.round(snapshot.completedSteps / snapshot.totalSteps * 100))
  const currentStep = snapshot.currentStep ?? 'baseline'
  const currentStepIndex = STEPS.indexOf(currentStep)
  const remaining = Math.max(0, snapshot.scenarioIds.length - snapshot.results.length)
  const passed = snapshot.results.filter(result => result.phase === 'passed').length
  const failed = snapshot.results.filter(result => result.phase === 'failed').length
  const running = snapshot.phase === 'queued' || snapshot.phase === 'running' || snapshot.phase === 'restoring'
  const cancellable = snapshot.phase === 'queued' || snapshot.phase === 'running'
  const scenario = snapshot.currentScenarioId === undefined ? '—' : t(SCENARIO_TITLES[snapshot.currentScenarioId])

  return (
    <aside className={css.card} role="status" aria-live="polite" data-diagnostic-lab-progress={snapshot.phase}>
      <div className={css.heading}>
        <div>
          <span>{t('lab.overlay.eyebrow')}</span>
          <h2>{t(`lab.phase.${snapshot.phase}`)}</h2>
        </div>
        <strong>{progress}%</strong>
      </div>
      <ol className={css.steps} aria-label={t('lab.overlay.timeline')}>
        {STEPS.map((step, index) => {
          const done = terminal(snapshot.phase) || index < currentStepIndex
          const active = running && index === currentStepIndex
          return (
            <li key={step} data-state={done ? 'done' : active ? 'active' : 'pending'}>
              <span>{done ? <IconCheckOutline16 size={12} /> : null}</span>
              <small>{t(`lab.overlay.step.${step}`)}</small>
            </li>
          )
        })}
      </ol>
      <progress className={css.progress} max={100} value={progress} />
      <p className={css.current}>
        {t('lab.overlay.current')
          .replace('{scenario}', scenario)}
      </p>
      <div className={css.stats}>
        <span>{t('lab.overlay.remaining').replace('{count}', String(remaining))}</span>
        <span>{t('lab.overlay.passed').replace('{count}', String(passed))}</span>
        <span data-failed={failed > 0}>{t('lab.overlay.failed').replace('{count}', String(failed))}</span>
      </div>
      <div className={css.actions}>
        <Button variant="outline" onClick={() => { setHiddenRunId(snapshot.runId) }}>{t('lab.overlay.hide')}</Button>
        {cancellable ? <Button variant="outline" onClick={() => { void cancel(snapshot.runId).then(setSnapshot) }}>{t('lab.cancel')}</Button> : null}
        {snapshot.phase === 'active' || snapshot.recovery === 'failed' ? (
          <Button variant="outline" onClick={() => { void restoreAll(snapshot.runId).then(setSnapshot) }}>{t('lab.restoreAll')}</Button>
        ) : null}
      </div>
    </aside>
  )
}

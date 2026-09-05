import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button, IconWarningOutline16, RiskConfirmation } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PluginInventoryLocaleKey } from './locales.ts'
import type {
  DiagnosticLabRunSnapshot,
  DiagnosticLabScenario,
  DiagnosticLabScenarioId,
  DiagnosticLabStartRequest,
  DiagnosticLabTarget,
} from './bundled-install-bridge.ts'
import css from './DiagnosticLabPanel.module.css'

/** Desktop Diagnostics Lab operations passed from the plugin apply layer. */
export interface DiagnosticLabInjected {
  readonly listScenarios: () => Promise<readonly DiagnosticLabScenario[]>
  readonly current: () => Promise<DiagnosticLabRunSnapshot | undefined>
  readonly start: (request: DiagnosticLabStartRequest) => Promise<DiagnosticLabRunSnapshot>
  readonly getRun: (runId: string) => Promise<DiagnosticLabRunSnapshot>
  readonly cancel: (runId: string) => Promise<DiagnosticLabRunSnapshot>
  readonly restoreAll: (runId: string) => Promise<DiagnosticLabRunSnapshot>
  readonly exportReport: (runId: string) => Promise<string>
  readonly subscribe: (callback: (snapshot: DiagnosticLabRunSnapshot) => void) => () => void
}

/** Presentation inputs for the desktop-only Diagnostics Lab card. */
export interface DiagnosticLabPanelProps extends DiagnosticLabInjected {
  readonly t: (key: PluginInventoryLocaleKey) => string
}

const SCENARIO_KEYS: Record<DiagnosticLabScenarioId, {
  readonly title: PluginInventoryLocaleKey
  readonly body: PluginInventoryLocaleKey
}> = {
  'host-shadow-compatible': { title: 'lab.scenario.hostCompatible.title', body: 'lab.scenario.hostCompatible.body' },
  'host-shadow-incompatible': { title: 'lab.scenario.hostIncompatible.title', body: 'lab.scenario.hostIncompatible.body' },
  'orphaned-bundle': { title: 'lab.scenario.orphan.title', body: 'lab.scenario.orphan.body' },
  'quarantine-removal-residue': { title: 'lab.scenario.quarantineRemoval.title', body: 'lab.scenario.quarantineRemoval.body' },
  'client-module-unavailable': { title: 'lab.scenario.clientModule.title', body: 'lab.scenario.clientModule.body' },
  'loader-package-name-mismatch': { title: 'lab.scenario.loaderPackageNameMismatch.title', body: 'lab.scenario.loaderPackageNameMismatch.body' },
  'startup-operation-timeout': { title: 'lab.scenario.startupTimeout.title', body: 'lab.scenario.startupTimeout.body' },
  'loader-dependency-unavailable': { title: 'lab.scenario.loaderDependency.title', body: 'lab.scenario.loaderDependency.body' },
  'settings-invalid': { title: 'lab.scenario.settingsInvalid.title', body: 'lab.scenario.settingsInvalid.body' },
  'module-resolution-missing': { title: 'lab.scenario.module.title', body: 'lab.scenario.module.body' },
  'patch-invalid': { title: 'lab.scenario.patch.title', body: 'lab.scenario.patch.body' },
  'loader-duplicate': { title: 'lab.scenario.duplicate.title', body: 'lab.scenario.duplicate.body' },
  'loader-lifecycle-failure': { title: 'lab.scenario.lifecycle.title', body: 'lab.scenario.lifecycle.body' },
  'build-script-blocked': { title: 'lab.scenario.build.title', body: 'lab.scenario.build.body' },
  'interrupted-repair': { title: 'lab.scenario.interrupted.title', body: 'lab.scenario.interrupted.body' },
}

function terminal(phase: DiagnosticLabRunSnapshot['phase']): boolean {
  return phase === 'active' || phase === 'restored' || phase === 'failed' || phase === 'cancelled'
}

function saveReport(content: string, runId: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `dsh-diagnostic-lab-${runId}.json`
  link.click()
  URL.revokeObjectURL(url)
}

/** Render the desktop-only persistent diagnostic scenario controls. */
export function DiagnosticLabPanel({
  listScenarios,
  current,
  start,
  getRun,
  cancel,
  restoreAll,
  exportReport,
  subscribe,
  t,
}: DiagnosticLabPanelProps): ReactNode {
  const [scenarios, setScenarios] = useState<readonly DiagnosticLabScenario[]>([])
  const [selected, setSelected] = useState<ReadonlySet<DiagnosticLabScenarioId>>(new Set())
  const [target, setTarget] = useState<DiagnosticLabTarget>('isolated')
  const [run, setRun] = useState<DiagnosticLabRunSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)

  useEffect(() => {
    let alive = true
    void Promise.all([listScenarios(), current()]).then(([value, active]) => {
      if (!alive) return
      setScenarios(value)
      setSelected(new Set<DiagnosticLabScenarioId>())
      if (active !== undefined) setRun(active)
    }, (reason: unknown) => { if (alive) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { alive = false }
  }, [current, listScenarios])

  useEffect(() => subscribe((snapshot) => {
    setRun(current => current?.runId === snapshot.runId ? snapshot : current)
  }), [subscribe])

  useEffect(() => {
    if (run === null || terminal(run.phase)) return
    const timer = window.setInterval(() => {
      void getRun(run.runId).then(setRun, (reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason))
      })
    }, 500)
    return () => { window.clearInterval(timer) }
  }, [getRun, run])

  const available = useMemo(() => scenarios.filter(scenario => scenario.targets.includes(target)), [scenarios, target])
  const chosen = available.filter(scenario => selected.has(scenario.id))
  const running = run?.phase === 'queued' || run?.phase === 'running' || run?.phase === 'restoring'
  const retained = run?.phase === 'active'
  const recoveryBlocked = run?.recovery === 'failed'
  const occupied = running || retained || recoveryBlocked
  const progress = run === null || run.totalSteps === 0
    ? 0
    : Math.min(100, Math.round(run.completedSteps / run.totalSteps * 100))

  const changeTarget = (next: DiagnosticLabTarget): void => {
    setTarget(next)
    setSelected(new Set<DiagnosticLabScenarioId>())
  }
  const toggleScenario = (id: DiagnosticLabScenarioId): void => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const begin = (): void => {
    if (chosen.length === 0) return
    if (target === 'active-profile' && !confirmOpen) {
      setAcknowledged(false)
      setConfirmOpen(true)
      return
    }
    setConfirmOpen(false)
    setAcknowledged(false)
    setError(null)
    void start({ scenarioIds: chosen.map(item => item.id), target }).then(setRun, (reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  return (
    <section className={css.lab} aria-busy={running}>
      <header>
        <div>
          <span className={css.eyebrow}>{t('lab.eyebrow')}</span>
          <h3>{t('lab.title')}</h3>
          <p>{t('lab.description')}</p>
        </div>
        <span className={css.offline}>{t('lab.offline')}</span>
      </header>

      <div className={css.controls}>
        <label>
          <span>{t('lab.target')}</span>
          <select
            disabled={occupied}
            value={target}
            onChange={(event) => { changeTarget(event.currentTarget.value as DiagnosticLabTarget) }}
          >
            <option value="isolated">{t('lab.target.isolated')}</option>
            <option value="active-profile">{t('lab.target.active')}</option>
          </select>
        </label>
        <span className={css.persistence}>{t('lab.persistence')}</span>
      </div>

      {target === 'active-profile' ? (
        <div className={css.warning} role="status">
          <IconWarningOutline16 size={16} />
          <span>{t('lab.active.warning')}</span>
        </div>
      ) : null}

      <div className={css.scenarios}>
        {available.map((scenario) => {
          const copy = SCENARIO_KEYS[scenario.id]
          return (
            <label key={scenario.id}>
              <input
                type="checkbox"
                disabled={occupied}
                checked={selected.has(scenario.id)}
                onChange={() => { toggleScenario(scenario.id) }}
              />
              <span>
                <strong>{t(copy.title)}</strong>
                <small>{t(copy.body)}</small>
                <code>{scenario.expectedCode}</code>
              </span>
            </label>
          )
        })}
      </div>

      <div className={css.actions}>
        <Button variant="primary" disabled={occupied || chosen.length === 0} onClick={begin}>
          {t('lab.start')}
        </Button>
        {running ? (
          <Button variant="outline" onClick={() => { void cancel(run.runId).then(setRun) }}>
            {t('lab.cancel')}
          </Button>
        ) : null}
        {run !== null && terminal(run.phase) ? (
          <>
            <Button
              variant="outline"
              onClick={() => { void exportReport(run.runId).then((content) => { saveReport(content, run.runId) }) }}
            >
              {t('lab.export')}
            </Button>
            {run.phase === 'active' || run.recovery === 'failed' ? (
              <Button variant="outline" onClick={() => {
                setError(null)
                void restoreAll(run.runId).then(setRun, (reason: unknown) => {
                  setError(reason instanceof Error ? reason.message : String(reason))
                })
              }}>
                {t('lab.restoreAll')}
              </Button>
            ) : null}
          </>
        ) : null}
      </div>

      {run !== null ? (
        <section className={css.progress} data-phase={run.phase}>
          <div>
            <strong>{t(`lab.phase.${run.phase}`)}</strong>
            <span>{progress}%</span>
          </div>
          <progress max={100} value={progress} />
          <p>
            {t('lab.progress')
              .replace('{scenario}', run.currentScenarioId ?? '—')
              .replace('{step}', run.currentStep ?? '—')}
          </p>
          {run.results.length > 0 ? (
            <ul>
              {run.results.map(result => (
                <li key={result.scenarioId} data-result={result.phase}>
                  <span>{result.phase === 'passed' ? '✓' : '!'}</span>
                  <code>{result.scenarioId}</code>
                  <small>{t('lab.duration').replace('{count}', String(result.durationMs))}</small>
                </li>
              ))}
            </ul>
          ) : null}
          {run.diagnostic !== undefined ? <code className={css.diagnostic}>{run.diagnostic}</code> : null}
        </section>
      ) : null}
      {error !== null ? <p className={css.error} role="alert">{error}</p> : null}

      <RiskConfirmation
        open={confirmOpen}
        title={t('lab.confirm.title')}
        description={t('lab.confirm.description')}
        acknowledgeLabel={t('lab.confirm.acknowledge')}
        cancelLabel={t('lab.confirm.cancel')}
        closeLabel={t('lab.confirm.cancel')}
        confirmLabel={t('lab.confirm.start')}
        acknowledged={acknowledged}
        onAcknowledgedChange={setAcknowledged}
        onCancel={() => { setConfirmOpen(false); setAcknowledged(false) }}
        onConfirm={begin}
      />
    </section>
  )
}

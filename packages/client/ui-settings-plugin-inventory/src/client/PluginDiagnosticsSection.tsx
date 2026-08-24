import { useEffect, useState, type ReactNode } from 'react'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  PluginDoctorRequest,
  PluginDoctorSnapshot,
  PluginInstallSnapshot,
  PluginQuarantineRequest,
  PluginRepairNoticeRequest,
  PluginUninstallRequest,
} from '@deepseek-ai/dsh-host-plugin-inventory/types'
import {
  Button,
  IconRefreshOutline16,
  IconWarningOutline16,
  Modal,
  RiskConfirmation,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginInventoryLocaleKey } from './locales.ts'
import css from './PluginDiagnosticsSection.module.css'

/** Remote operations owned by the dedicated Diagnostics settings page. */
export interface PluginDiagnosticsSectionInjected {
  /** Install the fixed incompatible test plugin; present only in Electron source mode. */
  readonly installDiagnosticFixture?: () => Promise<string | undefined>
  /** Read retained repair and quarantine state. */
  list: () => Promise<PluginInventorySnapshot>
  /** Start a current dependency-tree check or repair. */
  startDependencyDoctor: (request: PluginDoctorRequest) => Promise<PluginDoctorSnapshot>
  /** Poll a dependency-tree check or repair. */
  getDependencyDoctor: (doctorId: PluginDoctorSnapshot['doctorId']) => Promise<PluginDoctorSnapshot>
  /** Poll a quarantine retry operation. */
  getInstall: (installId: PluginInstallSnapshot['installId']) => Promise<PluginInstallSnapshot>
  /** Start an exact removal for an active conflicting plugin. */
  startUninstall: (request: PluginUninstallRequest) => Promise<PluginInstallSnapshot>
  /** Retry one quarantined plugin from its retained package specifier. */
  startQuarantineRetry: (request: PluginQuarantineRequest) => Promise<PluginInstallSnapshot>
  /** Physically remove one inactive quarantined plugin and its record. */
  uninstallQuarantine: (request: PluginQuarantineRequest) => Promise<boolean>
  /** Dismiss the retained startup repair notice. */
  dismissDependencyHealth: (request: PluginRepairNoticeRequest) => Promise<boolean>
}

/** Props assembled for the root Settings section. */
export type PluginDiagnosticsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.pluginInventory'>
  & InjectFace<PluginDiagnosticsSectionInjected>

type InventoryState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly snapshot: PluginInventorySnapshot }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const NOTICE_KEYS = {
  repaired: 'health.repaired',
  quarantined: 'health.quarantined',
  failed: 'health.failed',
} satisfies Record<NonNullable<PluginInventorySnapshot['dependencyHealth']['lastRepair']>['status'], PluginInventoryLocaleKey>

const DOCTOR_KEYS = {
  running: 'diagnostics.running',
  healthy: 'diagnostics.healthy',
  issues: 'diagnostics.issues',
  repaired: 'diagnostics.repaired',
  quarantined: 'diagnostics.quarantined',
  failed: 'diagnostics.failed',
} satisfies Record<PluginDoctorSnapshot['phase'], PluginInventoryLocaleKey>

const RETRY_KEYS = {
  succeeded: 'health.retry.succeeded',
  repaired: 'health.retry.repaired',
  quarantined: 'health.retry.quarantined',
  failed: 'health.retry.failed',
} satisfies Record<Exclude<PluginInstallSnapshot['phase'], 'running'>, PluginInventoryLocaleKey>

const QUARANTINE_REASON_KEYS = {
  'incompatible-host-dependency': 'health.quarantine.reason.incompatible',
  'convergence-failed': 'health.quarantine.reason.convergenceFailed',
  'orphaned-bundle': 'health.quarantine.reason.orphanedBundle',
} satisfies Record<PluginInventorySnapshot['dependencyHealth']['quarantined'][number]['reason'], PluginInventoryLocaleKey>

type UninstallTarget =
  | { readonly kind: 'active'; readonly packageName: string }
  | { readonly kind: 'quarantine'; readonly quarantineId: string }

type QuarantineRemoval = {
  readonly quarantineId: string
  readonly phase: 'running' | 'succeeded' | 'failed'
}

function uninstallSucceeded(snapshot: PluginInstallSnapshot | undefined): boolean {
  return snapshot !== undefined && snapshot.phase !== 'running' && snapshot.phase !== 'failed'
}

/** Dedicated profile dependency diagnosis and recovery page. */
export function PluginDiagnosticsSection({
  installDiagnosticFixture,
  list,
  startDependencyDoctor,
  getDependencyDoctor,
  getInstall,
  startUninstall,
  startQuarantineRetry,
  uninstallQuarantine,
  dismissDependencyHealth,
  t,
}: PluginDiagnosticsSectionProps): ReactNode {
  const [revision, setRevision] = useState(0)
  const [inventory, setInventory] = useState<InventoryState>({ status: 'loading' })
  const [doctor, setDoctor] = useState<PluginDoctorSnapshot | null>(null)
  const [diagnosticFixtureConfirmOpen, setDiagnosticFixtureConfirmOpen] = useState(false)
  const [diagnosticFixtureInstalling, setDiagnosticFixtureInstalling] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [quarantineInstall, setQuarantineInstall] = useState<{
    quarantineId: string
    snapshot: PluginInstallSnapshot
  } | null>(null)
  const [activeUninstall, setActiveUninstall] = useState<{
    packageName: string
    snapshot: PluginInstallSnapshot
  } | null>(null)
  const [quarantineRemoval, setQuarantineRemoval] = useState<QuarantineRemoval | null>(null)
  const [uninstallTarget, setUninstallTarget] = useState<UninstallTarget | null>(null)
  const [uninstallAcknowledged, setUninstallAcknowledged] = useState(false)

  useEffect(() => {
    let current = true
    void Promise.resolve().then(() => list()).then(
      (snapshot) => { if (current) setInventory({ status: 'ready', snapshot }) },
      () => { if (current) setInventory({ status: 'error' }) },
    )
    return () => { current = false }
  }, [list, revision])

  useEffect(() => {
    if (doctor?.phase !== 'running') return
    let current = true
    const timer = window.setInterval(() => {
      void getDependencyDoctor(doctor.doctorId).then(
        (snapshot) => {
          if (!current) return
          setDoctor(snapshot)
          if (snapshot.phase !== 'running') setRevision(value => value + 1)
        },
        (error) => { if (current) setActionError(errorMessage(error)) },
      )
    }, 500)
    return () => {
      current = false
      window.clearInterval(timer)
    }
  }, [doctor, getDependencyDoctor])

  useEffect(() => {
    if (quarantineInstall?.snapshot.phase !== 'running') return
    let current = true
    const timer = window.setInterval(() => {
      void getInstall(quarantineInstall.snapshot.installId).then(
        (snapshot) => {
          if (!current) return
          setQuarantineInstall(value => value === null ? null : { ...value, snapshot })
          if (snapshot.phase !== 'running') setRevision(value => value + 1)
        },
        (error) => { if (current) setActionError(errorMessage(error)) },
      )
    }, 500)
    return () => {
      current = false
      window.clearInterval(timer)
    }
  }, [getInstall, quarantineInstall])

  useEffect(() => {
    if (activeUninstall?.snapshot.phase !== 'running') return
    let current = true
    const timer = window.setInterval(() => {
      void getInstall(activeUninstall.snapshot.installId).then(
        (snapshot) => {
          if (!current) return
          setActiveUninstall(value => value === null ? null : { ...value, snapshot })
          if (snapshot.phase !== 'running') {
            setRevision(value => value + 1)
          }
        },
        (error) => { if (current) setActionError(errorMessage(error)) },
      )
    }, 500)
    return () => {
      current = false
      window.clearInterval(timer)
    }
  }, [activeUninstall, getInstall])

  const runDoctor = (repair: boolean): void => {
    setActionError(null)
    void startDependencyDoctor({ profile: 'web', repair }).then(
      setDoctor,
      (error) => { setActionError(errorMessage(error)) },
    )
  }
  const confirmDiagnosticFixture = (): void => {
    if (installDiagnosticFixture === undefined) return
    setDiagnosticFixtureConfirmOpen(false)
    setActionError(null)
    setDiagnosticFixtureInstalling(true)
    void installDiagnosticFixture().then(
      () => {
        setDiagnosticFixtureInstalling(false)
        setDoctor(null)
        setRevision(value => value + 1)
      },
      (error) => {
        setDiagnosticFixtureInstalling(false)
        setActionError(errorMessage(error))
      },
    )
  }
  const confirmUninstall = (): void => {
    if (uninstallTarget === null) return
    const target = uninstallTarget
    setActionError(null)
    setUninstallTarget(null)
    setUninstallAcknowledged(false)
    if (target.kind === 'active') {
      void startUninstall({ profile: 'web', packageName: target.packageName }).then(
        (snapshot) => {
          setActiveUninstall({ packageName: target.packageName, snapshot })
          if (snapshot.phase !== 'running') {
            setRevision(value => value + 1)
          }
        },
        (error) => { setActionError(errorMessage(error)) },
      )
      return
    }
    setQuarantineRemoval({ quarantineId: target.quarantineId, phase: 'running' })
    void uninstallQuarantine({ quarantineId: target.quarantineId }).then(
      (removed) => {
        if (!removed) {
          setQuarantineRemoval({ quarantineId: target.quarantineId, phase: 'failed' })
          setActionError(t('health.uninstall.safetyFailed'))
          return
        }
        setQuarantineRemoval({ quarantineId: target.quarantineId, phase: 'succeeded' })
        setRevision(value => value + 1)
      },
      (error) => {
        setQuarantineRemoval({ quarantineId: target.quarantineId, phase: 'failed' })
        setActionError(errorMessage(error))
      },
    )
  }
  const report = doctor?.report
  const retained = inventory.status === 'ready' ? inventory.snapshot.dependencyHealth.lastRepair : null
  const quarantined = inventory.status === 'ready' ? inventory.snapshot.dependencyHealth.quarantined : []
  const failedEntries = inventory.status === 'ready'
    ? inventory.snapshot.entries.filter(entry => entry.enabled && entry.fiberPhase === 'failed')
    : []
  const retainedConflicts = retained?.conflicts ?? []
  const quarantinedConflicts = quarantined.flatMap(record => record.conflicts)
  const visibleConflicts = report !== undefined && report.conflicts.length > 0
    ? report.conflicts
    : retainedConflicts.length > 0 ? retainedConflicts : quarantinedConflicts
  const retainedOrphanCount = quarantined.filter(record => record.reason === 'orphaned-bundle').length
  const visibleOrphanCount = report !== undefined && report.orphanedBundles.length > 0
    ? report.orphanedBundles.length
    : retainedOrphanCount
  const issueCount = new Set([
    ...(report?.conflicts ?? []).map(conflict => `plugin:${conflict.rootPackage}`),
    ...(report?.orphanedBundles ?? []).map(bundle => `plugin:${bundle.packageName}`),
    ...quarantined.map(record => `plugin:${record.packageName}`),
    ...failedEntries.map(entry => `runtime:${entry.entryId}`),
  ]).size
  const effectiveDoctorPhase = doctor?.phase ?? retained?.status ?? (quarantined.length > 0 ? 'quarantined' : 'idle')
  const statusKey = doctor?.phase === 'healthy' && failedEntries.length > 0
    ? 'diagnostics.runtimeIssues'
    : doctor === null && failedEntries.length > 0
      ? 'diagnostics.runtimeIssues'
      : doctor === null
        ? retained === null ? 'diagnostics.notChecked' : DOCTOR_KEYS[retained.status]
        : DOCTOR_KEYS[doctor.phase]

  return (
    <section className={css.section} aria-busy={inventory.status === 'loading' || doctor?.phase === 'running'}>
      <header className={css.header}>
        <div>
          <h2>{t('diagnostics.title')}</h2>
          <p>{t('diagnostics.description')}</p>
        </div>
        <div className={css.actions}>
          {installDiagnosticFixture !== undefined ? (
            <Tooltip
              label={t('diagnostics.fixture.description')}
              side="bottom"
              delayMs={250}
              maxWidth={320}
            >
              <Button
                variant="outline"
                disabled={diagnosticFixtureInstalling}
                onClick={() => { setDiagnosticFixtureConfirmOpen(true) }}
              >
                <IconWarningOutline16 size={14} />
                {t(diagnosticFixtureInstalling ? 'diagnostics.fixture.installing' : 'diagnostics.fixture.install')}
              </Button>
            </Tooltip>
          ) : null}
          <Button variant="outline" disabled={doctor?.phase === 'running'} onClick={() => { runDoctor(false) }}>
            <IconRefreshOutline16 size={14} />
            {t('diagnostics.check')}
          </Button>
          <Button variant="primary" disabled={doctor?.phase === 'running'} onClick={() => { runDoctor(true) }}>
            {t('diagnostics.repair')}
          </Button>
        </div>
      </header>

      <div className={css.summary} data-doctor-phase={effectiveDoctorPhase}>
        <div className={css.summaryLead}>
          <span className={css.healthDot} aria-hidden="true" />
          <strong>{t(statusKey)}</strong>
        </div>
        <dl>
          <div><dt>{t('diagnostics.metric.issues')}</dt><dd>{issueCount}</dd></div>
          <div><dt>{t('diagnostics.metric.conflicts')}</dt><dd>{visibleConflicts.length}</dd></div>
          <div><dt>{t('diagnostics.metric.orphans')}</dt><dd>{visibleOrphanCount}</dd></div>
          <div><dt>{t('diagnostics.metric.runtime')}</dt><dd>{failedEntries.length}</dd></div>
          <div><dt>{t('diagnostics.metric.quarantine')}</dt><dd>{quarantined.length}</dd></div>
        </dl>
        {quarantined.length > 0 ? (
          <div className={css.summaryAnalysis}>
            <strong>{t('diagnostics.summary.analysis')}</strong>
            {quarantined.map(record => (
              <div key={record.quarantineId}>
                <span><b>{record.packageName}</b> · {t(QUARANTINE_REASON_KEYS[record.reason])}</span>
                {record.conflicts.length > 0 ? record.conflicts.map(conflict => (
                  <p key={`${conflict.dependencyChain.join('>')}:${conflict.declaredIn}`}>
                    <code>{conflict.dependencyChain.join(' → ')}</code>
                    {' · '}{t('health.quarantine.conflict.requires')} {conflict.dependency}@{conflict.declaredRange}
                    {' · '}{t('health.quarantine.conflict.hostUses')} {conflict.hostVersion}
                    {' · '}{t(conflict.compatible
                      ? 'health.quarantine.conflict.convergence'
                      : 'health.quarantine.conflict.incompatible')}
                  </p>
                )) : (
                  <p>{t(`health.quarantine.analysis.${record.reason}`)}</p>
                )}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {inventory.status === 'loading' ? <p className={css.muted}>{t('diagnostics.loading')}</p> : null}
      {inventory.status === 'error' ? (
        <div className={css.inlineError} role="alert">
          <span>{t('diagnostics.loadFailed')}</span>
          <button type="button" onClick={() => { setInventory({ status: 'loading' }); setRevision(value => value + 1) }}>{t('retry')}</button>
        </div>
      ) : null}
      {doctor?.phase === 'failed' ? (
        <div className={css.inlineError} role="alert">
          <IconWarningOutline16 size={16} />
          <span>{doctor.diagnostic ?? t('diagnostics.failed')}</span>
        </div>
      ) : null}
      {actionError !== null ? (
        <div className={`${css.inlineError} ${css.actionError}`} role="alert">
          <IconWarningOutline16 size={16} />
          <div>
            <span>{t('health.actionFailed')}</span>
            <code>{actionError}</code>
          </div>
        </div>
      ) : null}

      {retained !== null && doctor?.phase !== 'healthy' ? (
        <article className={css.notice} data-notice-status={retained.status}>
          <strong>{t(NOTICE_KEYS[retained.status])}</strong>
          {retained.conflicts.map(conflict => (
            <code key={`${conflict.dependencyChain.join('>')}:${conflict.declaredIn}`}>
              {conflict.rootPackage} → {conflict.dependency}@{conflict.declaredRange}
            </code>
          ))}
          <Button variant="outline" onClick={() => {
            setActionError(null)
            void dismissDependencyHealth({ profile: 'web' }).then(
              () => { setRevision(value => value + 1) },
              (error) => { setActionError(errorMessage(error)) },
            )
          }}>{t('health.dismiss')}</Button>
        </article>
      ) : null}

      {report !== undefined && report.conflicts.length + report.orphanedBundles.length > 0 ? (
        <section className={css.findings} aria-labelledby="plugin-diagnostics-findings">
          <h3 id="plugin-diagnostics-findings">{t('diagnostics.findings')}</h3>
          {report.conflicts.map((conflict, index) => {
            const firstForPackage = report.conflicts.findIndex(item => item.rootPackage === conflict.rootPackage) === index
            const uninstall = activeUninstall?.packageName === conflict.rootPackage ? activeUninstall.snapshot : undefined
            return (
              <article className={css.finding} key={`${conflict.dependencyChain.join('>')}:${conflict.declaredIn}`}>
                <div><strong>{conflict.rootPackage}</strong><span>{conflict.compatible ? t('diagnostics.compatible') : t('diagnostics.incompatible')}</span></div>
                <code>{conflict.dependencyChain.join(' → ')}</code>
                <p>{conflict.dependency}@{conflict.declaredRange} · Host {conflict.hostVersion} · {conflict.declaredIn}</p>
                {firstForPackage ? (
                  <div className={css.actions}>
                    <Button
                      variant="outline"
                      disabled={uninstall?.phase === 'running' || uninstallSucceeded(uninstall)}
                      onClick={() => {
                        setUninstallAcknowledged(false)
                        setUninstallTarget({ kind: 'active', packageName: conflict.rootPackage })
                      }}
                    >
                      {uninstall?.phase === 'running' ? t('diagnostics.uninstall.running') : t('diagnostics.uninstall.action')}
                    </Button>
                    {uninstallSucceeded(uninstall) ? <span role="status">{t('diagnostics.uninstall.succeeded')}</span> : null}
                    {uninstall?.phase === 'failed' ? <span role="alert">{t('diagnostics.uninstall.failed')}</span> : null}
                  </div>
                ) : null}
              </article>
            )
          })}
          {report.orphanedBundles.map(bundle => (
            <article className={css.finding} key={`${bundle.packageName}:${bundle.bundleIndex}`}>
              <div><strong>{bundle.packageName}</strong><span>{t('diagnostics.orphan')}</span></div>
              <p>{t('diagnostics.orphanDescription')}</p>
            </article>
          ))}
        </section>
      ) : null}

      {failedEntries.length > 0 ? (
        <section className={css.findings} aria-labelledby="plugin-runtime-findings">
          <h3 id="plugin-runtime-findings">{t('diagnostics.runtimeFindings')}</h3>
          {failedEntries.map(entry => (
            <article className={css.finding} key={entry.entryId} data-failed-plugin-entry={entry.entryId}>
              <div><strong>{entry.moduleName}</strong><span>{t('diagnostics.runtimeFailed')}</span></div>
              <code>{entry.entryId}</code>
              <p>{t('diagnostics.runtimeDescription')}</p>
            </article>
          ))}
        </section>
      ) : null}

      {quarantined.length > 0 ? (
        <section className={css.quarantine}>
          <h3>{t('health.quarantine.title')}</h3>
          <p className={css.muted}>{t('health.quarantine.description')}</p>
          {quarantined.map((record) => {
            const active = quarantineInstall?.quarantineId === record.quarantineId
              ? quarantineInstall.snapshot
              : undefined
            const removal = quarantineRemoval?.quarantineId === record.quarantineId
              ? quarantineRemoval
              : undefined
            return (
              <article className={css.finding} key={record.quarantineId} data-quarantined-plugin={record.packageName}>
                <div><strong>{record.packageName}</strong><span>{t(QUARANTINE_REASON_KEYS[record.reason])}</span></div>
                {record.conflicts.map(conflict => (
                  <div className={css.conflictDetail} key={`${conflict.dependencyChain.join('>')}:${conflict.declaredIn}`}>
                    <code>{conflict.dependencyChain.join(' → ')}</code>
                    <p>
                      {t('health.quarantine.conflict.requires')} {conflict.dependency}@{conflict.declaredRange}
                      {' · '}{t('health.quarantine.conflict.hostUses')} {conflict.hostVersion}
                    </p>
                  </div>
                ))}
                {record.conflicts.length === 0 ? <p>{t(`health.quarantine.analysis.${record.reason}`)}</p> : null}
                <div className={css.actions}>
                  <Button variant="primary" disabled={active?.phase === 'running' || removal?.phase === 'running'} onClick={() => {
                    setActionError(null)
                    void startQuarantineRetry({ quarantineId: record.quarantineId }).then(
                      (snapshot) => { setQuarantineInstall({ quarantineId: record.quarantineId, snapshot }) },
                      (error) => { setActionError(errorMessage(error)) },
                    )
                  }}>{active?.phase === 'running' ? t('health.retry.running') : t('health.retry')}</Button>
                  <Button variant="outline" disabled={active?.phase === 'running' || removal?.phase === 'running' || removal?.phase === 'succeeded'} onClick={() => {
                    setUninstallAcknowledged(false)
                    setUninstallTarget({ kind: 'quarantine', quarantineId: record.quarantineId })
                  }}>{removal?.phase === 'running' ? t('health.uninstall.running') : t('health.uninstall')}</Button>
                  {active !== undefined && active.phase !== 'running'
                    ? <span role={active.phase === 'failed' || active.phase === 'quarantined' ? 'alert' : 'status'}>{t(RETRY_KEYS[active.phase])}</span>
                    : null}
                  {removal?.phase === 'succeeded' ? <span role="status">{t('health.uninstall.succeeded')}</span> : null}
                  {removal?.phase === 'failed' ? <span role="alert">{t('health.uninstall.failed')}</span> : null}
                </div>
              </article>
            )
          })}
        </section>
      ) : null}

      <div className={css.explainers}>
        <details>
          <summary>{t('diagnostics.what.title')}</summary>
          <p>{t('diagnostics.what.body')}</p>
        </details>
        <details>
          <summary>{t('diagnostics.safety.title')}</summary>
          <p>{t('diagnostics.safety.body')}</p>
        </details>
      </div>
      <Modal
        open={diagnosticFixtureConfirmOpen}
        onClose={() => { setDiagnosticFixtureConfirmOpen(false) }}
        title={t('diagnostics.fixture.title')}
        className={css.fixtureDialog ?? ''}
        headless
      >
        <div className={css.fixtureDialogContent}>
          <IconWarningOutline16 size={22} />
          <div className={css.fixtureDialogCopy}>
            <strong>{t('diagnostics.fixture.title')}</strong>
            <p>{t('diagnostics.fixture.description')}</p>
          </div>
          <div className={css.fixtureDialogActions}>
            <button type="button" className={css.fixtureCancel} onClick={() => { setDiagnosticFixtureConfirmOpen(false) }}>
              {t('diagnostics.fixture.cancel')}
            </button>
            <button type="button" className={css.fixtureConfirm} onClick={confirmDiagnosticFixture}>
              {t('diagnostics.fixture.confirm')}
            </button>
          </div>
        </div>
      </Modal>
      <RiskConfirmation
        open={uninstallTarget !== null}
        title={t(uninstallTarget?.kind === 'quarantine' ? 'health.uninstall.confirm.title' : 'diagnostics.uninstall.confirm.title')}
        description={t(uninstallTarget?.kind === 'quarantine' ? 'health.uninstall.confirm.description' : 'diagnostics.uninstall.confirm.description')}
        acknowledgeLabel={t(uninstallTarget?.kind === 'quarantine' ? 'health.uninstall.confirm.acknowledge' : 'diagnostics.uninstall.confirm.acknowledge')}
        cancelLabel={t('diagnostics.uninstall.confirm.cancel')}
        confirmLabel={t(uninstallTarget?.kind === 'quarantine' ? 'health.uninstall.confirm.action' : 'diagnostics.uninstall.confirm.action')}
        acknowledged={uninstallAcknowledged}
        onAcknowledgedChange={setUninstallAcknowledged}
        onCancel={() => {
          setUninstallTarget(null)
          setUninstallAcknowledged(false)
        }}
        onConfirm={confirmUninstall}
      />
    </section>
  )
}

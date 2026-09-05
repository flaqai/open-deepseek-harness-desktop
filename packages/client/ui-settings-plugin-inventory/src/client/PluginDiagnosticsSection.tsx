import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  PluginDoctorRequest,
  PluginDoctorSnapshot,
  PluginBuildApprovalRequest,
  PluginDiagnosticBuildApprovalRequest,
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
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginInventoryLocaleKey } from './locales.ts'
import { DiagnosticLabPanel, type DiagnosticLabInjected } from './DiagnosticLabPanel.tsx'
import { PluginSnapshotPanel } from './PluginSnapshotPanel.tsx'
import type { PluginSnapshotsInjected } from './plugin-snapshot-bridge.ts'
import type { SettingsRecoveryInjected } from './settings-recovery-bridge.ts'
import type {
  StartupDiagnosticIncident,
  StartupDiagnosticsInjected,
} from './startup-diagnostics-bridge.ts'
import css from './PluginDiagnosticsSection.module.css'

/** Remote operations owned by the dedicated Diagnostics settings page. */
export interface PluginDiagnosticsSectionInjected {
  /** Restricted offline exercise runner; present only in Electron Desktop. */
  readonly diagnosticLab?: DiagnosticLabInjected
  /** Durable plugin rollback points; present only in Electron Desktop. */
  readonly pluginSnapshots?: PluginSnapshotsInjected
  /** Fixed-path settings recovery owned by Electron; never accepts a renderer path. */
  readonly settingsRecovery?: SettingsRecoveryInjected
  /** Redacted desktop startup timeouts and recovery failures. */
  readonly startupDiagnostics?: StartupDiagnosticsInjected
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
  /** Approve one exact retained build key and retry its quarantined plugin. */
  approveQuarantineBuild: (request: PluginBuildApprovalRequest) => Promise<PluginInstallSnapshot>
  /** Approve one exact build key retained by a failed package operation. */
  approveDiagnosticBuild: (request: PluginDiagnosticBuildApprovalRequest) => Promise<PluginInstallSnapshot>
  /** Export the current redacted diagnostics bundle. */
  exportDiagnostics: () => Promise<string>
  /** Physically remove one inactive quarantined plugin and its record. */
  uninstallQuarantine: (request: PluginQuarantineRequest) => Promise<boolean>
  /** Dismiss the retained startup repair notice. */
  dismissDependencyHealth: (request: PluginRepairNoticeRequest) => Promise<boolean>
  /** Open the market at the quarantined package after its inactive old version is removed. */
  openPluginMarket: (packageName: string) => void
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
  'build-script-blocked': 'health.quarantine.reason.buildScriptBlocked',
  'client-module-unavailable': 'health.quarantine.reason.clientModuleUnavailable',
  'loader-module-unresolvable': 'health.quarantine.reason.loaderModuleUnresolvable',
  'loader-dependency-unavailable': 'health.quarantine.reason.loaderDependencyUnavailable',
} satisfies Record<PluginInventorySnapshot['dependencyHealth']['quarantined'][number]['reason'], PluginInventoryLocaleKey>

const QUARANTINE_SOLUTION_KEYS = {
  'incompatible-host-dependency': 'health.quarantine.solution.incompatible-host-dependency',
  'convergence-failed': 'health.quarantine.solution.convergence-failed',
  'orphaned-bundle': 'health.quarantine.solution.orphaned-bundle',
  'build-script-blocked': 'health.quarantine.solution.build-script-blocked',
  'client-module-unavailable': 'health.quarantine.solution.client-module-unavailable',
  'loader-module-unresolvable': 'health.quarantine.solution.loader-module-unresolvable',
  'loader-dependency-unavailable': 'health.quarantine.solution.loader-dependency-unavailable',
} satisfies Record<PluginInventorySnapshot['dependencyHealth']['quarantined'][number]['reason'], PluginInventoryLocaleKey>

const QUARANTINE_RETRY_KEYS = {
  'incompatible-host-dependency': 'health.quarantine.action.compatibleRetry',
  'convergence-failed': 'health.quarantine.action.convergeRetry',
  'orphaned-bundle': 'health.quarantine.action.restoreSource',
  'build-script-blocked': 'health.approveBuild',
  'client-module-unavailable': 'health.quarantine.action.findUpdate',
  'loader-module-unresolvable': 'health.quarantine.action.findUpdate',
  'loader-dependency-unavailable': 'health.quarantine.action.findUpdate',
} satisfies Record<PluginInventorySnapshot['dependencyHealth']['quarantined'][number]['reason'], PluginInventoryLocaleKey>

type DiagnosticIssue = PluginInventorySnapshot['dependencyHealth']['issues'][number]

const DIAGNOSTIC_ACTION_KEYS = {
  retry: 'diagnostics.action.retry',
  repair: 'diagnostics.action.repair',
  'approve-build': 'diagnostics.action.approveBuild',
  isolate: 'diagnostics.action.isolate',
  restore: 'diagnostics.action.restore',
  'open-config': 'diagnostics.action.openConfig',
  'reset-config': 'diagnostics.action.resetConfig',
  export: 'diagnostics.action.export',
} satisfies Record<DiagnosticIssue['actions'][number], PluginInventoryLocaleKey>

function diagnosticIssueCopy(code: DiagnosticIssue['code']): PluginInventoryLocaleKey {
  if (code === 'profile.quarantine-removal-residue') return 'diagnostics.issue.quarantineRemovalResidue'
  if (code === 'profile.session-persistence-migration') return 'diagnostics.issue.sessionPersistenceMigration'
  if (code === 'pnpm.build-script-blocked') return 'diagnostics.issue.buildScript'
  if (code === 'pnpm.minimum-release-age' || code === 'pnpm.supply-chain' || code === 'pnpm.integrity') {
    return 'diagnostics.issue.supplyChain'
  }
  if (code === 'pnpm.network' || code === 'pnpm.registry-auth') return 'diagnostics.issue.network'
  if (code.startsWith('pnpm.')) return 'diagnostics.issue.packageManager'
  if (code.startsWith('loader.') || code === 'profile.module-resolution') return 'diagnostics.issue.loader'
  if (code.startsWith('config.') || code === 'profile.patch-invalid') return 'diagnostics.issue.config'
  if (code.startsWith('runtime.')) return 'diagnostics.issue.runtime'
  if (code.startsWith('profile.')) return 'diagnostics.issue.profile'
  return 'diagnostics.issue.unknown'
}

function startupDiagnosticSolution(code: string): PluginInventoryLocaleKey {
  if (code === 'runtime.profile-check-timeout') return 'diagnostics.startup.solution.profileCheck'
  if (code === 'runtime.profile-repair-timeout' || code === 'runtime.profile-repair-failed') {
    return 'diagnostics.startup.solution.profileRepair'
  }
  if (code === 'runtime.bundled-plugin-timeout' || code === 'runtime.bundled-plugin-failed') {
    return 'diagnostics.startup.solution.bundledPlugin'
  }
  if (code === 'runtime.profile-mutation-lock-busy') return 'diagnostics.startup.solution.lockBusy'
  if (code === 'runtime.startup-rollback-failed') return 'diagnostics.startup.solution.rollback'
  return 'diagnostics.startup.solution.unknown'
}

type StartupRetryStatus = 'running' | 'started'

function withoutStartupRetryStatus(
  current: Readonly<Record<string, StartupRetryStatus>>,
  incidentId: string,
): Record<string, StartupRetryStatus> {
  return Object.fromEntries(Object.entries(current).filter(([key]) => key !== incidentId))
}

type UninstallTarget =
  | { readonly kind: 'active'; readonly packageName: string }
  | {
    readonly kind: 'quarantine'
    readonly quarantineId: string
    readonly packageName: string
    readonly after?: 'market'
  }

type QuarantineRemoval = {
  readonly quarantineId: string
  readonly phase: 'running' | 'succeeded' | 'failed'
}

type BuildApprovalTarget =
  | {
    readonly kind: 'quarantine'
    readonly record: PluginInventorySnapshot['dependencyHealth']['quarantined'][number]
  }
  | { readonly kind: 'diagnostic'; readonly issue: DiagnosticIssue }

function uninstallSucceeded(snapshot: PluginInstallSnapshot | undefined): boolean {
  return snapshot !== undefined && snapshot.phase !== 'running' && snapshot.phase !== 'failed'
}

/** Dedicated profile dependency diagnosis and recovery page. */
export function PluginDiagnosticsSection({
  preferredSubsectionId,
  diagnosticLab,
  pluginSnapshots,
  settingsRecovery,
  startupDiagnostics,
  list,
  startDependencyDoctor,
  getDependencyDoctor,
  getInstall,
  startUninstall,
  startQuarantineRetry,
  approveQuarantineBuild,
  approveDiagnosticBuild,
  exportDiagnostics,
  uninstallQuarantine,
  dismissDependencyHealth,
  openPluginMarket,
  t,
}: PluginDiagnosticsSectionProps): ReactNode {
  const snapshotsSection = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (preferredSubsectionId === 'snapshots') snapshotsSection.current?.scrollIntoView({ block: 'start' })
  }, [preferredSubsectionId])
  const [revision, setRevision] = useState(0)
  const [inventory, setInventory] = useState<InventoryState>({ status: 'loading' })
  const [doctor, setDoctor] = useState<PluginDoctorSnapshot | null>(null)
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
  const [buildApprovalTarget, setBuildApprovalTarget] = useState<BuildApprovalTarget | null>(null)
  const [diagnosticBuildInstall, setDiagnosticBuildInstall] = useState<{
    diagnosticId: string
    snapshot: PluginInstallSnapshot
  } | null>(null)
  const [uninstallAcknowledged, setUninstallAcknowledged] = useState(false)
  const [startupIncidents, setStartupIncidents] = useState<readonly StartupDiagnosticIncident[]>([])
  const [startupRetryStatus, setStartupRetryStatus] = useState<Record<string, StartupRetryStatus>>({})

  useEffect(() => {
    let current = true
    if (startupDiagnostics === undefined) return () => { current = false }
    void startupDiagnostics.list().then(
      (incidents) => { if (current) setStartupIncidents(incidents) },
      (error: unknown) => { if (current) setActionError(errorMessage(error)) },
    )
    return () => { current = false }
  }, [startupDiagnostics, revision])

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
        (error: unknown) => { if (current) setActionError(errorMessage(error)) },
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
        (error: unknown) => { if (current) setActionError(errorMessage(error)) },
      )
    }, 500)
    return () => {
      current = false
      window.clearInterval(timer)
    }
  }, [getInstall, quarantineInstall])

  useEffect(() => {
    if (diagnosticBuildInstall?.snapshot.phase !== 'running') return
    let current = true
    const timer = window.setInterval(() => {
      void getInstall(diagnosticBuildInstall.snapshot.installId).then(
        (snapshot) => {
          if (!current) return
          setDiagnosticBuildInstall(value => value === null ? null : { ...value, snapshot })
          if (snapshot.phase !== 'running') setRevision(value => value + 1)
        },
        (error: unknown) => { if (current) setActionError(errorMessage(error)) },
      )
    }, 500)
    return () => {
      current = false
      window.clearInterval(timer)
    }
  }, [diagnosticBuildInstall, getInstall])

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
        (error: unknown) => { if (current) setActionError(errorMessage(error)) },
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
      (error: unknown) => { setActionError(errorMessage(error)) },
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
        (error: unknown) => { setActionError(errorMessage(error)) },
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
        if (target.after === 'market') openPluginMarket(target.packageName)
      },
      (error: unknown) => {
        setQuarantineRemoval({ quarantineId: target.quarantineId, phase: 'failed' })
        setActionError(errorMessage(error))
      },
    )
  }
  const confirmBuildApproval = (): void => {
    if (buildApprovalTarget === null) return
    const target = buildApprovalTarget
    setBuildApprovalTarget(null)
    setActionError(null)
    if (target.kind === 'quarantine') {
      void approveQuarantineBuild({ quarantineId: target.record.quarantineId }).then(
        (snapshot) => { setQuarantineInstall({ quarantineId: target.record.quarantineId, snapshot }) },
        (error: unknown) => { setActionError(errorMessage(error)) },
      )
      return
    }
    void approveDiagnosticBuild({ diagnosticId: target.issue.diagnosticId }).then(
      (snapshot) => { setDiagnosticBuildInstall({ diagnosticId: target.issue.diagnosticId, snapshot }) },
      (error: unknown) => { setActionError(errorMessage(error)) },
    )
  }
  const downloadDiagnostics = (): void => {
    setActionError(null)
    void exportDiagnostics().then(
      (content) => {
        const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
        const link = document.createElement('a')
        link.href = url
        link.download = `dsh-profile-diagnostics-${new Date().toISOString().replaceAll(':', '-')}.json`
        link.click()
        URL.revokeObjectURL(url)
      },
      (error: unknown) => { setActionError(errorMessage(error)) },
    )
  }
  const report = doctor?.report
  const retained = inventory.status === 'ready' ? inventory.snapshot.dependencyHealth.lastRepair : null
  const quarantined = inventory.status === 'ready' ? inventory.snapshot.dependencyHealth.quarantined : []
  const retainedIssues = inventory.status === 'ready' ? inventory.snapshot.dependencyHealth.issues : []
  const safeMode = inventory.status === 'ready' ? inventory.snapshot.dependencyHealth.safeMode ?? null : null
  const currentIssues = report?.issues ?? retainedIssues
  const failedEntries = inventory.status === 'ready'
    ? inventory.snapshot.entries.filter(entry => entry.enabled && entry.fiberPhase === 'failed')
    : []
  const quarantinedWithoutIssue = quarantined.filter(record => !currentIssues.some(issue => (
    issue.attribution?.rootPackage === record.packageName
  )))
  const dependencyIssueCount = currentIssues.filter(issue => issue.code === 'profile.host-dependency-conflict').length
    + quarantinedWithoutIssue.reduce((count, record) => count + record.conflicts.length, 0)
  const loadIssueCount = currentIssues.filter(issue => (
    issue.source === 'loader' || issue.source === 'cordis-runtime'
  )).length
    + failedEntries.length
  const configIssueCount = currentIssues.filter(issue => issue.source === 'config' || issue.code === 'profile.patch-invalid').length
  const issueCount = currentIssues.length + failedEntries.length + quarantinedWithoutIssue.length
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
          <Button variant="outline" onClick={downloadDiagnostics}>
            {t('diagnostics.export')}
          </Button>
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
          <div><dt>{t('diagnostics.metric.conflicts')}</dt><dd>{dependencyIssueCount}</dd></div>
          <div><dt>{t('diagnostics.metric.load')}</dt><dd>{loadIssueCount}</dd></div>
          <div><dt>{t('diagnostics.metric.config')}</dt><dd>{configIssueCount}</dd></div>
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
                <p className={css.summarySolution}>
                  <b>{t('health.quarantine.solution.title')}：</b>{t(QUARANTINE_SOLUTION_KEYS[record.reason])}
                </p>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {safeMode !== null ? (
        <article className={css.safeModeNotice} role="status">
          <IconWarningOutline16 size={16} />
          <div>
            <strong>{t('diagnostics.safeMode.title')}</strong>
            <p>{t('diagnostics.safeMode.description')}</p>
            {safeMode.skippedBundles.length > 0 ? <code>{safeMode.skippedBundles.join(', ')}</code> : null}
          </div>
        </article>
      ) : null}

      {startupIncidents.length > 0 ? (
        <section className={css.findings} aria-labelledby="desktop-startup-diagnostics">
          <h3 id="desktop-startup-diagnostics">{t('diagnostics.startup.title')}</h3>
          <p className={css.muted}>{t('diagnostics.startup.description')}</p>
          {startupIncidents.map(incident => (
            <article className={css.finding} key={incident.incidentId} data-diagnostic-code={incident.code}>
              <div>
                <strong>{t('diagnostics.startup.issue')}</strong>
                <span>{incident.code}</span>
              </div>
              {incident.packageName === undefined ? null : <code>{incident.packageName}</code>}
              <p>{incident.operation} · {new Date(incident.createdAt).toLocaleString()}</p>
              <p className={css.summarySolution}>
                <b>{t('health.quarantine.solution.title')}：</b>{t(startupDiagnosticSolution(incident.code))}
              </p>
              <div className={css.actions}>
                {incident.actions.includes('retry-plugin')
                  || incident.code === 'runtime.profile-check-timeout'
                  || incident.code === 'runtime.profile-repair-timeout'
                  || incident.code === 'runtime.profile-repair-failed' ? (
                    <Button
                      variant="primary"
                      disabled={startupRetryStatus[incident.incidentId] !== undefined}
                      onClick={() => {
                        setActionError(null)
                        setStartupRetryStatus(current => ({ ...current, [incident.incidentId]: 'running' }))
                        void startupDiagnostics?.retry(incident.incidentId).then(
                          (result) => {
                            if (result.status === 'plugin-started') {
                              setStartupRetryStatus(current => ({ ...current, [incident.incidentId]: 'started' }))
                            } else if (result.status === 'unsupported') {
                              setStartupRetryStatus(current => (
                                withoutStartupRetryStatus(current, incident.incidentId)
                              ))
                              setActionError(t('diagnostics.startup.retryUnsupported'))
                            }
                          },
                          (error: unknown) => {
                            setStartupRetryStatus(current => (
                              withoutStartupRetryStatus(current, incident.incidentId)
                            ))
                            setActionError(errorMessage(error))
                          },
                        )
                      }}
                    >
                      {startupRetryStatus[incident.incidentId] === 'running'
                        ? t('diagnostics.startup.retrying')
                        : startupRetryStatus[incident.incidentId] === 'started'
                          ? t('diagnostics.startup.retryStarted')
                          : t('diagnostics.startup.retry')}
                    </Button>
                  ) : null}
                {incident.actions.includes('snapshot-restore') ? (
                  <Button onClick={() => { snapshotsSection.current?.scrollIntoView({ block: 'start' }) }}>
                    {t('diagnostics.startup.snapshots')}
                  </Button>
                ) : null}
              </div>
            </article>
          ))}
          <div className={css.actions}>
            <Button onClick={() => {
              void startupDiagnostics?.openLog().then(
                ({ error }) => { if (error !== '') setActionError(error) },
                (error: unknown) => { setActionError(errorMessage(error)) },
              )
            }}>{t('diagnostics.startup.openLog')}</Button>
          </div>
        </section>
      ) : null}

      {currentIssues.length > 0 ? (
        <section className={css.findings} aria-labelledby="profile-current-diagnostics">
          <h3 id="profile-current-diagnostics">{t('diagnostics.currentIssues')}</h3>
          {currentIssues.map(issue => (
            <article className={css.finding} key={issue.diagnosticId} data-diagnostic-code={issue.code}>
              <div>
                <strong>{t(diagnosticIssueCopy(issue.code))}</strong>
                <span>{issue.nativeCode ?? issue.code}</span>
              </div>
              {issue.attribution?.rootPackage !== undefined ? <code>{issue.attribution.rootPackage}</code> : null}
              {issue.attribution?.dependencyChain !== undefined ? (
                <code>{issue.attribution.dependencyChain.join(' → ')}</code>
              ) : null}
              {issue.attribution?.moduleName !== undefined ? <code>{issue.attribution.moduleName}</code> : null}
              {issue.attribution?.importerPackage !== undefined ? <code>{issue.attribution.importerPackage}</code> : null}
              {issue.attribution?.missingModule !== undefined ? <code>{issue.attribution.missingModule}</code> : null}
              {issue.attribution?.entryId !== undefined ? <code>{issue.attribution.entryId}</code> : null}
              <p>{t('diagnostics.issue.phase')}: {issue.phase} · {t('diagnostics.issue.actions')}: {issue.actions.map(action => t(DIAGNOSTIC_ACTION_KEYS[action])).join(', ')}</p>
              {issue.evidence.length > 0 ? (
                <details className={css.evidence}>
                  <summary>{t('diagnostics.issue.evidence')}</summary>
                  {issue.evidence.map((evidence, index) => <code key={`${issue.diagnosticId}:${index}`}>{evidence}</code>)}
                </details>
              ) : null}
              {issue.code === 'pnpm.build-script-blocked' && issue.buildApprovalKey !== undefined ? (
                <div className={css.actions}>
                  <Button
                    variant="primary"
                    disabled={diagnosticBuildInstall?.diagnosticId === issue.diagnosticId
                      && diagnosticBuildInstall.snapshot.phase === 'running'}
                    onClick={() => { setBuildApprovalTarget({ kind: 'diagnostic', issue }) }}
                  >
                    {diagnosticBuildInstall?.diagnosticId === issue.diagnosticId
                      && diagnosticBuildInstall.snapshot.phase === 'running'
                      ? t('health.retry.running')
                      : t('health.approveBuild')}
                  </Button>
                </div>
              ) : null}
              {issue.code === 'config.settings-invalid' && settingsRecovery !== undefined ? (
                <div className={css.actions}>
                  <Button onClick={() => {
                    setActionError(null)
                    void settingsRecovery.openSettingsDocument().then(
                      ({ error }) => { if (error !== '') setActionError(error) },
                      (error: unknown) => { setActionError(errorMessage(error)) },
                    )
                  }}>
                    {t('diagnostics.settings.open')}
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => {
                      if (!globalThis.confirm(t('diagnostics.settings.resetConfirm'))) return
                      setActionError(null)
                      void settingsRecovery.backupAndResetSettings().catch(
                        (error: unknown) => { setActionError(errorMessage(error)) },
                      )
                    }}
                  >
                    {t('diagnostics.settings.reset')}
                  </Button>
                </div>
              ) : null}
              {issue.code === 'profile.quarantine-removal-residue' ? (
                <div className={css.actions}>
                  <Button
                    variant="primary"
                    disabled={doctor?.phase === 'running'}
                    onClick={() => { runDoctor(true) }}
                  >
                    {t('diagnostics.repairQuarantineRemovalResidue')}
                  </Button>
                </div>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}

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
              (error: unknown) => { setActionError(errorMessage(error)) },
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
                <p>{conflict.dependency}@{conflict.declaredRange} · {t('diagnostics.host')} {conflict.hostVersion} · {conflict.declaredIn}</p>
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
                <div className={css.solution}>
                  <strong>{t('health.quarantine.solution.title')}</strong>
                  <p>{t(QUARANTINE_SOLUTION_KEYS[record.reason])}</p>
                  <div>
                    {record.installedVersion === undefined ? null : (
                      <span>{t('health.quarantine.installedVersion')} <code>{record.installedVersion}</code></span>
                    )}
                    <span>{t('health.quarantine.originalSpec')} <code>{record.packageSpec}</code></span>
                  </div>
                </div>
                <div className={css.actions}>
                  {record.reason === 'client-module-unavailable'
                    || record.reason === 'loader-module-unresolvable'
                    || record.reason === 'loader-dependency-unavailable' ? (
                      <Button
                        variant="primary"
                        disabled={removal?.phase === 'running'}
                        onClick={() => {
                          setUninstallAcknowledged(false)
                          setUninstallTarget({
                            kind: 'quarantine',
                            quarantineId: record.quarantineId,
                            packageName: record.packageName,
                            after: 'market',
                          })
                        }}
                      >
                        {removal?.phase === 'running'
                          ? t('health.uninstall.running')
                          : t(QUARANTINE_RETRY_KEYS[record.reason])}
                      </Button>
                    ) : (
                      <Button variant="primary" disabled={active?.phase === 'running' || removal?.phase === 'running'} onClick={() => {
                        setActionError(null)
                        if (record.reason === 'build-script-blocked' && record.buildApprovalKey !== undefined) {
                          setBuildApprovalTarget({ kind: 'quarantine', record })
                          return
                        }
                        void startQuarantineRetry({ quarantineId: record.quarantineId }).then(
                          (snapshot) => { setQuarantineInstall({ quarantineId: record.quarantineId, snapshot }) },
                          (error: unknown) => { setActionError(errorMessage(error)) },
                        )
                      }}>{active?.phase === 'running'
                          ? t('health.retry.running')
                          : t(QUARANTINE_RETRY_KEYS[record.reason])}</Button>
                    )}
                  <Button variant="outline" disabled={active?.phase === 'running' || removal?.phase === 'running' || removal?.phase === 'succeeded'} onClick={() => {
                    setUninstallAcknowledged(false)
                    setUninstallTarget({
                      kind: 'quarantine',
                      quarantineId: record.quarantineId,
                      packageName: record.packageName,
                    })
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

      {pluginSnapshots === undefined ? null : <div ref={snapshotsSection}><PluginSnapshotPanel {...pluginSnapshots} t={t} /></div>}

      {diagnosticLab === undefined ? null : <DiagnosticLabPanel {...diagnosticLab} t={t} />}

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
        open={buildApprovalTarget !== null}
        onClose={() => { setBuildApprovalTarget(null) }}
        title={t('health.approveBuild.title')}
        className={css.fixtureDialog ?? ''}
        headless
      >
        <div className={css.fixtureDialogContent}>
          <IconWarningOutline16 size={22} />
          <div className={css.fixtureDialogCopy}>
            <strong>{t('health.approveBuild.title')}</strong>
            <p>{t('health.approveBuild.description')}</p>
            {buildApprovalTarget === null ? null : (
              <code className={css.buildKey}>
                {buildApprovalTarget.kind === 'quarantine'
                  ? buildApprovalTarget.record.buildApprovalKey
                  : buildApprovalTarget.issue.buildApprovalKey}
              </code>
            )}
          </div>
          <div className={css.fixtureDialogActions}>
            <button type="button" className={css.fixtureCancel} onClick={() => { setBuildApprovalTarget(null) }}>
              {t('health.approveBuild.cancel')}
            </button>
            <button type="button" className={css.fixtureConfirm} onClick={confirmBuildApproval}>
              {t('health.approveBuild.confirm')}
            </button>
          </div>
        </div>
      </Modal>
      <RiskConfirmation
        open={uninstallTarget !== null}
        closeLabel={t('diagnostics.uninstall.confirm.cancel')}
        title={t(uninstallTarget?.kind === 'quarantine' && uninstallTarget.after === 'market'
          ? 'health.update.confirm.title'
          : uninstallTarget?.kind === 'quarantine' ? 'health.uninstall.confirm.title' : 'diagnostics.uninstall.confirm.title')}
        description={t(uninstallTarget?.kind === 'quarantine' && uninstallTarget.after === 'market'
          ? 'health.update.confirm.description'
          : uninstallTarget?.kind === 'quarantine' ? 'health.uninstall.confirm.description' : 'diagnostics.uninstall.confirm.description')}
        acknowledgeLabel={t(uninstallTarget?.kind === 'quarantine' && uninstallTarget.after === 'market'
          ? 'health.update.confirm.acknowledge'
          : uninstallTarget?.kind === 'quarantine' ? 'health.uninstall.confirm.acknowledge' : 'diagnostics.uninstall.confirm.acknowledge')}
        cancelLabel={t('diagnostics.uninstall.confirm.cancel')}
        confirmLabel={t(uninstallTarget?.kind === 'quarantine' && uninstallTarget.after === 'market'
          ? 'health.update.confirm.action'
          : uninstallTarget?.kind === 'quarantine' ? 'health.uninstall.confirm.action' : 'diagnostics.uninstall.confirm.action')}
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

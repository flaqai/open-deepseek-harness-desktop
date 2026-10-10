/** Bundled Python runtime cards embedded between experimental capabilities and external tools. */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, IconCodeOutline16, Modal, TerminalBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PluginInventoryLocaleKey } from './locales.ts'
import type {
  WorkspaceRuntimeCapability,
  WorkspaceRuntimeInjected,
  WorkspaceRuntimeJobSnapshot,
  WorkspaceRuntimeSnapshot,
} from './workspace-runtime-bridge.ts'
import css from './ExternalToolsSection.module.css'

interface Props extends WorkspaceRuntimeInjected {
  readonly restart: () => Promise<boolean>
  readonly t: (key: PluginInventoryLocaleKey) => string
}

interface Definition {
  readonly id: WorkspaceRuntimeCapability
  readonly nameKey: PluginInventoryLocaleKey
  readonly descriptionKey: PluginInventoryLocaleKey
}

const DEFINITIONS: readonly Definition[] = [
  { id: 'office', nameKey: 'external.runtime.office.title', descriptionKey: 'external.runtime.office.description' },
  { id: 'ptc', nameKey: 'external.runtime.ptc.title', descriptionKey: 'external.runtime.ptc.description' },
]

function statusKey(phase: WorkspaceRuntimeSnapshot['capabilities']['office']['phase']): PluginInventoryLocaleKey {
  return `external.runtime.status.${phase}`
}

/** Render the Desktop-only workspace-runtime group. */
export function WorkspaceRuntimesSection(props: Props): ReactNode {
  const [snapshot, setSnapshot] = useState<WorkspaceRuntimeSnapshot>()
  const [jobs, setJobs] = useState<Partial<Record<WorkspaceRuntimeCapability, WorkspaceRuntimeJobSnapshot>>>({})
  const [progress, setProgress] = useState<WorkspaceRuntimeCapability>()
  const [output, setOutput] = useState<Record<string, { text: string; offset: number; lossy: boolean; settled: boolean }>>({})
  const [riskOpen, setRiskOpen] = useState(false)
  const [riskAccepted, setRiskAccepted] = useState(false)
  const [packagePlanOpen, setPackagePlanOpen] = useState(false)
  const [error, setError] = useState<string>()
  const terminal = useRef<HTMLDivElement>(null)

  const refresh = useCallback((): void => {
    void props.getWorkspaceRuntimes().then(setSnapshot, () => { setError(props.t('external.runtime.error.load')) })
  }, [props.getWorkspaceRuntimes, props.t])
  useEffect(refresh, [refresh])

  const running = Object.values(jobs).find(job => job.phase === 'running')
  useEffect(() => {
    if (running === undefined) return
    const timer = window.setTimeout(() => {
      void props.getWorkspaceRuntimeJob(running.jobId).then((next) => {
        setJobs(previous => ({ ...previous, [next.capabilityId]: next }))
        if (next.phase === 'succeeded') refresh()
      }, () => { setError(props.t('external.runtime.error.job')) })
    }, 500)
    return () => { window.clearTimeout(timer) }
  }, [running, props.getWorkspaceRuntimeJob, refresh])

  const selected = progress === undefined ? undefined : jobs[progress]
  const transcript = selected === undefined ? undefined : output[selected.jobId]
  useEffect(() => {
    if (selected === undefined || selected.phase === 'paused' || transcript?.settled === true) return
    const timer = window.setTimeout(() => {
      void props.readWorkspaceRuntimeOutput(selected.jobId, transcript?.offset ?? 0).then((read) => {
        setOutput(previous => ({
          ...previous,
          [selected.jobId]: {
            text: `${previous[selected.jobId]?.text ?? ''}${read.text}`,
            offset: read.nextOffset,
            lossy: (previous[selected.jobId]?.lossy ?? false) || read.lossy,
            settled: read.settled,
          },
        }))
      }, () => { setError(props.t('external.runtime.error.job')) })
    }, transcript === undefined ? 0 : 500)
    return () => { window.clearTimeout(timer) }
  }, [selected, transcript?.offset, props.readWorkspaceRuntimeOutput])
  useEffect(() => {
    const element = terminal.current
    if (element !== null) element.scrollTop = element.scrollHeight
  }, [transcript?.text])

  const start = async (capability: WorkspaceRuntimeCapability): Promise<void> => {
    setError(undefined)
    try {
      const job = await props.startWorkspaceRuntime(capability)
      setJobs(previous => ({ ...previous, [capability]: job }))
      setOutput(previous => ({ ...previous, [job.jobId]: { text: '', offset: 0, lossy: false, settled: false } }))
      setProgress(capability)
    } catch { setError(props.t('external.runtime.error.start')) }
  }

  const activate = async (capability: WorkspaceRuntimeCapability): Promise<void> => {
    setError(undefined)
    try { setSnapshot(await props.activateWorkspaceRuntime(capability)) }
    catch { setError(props.t('external.runtime.error.activate')) }
  }

  const remove = async (capability: WorkspaceRuntimeCapability): Promise<void> => {
    setError(undefined)
    try { setSnapshot(await props.removeWorkspaceRuntime(capability)) }
    catch { setError(props.t('external.runtime.error.remove')) }
  }

  const restart = async (): Promise<void> => {
    if (!await props.restart()) setError(props.t('external.restart.failed'))
  }

  const choosePython = async (): Promise<void> => {
    setError(undefined)
    try {
      const next = await props.chooseWorkspacePython()
      if (next !== undefined) setSnapshot(next)
    } catch { setError(props.t('external.runtime.python.error')) }
  }

  const installOffice = async (allowPackageChanges: boolean): Promise<void> => {
    setError(undefined)
    try {
      setSnapshot(await props.installWorkspaceOffice(allowPackageChanges))
      setPackagePlanOpen(false)
      await start('office')
    }
    catch { setError(props.t('external.runtime.office.installError')) }
  }

  return (
    <>
      <div className={css.groupHeading}>
        <div>
          <h3>{props.t('external.runtime.title')}</h3>
          <p>{props.t('external.runtime.description')}</p>
        </div>
      </div>
      <ul className={css.grid} data-testid="workspace-runtime-grid">
        <li className={css.card} data-testid="workspace-python-card">
          <div className={css.cardTop}>
            <span className={css.toolMark} data-tool="workspace-runtime" aria-hidden="true"><IconCodeOutline16 size={20} /></span>
            <span className={css.status}>{snapshot?.python?.source === 'custom'
              ? props.t('external.runtime.python.custom') : props.t('external.runtime.python.managed')}</span>
          </div>
          <div className={css.cardBody}>
            <div className={css.toolTitle}><h3>{props.t('external.runtime.python.title')}</h3></div>
            <p>{props.t('external.runtime.python.description')}</p>
            {snapshot?.python?.probe === undefined ? null : <p className={css.runtimeNotice}>
              {`${snapshot.python.probe.implementation} ${snapshot.python.probe.version} · ${snapshot.python.probe.architecture} · ${snapshot.python.probe.executable}`}
            </p>}
          </div>
          <div className={css.cardAction}>
            <Button variant="outline" disabled={snapshot?.capabilities.office.phase === 'nas-unavailable'} onClick={() => { void choosePython() }}>
              {props.t('external.runtime.python.choose')}
            </Button>
            {snapshot?.python?.source === 'custom' ? <Button variant="toolbar" onClick={() => {
              void props.useManagedWorkspacePython().then(setSnapshot, () => { setError(props.t('external.runtime.python.error')) })
            }}>{props.t('external.runtime.python.useManaged')}</Button> : null}
          </div>
        </li>
        {DEFINITIONS.map((definition) => {
          const status = snapshot?.capabilities[definition.id]
          const job = jobs[definition.id]
          const downloaded = job?.phase === 'succeeded'
            || (snapshot?.sharedPayload !== undefined && status?.phase !== 'needs-update')
            || (snapshot?.python?.source === 'custom' && definition.id === 'ptc')
          const waiting = status?.phase === 'waiting-restart'
          const enabled = status?.phase === 'enabled'
          const unavailable = status?.phase === 'unsupported' || status?.phase === 'nas-unavailable'
          return (
            <li key={definition.id} className={css.card} data-connected={enabled ? 'true' : undefined}>
              <div className={css.cardTop}>
                <span className={css.toolMark} data-tool="workspace-runtime" aria-hidden="true">
                  <IconCodeOutline16 size={20} />
                </span>
                <span className={css.status} data-state={enabled ? 'connected' : 'idle'}>
                  {status === undefined ? props.t('external.loading')
                    : definition.id === 'office' && status.phase === 'not-installed'
                      ? props.t('external.runtime.office.inactive') : props.t(statusKey(status.phase))}
                </span>
              </div>
              <div className={css.cardBody}>
                <div className={css.toolTitle}><h3>{props.t(definition.nameKey)}</h3></div>
                <p>{props.t(definition.descriptionKey)}</p>
                {status?.phase === 'nas-unavailable' ? <p className={css.runtimeNotice}>{props.t('external.runtime.nasNotice')}</p> : null}
                {definition.id === 'ptc' ? <p className={css.runtimeNotice}>{props.t('external.runtime.ptc.risk')}</p> : null}
              </div>
              <div className={css.cardAction}>
                {job !== undefined ? <Button variant="toolbar" onClick={() => { setProgress(definition.id) }}>{props.t('external.action.viewProgress')}</Button> : null}
                {waiting ? <Button variant="primary" onClick={() => { void restart() }}>{props.t('external.runtime.action.quickRestart')}</Button>
                  : enabled ? <Button variant="outline" onClick={() => { void remove(definition.id) }}>
                    {props.t(definition.id === 'office' ? 'external.runtime.office.disable' : 'external.runtime.action.remove')}
                  </Button>
                    : downloaded && !unavailable ? <Button variant="primary" onClick={() => {
                      if (definition.id === 'ptc') setRiskOpen(true)
                      else void activate(definition.id)
                    }}>{props.t('external.runtime.action.activate')}</Button>
                      : <Button variant="primary" disabled={unavailable || job?.phase === 'running'} onClick={() => {
                        if (definition.id === 'office' && snapshot?.python?.source === 'custom') {
                          if ((snapshot.python.plan?.changes.length ?? 0) === 0) void start('office')
                          else if (snapshot.python.plan?.requiresConfirmation === true) setPackagePlanOpen(true)
                          else void installOffice(false)
                        } else void start(definition.id)
                      }}>
                        {job?.phase === 'paused' ? props.t('external.action.resume') : props.t('external.runtime.action.install')}
                      </Button>}
              </div>
            </li>
          )
        })}
      </ul>
      {error === undefined ? null : <p className={css.error} role="alert">{error}</p>}
      <Modal open={selected !== undefined} onClose={() => { setProgress(undefined) }} closeLabel={props.t('external.progress.close')} title={props.t('external.runtime.progress.title')}>
        {selected === undefined ? null : <div className={css.capabilityForm}>
          <p className={css.capabilityNotice}>{props.t(`external.runtime.stage.${selected.stage}`)}</p>
          <div ref={terminal} className={css.terminalScroll}>
            {transcript?.lossy === true ? <p className={css.truncated}>{props.t('external.progress.truncated')}</p> : null}
            <TerminalBlock
              command={selected.stage}
              output={transcript?.text}
              running={selected.phase === 'running'}
              maxLines={Infinity}
              labels={{
                commandLine: line => props.t('external.terminal.commandLine').replace('{line}', String(line)),
                signal: signal => props.t('external.terminal.signal').replace('{signal}', signal),
                exitCode: code => props.t('external.terminal.exitCode').replace('{code}', String(code)),
                noExitCode: props.t('external.terminal.noExitCode'),
                running: props.t('external.terminal.running'),
                failed: props.t('external.terminal.failed'),
                done: props.t('external.terminal.done'),
                copy: props.t('external.terminal.copy'),
                copied: props.t('external.terminal.copied'),
                noOutput: props.t('external.terminal.noOutput'),
                collapseAria: props.t('external.terminal.collapseAria'),
                collapse: props.t('external.terminal.collapse'),
                expandAria: hidden => props.t('external.terminal.expandAria').replace('{count}', String(hidden)),
                expand: hidden => props.t('external.terminal.expand').replace('{count}', String(hidden)),
              }}
            />
          </div>
          <div className={css.dialogActions}>
            {selected.phase === 'running' ? <>
              <Button variant="outline" onClick={() => { void props.pauseWorkspaceRuntime(selected.jobId).then((job) => { setJobs(previous => ({ ...previous, [job.capabilityId]: job })) }) }}>{props.t('external.action.pause')}</Button>
              <Button variant="outline" onClick={() => { void props.cancelWorkspaceRuntime(selected.jobId).then((job) => { setJobs(previous => ({ ...previous, [job.capabilityId]: job })) }) }}>{props.t('external.action.stop')}</Button>
            </> : selected.phase === 'paused' ? <Button variant="primary" onClick={() => { void start(selected.capabilityId) }}>{props.t('external.action.resume')}</Button> : null}
          </div>
        </div>}
      </Modal>
      <Modal open={riskOpen} onClose={() => { setRiskOpen(false) }} closeLabel={props.t('external.capability.dialog.close')} title={props.t('external.runtime.ptc.confirmTitle')}>
        <div className={css.capabilityForm}>
          <p className={css.capabilityNotice}>{props.t('external.runtime.ptc.risk')}</p>
          <label className={css.riskAcknowledgement}>
            <input type="checkbox" checked={riskAccepted} onChange={(event) => { setRiskAccepted(event.currentTarget.checked) }} />
            <span>{props.t('external.runtime.ptc.acknowledge')}</span>
          </label>
          <div className={css.dialogActions}>
            <Button variant="primary" disabled={!riskAccepted} onClick={() => { setRiskOpen(false); void activate('ptc') }}>{props.t('external.runtime.action.activate')}</Button>
          </div>
        </div>
      </Modal>
      <Modal open={packagePlanOpen} onClose={() => { setPackagePlanOpen(false) }} closeLabel={props.t('external.capability.dialog.close')} title={props.t('external.runtime.office.confirmTitle')}>
        <div className={css.capabilityForm}>
          <p className={css.capabilityNotice}>{props.t('external.runtime.office.confirmDescription')}</p>
          <ul>{snapshot?.python?.plan?.changes.map(change => <li key={change.name}>
            {`${change.name}: ${change.installed ?? '—'} → ${change.target} (${change.action})`}
          </li>)}</ul>
          <div className={css.dialogActions}>
            <Button variant="primary" onClick={() => { void installOffice(true) }}>{props.t('external.runtime.office.confirm')}</Button>
          </div>
        </div>
      </Modal>
    </>
  )
}

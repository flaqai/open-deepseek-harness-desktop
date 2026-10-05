/** Desktop connection center for official and planned coding-product providers. */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  ExperimentalCapabilityRecipe,
  ExternalToolId,
  ExternalToolsSnapshot,
  PluginInstallId,
  PluginInstallOutputRead,
  PluginInstallProgress,
  PluginInstallSnapshot,
} from '@deepseek-ai/dsh-host-plugin-inventory/types'
import { Button, IconRefreshOutline16, Modal, TerminalBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginInventoryLocaleKey } from './locales.ts'
import css from './ExternalToolsSection.module.css'
import type {
  ExperimentalCapabilityInstallId,
  InstallableExternalToolId,
} from './external-tool-compatibility-bridge.ts'
import { ExternalToolIcon, type ExternalToolIconId } from './ExternalToolIcon.tsx'
import { WorkspaceRuntimesSection } from './WorkspaceRuntimesSection.tsx'
import type { WorkspaceRuntimeInjected } from './workspace-runtime-bridge.ts'

interface ToolDefinition {
  readonly id: ExternalToolIconId
  readonly name: string
  readonly installable?: true
  readonly moduleName?: string
  readonly managedToggle?: true
  readonly community?: true
  readonly descriptionKey: PluginInventoryLocaleKey
}

type ExperimentalCapabilityId = 'browser-use' | 'computer-use' | 'auto-review'

interface ExperimentalCapabilityDefinition {
  readonly id: ExperimentalCapabilityId
  readonly name: string
  readonly descriptionKey: PluginInventoryLocaleKey
  readonly moduleNames: readonly string[]
}

const EXPERIMENTAL_CAPABILITIES: readonly ExperimentalCapabilityDefinition[] = [
  {
    id: 'browser-use',
    name: 'Browser Use',
    descriptionKey: 'external.capability.browser.description',
    moduleNames: [
      '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp',
      '@deepseek-ai/dsh-experimental-browser-use-chrome-devtools-mcp',
      '@deepseek-ai/dsh-experimental-browser-use-stagehand-native',
    ],
  },
  {
    id: 'computer-use',
    name: 'Computer Use',
    descriptionKey: 'external.capability.computer.description',
    moduleNames: [
      '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native',
      '@deepseek-ai/dsh-experimental-computer-use-cua-driver-mcp',
    ],
  },
  {
    id: 'auto-review',
    name: 'Auto review',
    descriptionKey: 'external.capability.review.description',
    moduleNames: ['@deepseek-ai/dsh-experimental-auto-review'],
  },
]

const BROWSER_PROVIDER_INSTALL_IDS = {
  playwright: 'browser-use-playwright',
  devtools: 'browser-use-devtools',
  stagehand: 'browser-use-stagehand',
} as const satisfies Readonly<Record<'playwright' | 'devtools' | 'stagehand', ExperimentalCapabilityInstallId>>

const COMPUTER_PROVIDER_INSTALL_IDS = {
  native: 'computer-use-native',
  mcp: 'computer-use-mcp',
} as const satisfies Readonly<Record<'native' | 'mcp', ExperimentalCapabilityInstallId>>

const TOOLS: readonly ToolDefinition[] = [
  {
    id: 'codex',
    name: 'Codex',
    installable: true,
    moduleName: '@deepseek-ai/dsh-subagent-codex',
    managedToggle: true,
    descriptionKey: 'external.codex.description',
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    installable: true,
    moduleName: '@deepseek-ai/dsh-subagent-claude-code',
    managedToggle: true,
    descriptionKey: 'external.claude.description',
  },
  {
    id: 'workbuddy',
    name: 'WorkBuddy',
    installable: true,
    moduleName: 'dsh-workbuddy-connect',
    community: true,
    descriptionKey: 'external.workbuddy.description',
  },
  {
    id: 'hermes',
    name: 'Hermes',
    descriptionKey: 'external.hermes.description',
  },
  {
    id: 'trae',
    name: 'Trae',
    descriptionKey: 'external.trae.description',
  },
]

/** Host operations used by the external-tools settings page. */
export interface ExternalToolsSectionInjected extends WorkspaceRuntimeInjected {
  list: () => Promise<PluginInventorySnapshot>
  externalTools: () => Promise<ExternalToolsSnapshot>
  setExternalTool: (tool: ExternalToolId, enabled: boolean) => Promise<ExternalToolsSnapshot>
  installExternalTool: (
    toolId: InstallableExternalToolId,
    experimentalCapability?: ExperimentalCapabilityRecipe,
  ) => Promise<PluginInstallSnapshot>
  getInstall: (installId: PluginInstallId) => Promise<PluginInstallSnapshot>
  getInstallOutput: (installId: PluginInstallId, offset: number) => Promise<PluginInstallOutputRead>
  pauseInstall: (installId: PluginInstallId) => Promise<PluginInstallSnapshot>
  cancelInstall: (installId: PluginInstallId) => Promise<PluginInstallSnapshot>
  restart: () => Promise<boolean>
  activateAutoReview: () => Promise<'switched' | 'no-session'>
}

/** Full props assembled by the Settings section slot. */
export type ExternalToolsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.pluginInventory'>
  & InjectFace<ExternalToolsSectionInjected>

type PageState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'failed' }
  | {
    readonly phase: 'ready'
    readonly inventory: PluginInventorySnapshot
    readonly managed: ExternalToolsSnapshot
  }

function isEnabled(snapshot: ExternalToolsSnapshot, id: ExternalToolId): boolean {
  return id === 'codex' ? snapshot.codex : snapshot.claudeCode
}

interface TranscriptState {
  readonly text: string
  readonly offset: number
  readonly lossy: boolean
  readonly settled: boolean
}

function progressCopy(progress: PluginInstallProgress | undefined, t: ExternalToolsSectionProps['t']): string {
  if (progress?.stage === 'resolving') return t('external.progress.resolving')
  if (progress?.stage === 'downloading' && progress.percent !== undefined) {
    return t('external.progress.downloading').replace('{percent}', String(progress.percent))
  }
  if (progress?.stage === 'downloading') return t('external.progress.downloadingUnknown')
  if (progress?.stage === 'installing' && progress.percent !== undefined) {
    return t('external.progress.installingPercent').replace('{percent}', String(progress.percent))
  }
  if (progress?.stage === 'installing') return t('external.progress.installing')
  if (progress?.stage === 'verifying') return t('external.progress.verifying')
  return t('external.progress.preparing')
}

/** Render the dedicated connection center in Settings navigation. */
export function ExternalToolsSection(props: ExternalToolsSectionProps): ReactNode {
  const { list, externalTools, setExternalTool, installExternalTool, getInstall, getInstallOutput, restart, t } = props
  const [request, setRequest] = useState(0)
  const [state, setState] = useState<PageState>({ phase: 'loading' })
  const [installs, setInstalls] = useState<Readonly<Record<string, PluginInstallSnapshot>>>({})
  const [composedInstalls, setComposedInstalls] = useState<Readonly<Record<string, boolean>>>({})
  const [busyTool, setBusyTool] = useState<ExternalToolId | null>(null)
  const [restartingTool, setRestartingTool] = useState<ToolDefinition['id'] | null>(null)
  const [controllingInstall, setControllingInstall] = useState<{
    readonly toolId: ToolDefinition['id']
    readonly action: 'pause' | 'cancel'
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progressTool, setProgressTool] = useState<ToolDefinition['id'] | null>(null)
  const [capabilityDialog, setCapabilityDialog] = useState<ExperimentalCapabilityId | null>(null)
  const [browserBackend, setBrowserBackend] = useState<'playwright' | 'devtools' | 'stagehand'>('playwright')
  const [browserMode, setBrowserMode] = useState<'launch' | 'attach'>('launch')
  const [computerBackend, setComputerBackend] = useState<'native' | 'mcp'>('native')
  const [autoReviewAcknowledged, setAutoReviewAcknowledged] = useState(false)
  const [autoReviewOutcome, setAutoReviewOutcome] = useState<'switched' | 'no-session' | null>(null)
  const [transcripts, setTranscripts] = useState<Readonly<Record<string, TranscriptState>>>({})
  const terminalScrollRef = useRef<HTMLDivElement>(null)
  const followTerminalRef = useRef(true)
  const activatedAutoReviewInstalls = useRef(new Set<string>())

  useEffect(() => {
    let current = true
    void Promise.all([list(), externalTools()]).then(
      ([inventory, managed]) => {
        if (current) setState({ phase: 'ready', inventory, managed })
      },
      () => { if (current) setState({ phase: 'failed' }) },
    )
    return () => { current = false }
  }, [externalTools, list, request])

  const running = useMemo(
    () => Object.values(installs).find(install => install.phase === 'running'),
    [installs],
  )
  useEffect(() => {
    if (running === undefined) return
    let current = true
    const timer = window.setTimeout(() => {
      void getInstall(running.installId).then(
        (snapshot) => {
          if (current) setInstalls(previous => Object.fromEntries(
            Object.entries(previous).map(([toolId, install]) => (
              install.installId === snapshot.installId ? [toolId, snapshot] : [toolId, install]
            )),
          ))
        },
        () => { if (current) setError(t('external.install.pollFailed')) },
      )
    }, 700)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [getInstall, running, t])

  const autoReviewInstall = installs['auto-review']
  useEffect(() => {
    if (autoReviewInstall === undefined
      || (autoReviewInstall.phase !== 'succeeded' && autoReviewInstall.phase !== 'repaired')
      || activatedAutoReviewInstalls.current.has(autoReviewInstall.installId)) return
    activatedAutoReviewInstalls.current.add(autoReviewInstall.installId)
    let current = true
    void props.activateAutoReview().then(
      (outcome) => { if (current) setAutoReviewOutcome(outcome) },
      () => { if (current) setError(t('external.capability.review.switchFailed')) },
    )
    return () => { current = false }
  }, [autoReviewInstall, props.activateAutoReview, t])

  const progressInstall = progressTool === null ? undefined : installs[progressTool]
  const progressTranscript = progressTool === null ? undefined : transcripts[progressTool]
  useEffect(() => {
    if (progressTool === null || progressInstall === undefined) return
    if (progressTranscript?.settled === true) return
    let current = true
    const offset = progressTranscript?.offset ?? 0
    const timer = window.setTimeout(() => {
      void getInstallOutput(progressInstall.installId, offset).then(
        (read) => {
          if (!current) return
          setTranscripts(previous => ({
            ...previous,
            [progressTool]: {
              text: `${previous[progressTool]?.text ?? ''}${read.text}`,
              offset: read.nextOffset,
              lossy: (previous[progressTool]?.lossy ?? false) || read.lossy,
              settled: read.settled,
            },
          }))
        },
        () => { if (current) setError(t('external.install.pollFailed')) },
      )
    }, progressTranscript === undefined ? 0 : 500)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [getInstallOutput, progressInstall, progressTool, progressTranscript, t])

  useEffect(() => {
    const element = terminalScrollRef.current
    if (element !== null && followTerminalRef.current) element.scrollTop = element.scrollHeight
  }, [progressTranscript?.text])

  const install = async (tool: ToolDefinition): Promise<void> => {
    if (tool.installable !== true) return
    setError(null)
    try {
      const snapshot = await installExternalTool(tool.id as InstallableExternalToolId)
      setTranscripts(previous => ({
        ...previous,
        [tool.id]: { text: '', offset: 0, lossy: false, settled: false },
      }))
      setInstalls(previous => ({ ...previous, [tool.id]: snapshot }))
    } catch {
      setError(t('external.install.failed'))
    }
  }

  const installCapability = async (
    capabilityId: ExperimentalCapabilityId,
    installId: InstallableExternalToolId,
    experimentalCapability?: ExperimentalCapabilityRecipe,
  ): Promise<void> => {
    setError(null)
    try {
      const snapshot = experimentalCapability === undefined
        ? await installExternalTool(installId)
        : await installExternalTool(installId, experimentalCapability)
      setTranscripts(previous => ({
        ...previous,
        [capabilityId]: { text: '', offset: 0, lossy: false, settled: false },
      }))
      setInstalls(previous => ({ ...previous, [capabilityId]: snapshot }))
      setComposedInstalls(previous => ({ ...previous, [capabilityId]: experimentalCapability !== undefined }))
      setCapabilityDialog(null)
    } catch {
      setError(t('external.install.failed'))
    }
  }

  const installAutoReview = async (): Promise<void> => {
    await installCapability('auto-review', 'auto-review')
  }

  const toggle = async (tool: ExternalToolId, enabled: boolean): Promise<void> => {
    if (state.phase !== 'ready') return
    setBusyTool(tool)
    setError(null)
    try {
      const managed = await setExternalTool(tool, enabled)
      setState({ ...state, managed })
    } catch {
      setError(t('external.toggle.failed'))
    } finally {
      setBusyTool(null)
    }
  }

  const restartToEnable = async (tool: ToolDefinition): Promise<void> => {
    setRestartingTool(tool.id)
    setError(null)
    try {
      if (!(await restart())) setError(t('external.restart.failed'))
    } catch {
      setError(t('external.restart.failed'))
    } finally {
      setRestartingTool(null)
    }
  }

  const controlInstall = async (
    tool: Pick<ToolDefinition, 'id'>,
    installId: PluginInstallId,
    action: 'pause' | 'cancel',
  ): Promise<void> => {
    setControllingInstall({ toolId: tool.id, action })
    setError(null)
    try {
      const snapshot = action === 'pause'
        ? await props.pauseInstall(installId)
        : await props.cancelInstall(installId)
      setInstalls(previous => ({ ...previous, [tool.id]: snapshot }))
    } catch {
      setError(t('external.install.controlFailed'))
    } finally {
      setControllingInstall(null)
    }
  }

  if (state.phase === 'loading') return <p className={css.pageStatus}>{t('external.loading')}</p>
  if (state.phase === 'failed') {
    return (
      <div className={css.failure}>
        <p role="alert">{t('external.loadFailed')}</p>
        <Button variant="outline" onClick={() => { setState({ phase: 'loading' }); setRequest(value => value + 1) }}>
          <IconRefreshOutline16 size={14} />
          {t('retry')}
        </Button>
      </div>
    )
  }

  return (
    <section className={css.section} aria-labelledby="external-tools-title">
      <header className={css.intro}>
        <div>
          <p className={css.eyebrow}>{t('external.eyebrow')}</p>
          <h2 id="external-tools-title">{t('external.title')}</h2>
          <p>{t('external.description')}</p>
        </div>
        <span className={css.presetBadge} data-ready={state.managed.codex || state.managed.claudeCode ? 'true' : undefined}>
          {state.managed.codex || state.managed.claudeCode ? t('external.preset.ready') : t('external.preset.empty')}
        </span>
      </header>

      <div className={css.groupHeading}>
        <div>
          <div className={css.headingLine}>
            <h3>{t('external.capability.title')}</h3>
            <span className={css.releaseBadge}>{t('external.capability.releaseBadge')}</span>
          </div>
          <p>{t('external.capability.description')}</p>
        </div>
      </div>

      <ul className={css.grid} data-testid="experimental-capability-grid">
        {EXPERIMENTAL_CAPABILITIES.map((capability) => {
          const entries = state.inventory.entries.filter(entry => capability.moduleNames.includes(entry.moduleName))
          const active = entries.some(entry => entry.enabled && entry.fiberPhase === 'active')
          const installed = entries.length > 0
          const installState = installs[capability.id]
          const installSucceeded = installState?.phase === 'succeeded' || installState?.phase === 'repaired'
          const restartRequired = installSucceeded && composedInstalls[capability.id] === true
          const installing = installState?.phase === 'running'
          const paused = installState?.phase === 'paused'
          const cancelled = installState?.phase === 'cancelled'
          const selectedInstallId: InstallableExternalToolId = capability.id === 'browser-use'
            ? BROWSER_PROVIDER_INSTALL_IDS[browserBackend]
            : capability.id === 'computer-use'
              ? COMPUTER_PROVIDER_INSTALL_IDS[computerBackend]
              : 'auto-review'
          const selectedRecipe: ExperimentalCapabilityRecipe | undefined = capability.id === 'browser-use'
            ? browserMode === 'launch' && browserBackend === 'playwright'
              ? 'browser-use-playwright-visible'
              : browserMode === 'launch' && browserBackend === 'devtools'
                ? 'browser-use-devtools-visible'
                : undefined
            : capability.id === 'computer-use'
              ? computerBackend === 'native' ? 'computer-use-native' : 'computer-use-mcp'
              : undefined
          const status = active
            ? t('external.capability.status.ready')
            : restartRequired
              ? t('external.status.restart')
              : paused
                ? t('external.status.paused')
                : cancelled
                  ? t('external.status.cancelled')
                  : capability.id === 'computer-use' && installed
                    ? t('external.capability.status.permission')
                    : installed || installSucceeded
                      ? t('external.capability.status.configuration')
                      : t('external.capability.status.notInstalled')
          return (
            <li key={capability.id} className={css.card} data-connected={active ? 'true' : undefined}>
              <div className={css.cardTop}>
                <span className={css.toolMark} data-tool={capability.id} data-testid={`experimental-capability-icon-${capability.id}`}>
                  <ExternalToolIcon tool={capability.id} />
                </span>
                <span className={css.status} data-state={active ? 'connected' : 'idle'}>{status}</span>
              </div>
              <div className={css.cardBody}>
                <div className={css.toolTitle}><h3>{capability.name}</h3></div>
                <p>{t(capability.descriptionKey)}</p>
              </div>
              <div className={css.cardAction}>
                {active ? (
                  <Button variant="outline" disabled>{t('external.capability.action.ready')}</Button>
                ) : (
                  <>
                    <Button
                      variant="toolbar"
                      disabled={installState === undefined}
                      onClick={() => { followTerminalRef.current = true; setProgressTool(capability.id) }}
                    >
                      {t('external.action.viewProgress')}
                    </Button>
                    {restartRequired ? (
                      <Button
                        variant="primary"
                        disabled={restartingTool !== null}
                        onClick={() => { void restartToEnable({
                          id: capability.id,
                          name: capability.name,
                          descriptionKey: capability.descriptionKey,
                        }) }}
                      >
                        {restartingTool === capability.id ? t('external.action.restarting') : t('external.action.restart')}
                      </Button>
                    ) : installing ? (
                      <div
                        className={css.installSplit}
                        role="group"
                        aria-label={t('external.action.downloadControls')}
                      >
                        <span
                          className={css.installFill}
                          style={{ '--install-progress': `${String(installState.installProgress?.percent ?? 100)}%` } as CSSProperties}
                          data-indeterminate={installState.installProgress?.percent === undefined ? 'true' : undefined}
                          aria-hidden="true"
                        />
                        <button
                          type="button"
                          className={css.pauseButton}
                          disabled={controllingInstall !== null}
                          onClick={() => { void controlInstall(capability, installState.installId, 'pause') }}
                        >
                          <span>{controllingInstall?.toolId === capability.id && controllingInstall.action === 'pause'
                            ? t('external.action.pausing')
                            : t('external.action.pause')}</span>
                          <span className={css.progressCopy}>{progressCopy(installState.installProgress, t)}</span>
                        </button>
                        <button
                          type="button"
                          className={css.stopButton}
                          disabled={controllingInstall !== null}
                          onClick={() => { void controlInstall(capability, installState.installId, 'cancel') }}
                        >
                          {controllingInstall?.toolId === capability.id && controllingInstall.action === 'cancel'
                            ? t('external.action.stopping')
                            : t('external.action.stop')}
                        </button>
                        <span
                          className={css.visualProgress}
                          role="progressbar"
                          aria-label={progressCopy(installState.installProgress, t)}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={installState.installProgress?.percent}
                        />
                      </div>
                    ) : (
                      <Button
                        variant="primary"
                        className={css.installButton}
                        disabled={running !== undefined}
                        onClick={() => {
                          if (installState === undefined || capability.id === 'auto-review') {
                            setCapabilityDialog(capability.id)
                          } else {
                            void installCapability(capability.id, selectedInstallId, selectedRecipe)
                          }
                        }}
                      >
                        {paused
                          ? t('external.action.resume')
                          : cancelled || installState?.phase === 'failed' || installState?.phase === 'quarantined'
                            ? t('external.action.retryDownload')
                            : t('external.capability.action.configure')}
                      </Button>
                    )}
                  </>
                )}
              </div>
              {installState?.phase === 'failed' || installState?.phase === 'quarantined' ? (
                <details className={css.diagnostic}>
                  <summary>{t('external.install.details')}</summary>
                  <pre>{installState.diagnostic ?? t('external.install.failed')}</pre>
                </details>
              ) : null}
            </li>
          )
        })}
      </ul>

      <WorkspaceRuntimesSection
        restart={restart}
        t={t}
        getWorkspaceRuntimes={props.getWorkspaceRuntimes}
        chooseWorkspacePython={props.chooseWorkspacePython}
        useManagedWorkspacePython={props.useManagedWorkspacePython}
        installWorkspaceOffice={props.installWorkspaceOffice}
        startWorkspaceRuntime={props.startWorkspaceRuntime}
        getWorkspaceRuntimeJob={props.getWorkspaceRuntimeJob}
        readWorkspaceRuntimeOutput={props.readWorkspaceRuntimeOutput}
        pauseWorkspaceRuntime={props.pauseWorkspaceRuntime}
        cancelWorkspaceRuntime={props.cancelWorkspaceRuntime}
        activateWorkspaceRuntime={props.activateWorkspaceRuntime}
        removeWorkspaceRuntime={props.removeWorkspaceRuntime}
      />

      <div className={css.groupHeading}>
        <div>
          <h3>{t('external.tools.title')}</h3>
          <p>{t('external.tools.description')}</p>
        </div>
      </div>

      <ul className={css.grid} data-testid="external-tools-grid">
        {TOOLS.map((tool) => {
          const supported = tool.installable === true && tool.moduleName !== undefined
          const active = supported && state.inventory.entries.some(entry =>
            entry.moduleName === tool.moduleName && entry.enabled && entry.fiberPhase === 'active')
          const installState = installs[tool.id]
          const enabled = supported && (tool.managedToggle === true
            ? isEnabled(state.managed, tool.id as ExternalToolId)
            : active)
          const restarting = installState?.phase === 'succeeded'
            || installState?.phase === 'repaired'
          const installing = installState?.phase === 'running'
          const paused = installState?.phase === 'paused'
          const cancelled = installState?.phase === 'cancelled'
          return (
            <li key={tool.id} className={css.card} data-connected={active && enabled ? 'true' : undefined}>
              <div className={css.cardTop}>
                <span className={css.toolMark} data-tool={tool.id} data-testid={`external-tool-icon-${tool.id}`}>
                  <ExternalToolIcon tool={tool.id} />
                </span>
                <span className={css.status} data-state={!supported ? 'planned' : active && enabled ? 'connected' : 'idle'}>
                  {!supported
                    ? t('external.status.planned')
                    : tool.community === true && active
                      ? t('external.status.pluginReady')
                      : active && enabled
                        ? t('external.status.connected')
                        : restarting
                          ? t('external.status.restart')
                          : paused
                            ? t('external.status.paused')
                            : cancelled
                              ? t('external.status.cancelled')
                              : active
                                ? t('external.status.ready')
                                : t('external.status.notInstalled')}
                </span>
              </div>
              <div className={css.cardBody}>
                <div className={css.toolTitle}>
                  <h3>{tool.name}</h3>
                  {tool.community === true
                    ? <span className={css.communityBadge}>{t('external.badge.community')}</span>
                    : null}
                </div>
                <p>{t(tool.descriptionKey)}</p>
              </div>
              <div className={css.cardAction}>
                {!supported ? (
                  <Button variant="outline" disabled>{t('external.action.planned')}</Button>
                ) : !active ? (
                  <>
                    <Button
                      variant="toolbar"
                      disabled={installState === undefined}
                      onClick={() => { followTerminalRef.current = true; setProgressTool(tool.id) }}
                    >
                      {t('external.action.viewProgress')}
                    </Button>
                    {installing ? (
                      <div
                        className={css.installSplit}
                        role="group"
                        aria-label={t('external.action.downloadControls')}
                      >
                        <span
                          className={css.installFill}
                          style={{ '--install-progress': `${String(installState.installProgress?.percent ?? 100)}%` } as CSSProperties}
                          data-indeterminate={installState.installProgress?.percent === undefined ? 'true' : undefined}
                          aria-hidden="true"
                        />
                        <button
                          type="button"
                          className={css.pauseButton}
                          disabled={controllingInstall !== null}
                          onClick={() => { void controlInstall(tool, installState.installId, 'pause') }}
                        >
                          <span>{controllingInstall?.toolId === tool.id && controllingInstall.action === 'pause'
                            ? t('external.action.pausing')
                            : t('external.action.pause')}</span>
                          <span className={css.progressCopy}>{progressCopy(installState.installProgress, t)}</span>
                        </button>
                        <button
                          type="button"
                          className={css.stopButton}
                          disabled={controllingInstall !== null}
                          onClick={() => { void controlInstall(tool, installState.installId, 'cancel') }}
                        >
                          {controllingInstall?.toolId === tool.id && controllingInstall.action === 'cancel'
                            ? t('external.action.stopping')
                            : t('external.action.stop')}
                        </button>
                        <span
                          className={css.visualProgress}
                          role="progressbar"
                          aria-label={progressCopy(installState.installProgress, t)}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={installState.installProgress?.percent}
                        />
                      </div>
                    ) : (
                      <Button
                        variant="primary"
                        className={css.installButton}
                        disabled={restartingTool !== null || running !== undefined}
                        onClick={() => {
                          if (restarting) void restartToEnable(tool)
                          else void install(tool)
                        }}
                      >
                        {restarting
                          ? restartingTool === tool.id
                            ? t('external.action.restarting')
                            : t('external.action.restart')
                          : paused
                            ? t('external.action.resume')
                            : cancelled
                              ? t('external.action.retryDownload')
                              : tool.community === true
                                ? t('external.action.installCommunity')
                                : t('external.action.install')}
                      </Button>
                    )}
                  </>
                ) : tool.community === true ? (
                  <Button variant="outline" disabled>{t('external.action.pluginInstalled')}</Button>
                ) : (
                  <Button
                    variant={enabled ? 'outline' : 'primary'}
                    disabled={busyTool !== null}
                    onClick={() => { void toggle(tool.id as ExternalToolId, !enabled) }}
                  >
                    {busyTool === tool.id
                      ? t('external.action.saving')
                      : enabled ? t('external.action.disconnect') : t('external.action.connect')}
                  </Button>
                )}
              </div>
              {installState?.phase === 'failed' || installState?.phase === 'quarantined' ? (
                <details className={css.diagnostic}>
                  <summary>{t('external.install.details')}</summary>
                  <pre>{installState.diagnostic ?? t('external.install.failed')}</pre>
                </details>
              ) : null}
            </li>
          )
        })}
      </ul>
      <p className={css.footnote}>{t('external.footnote')}</p>
      {autoReviewOutcome === null ? null : (
        <p className={css.footnote} role="status">
          {autoReviewOutcome === 'switched'
            ? t('external.capability.review.switched')
            : t('external.capability.review.noSession')}
        </p>
      )}
      {error === null ? null : <p className={css.error} role="alert">{error}</p>}
      <Modal
        open={capabilityDialog !== null}
        onClose={() => { setCapabilityDialog(null) }}
        closeLabel={t('external.capability.dialog.close')}
        title={capabilityDialog === null
          ? t('external.capability.title')
          : EXPERIMENTAL_CAPABILITIES.find(item => item.id === capabilityDialog)?.name ?? capabilityDialog}
        description={capabilityDialog === null
          ? t('external.capability.description')
          : t(`external.capability.${capabilityDialog}.dialogDescription`)}
      >
        {capabilityDialog === 'browser-use' ? (
          <div className={css.capabilityForm}>
            <fieldset>
              <legend>{t('external.capability.browser.backend')}</legend>
              {(['playwright', 'devtools', 'stagehand'] as const).map(value => (
                <label key={value}>
                  <input type="radio" name="browser-backend" value={value} checked={browserBackend === value} onChange={() => { setBrowserBackend(value) }} />
                  <span>{t(`external.capability.browser.backend.${value}`)}</span>
                </label>
              ))}
              <p className={css.capabilityOptionHint} aria-live="polite">
                {t(`external.capability.browser.backend.${browserBackend}Notice`)}
              </p>
            </fieldset>
            <fieldset>
              <legend>{t('external.capability.browser.mode')}</legend>
              {(['launch', 'attach'] as const).map(value => (
                <label key={value}>
                  <input type="radio" name="browser-mode" value={value} checked={browserMode === value} onChange={() => { setBrowserMode(value) }} />
                  <span>{t(`external.capability.browser.mode.${value}`)}</span>
                </label>
              ))}
              <p className={css.capabilityOptionHint} aria-live="polite">
                {t(`external.capability.browser.mode.${browserMode}Notice`)}
              </p>
            </fieldset>
            <div className={css.dialogActions}>
              <Button
                variant="primary"
                disabled={running !== undefined}
                onClick={() => { void installCapability(
                  'browser-use',
                  BROWSER_PROVIDER_INSTALL_IDS[browserBackend],
                  browserMode === 'launch' && browserBackend === 'playwright'
                    ? 'browser-use-playwright-visible'
                    : browserMode === 'launch' && browserBackend === 'devtools'
                      ? 'browser-use-devtools-visible'
                      : undefined,
                ) }}
              >
                {t('external.capability.action.installSelected')}
              </Button>
            </div>
          </div>
        ) : capabilityDialog === 'computer-use' ? (
          <div className={css.capabilityForm}>
            <fieldset>
              <legend>{t('external.capability.computer.backend')}</legend>
              {(['native', 'mcp'] as const).map(value => (
                <label key={value}>
                  <input type="radio" name="computer-backend" value={value} checked={computerBackend === value} onChange={() => { setComputerBackend(value) }} />
                  <span>{t(`external.capability.computer.backend.${value}`)}</span>
                </label>
              ))}
              <p className={css.capabilityOptionHint} aria-live="polite">
                {t(`external.capability.computer.backend.${computerBackend}Notice`)}
              </p>
            </fieldset>
            <div className={css.dialogActions}>
              <Button
                variant="primary"
                disabled={running !== undefined}
                onClick={() => { void installCapability(
                  'computer-use',
                  COMPUTER_PROVIDER_INSTALL_IDS[computerBackend],
                  computerBackend === 'native' ? 'computer-use-native' : 'computer-use-mcp',
                ) }}
              >
                {t('external.capability.action.installSelected')}
              </Button>
            </div>
          </div>
        ) : capabilityDialog === 'auto-review' ? (
          <div className={css.capabilityForm}>
            <p className={css.capabilityNotice}>{t('external.capability.review.riskNotice')}</p>
            <p className={css.capabilityHint}>{t('external.capability.review.sessionNotice')}</p>
            <label className={css.riskAcknowledgement}>
              <input
                type="checkbox"
                checked={autoReviewAcknowledged}
                onChange={(event) => { setAutoReviewAcknowledged(event.currentTarget.checked) }}
              />
              <span>{t('external.capability.review.acknowledge')}</span>
            </label>
            <div className={css.dialogActions}>
              <Button variant="primary" disabled={!autoReviewAcknowledged || running !== undefined} onClick={() => { void installAutoReview() }}>
                {t('external.capability.review.install')}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
      <Modal
        open={progressInstall !== undefined}
        onClose={() => { setProgressTool(null) }}
        closeLabel={t('external.progress.close')}
        title={progressTool === null
          ? t('external.progress.title')
          : t('external.progress.titleFor').replace(
            '{tool}',
            TOOLS.find(tool => tool.id === progressTool)?.name
              ?? EXPERIMENTAL_CAPABILITIES.find(capability => capability.id === progressTool)?.name
              ?? progressTool,
          )}
        description={progressCopy(progressInstall?.installProgress, t)}
        {...(css.progressDialog === undefined ? {} : { className: css.progressDialog })}
      >
        {progressTranscript?.lossy === true
          ? <p className={css.truncated} role="status">{t('external.progress.truncated')}</p>
          : null}
        <div
          ref={terminalScrollRef}
          className={css.terminalScroll}
          onScroll={(event) => {
            const element = event.currentTarget
            followTerminalRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24
          }}
        >
          <TerminalBlock
            command={progressInstall?.command ?? ''}
            output={progressTranscript?.text}
            running={progressInstall?.phase === 'running'}
            {...(progressInstall?.exitCode === undefined || progressInstall.exitCode === null
              ? {}
              : { exitCode: progressInstall.exitCode })}
            maxLines={Infinity}
            labels={{
              signal: signal => t('external.terminal.signal').replace('{signal}', signal),
              exitCode: code => t('external.terminal.exitCode').replace('{code}', String(code)),
              noExitCode: t('external.terminal.noExitCode'),
              running: t('external.terminal.running'),
              failed: t('external.terminal.failed'),
              done: t('external.terminal.done'),
              copy: t('external.terminal.copy'),
              copied: t('external.terminal.copied'),
              noOutput: t('external.terminal.noOutput'),
              collapseAria: t('external.terminal.collapseAria'),
              collapse: t('external.terminal.collapse'),
              expandAria: hidden => t('external.terminal.expandAria').replace('{count}', String(hidden)),
              expand: hidden => t('external.terminal.expand').replace('{count}', String(hidden)),
            }}
          />
        </div>
      </Modal>
    </section>
  )
}

/** Desktop connection center for official and planned coding-product providers. */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  ExternalToolId,
  ExternalToolsSnapshot,
  PluginInstallId,
  PluginInstallRequest,
  PluginInstallSnapshot,
} from '@deepseek-ai/dsh-host-plugin-inventory/types'
import { Button, IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginInventoryLocaleKey } from './locales.ts'
import css from './ExternalToolsSection.module.css'

interface ToolDefinition {
  readonly id: 'codex' | 'claude-code' | 'hermes' | 'trae'
  readonly name: string
  readonly mark: string
  readonly packageSpec?: string
  readonly moduleName?: string
  readonly descriptionKey: PluginInventoryLocaleKey
}

const TOOLS: readonly ToolDefinition[] = [
  {
    id: 'codex',
    name: 'Codex',
    mark: 'CX',
    packageSpec: '@deepseek-ai/dsh-subagent-codex@0.1.0-rc.8',
    moduleName: '@deepseek-ai/dsh-subagent-codex',
    descriptionKey: 'external.codex.description',
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    mark: 'CC',
    packageSpec: '@deepseek-ai/dsh-subagent-claude-code@0.1.0-rc.8',
    moduleName: '@deepseek-ai/dsh-subagent-claude-code',
    descriptionKey: 'external.claude.description',
  },
  {
    id: 'hermes',
    name: 'Hermes',
    mark: 'H',
    descriptionKey: 'external.hermes.description',
  },
  {
    id: 'trae',
    name: 'Trae',
    mark: 'T',
    descriptionKey: 'external.trae.description',
  },
]

/** Host operations used by the external-tools settings page. */
export interface ExternalToolsSectionInjected {
  list: () => Promise<PluginInventorySnapshot>
  externalTools: () => Promise<ExternalToolsSnapshot>
  setExternalTool: (tool: ExternalToolId, enabled: boolean) => Promise<ExternalToolsSnapshot>
  startInstall: (request: PluginInstallRequest) => Promise<PluginInstallSnapshot>
  getInstall: (installId: PluginInstallId) => Promise<PluginInstallSnapshot>
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

/** Render the dedicated connection center in Settings navigation. */
export function ExternalToolsSection(props: ExternalToolsSectionProps): ReactNode {
  const { list, externalTools, setExternalTool, startInstall, getInstall, t } = props
  const [request, setRequest] = useState(0)
  const [state, setState] = useState<PageState>({ phase: 'loading' })
  const [installs, setInstalls] = useState<Readonly<Record<string, PluginInstallSnapshot>>>({})
  const [busyTool, setBusyTool] = useState<ExternalToolId | null>(null)
  const [error, setError] = useState<string | null>(null)

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
          if (current) setInstalls(previous => ({ ...previous, [snapshot.packageSpec]: snapshot }))
        },
        () => { if (current) setError(t('external.install.pollFailed')) },
      )
    }, 700)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [getInstall, running, t])

  const install = async (tool: ToolDefinition): Promise<void> => {
    const packageSpec = tool.packageSpec
    if (packageSpec === undefined) return
    setError(null)
    try {
      const snapshot = await startInstall({ profile: 'web', packageSpec })
      setInstalls(previous => ({ ...previous, [packageSpec]: snapshot }))
    } catch {
      setError(t('external.install.failed'))
    }
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

      <ul className={css.grid}>
        {TOOLS.map((tool) => {
          const supported = tool.packageSpec !== undefined && tool.moduleName !== undefined
          const active = supported && state.inventory.entries.some(entry =>
            entry.moduleName === tool.moduleName && entry.enabled && entry.fiberPhase === 'active')
          const installState = tool.packageSpec === undefined ? undefined : installs[tool.packageSpec]
          const enabled = supported && isEnabled(state.managed, tool.id as ExternalToolId)
          const restarting = installState?.phase === 'succeeded'
            || installState?.phase === 'repaired'
          const installing = installState?.phase === 'running'
          return (
            <li key={tool.id} className={css.card} data-connected={active && enabled ? 'true' : undefined}>
              <div className={css.cardTop}>
                <span className={css.toolMark} data-tool={tool.id}>{tool.mark}</span>
                <span className={css.status} data-state={!supported ? 'planned' : active && enabled ? 'connected' : 'idle'}>
                  {!supported
                    ? t('external.status.planned')
                    : active && enabled
                      ? t('external.status.connected')
                      : restarting
                        ? t('external.status.restart')
                        : active
                          ? t('external.status.ready')
                          : t('external.status.notInstalled')}
                </span>
              </div>
              <div className={css.cardBody}>
                <h3>{tool.name}</h3>
                <p>{t(tool.descriptionKey)}</p>
              </div>
              <div className={css.cardAction}>
                {!supported ? (
                  <Button variant="outline" disabled>{t('external.action.planned')}</Button>
                ) : !active ? (
                  <Button
                    variant="primary"
                    disabled={installing || restarting || running !== undefined}
                    onClick={() => { void install(tool) }}
                  >
                    {installing
                      ? t('external.action.installing')
                      : restarting
                        ? t('external.action.restart')
                        : t('external.action.install')}
                  </Button>
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
      {error === null ? null : <p className={css.error} role="alert">{error}</p>}
    </section>
  )
}

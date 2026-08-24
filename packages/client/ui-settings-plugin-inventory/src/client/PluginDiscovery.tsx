/** Curated community plugin discovery for the new-session home screen. */

import { useEffect, useState, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  PluginInstallId,
  PluginInstallRequest,
  PluginInstallSnapshot,
} from '@deepseek-ai/dsh-host-plugin-inventory/types'
import {
  Button,
  IconCordisPluginOutline14,
  IconCopyOutline16,
  Modal,
  RiskConfirmation,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the ui-conversation SlotMap merge for the hero seat.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PluginInventoryLocaleKey } from './locales.ts'
import css from './PluginDiscovery.module.css'

interface CuratedPlugin {
  id: string
  name: string
  repository: string
  stars: string
  license: string
  categoryKey: PluginInventoryLocaleKey
  descriptionKey: PluginInventoryLocaleKey
  profile: string
  packageSpec: string
}

const GITHUB_TOPIC_URL = 'https://github.com/topics/dsh-plugin'
const CURATED_PLUGINS: readonly CuratedPlugin[] = [
  {
    id: 'dsh-web-ui',
    name: 'dsh-web-ui',
    repository: 'https://github.com/zhu1090093659/dsh-web-ui',
    stars: '2.9k+',
    license: 'Apache-2.0',
    categoryKey: 'discovery.category.web',
    descriptionKey: 'discovery.plugin.webUi',
    profile: 'web',
    packageSpec: '@linxin666/dsh-web-ui-all',
  },
  {
    id: 'modlens',
    name: 'modlens',
    repository: 'https://github.com/liustack/modlens',
    stars: '2k+',
    license: 'MIT',
    categoryKey: 'discovery.category.vision',
    descriptionKey: 'discovery.plugin.modlens',
    profile: 'web',
    packageSpec: '@liustack/modlens@3.17.1',
  },
  {
    id: 'better-sidebar',
    name: 'DSH Better Sidebar',
    repository: 'https://github.com/omdsh-dev/DSH-better-sidebar',
    stars: '1.4k+',
    license: 'MIT',
    categoryKey: 'discovery.category.workspace',
    descriptionKey: 'discovery.plugin.sidebar',
    profile: 'web',
    packageSpec: 'dsh-better-sidebar@0.15.2',
  },
  {
    id: 'dsh-tui',
    name: 'dsh-TUI',
    repository: 'https://github.com/ccch1mneyyy/dsh-TUI',
    stars: '1.3k+',
    license: 'MIT',
    categoryKey: 'discovery.category.terminal',
    descriptionKey: 'discovery.plugin.tui',
    profile: 'dsh-tui',
    packageSpec: '@deepseek-harness-tui/dsh-tui',
  },
  {
    id: 'dsh-market',
    name: 'dsh-market',
    repository: 'https://github.com/dsh-market/dsh-market',
    stars: '380+',
    license: 'MIT',
    categoryKey: 'discovery.category.market',
    descriptionKey: 'discovery.plugin.market',
    profile: 'web',
    packageSpec: 'dshmarket',
  },
]

/** Full props assembled by the hero discovery slot. */
export type PluginDiscoveryProps =
  PropsRuntime<'conversation.hero.pluginDiscovery'>
  & PropsLocale<'settings.pluginInventory'>
  & PluginDiscoveryInjected

/** Controlled Host operations injected into the discovery card renderer. */
export interface PluginDiscoveryInjected {
  startInstall: (request: PluginInstallRequest) => Promise<PluginInstallSnapshot>
  getInstall: (installId: PluginInstallId) => Promise<PluginInstallSnapshot>
}

/** Exact CLI representation shown to users before the structured Remote call. */
function installCommand(plugin: CuratedPlugin): string {
  return `dsh plugin --profile ${plugin.profile} add ${plugin.packageSpec}`
}

/** Render the compact home entry and its reviewed community guide. */
export function PluginDiscovery({ t, startInstall, getInstall }: PluginDiscoveryProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<CuratedPlugin | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [installs, setInstalls] = useState<Record<string, PluginInstallSnapshot>>({})
  const [installError, setInstallError] = useState<string | null>(null)

  const running = Object.values(installs).find(install => install.phase === 'running')

  useEffect(() => {
    if (running === undefined) return
    let disposed = false
    const timer = window.setTimeout(() => {
      void getInstall(running.installId).then((snapshot) => {
        if (!disposed) setInstalls(current => ({ ...current, [snapshot.packageSpec]: snapshot }))
      }).catch(() => {
        if (!disposed) setInstallError(t('discovery.install.statusFailed'))
      })
    }, 750)
    return () => {
      disposed = true
      window.clearTimeout(timer)
    }
  }, [getInstall, running, t])

  const close = (): void => {
    setOpen(false)
    setCopied(null)
    setConfirmation(null)
    setAcknowledged(false)
    setInstallError(null)
  }

  const install = async (): Promise<void> => {
    const plugin = confirmation
    if (plugin === null) return
    setInstallError(null)
    try {
      const snapshot = await startInstall({ profile: plugin.profile, packageSpec: plugin.packageSpec })
      setInstalls(current => ({ ...current, [plugin.packageSpec]: snapshot }))
      setConfirmation(null)
      setAcknowledged(false)
    } catch {
      setInstallError(t('discovery.install.startFailed'))
    }
  }

  return (
    <>
      <button
        type="button"
        className={css.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { setOpen(true) }}
      >
        <IconCordisPluginOutline14 size={14} />
        {t('discovery.trigger')}
        <span className={css.triggerCount}>{CURATED_PLUGINS.length}</span>
      </button>
      <Modal
        open={open}
        onClose={close}
        closeLabel={t('discovery.close')}
        title={t('discovery.title')}
        description={t('discovery.description')}
        className={css.dialog as string}
        contentClassName={css.dialogContent as string}
        footer={(
          <div className={css.footer}>
            <span>{t('discovery.collected')}</span>
            <a href={GITHUB_TOPIC_URL} target="_blank" rel="noreferrer">
              {t('discovery.more')}
            </a>
          </div>
        )}
      >
        <div className={css.notice}>{t('discovery.notice')}</div>
        <ul className={css.grid}>
          {CURATED_PLUGINS.map((plugin) => {
            const command = installCommand(plugin)
            const status = installs[plugin.packageSpec]
            return (
              <li key={plugin.id} className={css.card}>
                <div className={css.cardHead}>
                  <div>
                    <div className={css.category}>{t(plugin.categoryKey)}</div>
                    <a className={css.name} href={plugin.repository} target="_blank" rel="noreferrer">
                      {plugin.name}
                    </a>
                  </div>
                  <span className={css.stars}>★ {plugin.stars}</span>
                </div>
                <p className={css.summary}>{t(plugin.descriptionKey)}</p>
                <div className={css.meta}>
                  <span>{plugin.license}</span>
                  <span>{t('discovery.thirdParty')}</span>
                </div>
                <code className={css.command}>{command}</code>
                {status !== undefined && (
                  <div
                    className={status.phase === 'failed' ? css.installError : css.installStatus}
                    role="status"
                  >
                    {status.phase === 'running'
                      ? t('discovery.install.running')
                      : status.phase === 'succeeded'
                        ? t('discovery.install.succeeded')
                        : t('discovery.install.failed')}
                    {status.phase === 'failed' && status.diagnostic !== undefined && (
                      <details>
                        <summary>{t('discovery.install.details')}</summary>
                        <pre>{status.diagnostic}</pre>
                      </details>
                    )}
                  </div>
                )}
                <div className={css.actions}>
                  <Button
                    variant="outline"
                    onClick={() => {
                      void writeClipboard(command).then((accepted) => {
                        if (accepted) setCopied(plugin.id)
                      })
                    }}
                  >
                    <IconCopyOutline16 size={14} />
                    {copied === plugin.id ? t('discovery.copied') : t('discovery.copy')}
                  </Button>
                  <Button
                    variant="primary"
                    disabled={status?.phase === 'running' || status?.phase === 'succeeded'}
                    onClick={() => {
                      setInstallError(null)
                      setAcknowledged(false)
                      setConfirmation(plugin)
                    }}
                  >
                    {status?.phase === 'succeeded'
                      ? t('discovery.install.installed')
                      : t('discovery.install.action')}
                  </Button>
                  <a href={plugin.repository} target="_blank" rel="noreferrer">
                    {t('discovery.source')}
                  </a>
                </div>
              </li>
            )
          })}
        </ul>
        {installError !== null && <div className={css.installError} role="alert">{installError}</div>}
      </Modal>
      <RiskConfirmation
        open={confirmation !== null}
        title={t('discovery.confirm.title')}
        description={t('discovery.confirm.description', { name: confirmation?.name ?? '' })}
        acknowledgeLabel={t('discovery.confirm.acknowledge')}
        cancelLabel={t('discovery.confirm.cancel')}
        confirmLabel={t('discovery.confirm.install')}
        acknowledged={acknowledged}
        disabled={running !== undefined}
        onAcknowledgedChange={setAcknowledged}
        onCancel={() => {
          setConfirmation(null)
          setAcknowledged(false)
        }}
        onConfirm={() => { void install() }}
      />
    </>
  )
}

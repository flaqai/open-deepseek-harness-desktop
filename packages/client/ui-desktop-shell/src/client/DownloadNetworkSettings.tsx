/** Desktop-owned source and proxy settings for application and plugin downloads. */

import { useSyncExternalStore } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DownloadNetworkSettings as Settings, DownloadNetworkTarget, DownloadNetworkTestStatus,
  DownloadProxySettings } from './bridge.ts'
import type { DownloadNetworkProjection } from './download-network-projection.ts'
import type { DesktopShellKey } from './locales.ts'
import css from './DesktopShell.module.css'

type Translate = (key: DesktopShellKey, params?: Record<string, string | number>) => string

function ProxyFields({ target, proxy, password, t, onProxy, onPassword }: {
  target: DownloadNetworkTarget
  proxy: DownloadProxySettings
  password: string
  t: Translate
  onProxy: (proxy: DownloadProxySettings) => void
  onPassword: (value: string) => void
}) {
  const application = target === 'application'
  return <div className={css.networkFields}>
    <label><span>{t('network.proxy')}</span><select value={proxy.mode} onChange={(event) => {
      onProxy({ mode: event.target.value as DownloadProxySettings['mode'], passwordSet: proxy.passwordSet })
    }}>
      {application && <option value="system">{t('network.proxy.system')}</option>}
      {!application && <option value="existing">{t('network.proxy.existing')}</option>}
      <option value="direct">{t('network.proxy.direct')}</option>
      <option value="custom">{t('network.proxy.custom')}</option>
    </select></label>
    {proxy.mode === 'custom' && <>
      <label><span>{t('network.proxy.url')}</span><input value={proxy.url ?? ''} placeholder={t('network.proxy.url')} onChange={(event) => {
        onProxy({ ...proxy, url: event.target.value })
      }} /></label>
      <label><span>{t('network.proxy.username')}</span><input value={proxy.username ?? ''} autoComplete="username" onChange={(event) => {
        onProxy({ ...proxy, username: event.target.value })
      }} /></label>
      <label><span>{t('network.proxy.password')}</span><input type="password" value={password} autoComplete="new-password"
        placeholder={proxy.passwordSet ? t('network.proxy.password.saved') : ''} onChange={(event) => {
          onPassword(event.target.value)
        }} /></label>
    </>}
  </div>
}

function TestResult({ target, status, t }: { target: DownloadNetworkTarget; status: DownloadNetworkTestStatus; t: Translate }) {
  if (status.phase === 'idle' || !('target' in status) || status.target !== target) return null
  if (status.phase === 'testing') return <div className={css.description}>{t('network.test.testing')}</div>
  if (status.phase === 'succeeded') return <div className={css.networkSuccess}>{t('network.test.success', { ms: status.elapsedMs })}</div>
  return <div className={css.error}>{t('network.test.failed', { message: status.message })}</div>
}

/** Download cards with redacted credential editing and capability-gated market controls. */
export function DownloadNetworkSettings({
  projection,
  t,
  scope = 'all',
  marketSettingsAvailable = false,
}: {
  projection: DownloadNetworkProjection
  t: Translate
  scope?: 'all' | 'application' | 'packages'
  /** The official market does not currently expose a host-managed network-policy capability. */
  marketSettingsAvailable?: boolean
}) {
  const { saved, draft, test, passwords, busy, error } = useSyncExternalStore(
    projection.subscribe, projection.getSnapshot, projection.getSnapshot,
  )
  if (draft === null || saved === null) return <div className={css.description}>{t('network.loading')}</div>

  const actions = (target: DownloadNetworkTarget) => <div className={css.networkActions}>
    <Button variant="outline" disabled={busy !== null || test.phase === 'testing'} onClick={() => { void projection.test(target) }}>{t('network.test')}</Button>
    <Button variant="outline" disabled={busy !== null} onClick={() => { void projection.reset(target) }}>{t('network.reset')}</Button>
    <Button disabled={busy !== null} onClick={() => { void projection.save(target) }}>{t('network.save')}</Button>
  </div>

  return <section className={css.networkSection}>
    <div><div className={css.title}>{scope === 'application' ? t('network.application.title') : t('network.title')}</div><div className={css.description}>{t(scope === 'application' ? 'network.application.description' : scope === 'packages' ? 'network.packages.description' : 'network.description')}</div></div>
    {scope !== 'packages' && <article className={css.networkCard}>
      <div className={css.networkHeading}><div><strong>{t('network.application.title')}</strong><small>{t('network.application.description')}</small></div><span>{t(`network.application.source.${saved.application.source}`)}</span></div>
      <div className={css.networkFields}><label><span>{t('network.source')}</span><select value={draft.application.source} onChange={(event) => {
        projection.setApplicationSource(event.target.value as 'github' | 'cnb')
      }}>
        <option value="github">{t('network.application.source.github')}</option><option value="cnb">{t('network.application.source.cnb')}</option>
      </select></label></div>
      <ProxyFields target="application" proxy={draft.application.proxy} password={passwords.application} t={t}
        onProxy={(proxy) => { projection.setProxy('application', proxy) }}
        onPassword={(value) => { projection.setPassword('application', value) }} />
      <TestResult target="application" status={test} t={t} />{actions('application')}
    </article>}
    {scope !== 'application' && <article className={css.networkCard}>
      <div className={css.networkHeading}><div><strong>{t('network.npm.title')}</strong><small>{t('network.npm.description')}</small></div><span>{t(`network.npm.registry.${saved.npm.registry}`)}</span></div>
      <div className={css.networkFields}><label><span>{t('network.registry')}</span><select value={draft.npm.registry} onChange={(event) => {
        projection.setNpmRegistry(event.target.value as Settings['npm']['registry'])
      }}>
        <option value="npmmirror">{t('network.npm.registry.npmmirror')}</option><option value="npmjs">{t('network.npm.registry.npmjs')}</option><option value="custom">{t('network.npm.registry.custom')}</option>
      </select></label>{draft.npm.registry === 'custom' && <label><span>{t('network.registry.url')}</span><input value={draft.npm.registryUrl ?? ''} onChange={(event) => {
        projection.setNpmRegistryUrl(event.target.value)
      }} /></label>}</div>
      <ProxyFields target="npm" proxy={draft.npm.proxy} password={passwords.npm} t={t}
        onProxy={(proxy) => { projection.setProxy('npm', proxy) }}
        onPassword={(value) => { projection.setPassword('npm', value) }} />
      <TestResult target="npm" status={test} t={t} />{actions('npm')}
    </article>}
    {scope !== 'application' && marketSettingsAvailable ? <>
      <article className={css.networkCard}>
        <div className={css.networkHeading}><div><strong>{t('network.github.title')}</strong><small>{t('network.github.description')}</small></div><span>{t(`network.github.download.${saved.github.download}`)}</span></div>
        <div className={css.networkFields}><label><span>{t('network.github.route')}</span><select value={draft.github.download} onChange={(event) => {
          projection.setGithubDownload(event.target.value as 'original' | 'custom')
        }}>
          <option value="original">{t('network.github.download.original')}</option><option value="custom">{t('network.github.download.custom')}</option>
        </select></label>{draft.github.download === 'custom' && <label><span>{t('network.github.accelerator')}</span><input value={draft.github.acceleratorUrl ?? ''} placeholder={t('network.github.accelerator')} onChange={(event) => {
          projection.setGithubAcceleratorUrl(event.target.value)
        }} /></label>}</div>
        <ProxyFields target="github" proxy={draft.github.proxy} password={passwords.github} t={t}
          onProxy={(proxy) => { projection.setProxy('github', proxy) }}
          onPassword={(value) => { projection.setPassword('github', value) }} />
        <div className={css.description}>{t('network.github.ssh')}</div><TestResult target="github" status={test} t={t} />{actions('github')}
      </article>
    </> : null}
    {error !== null && <div className={css.error}>{error}</div>}
  </section>
}

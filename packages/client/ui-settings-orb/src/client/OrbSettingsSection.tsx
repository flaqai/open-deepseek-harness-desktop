/** Floating-ball Settings section consuming the host-owned per-home state. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { OrbSettings, OrbSettingsPatch, OrbSettingsView } from './orb-bridge.ts'
import css from './OrbSettingsSection.module.css'

/** Injected methods and subscribed state from the plugin apply closure. */
export interface OrbSettingsInjected {
  hooks: { orb: { getSnapshot(): OrbSettingsView; subscribe(listener: () => void): () => void } }
  update(patch: OrbSettingsPatch): Promise<void>
  selectBackend(backend: OrbSettings['backend']): Promise<void>
  canSelectBackend: boolean
  restart(): Promise<void>
  canRestart: boolean
  reload(): void
  openTools(): void
}

/** Slot and locale-derived component props. */
export type OrbSettingsSectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'settings.orb'>
  & InjectFace<OrbSettingsInjected>

/** Render safe controls and explicit availability/permission guidance.
 * @param props - Injected state and user actions.
 * @returns The dedicated Settings page.
 */
export function OrbSettingsSection({
  t, useOrb, update, selectBackend, canSelectBackend, restart, canRestart, reload, openTools,
}: OrbSettingsSectionProps) {
  const view = useOrb(state => state)
  if (view.phase === 'unavailable') return <section className={css.section}><div className={css.heading}><h2>{t('title')}</h2></div><p className={css.notice}>{t('unavailable')}</p></section>
  if (view.phase === 'loading') return <section className={css.section} aria-busy="true"><div className={css.heading}><h2>{t('title')}</h2></div><p className={css.hint}>{t('loading')}</p></section>
  if (view.phase === 'error') return <section className={css.section}><div className={css.heading}><h2>{t('title')}</h2></div><p className={css.notice} role="alert">{t('error')}</p><button className={css.link} type="button" onClick={reload}>{t('retry')}</button></section>
  const settings = view.settings
  const status = view.status
  const switchingBlocked = status === undefined || status.mode !== 'local' || status.taskInspection === 'unknown' || status.activeTasks > 0 || status.pendingRestart || view.busy
  const backendReady = (backend: OrbSettings['backend']) => status?.backendAvailability[backend] === 'ready'
  const backendNotice = status === undefined ? t('statusUnavailable')
    : status.backendAvailability[settings.backend] === 'unknown' ? t('backendUnknown')
      : status.taskInspection === 'unknown' ? t('taskStatusUnknown')
        : status.activeTasks > 0 ? t('backendBusy')
          : status.pendingRestart ? t('restartPending')
            : status.backendAvailability[settings.backend] === 'not-installed' ? t('backendInstall')
              : status.backendAvailability[settings.backend] === 'unsupported' ? t('backendUnsupported')
                : t('backendReady')
  return <section className={css.section} aria-labelledby="orb-settings-title">
    <div className={css.heading}><h2 id="orb-settings-title">{t('title')}</h2><p>{t('description')}</p></div>
    {view.error !== undefined && <p className={css.notice} role="alert">{t('saveError')}</p>}
    {status?.mode === 'nas' && <p className={css.notice}>{t('unavailable')}</p>}
    <div className={css.card}>
      <h3>{t('display')}</h3>
      <label className={css.row}><span>{t('visible')}</span><input type="checkbox" checked={settings.visible} disabled={view.busy} onChange={(event) => { void update({ visible: event.currentTarget.checked }) }} /></label>
      <label className={css.row}><span>{t('showAtStartup')}</span><input type="checkbox" checked={settings.showAtStartup} disabled={view.busy} onChange={(event) => { void update({ showAtStartup: event.currentTarget.checked }) }} /></label>
    </div>
    <div className={css.card}>
      <h3>{t('appearance')}</h3>
      <label className={css.row}><span>{t('avatar')}</span><select value={settings.avatar} disabled={view.busy} onChange={(event) => { void update({ avatar: event.currentTarget.value === 'minimal' ? 'minimal' : 'deepseek' }) }}><option value="deepseek">{t('deepseek')}</option><option value="minimal">{t('minimal')}</option></select></label>
      <label className={css.row}><span>{t('anchor')}</span><select value={settings.anchor} disabled={view.busy} onChange={(event) => { void update({ anchor: event.currentTarget.value === 'left' ? 'left' : 'right' }) }}><option value="left">{t('left')}</option><option value="right">{t('right')}</option></select></label>
    </div>
    <div className={css.card}><h3>{t('selection')}</h3><p className={css.hint}>{status?.mode === 'local' && status.selectionAvailable ? t('selectionReady') : t('selectionHint')}</p>{status?.mode === 'local' && status.selectionAvailable && status.permission.accessibility === 'denied' && <p className={css.hint}>{t('automaticSelectionNeedsAccessibility')}</p>}<label className={css.row}><span>{t('selectionToolbar')}</span><input type="checkbox" checked={settings.selectionToolbar} disabled={status?.mode !== 'local' || view.busy} onChange={(event) => { void update({ selectionToolbar: event.currentTarget.checked }) }} /></label></div>
    <div className={css.card}>
      <h3>{t('computer')}</h3><p className={css.hint}>{t('computerHint')}</p>
      <label className={css.row}><span>{t('backend')}</span><select value={settings.backend} disabled={!canSelectBackend || switchingBlocked} aria-describedby="orb-backend-notice" onChange={(event) => { const next = event.currentTarget.value; if (next === 'orb' || next === 'official-native' || next === 'official-mcp') void selectBackend(next) }}><option value="orb" disabled={!backendReady('orb')}>{t('orbBackend')}</option><option value="official-native" disabled={!backendReady('official-native')}>{t('officialNative')}</option><option value="official-mcp" disabled={!backendReady('official-mcp')}>{t('officialMcp')}</option></select></label>
      <p id="orb-backend-notice" className={css.hint} aria-live="polite">{status?.pendingRestart ? t('restartPending') : status?.backendAvailability[settings.backend] === 'unknown' ? t('backendUnknown') : status?.taskInspection === 'unknown' ? t('taskStatusUnknown') : canSelectBackend ? backendNotice : t('backendPending')}</p>
      {status?.pendingRestart && status.mode === 'local' && <button className={css.restart} type="button" disabled={!canRestart || view.busy} onClick={() => { void restart() }}>{t('restartNow')}</button>}
      <dl className={css.statusGrid}><div><dt>{t('screenPermission')}</dt><dd>{status?.permission.screen === 'granted' ? t('permissionGranted') : status?.permission.screen === 'denied' ? t('permissionDenied') : t('permissionUnknown')}</dd></div><div><dt>{t('accessibilityPermission')}</dt><dd>{status?.permission.accessibility === 'granted' ? t('permissionGranted') : status?.permission.accessibility === 'denied' ? t('permissionDenied') : t('permissionUnknown')}</dd></div></dl>
      <button className={css.link} type="button" onClick={openTools}>{t('tools')}</button>
    </div>
    <div className={css.card}><h3>{t('background')}</h3><p className={css.hint}>{t('backgroundHint')}</p><p className={css.status} aria-live="polite">{status?.taskInspection === 'unknown' ? t('taskStatusUnknown') : status?.backgroundAvailable ? t('activeTasks', { count: status.activeTasks }) : t('backgroundUnavailable')}</p>{status?.observationActive && <p className={css.notice} role="status">{t('observing')}</p>}</div>
  </section>
}

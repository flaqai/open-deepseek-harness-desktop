/** Floating-ball Settings section consuming the host-owned per-home state. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { OrbSettingsPatch, OrbSettingsView } from './orb-bridge.ts'
import css from './OrbSettingsSection.module.css'

/** Injected methods and subscribed state from the plugin apply closure. */
export interface OrbSettingsInjected {
  hooks: { orb: { getSnapshot(): OrbSettingsView; subscribe(listener: () => void): () => void } }
  update(patch: OrbSettingsPatch): Promise<void>
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
export function OrbSettingsSection({ t, useOrb, update, reload, openTools }: OrbSettingsSectionProps) {
  const view = useOrb(state => state)
  if (view.phase === 'unavailable') return <section className={css.section}><div className={css.heading}><h2>{t('title')}</h2></div><p className={css.notice}>{t('unavailable')}</p></section>
  if (view.phase === 'loading') return <section className={css.section}><p className={css.hint}>{t('loading')}</p></section>
  if (view.phase === 'error') return <section className={css.section}><p className={css.notice}>{t('error')}</p><button className={css.link} type="button" onClick={reload}>{t('retry')}</button></section>
  const settings = view.settings
  return <section className={css.section} aria-labelledby="orb-settings-title">
    <div className={css.heading}><h2 id="orb-settings-title">{t('title')}</h2><p>{t('description')}</p></div>
    {view.error !== undefined && <p className={css.notice} role="alert">{t('saveError')}</p>}
    <div className={css.card}>
      <h3>{t('display')}</h3>
      <label className={css.row}><span>{t('visible')}</span><input type="checkbox" checked={settings.visible} onChange={(event) => { void update({ visible: event.currentTarget.checked }) }} /></label>
      <label className={css.row}><span>{t('showAtStartup')}</span><input type="checkbox" checked={settings.showAtStartup} onChange={(event) => { void update({ showAtStartup: event.currentTarget.checked }) }} /></label>
    </div>
    <div className={css.card}>
      <h3>{t('appearance')}</h3>
      <label className={css.row}><span>{t('avatar')}</span><select value={settings.avatar} onChange={(event) => { void update({ avatar: event.currentTarget.value === 'minimal' ? 'minimal' : 'deepseek' }) }}><option value="deepseek">{t('deepseek')}</option><option value="minimal">{t('minimal')}</option></select></label>
      <label className={css.row}><span>{t('anchor')}</span><select value={settings.anchor} onChange={(event) => { void update({ anchor: event.currentTarget.value === 'left' ? 'left' : 'right' }) }}><option value="left">{t('left')}</option><option value="right">{t('right')}</option></select></label>
    </div>
    <div className={css.card}><h3>{t('selection')}</h3><p className={css.hint}>{t('selectionHint')}</p></div>
    <div className={css.card}>
      <h3>{t('computer')}</h3><p className={css.hint}>{t('computerHint')}</p>
      <label className={css.row}><span>{t('orbBackend')}</span><select value={settings.backend} disabled aria-describedby="orb-backend-notice"><option value="orb">{t('orbBackend')}</option><option value="official-native">{t('officialNative')}</option><option value="official-mcp">{t('officialMcp')}</option></select></label>
      <p id="orb-backend-notice" className={css.hint}>{t('backendPending')}</p>
      <button className={css.link} type="button" onClick={openTools}>{t('tools')}</button>
    </div>
    <div className={css.card}><h3>{t('background')}</h3><p className={css.hint}>{t('backgroundHint')}</p></div>
  </section>
}

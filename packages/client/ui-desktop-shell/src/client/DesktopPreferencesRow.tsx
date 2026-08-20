/** General Settings rows owned by the Electron desktop shell feature. */

import { useState, useSyncExternalStore } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { DesktopShellController } from './controller.ts'
import css from './DesktopShell.module.css'

export type DesktopPreferencesRowProps = PropsRuntime<'settings.general.item'>
  & PropsLocale<'desktop-shell'>
  & { controller: DesktopShellController }

function Toggle({ enabled, disabled, label, onChange }: {
  enabled: boolean
  disabled?: boolean
  label: string
  onChange(enabled: boolean): void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={enabled}
      disabled={disabled}
      className={css.toggle}
      data-enabled={enabled}
      onClick={() => { onChange(!enabled) }}
    >
      <span />
    </button>
  )
}

export function DesktopPreferencesRow({ controller, t }: DesktopPreferencesRowProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const [menuOpen, setMenuOpen] = useState(false)
  const preferences = state.preferences
  if (preferences === null || state.capabilities === null) return null
  const release = state.release
  const releaseText = release.phase === 'checking'
    ? t('release.checking')
    : release.phase === 'available'
      ? t('release.available', { version: release.latestVersion })
      : release.phase === 'current'
        ? t('release.current')
        : release.phase === 'error'
          ? t('release.error')
          : t('release.unsupported')

  return (
    <section className={css.group}>
      <div className={css.row}>
        <div className={css.text}>
          <div className={css.title}>{t('close.title')}</div>
          <div className={css.description}>{t('close.description')}</div>
        </div>
        <Menu
          open={menuOpen}
          onClose={() => { setMenuOpen(false) }}
          items={[
            { id: 'tray', label: t('close.tray') },
            { id: 'quit', label: t('close.quit') },
          ]}
          selectedId={preferences.closeBehavior}
          onSelect={(id) => {
            setMenuOpen(false)
            controller.setCloseBehavior(id === 'quit' ? 'quit' : 'tray')
          }}
          align="end"
          portal
          anchor={(
            <button type="button" className={css.selector} onClick={() => { setMenuOpen(value => !value) }}>
              {t(preferences.closeBehavior === 'tray' ? 'close.tray' : 'close.quit')}
              <IconChevronDownOutline14 />
            </button>
          )}
        />
      </div>
      <div className={css.row}>
        <div className={css.text}>
          <div className={css.title}>{t('notifications.title')}</div>
          <div className={css.description}>{t('notifications.description')}</div>
        </div>
        <Toggle
          label={t('notifications.title')}
          enabled={preferences.notificationsEnabled}
          disabled={state.busy}
          onChange={(enabled) => { controller.setNotifications(enabled) }}
        />
      </div>
      <div className={css.row}>
        <div className={css.text}>
          <div className={css.title}>{t('launch.title')}</div>
          <div className={css.description}>
            {state.capabilities.launchAtLoginAvailable ? t('launch.description') : t('launch.unavailable')}
          </div>
        </div>
        <Toggle
          label={t('launch.title')}
          enabled={preferences.launchAtLoginEnabled}
          disabled={state.busy || !state.capabilities.launchAtLoginAvailable}
          onChange={(enabled) => { controller.setLaunchAtLogin(enabled) }}
        />
      </div>
      {release.phase !== 'unsupported' && (
        <div className={css.row}>
          <div className={css.text}>
            <div className={css.title}>{t('release.title')}</div>
            <div className={release.phase === 'error' ? css.error : css.description}>{releaseText}</div>
          </div>
          <div className={css.actions}>
            <Button variant="outline" disabled={release.phase === 'checking'} onClick={() => { void controller.checkRelease() }}>
              {t('release.check')}
            </Button>
            {release.phase === 'available' && (
              <Button variant="primary" onClick={() => { void controller.openRelease() }}>{t('release.open')}</Button>
            )}
          </div>
        </div>
      )}
      {state.error !== null && <div className={css.error} role="alert">{state.error}</div>}
    </section>
  )
}

/** General Settings rows owned by the Electron desktop shell feature. */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, IconChevronDownOutline14, Menu, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { DesktopShellController } from './controller.ts'
import type { DesktopIconsBridge } from './icon-protocol.ts'
import type { DesktopProcessesBridge } from './bridge.ts'
import type { DownloadNetworkProjection } from './download-network-projection.ts'
import { DownloadNetworkSettings } from './DownloadNetworkSettings.tsx'
import { ManagedProcessesRow } from './ManagedProcessesRow.tsx'
import { DesktopIconSettings } from './DesktopIconSettings.tsx'
import css from './DesktopShell.module.css'

export type DesktopPreferencesRowProps = PropsRuntime<'settings.general.item'>
  & PropsLocale<'desktop-shell'>
  & {
    controller: DesktopShellController
    icons?: DesktopIconsBridge | undefined
    processes?: DesktopProcessesBridge | undefined
    openLog?: (() => Promise<unknown>) | undefined
    downloadNetwork?: DownloadNetworkProjection | undefined
  }

function Toggle({ enabled, disabled, label, onChange }: {
  enabled: boolean
  disabled?: boolean
  label: string
  onChange: (enabled: boolean) => void
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

export function DesktopPreferencesRow({ controller, icons, processes, openLog, downloadNetwork, t }: DesktopPreferencesRowProps) {
  const subscribe = useCallback((listener: () => void) => controller.subscribe(listener), [controller])
  const getSnapshot = useCallback(() => controller.getSnapshot(), [controller])
  const state = useSyncExternalStore(subscribe, getSnapshot)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmingCommandLine, setConfirmingCommandLine] = useState(false)
  const networkRow = useRef<HTMLDivElement>(null)
  const preferences = state.preferences
  useEffect(() => {
    if (state.preferences === null || state.capabilities === null || state.menuDestination !== 'data-home') return
    void controller.openDataHomeChooser()
    controller.navigate()
  }, [controller, state.preferences, state.capabilities, state.menuDestination, state.dataHome])
  useEffect(() => {
    if (state.capabilities === null || state.menuDestination !== 'download-network') return
    let secondFrame = 0
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        networkRow.current?.scrollIntoView({ block: 'center' })
        controller.navigate()
      })
    })
    return () => {
      window.cancelAnimationFrame(firstFrame)
      if (secondFrame !== 0) window.cancelAnimationFrame(secondFrame)
    }
  }, [controller, state.capabilities, state.menuDestination])
  if (preferences === null || state.capabilities === null) return null
  const commandLine = state.commandLine
  const dataHome = state.dataHome
  const commandLineActionUnavailable = commandLine?.phase === 'unsupported'
    || commandLine?.phase === 'unsupported-shell'
    || commandLine?.phase === 'setup-required'
  const desktopWebSupported = state.capabilities.platform === 'darwin' || state.capabilities.platform === 'win32'

  return (
    <section className={css.group}>
      {icons !== undefined && ['darwin', 'win32'].includes(state.capabilities.platform) && <DesktopIconSettings bridge={icons} t={t} />}
      {processes !== undefined && openLog !== undefined && <ManagedProcessesRow bridge={processes} openLog={openLog} t={t} />}
      {desktopWebSupported && <><div className={css.row}>
        <div className={css.text}>
          <div className={css.title}>{t('web.title')}</div>
          <div className={css.description}>{t('web.description')}</div>
          {state.desktopWeb.phase === 'error' && <div className={css.error}>{t('web.error', { message: state.desktopWeb.message })}</div>}
        </div>
        <div className={css.actions}>
          <Button
            variant="outline"
            disabled={state.desktopWeb.phase === 'starting' || state.desktopWeb.phase === 'opening'}
            onClick={() => { void controller.openDesktopWeb() }}
          >
            {t(state.desktopWeb.phase === 'starting' ? 'web.starting'
              : state.desktopWeb.phase === 'opening' ? 'web.opening' : 'web.open')}
          </Button>
        </div>
      </div>
      <div className={css.row}>
        <div className={css.text}>
          <div className={css.title}>{t('web.auto.title')}</div>
          <div className={css.description}>{t('web.auto.description')}</div>
        </div>
        <Toggle
          label={t('web.auto.title')}
          enabled={preferences.openBrowserOnStartup}
          disabled={state.busy}
          onChange={(enabled) => { controller.setOpenBrowserOnStartup(enabled) }}
        />
      </div></>}
      <div className={css.row}>
        <div className={css.text}>
          <div className={css.title}>{t('close.title')}</div>
          <div className={css.description}>{t('close.description')}</div>
          {state.capabilities.platform === 'linux' && <div className={css.description}>{t('close.linux')}</div>}
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
      {dataHome !== null && (
        <div className={css.row}>
          <div className={css.text}>
            <div className={css.title}>{t('dataHome.title')}</div>
            <div className={css.description}>
              {t(dataHome.managedExternally ? 'dataHome.external' : `dataHome.mode.${dataHome.activeKind}`)}
            </div>
            <div className={css.path}>{dataHome.activePath}</div>
          </div>
          {!dataHome.managedExternally && (
            <div className={css.actions}>
              <Button
                variant="outline"
                disabled={state.busy}
                onClick={() => { void controller.openDataHomeChooser() }}
              >
                {t('dataHome.change')}
              </Button>
            </div>
          )}
        </div>
      )}
      {state.capabilities.commandLineAvailable && commandLine !== null && (
        <div className={css.row}>
          <div className={css.text}>
            <div className={css.title}>{t('cli.title')}</div>
            <div className={commandLine.phase === 'broken' ? css.error : css.description}>
              {t(`cli.phase.${commandLine.phase}`)}
            </div>
            <div className={css.path}>{commandLine.commandPath}</div>
            {commandLine.dataHome !== '' && (
              <div className={css.description}>{t('cli.dataHome', { path: commandLine.dataHome })}</div>
            )}
            {commandLine.reason !== undefined && <div className={css.error}>{t(`cli.reason.${commandLine.reason}`)}</div>}
            {commandLine.message !== undefined && <div className={css.error}>{commandLine.message}</div>}
          </div>
          <div className={css.actions}>
            {commandLine.phase === 'installed' ? (
              <>
                <Button variant="outline" disabled={state.busy} onClick={() => { void controller.installCommandLine(false) }}>
                  {t('cli.repair')}
                </Button>
                <Button variant="outline" disabled={state.busy} onClick={() => { void controller.removeCommandLine() }}>
                  {t('cli.remove')}
                </Button>
              </>
            ) : commandLineActionUnavailable ? null : (
              <Button
                variant="outline"
                disabled={state.busy}
                onClick={() => {
                  if (commandLine.phase === 'conflict') setConfirmingCommandLine(true)
                  else void controller.installCommandLine(false)
                }}
              >
                {t(commandLine.phase === 'broken' ? 'cli.repair' : 'cli.install')}
              </Button>
            )}
          </div>
        </div>
      )}
      {state.capabilities.developmentRecoveryAvailable && (
        <div className={css.row}>
          <div className={css.text}>
            <div className={css.title}>{t('recovery.development.title')}</div>
            <div className={css.description}>{t('recovery.development.description')}</div>
          </div>
          <div className={css.actions}>
            <Button
              variant="outline"
              disabled={state.busy}
              onClick={() => { void controller.enterRecoveryMode() }}
            >
              {t('recovery.development.open')}
            </Button>
          </div>
        </div>
      )}
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
      {downloadNetwork !== undefined && <div ref={networkRow}><DownloadNetworkSettings projection={downloadNetwork} t={t} scope="packages" /></div>}
      {state.error !== null && <div className={css.error} role="alert">{state.error}</div>}
      <Modal
        open={confirmingCommandLine}
        title={t('cli.conflict.title')}
        description={t('cli.conflict.description', { path: commandLine?.conflictPath ?? '' })}
        closeLabel={t('cli.conflict.cancel')}
        onClose={() => { setConfirmingCommandLine(false) }}
      >
        <div className={css.modalActions}>
          <Button variant="outline" onClick={() => { setConfirmingCommandLine(false) }}>{t('cli.conflict.cancel')}</Button>
          <Button
            variant="primary"
            onClick={() => {
              setConfirmingCommandLine(false)
              void controller.installCommandLine(true)
            }}
          >
            {t('cli.conflict.confirm')}
          </Button>
        </div>
      </Modal>
    </section>
  )
}

/** General Settings rows owned by the Electron desktop shell feature. */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, IconChevronDownOutline14, Menu, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { DEVELOPMENT_RELEASE_VERSION, type DesktopShellController } from './controller.ts'
import type { DesktopIconsBridge } from './icon-protocol.ts'
import { DesktopIconSettings } from './DesktopIconSettings.tsx'
import css from './DesktopShell.module.css'

export type DesktopPreferencesRowProps = PropsRuntime<'settings.general.item'>
  & PropsLocale<'desktop-shell'>
  & { controller: DesktopShellController; icons?: DesktopIconsBridge | undefined }

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

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

export function DesktopPreferencesRow({ controller, icons, t }: DesktopPreferencesRowProps) {
  const subscribe = useCallback((listener: () => void) => controller.subscribe(listener), [controller])
  const getSnapshot = useCallback(() => controller.getSnapshot(), [controller])
  const state = useSyncExternalStore(subscribe, getSnapshot)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmingCommandLine, setConfirmingCommandLine] = useState(false)
  const [dataHomeOpen, setDataHomeOpen] = useState(false)
  const [dataHomeTarget, setDataHomeTarget] = useState<'desktop' | 'official' | 'custom' | 'create'>('desktop')
  const preferences = state.preferences
  const updateRow = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (state.preferences === null || state.capabilities === null || state.menuDestination === undefined) return
    if (state.menuDestination === 'data-home') {
      setDataHomeTarget(state.dataHome?.activeKind === 'official' ? 'official' : 'desktop')
      setDataHomeOpen(true)
      controller.navigate()
      return
    }
    let secondFrame = 0
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        updateRow.current?.scrollIntoView({ block: 'center' })
        controller.navigate()
      })
    })
    return () => {
      window.cancelAnimationFrame(firstFrame)
      if (secondFrame !== 0) window.cancelAnimationFrame(secondFrame)
    }
  }, [controller, state.preferences, state.capabilities, state.menuDestination, state.dataHome])
  if (preferences === null || state.capabilities === null) return null
  const release = state.release
  const releaseDownload = state.releaseDownload
  const commandLine = state.commandLine
  const dataHome = state.dataHome
  const dataHomeSelection = state.dataHomeSelection
  const dataHomeTargetIsCurrent = dataHome !== null && (
    (dataHomeTarget === 'desktop' && dataHome.activeKind === 'desktop')
    || (dataHomeTarget === 'official' && dataHome.activeKind === 'official')
    || (dataHomeTarget === 'custom'
      && dataHomeSelection?.status === 'selected'
      && dataHomeSelection.selectionKind === 'existing'
      && dataHomeSelection.path === dataHome.activePath)
  )
  const commandLineActionUnavailable = commandLine?.phase === 'unsupported'
    || commandLine?.phase === 'unsupported-shell'
    || commandLine?.phase === 'setup-required'
  const releaseText = release.phase === 'unsupported'
    ? state.simulatedReleaseAvailable
      ? t('release.developmentAvailable', { version: DEVELOPMENT_RELEASE_VERSION })
      : t('release.developmentCurrent')
    : release.phase === 'checking'
      ? t('release.checking')
      : release.phase === 'available'
        ? t('release.available', { version: release.latestVersion })
        : release.phase === 'current'
          ? t('release.current')
          : t('release.error')
  const installerDownloadSupported = state.capabilities.packaged
    && (state.capabilities.platform === 'darwin' || state.capabilities.platform === 'win32')
  const selectedDownload = release.phase === 'available'
    && 'version' in releaseDownload
    && releaseDownload.version === release.latestVersion
    ? releaseDownload
    : releaseDownload.phase === 'idle' || releaseDownload.phase === 'unsupported'
      ? releaseDownload
      : { phase: 'idle' as const }
  const downloadActive = selectedDownload.phase === 'resolving'
    || selectedDownload.phase === 'downloading'
    || selectedDownload.phase === 'verifying'
  const downloadText = selectedDownload.phase === 'resolving'
    ? t('release.download.resolving')
    : selectedDownload.phase === 'downloading'
      ? t('release.download.progress', {
        percent: selectedDownload.percent,
        transferred: formatBytes(selectedDownload.transferredBytes),
        total: formatBytes(selectedDownload.totalBytes),
      })
      : selectedDownload.phase === 'verifying'
        ? t('release.download.verifying')
        : selectedDownload.phase === 'ready'
          ? t('release.download.ready', { file: selectedDownload.fileName })
          : selectedDownload.phase === 'cancelled'
            ? t('release.download.cancelled')
            : selectedDownload.phase === 'error'
              ? t('release.download.error', { message: selectedDownload.message })
              : null

  return (
    <section className={css.group}>
      {icons !== undefined && ['darwin', 'win32'].includes(state.capabilities.platform) && <DesktopIconSettings bridge={icons} t={t} />}
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
                onClick={() => {
                  setDataHomeTarget(dataHome.activeKind === 'official'
                    ? 'official'
                    : dataHome.activeKind === 'custom' ? 'custom' : 'desktop')
                  setDataHomeOpen(true)
                }}
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
      <div className={css.row}>
        <div className={css.text}>
          <div ref={updateRow} className={css.title}>{t('release.title')}</div>
          <div className={release.phase === 'error' ? css.error : css.description}>{releaseText}</div>
          {release.phase === 'available'
            && state.capabilities.platform === 'darwin'
            && state.capabilities.packaged && (
            <div className={css.description}>{t('release.macosInstallHint')}</div>
          )}
          {release.phase === 'available' && downloadText !== null && (
            <div className={selectedDownload.phase === 'error' ? css.error : css.description}>{downloadText}</div>
          )}
          {selectedDownload.phase === 'downloading' && (
            <progress
              className={css.progress}
              aria-label={t('release.download.progressLabel')}
              value={selectedDownload.transferredBytes}
              max={selectedDownload.totalBytes}
            />
          )}
        </div>
        {release.phase === 'unsupported' ? (
          <div className={css.actions}>
            <Button
              variant={state.simulatedReleaseAvailable ? 'primary' : 'outline'}
              onClick={() => { controller.toggleSimulatedRelease() }}
            >
              {t(state.simulatedReleaseAvailable ? 'release.developmentOpen' : 'release.check')}
            </Button>
          </div>
        ) : (
          <div className={css.actions}>
            <Button
              variant="outline"
              disabled={release.phase === 'checking' || downloadActive}
              onClick={() => { void controller.checkRelease() }}
            >
              {t('release.check')}
            </Button>
            {release.phase === 'available' && (
              installerDownloadSupported ? (
                selectedDownload.phase === 'ready' ? (
                  <Button variant="primary" onClick={() => { void controller.openInstaller() }}>
                    {t('release.download.open')}
                  </Button>
                ) : downloadActive ? (
                  <Button variant="outline" onClick={() => { void controller.cancelReleaseDownload() }}>
                    {t('release.download.cancel')}
                  </Button>
                ) : (
                  <Button variant="primary" onClick={() => { void controller.downloadRelease() }}>
                    {t(selectedDownload.phase === 'error' || selectedDownload.phase === 'cancelled'
                      ? 'release.download.retry'
                      : 'release.download.start')}
                  </Button>
                )
              ) : (
                <Button variant="primary" onClick={() => { void controller.openRelease() }}>{t('release.open')}</Button>
              )
            )}
          </div>
        )}
      </div>
      {state.error !== null && <div className={css.error} role="alert">{state.error}</div>}
      <Modal
        open={dataHomeOpen}
        title={t('dataHome.modal.title')}
        description={t('dataHome.modal.description')}
        closeLabel={t('dataHome.cancel')}
        onClose={() => { setDataHomeOpen(false) }}
      >
        <div className={css.dataHomeChoices} role="radiogroup" aria-label={t('dataHome.modal.title')}>
          <label className={css.dataHomeChoice} data-selected={dataHomeTarget === 'desktop'}>
            <input
              type="radio"
              name="desktop-data-home"
              checked={dataHomeTarget === 'desktop'}
              onChange={() => { setDataHomeTarget('desktop') }}
            />
            <span>
              <strong>{t('dataHome.desktop.title')}</strong>
              <small>{t('dataHome.desktop.description')}</small>
              <code>{dataHome?.desktopPath ?? ''}</code>
            </span>
          </label>
          <label
            className={css.dataHomeChoice}
            data-selected={dataHomeTarget === 'official'}
            data-disabled={dataHome?.officialAvailable !== true}
          >
            <input
              type="radio"
              name="desktop-data-home"
              checked={dataHomeTarget === 'official'}
              disabled={dataHome?.officialAvailable !== true}
              onChange={() => { setDataHomeTarget('official') }}
            />
            <span>
              <strong>{t('dataHome.official.title')}</strong>
              <small>{t(dataHome?.officialAvailable === true
                ? 'dataHome.official.description'
                : 'dataHome.official.unavailable')}</small>
              <code>{dataHome?.officialPath ?? ''}</code>
            </span>
          </label>
          <label className={css.dataHomeChoice} data-selected={dataHomeTarget === 'custom'}>
            <input
              type="radio"
              name="desktop-data-home"
              checked={dataHomeTarget === 'custom'}
              onChange={() => { setDataHomeTarget('custom') }}
            />
            <span>
              <strong>{t('dataHome.custom.title')}</strong>
              <small>{t('dataHome.custom.description')}</small>
              {dataHomeSelection?.status === 'selected'
                && dataHomeSelection.selectionKind === 'existing'
                && <code>{dataHomeSelection.path}</code>}
            </span>
          </label>
          <label className={css.dataHomeChoice} data-selected={dataHomeTarget === 'create'}>
            <input
              type="radio"
              name="desktop-data-home"
              checked={dataHomeTarget === 'create'}
              onChange={() => { setDataHomeTarget('create') }}
            />
            <span>
              <strong>{t('dataHome.create.title')}</strong>
              <small>{t('dataHome.create.description')}</small>
              {dataHomeSelection?.status === 'selected'
                && dataHomeSelection.selectionKind === 'empty'
                && <code>{dataHomeSelection.path}</code>}
            </span>
          </label>
          {(dataHomeTarget === 'custom' || dataHomeTarget === 'create') && <div className={css.dataHomePicker}>
            <Button
              variant="outline"
              disabled={state.busy}
              onClick={() => {
                void controller.chooseDataHome(dataHomeTarget === 'create' ? 'empty' : 'existing')
              }}
            >
              {t(dataHomeTarget === 'create' ? 'dataHome.create.choose' : 'dataHome.custom.choose')}
            </Button>
            {dataHomeSelection?.status === 'invalid'
              || dataHomeSelection?.status === 'not-empty'
              || dataHomeSelection?.status === 'unreadable' ? (
                <span className={css.error}>{t(`dataHome.custom.${dataHomeSelection.status}`, { path: dataHomeSelection.path })}</span>
              ) : null}
          </div>}
          <p className={css.dataHomeWarning}>{t('dataHome.warning')}</p>
        </div>
        <div className={css.modalActions}>
          <Button variant="outline" onClick={() => { setDataHomeOpen(false) }}>{t('dataHome.cancel')}</Button>
          <Button
            variant="primary"
            disabled={state.busy
              || state.restartPending
              || dataHome === null
              || dataHomeTargetIsCurrent
              || (dataHomeTarget === 'official' && !dataHome.officialAvailable)
              || (dataHomeTarget === 'custom'
                && (dataHomeSelection?.status !== 'selected' || dataHomeSelection.selectionKind !== 'existing'))
              || (dataHomeTarget === 'create'
                && (dataHomeSelection?.status !== 'selected' || dataHomeSelection.selectionKind !== 'empty'))}
            onClick={() => {
              if (dataHomeTarget === 'custom' || dataHomeTarget === 'create') {
                if (dataHomeSelection?.status !== 'selected') return
                void controller.switchDataHome({ kind: dataHomeTarget, selectionId: dataHomeSelection.selectionId })
                return
              }
              void controller.switchDataHome({ kind: dataHomeTarget })
            }}
          >
            {t(state.restartPending ? 'dataHome.restarting' : 'dataHome.confirm')}
          </Button>
        </div>
      </Modal>
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

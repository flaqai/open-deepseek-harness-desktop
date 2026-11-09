/** Quiet settings-header indicator for a newly discovered desktop Release. */

import { useCallback, useSyncExternalStore } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { DEVELOPMENT_RELEASE_VERSION, type DesktopShellController } from './controller.ts'
import { releaseDownloadLabel, selectedReleaseDownload } from './release-download-presentation.ts'
import css from './DesktopUpdateBadge.module.css'

export interface DesktopUpdateBadgeInjected {
  controller: DesktopShellController
  openUpdates: () => void
}

export type DesktopUpdateBadgeProps = PropsRuntime<'settings.action'>
  & PropsLocale<'desktop-shell'>
  & InjectFace<DesktopUpdateBadgeInjected>

/** Render only while Release discovery has a newer version. */
export function DesktopUpdateBadge({ controller, openUpdates, t }: DesktopUpdateBadgeProps) {
  const subscribe = useCallback((listener: () => void) => controller.subscribe(listener), [controller])
  const getSnapshot = useCallback(() => controller.getSnapshot(), [controller])
  const state = useSyncExternalStore(subscribe, getSnapshot)
  const version = state.release.phase === 'available'
    ? state.release.latestVersion
    : state.release.phase === 'unsupported' && state.simulatedReleaseAvailable
      ? DEVELOPMENT_RELEASE_VERSION
      : undefined
  const downloadLabel = releaseDownloadLabel(selectedReleaseDownload(state.release, state.releaseDownload))
  if (version === undefined && downloadLabel === undefined) return null
  const label = downloadLabel === undefined ? t('release.badge', { version: version ?? '' }) : t(downloadLabel)
  return (
    <Button
      variant="outline"
      size="sm"
      className={css.badge}
      icon={<span className={css.dot} aria-hidden="true" />}
      aria-label={label}
      onClick={openUpdates}
    >
      {label}
    </Button>
  )
}

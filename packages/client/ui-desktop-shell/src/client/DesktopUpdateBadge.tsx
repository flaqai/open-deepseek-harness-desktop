/** Quiet settings-header indicator for a newly discovered desktop Release. */

import { useCallback, useSyncExternalStore } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { DEVELOPMENT_RELEASE_VERSION, type DesktopShellController } from './controller.ts'
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
  if (version === undefined) return null
  const label = t('release.badge', { version })
  return (
    <button type="button" className={css.badge} aria-label={label} onClick={openUpdates}>
      <span className={css.dot} aria-hidden="true" />
      <span>{label}</span>
    </button>
  )
}

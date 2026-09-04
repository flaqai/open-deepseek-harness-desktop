/** Sidebar-foot call to action for an available desktop update. */

import { useCallback, useSyncExternalStore } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { DEVELOPMENT_RELEASE_VERSION, type DesktopShellController } from './controller.ts'
import css from './DesktopSidebarUpdateButton.module.css'

export interface DesktopSidebarUpdateButtonInjected {
  controller: DesktopShellController
  openUpdates: () => void
}

export type DesktopSidebarUpdateButtonProps = PropsRuntime<'sidebar.settings.action'>
  & PropsLocale<'desktop-shell'>
  & InjectFace<DesktopSidebarUpdateButtonInjected>

/** Render a blue update action immediately beside Settings in wide mode. */
export function DesktopSidebarUpdateButton({ controller, openUpdates, t, wide }: DesktopSidebarUpdateButtonProps) {
  const subscribe = useCallback((listener: () => void) => controller.subscribe(listener), [controller])
  const getSnapshot = useCallback(() => controller.getSnapshot(), [controller])
  const state = useSyncExternalStore(subscribe, getSnapshot)
  const version = state.release.phase === 'available'
    ? state.release.latestVersion
    : state.release.phase === 'unsupported' && state.simulatedReleaseAvailable
      ? DEVELOPMENT_RELEASE_VERSION
      : undefined
  if (!wide || version === undefined) return null
  const label = t('release.badge', { version })
  return (
    <button type="button" className={css.button} aria-label={label} title={label} onClick={openUpdates}>
      {t('release.sidebar')}
    </button>
  )
}

/** Sidebar update badge for an available downloadable Release. */

import { useSyncExternalStore } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconDownloadOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { DesktopShellController } from './controller.ts'
import css from './DesktopShell.module.css'

export type ReleaseFooterActionProps = PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<'desktop-shell'>
  & { controller: DesktopShellController }

export function ReleaseFooterAction({ wide, controller, t }: ReleaseFooterActionProps) {
  const release = useSyncExternalStore(controller.subscribe, controller.getSnapshot).release
  if (release.phase !== 'available') return <div className={css.releaseOwner} data-desktop-release hidden />
  const label = t('release.badge', { version: release.latestVersion })
  return (
    <div
      className={wide ? `${css.releaseOwner} ${css.footer}` : `${css.releaseOwner} ${css.footer} ${css.rail}`}
      data-desktop-release
    >
      <Tooltip label={label} side="right" delayMs={300} disabled={wide}>
        <button type="button" className={css.footerButton} aria-label={label} onClick={() => { void controller.openRelease() }}>
          <span className={css.releaseIcon} aria-hidden>
            <IconDownloadOutline16 size={wide ? 14 : 18} />
            <span className={css.updateDot} data-update-dot />
          </span>
          {wide && <span>{label}</span>}
        </button>
      </Tooltip>
    </div>
  )
}

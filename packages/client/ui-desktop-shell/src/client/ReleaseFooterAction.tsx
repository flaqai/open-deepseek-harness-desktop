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
  if (release.phase !== 'available') return null
  const label = t('release.badge', { version: release.latestVersion })
  return (
    <div className={wide ? css.footer : `${css.footer} ${css.rail}`}>
      <Tooltip label={label} side="right" delayMs={300} disabled={wide}>
        <button type="button" className={css.footerButton} aria-label={label} onClick={() => { void controller.openRelease() }}>
          <IconDownloadOutline16 size={wide ? 14 : 18} />
          {wide && <span>{label}</span>}
        </button>
      </Tooltip>
    </div>
  )
}

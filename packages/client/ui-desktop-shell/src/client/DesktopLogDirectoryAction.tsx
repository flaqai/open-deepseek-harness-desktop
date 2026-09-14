/** Settings-header action for opening the fixed desktop log directory. */

import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './DesktopLogDirectoryAction.module.css'

export interface DesktopLogDirectoryActionInjected {
  openLogDirectory: () => Promise<{ error: string }>
}

export type DesktopLogDirectoryActionProps = PropsRuntime<'settings.action'>
  & PropsLocale<'desktop-shell'>
  & InjectFace<DesktopLogDirectoryActionInjected>

/** Open only the main-process-owned log directory; the renderer never receives its path. */
export function DesktopLogDirectoryAction({ openLogDirectory, t }: DesktopLogDirectoryActionProps) {
  const [opening, setOpening] = useState(false)
  const [failed, setFailed] = useState(false)

  const open = async (): Promise<void> => {
    if (opening) return
    setOpening(true)
    setFailed(false)
    try {
      const result = await openLogDirectory()
      setFailed(result.error !== '')
    } catch {
      setFailed(true)
    } finally {
      setOpening(false)
    }
  }

  return (
    <div className={css.action}>
      {failed ? <span className={css.error} role="alert">{t('logs.openDirectory.error')}</span> : null}
      <Button variant="outline" size="sm" disabled={opening} onClick={() => { void open() }}>
        {t(opening ? 'logs.openDirectory.opening' : 'logs.openDirectory')}
      </Button>
    </div>
  )
}

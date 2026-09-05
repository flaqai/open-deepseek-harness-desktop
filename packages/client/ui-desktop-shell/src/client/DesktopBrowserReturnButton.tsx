/** Browser-side action that reveals the Electron client which opened the page. */

import { useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import css from './DesktopSidebarUpdateButton.module.css'

export interface DesktopBrowserReturnButtonInjected {
  returnToDesktop: () => Promise<void>
}

export type DesktopBrowserReturnButtonProps = PropsRuntime<'sidebar.settings.action'>
  & PropsLocale<'desktop-shell'>
  & InjectFace<DesktopBrowserReturnButtonInjected>

/** Render a browser-only action beside Settings. */
export function DesktopBrowserReturnButton({ returnToDesktop, t, wide }: DesktopBrowserReturnButtonProps) {
  const [phase, setPhase] = useState<'idle' | 'opening' | 'error'>('idle')
  if (!wide) return null
  const label = phase === 'opening' ? t('web.return.opening') : t('web.return')
  return (
    <button
      type="button"
      className={css.button}
      aria-label={label}
      title={phase === 'error' ? t('web.return.error') : label}
      disabled={phase === 'opening'}
      onClick={() => {
        setPhase('opening')
        void returnToDesktop().then(() => { setPhase('idle') }, () => { setPhase('error') })
      }}
    >
      {label}
    </button>
  )
}

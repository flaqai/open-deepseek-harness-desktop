/** Compact product marks for the external-tool connection cards. */

import type { ReactNode } from 'react'

export type ExternalToolIconId = 'codex' | 'claude-code' | 'workbuddy' | 'hermes' | 'trae'

/** Render a decorative, theme-aware mark without loading remote artwork. */
export function ExternalToolIcon({ tool }: { readonly tool: ExternalToolIconId }): ReactNode {
  if (tool === 'codex') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M22.28 9.82a6 6 0 0 0-.52-4.91 6.05 6.05 0 0 0-6.51-2.9A6.07 6.07 0 0 0 4.98 4.18a6 6 0 0 0-4 2.9 6.05 6.05 0 0 0 .74 7.1 5.98 5.98 0 0 0 .51 4.91 6.05 6.05 0 0 0 6.52 2.9A6 6 0 0 0 13.26 24a6.06 6.06 0 0 0 5.77-4.21 6 6 0 0 0 4-2.9 6.06 6.06 0 0 0-.75-7.07m-9.02 12.61a4.48 4.48 0 0 1-2.88-1.04l4.92-2.84a.8.8 0 0 0 .4-.68v-6.74l2.02 1.17v5.64a4.5 4.5 0 0 1-4.46 4.49M3.6 18.3a4.47 4.47 0 0 1-.54-3.01l4.93 2.84a.77.77 0 0 0 .78 0l5.84-3.37v2.34l-4.87 2.85A4.5 4.5 0 0 1 3.6 18.3M2.34 7.9a4.5 4.5 0 0 1 2.37-1.98v5.68a.77.77 0 0 0 .39.68l5.81 3.35-2.02 1.17-4.9-2.79A4.5 4.5 0 0 1 2.34 7.9m16.6 3.85-5.84-3.39 2.02-1.16 4.9 2.79a4.49 4.49 0 0 1-.68 8.1v-5.67a.79.79 0 0 0-.4-.67m2.01-3.02-4.92-2.87a.78.78 0 0 0-.78 0L9.41 9.23V6.9l4.86-2.85a4.5 4.5 0 0 1 6.68 4.68M8.31 12.86l-2.02-1.16V6.08a4.5 4.5 0 0 1 7.38-3.46L8.7 5.46a.8.8 0 0 0-.39.68zm1.1-2.36 2.6-1.5 2.6 1.5v3l-2.6 1.5-2.6-1.5Z" />
      </svg>
    )
  }
  if (tool === 'claude-code') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M21 10.5h3v3h-3v3h-1.5v3H18v-3h-1.5v3H15v-3H9v3H7.5v-3H6v3H4.5v-3H3v-3H0v-3h3v-6h18Zm-15 0h1.5v-3H6Zm10.5 0H18v-3h-1.5Z" />
      </svg>
    )
  }
  if (tool === 'workbuddy') {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 5.5h10a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3H9l-3.7 2.8.8-2.8H4a3 3 0 0 1-3-3v-3a3 3 0 0 1 3-3Z" fill="currentColor" opacity=".34" />
        <path d="M10 9.5h10a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3h-2.1l.8 2.8-3.7-2.8h-5a3 3 0 0 1-3-3v-3a3 3 0 0 1 3-3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M11 13.9h1.2m2.4 0h1.2m2.4 0h1.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    )
  }
  if (tool === 'hermes') {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 3v18M8.5 5.5 12 8l3.5-2.5M7 9c2.8 0 5 1.4 5 3.2S9.8 15.4 7 15.4m10-6.4c-2.8 0-5 1.4-5 3.2s2.2 3.2 5 3.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 4.2C9.8 2.8 7.6 2.5 5.5 3.1 7 4.6 8.7 5.5 12 5.7m0-1.5c2.2-1.4 4.4-1.7 6.5-1.1C17 4.6 15.3 5.5 12 5.7" fill="currentColor" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" fillRule="evenodd" d="M3 4h15v3h3v13H6v-3H3Zm3 3v7h3v3h9V7Zm4 3 2 2-2 2-2-2Zm5 0 2 2-2 2-2-2Z" />
    </svg>
  )
}

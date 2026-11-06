/**
 * The per-tab context menu, opened by a secondary press on the chip. It carries
 * the close gesture and whatever the embedder appends; the copy and float
 * gestures have no menu item — copying is an embedder API, floating is a drag
 * released clear of the surface. A menu that would hold no item at all renders
 * no popup, so a secondary press on a chip with nothing to offer shows nothing.
 * Presentational — it renders what its props supply and dismisses itself on
 * outside presses or an unmodified Escape, returning menu focus to its tab.
 *
 * It renders in a portal, positioned against the control that opened it. The tab
 * strip clips its overflow on purpose (so it never becomes a scroll container
 * that claims a drag), and a menu drawn inside the strip would be clipped with
 * it; a portal puts it above every clipping ancestor. React still bubbles the
 * portal's synthetic events through the strip, which is why the press guards
 * below remain necessary.
 */
import { MenuItemButton, MenuSurface, useAnchoredPosition } from '@deepseek-ai/dsh-client-ui-primitives'
import { Children, useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { focusWithoutRing, modalSelector, observeComposition } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DockLabels } from '../contract/adapter.ts'
import css from './dockkit.module.css'

/** Gap between the opening control and the menu, and the viewport margin kept clear. */
const MENU_GAP = 4

/** What the menu offers, where it anchors, and how it closes. */
export interface TabMenuProps {
  readonly labels: DockLabels
  /** The control that opened the menu; the menu hangs below its left edge. */
  readonly anchor: HTMLElement
  /** Close the tab; `undefined` removes the kit's item, leaving the extras only. */
  readonly onClose: (() => void) | undefined
  /** Dismiss without acting. */
  readonly onDismiss: () => void
  /** Embedder items, rendered after the kit's own; absent means none. */
  readonly extras: ReactNode
}

/** The actions menu body, anchored to the control that opened it. */
export function TabMenu({ labels, anchor, onClose, onDismiss, extras }: TabMenuProps): ReactNode {
  const self = useRef<HTMLDivElement | null>(null)
  const hasItems = onClose !== undefined || Children.toArray(extras).some(item => item !== '')

  const anchorRef = useMemo(() => ({ current: anchor }), [anchor])
  const position = useAnchoredPosition({
    open: hasItems, anchorRef, panelRef: self, gap: MENU_GAP, margin: MENU_GAP, frameClearance: false,
  })

  useEffect(() => {
    const menu = self.current
    /* v8 ignore next -- the ref is attached by effect time: the menu renders unconditionally. */
    if (menu === null) return undefined
    const document = menu.ownerDocument
    const composition = observeComposition(document)
    const onKeyDown = (event: KeyboardEvent): void => {
      if (composition.guards(event) || event.defaultPrevented || event.key !== 'Escape'
        || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return
      const top = [...document.querySelectorAll(modalSelector)].at(-1)
      if (top !== menu) return
      event.preventDefault()
      if (event.repeat) return
      const restoreFocus = menu.contains(document.activeElement)
      onDismiss()
      if (restoreFocus) focusWithoutRing(anchor)
    }
    document.addEventListener('keydown', onKeyDown, true)
    // A press anywhere but inside the menu dismisses it; one with no element
    // target (dispatched to the window itself) counts as outside.
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && menu.contains(event.target)) return
      onDismiss()
    }
    // Capture phase: a press on a tab chip starts a drag on its own handler,
    // so the menu must be gone before that handler runs.
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      composition.dispose()
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [anchor, onDismiss, hasItems])

  if (!hasItems) return null
  return createPortal(
    <MenuSurface
      contextual
      className={css.menu}
      ref={self}
      role="menu"
      data-dockkit-tab-menu
      // Unplaced for one layout pass: measured, then positioned.
      style={position ?? { visibility: 'hidden', top: 0, left: 0 }}
      // Portal events reach the owning chip: a press would start its drag,
      // a click would focus it, and a middle click would close it.
      onPointerDown={(event) => { event.stopPropagation() }}
      onClick={(event) => { event.stopPropagation() }}
      onAuxClick={(event) => { event.stopPropagation() }}
    >
      <div className={css.menuViewport} role="presentation">
        {onClose !== undefined && (
          <MenuItemButton onSelect={onClose}>
            {labels.closeTab}
          </MenuItemButton>
        )}
        {/* Embedder items last: the kit's own item is the same in every menu, so
            a reader looks for it in the same place every time. */}
        {extras}
      </div>
    </MenuSurface>,
    document.body,
  )
}

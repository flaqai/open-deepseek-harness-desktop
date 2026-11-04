import { useEffect, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'

type Size = { width: number; height: number; nav: number }
const defaults: Size = { width: 808, height: 800, nav: 196 }
let remembered = defaults

/** Centered panel sizing, retained across modal reopen within this client.
 * @returns CSS dimensions, pointer handlers, and a default-size reset.
 */
export function usePanelSize(): {
  style: CSSProperties
  start: (edge: string, event: ReactPointerEvent<HTMLElement>) => void
  reset: () => void
  dividerDragging: boolean
} {
  const [size, setSize] = useState(remembered)
  const [, refresh] = useState(0)
  const [drag, setDrag] = useState<{ edge: string; x: number; y: number; size: Size; pointerId: number }>()
  const constrain = (value: Size): Size => {
    const inset = Math.max(24, Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dsh-frame-overlay-top')) || 24)
    const width = Math.min(Math.max(defaults.width, value.width), 1200, Math.max(0, window.innerWidth - 48))
    const height = Math.min(Math.max(800, value.height), 1000, Math.max(0, window.innerHeight - inset * 2))
    return { width, height, nav: Math.min(Math.max(defaults.nav, value.nav), 320, Math.max(defaults.nav, width - 360)) }
  }
  const current = constrain(size)
  useEffect(() => {
    const resize = () => { setDrag(undefined); refresh(value => value + 1) }
    window.addEventListener('resize', resize)
    return () => { window.removeEventListener('resize', resize) }
  }, [])
  useEffect(() => {
    if (!drag) return
    const move = (event: PointerEvent) => {
      if (event.pointerId !== drag.pointerId) return
      event.preventDefault()
      const dx = event.clientX - drag.x; const dy = event.clientY - drag.y
      const next = constrain({
        width: drag.size.width + (drag.edge.includes('e') ? dx * 2 : drag.edge.includes('w') ? -dx * 2 : 0),
        height: drag.size.height + (drag.edge.includes('s') ? dy * 2 : drag.edge.includes('n') ? -dy * 2 : 0),
        nav: drag.size.nav,
      })
      if (drag.edge === 'divider') {
        next.width = drag.size.width; next.height = drag.size.height
        next.nav = Math.max(defaults.nav, Math.min(320, next.width - 360, drag.size.nav + dx))
      }
      remembered = next; setSize(next)
    }
    const stop = () => { setDrag(undefined) }
    const release = (event: PointerEvent) => { if (event.pointerId === drag.pointerId) stop() }
    const preventSelection = (event: Event) => { event.preventDefault() }
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    window.addEventListener('blur', stop)
    document.addEventListener('selectstart', preventSelection)
    return () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release); window.removeEventListener('blur', stop)
      document.removeEventListener('selectstart', preventSelection)
    }
  }, [drag])
  return {
    style: { ...(drag ? { userSelect: 'none' } : {}), '--settings-width': `${current.width}px`, '--settings-height': `${current.height}px`, '--settings-nav-width': `${current.nav}px` } as CSSProperties,
    start: (edge, event) => {
      if (event.button !== 0) return
      event.preventDefault(); event.stopPropagation()
      setDrag({ edge, x: event.clientX, y: event.clientY, size: current, pointerId: event.pointerId })
    },
    dividerDragging: drag?.edge === 'divider',
    reset: () => { remembered = defaults; setSize(defaults); setDrag(undefined) },
  }
}

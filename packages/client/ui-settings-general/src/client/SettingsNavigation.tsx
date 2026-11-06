import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode, ReactElement, PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsNavigationLayout } from '../types.ts'
import type { SettingsSectionRow, SettingsRootComponentProps } from './shell-contract.ts'
import { moveLayoutGroup, moveLayoutSection, setLayoutGroupState, setLayoutSectionHidden, visibleSettingsNodes } from './section-layout.ts'
import { settingsSectionAutoScroll } from './section-order.ts'
import css from './SettingsNavigation.module.css'

type ContextTarget = { kind: 'blank' } | { kind: 'group'; id: string } | { kind: 'section'; id: string; group?: string }

type Move = { kind: 'group' | 'section'; id: string }
type Target = { kind: 'into' | 'inside'; group: string; index: number } | { kind: 'standalone' | 'group'; index: number }
interface Props {
  rows: readonly SettingsSectionRow[]
  layout: SettingsNavigationLayout
  active: string | undefined
  t: SettingsRootComponentProps['t']
  mutate: (operation: (layout: SettingsNavigationLayout) => SettingsNavigationLayout) => void
  onSelect: (id: string) => void
  onManage: (id: string, action: 'rename' | 'delete') => void
  onOrganize: (action: 'create' | 'manage') => void
  icon: (id: string) => ReactNode
}

/** Direct manipulation of navigation groups and entries, with keyboard equivalents. */
export function SettingsNavigation({ rows, layout, active, t, mutate, onSelect, onManage, onOrganize, icon }: Props): ReactElement {
  const hintId = useId()
  const rail = useRef<HTMLDivElement>(null)
  const floating = useRef<HTMLDivElement>(null)
  const [scrollbarHovered, setScrollbarHovered] = useState(false)
  const hoverScrollbar = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = event.currentTarget
    const bounds = element.getBoundingClientRect()
    // The CSS track stays 8px wide even when its thumb is thin.
    setScrollbarHovered(event.pointerType !== 'touch' && element.scrollHeight > element.clientHeight
      && event.clientX >= bounds.right - 8 && event.clientX <= bounds.right)
  }
  const move = useRef<Move | undefined>(undefined)
  const target = useRef<Target | undefined>(undefined)
  const velocity = useRef(0)
  const frame = useRef<number | undefined>(undefined)
  const pointer = useRef<{ clientX: number; clientY: number } | undefined>(undefined)
  const [menu, setMenu] = useState<string>()
  const [contextMenu, setContextMenu] = useState<{ target: ContextTarget; x: number; y: number; trigger: HTMLElement }>()
  const [preview, setPreview] = useState<SettingsNavigationLayout>()
  const draft = useRef<SettingsNavigationLayout | undefined>(undefined)
  const [ghost, setGhost] = useState<{
    content: ReactNode
    x: number
    y: number
    width: number
    height: number
    viewport: DOMRect
    settling: boolean
  }>()
  const armed = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const settlement = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const origin = useRef({ x: 0, y: 0 })
  const offset = useRef({ x: 0, y: 0 })
  const suppress = useRef(false)
  const focusAfterMove = useRef<{ source: Move; group: string | undefined } | undefined>(undefined)
  const pointerId = useRef<number | undefined>(undefined)
  const lastProbe = useRef<{ x: number; y: number; scrollTop: number } | undefined>(undefined)
  const headerLatch = useRef<{ group: string; top: number; bottom: number; left: number; right: number } | undefined>(undefined)
  const dragGeometry = useRef<{
    scrollTop: number
    nodes: { id: string; kind: 'group' | 'section'; box: DOMRect; heading: DOMRect | undefined; rows: { id: string; box: DOMRect }[] }[]
  } | undefined>(undefined)
  const rects = useRef(new Map<string, DOMRect>())
  const rectsScrollTop = useRef(0)
  const animations = useRef(new Set<Animation>())
  const animateNavigation = (element: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) => {
    const animation = element.animate(frames, options)
    animations.current.add(animation)
  }
  const cancelAnimations = () => {
    animations.current.forEach((animation) => { animation.cancel() })
    animations.current.clear()
  }
  const committed = useRef(false)
  const handlers = useRef({
    track: (_event: PointerEvent) => {}, finish: () => {}, cancel: () => {}, tick: () => {}, key: (_event: KeyboardEvent) => {},
  })
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const nodes = visibleSettingsNodes(rows, preview ?? layout)
  const groups = nodes.filter(node => node.kind === 'group')
  const project = (next: SettingsNavigationLayout) => { draft.current = next; setPreview(next) }
  useLayoutEffect(() => {
    if (ghost?.settling && move.current && floating.current) {
      const source = move.current
      const destination = [...(rail.current?.querySelectorAll<HTMLElement>('[data-navigation-section], [data-navigation-container]') ?? [])]
        .find(element => !element.closest('[inert]') && (source.kind === 'group'
          ? element.dataset.navigationContainer === source.id : element.dataset.navigationSection === source.id))
      const groupId = draft.current?.nodes.find(node => node.kind === 'group' && node.sectionIds.includes(source.id))?.id
      const bounds = destination ? rects.current.get(source.kind === 'group' ? `group:${source.id}` : source.id)
        : dragGeometry.current?.nodes.find(node => node.id === groupId && node.kind === 'group')?.heading
      const scroll = (rail.current?.scrollTop ?? 0) - (dragGeometry.current?.scrollTop ?? 0)
      if (bounds && !reduced()) animateNavigation(floating.current, [
        { transform: floating.current.style.transform, width: `${ghost.width}px`, height: `${ghost.height}px`, opacity: 1 },
        { transform: `translate3d(${bounds.left - ghost.viewport.left}px, ${bounds.top - ghost.viewport.top - scroll}px, 0)`,
          width: `${bounds.width}px`, height: `${bounds.height}px`, opacity: destination ? 1 : 0, boxShadow: 'none' },
      ], { duration: 180, easing: 'cubic-bezier(0.2,0,0,1)', fill: 'forwards' })
      return
    }
    const next = new Map<string, DOMRect>()
    const scrollTop = rail.current?.scrollTop ?? 0
    const scrollDelta = scrollTop - rectsScrollTop.current
    const translation = (element: HTMLElement) => {
      const transform = getComputedStyle(element).transform
      return transform.startsWith('matrix(') ? Number(transform.slice(7, -1).split(',')[5]) : 0
    }
    const entries = [...(rail.current?.querySelectorAll<HTMLElement>('[data-navigation-section], [data-navigation-container]') ?? [])]
      .map((element) => {
        const key = element.dataset.navigationSection ?? `group:${element.dataset.navigationContainer}`
        const parent = element.dataset.navigationSection ? element.closest<HTMLElement>('[data-navigation-container]') : null
        const parentTranslation = parent ? translation(parent) : 0
        const previous = rects.current.get(key)
        return { element, key, parentTranslation,
          beforeTop: previous === undefined ? undefined : previous.top - scrollDelta + translation(element) + parentTranslation }
      })
    if (move.current) cancelAnimations()
    const measured = entries.map(entry => ({ ...entry, rect: entry.element.getBoundingClientRect() }))
    measured.forEach(({ key, rect }) => { next.set(key, rect) })
    if (move.current && rail.current) dragGeometry.current = {
      scrollTop: rail.current.scrollTop,
      nodes: measured.filter(({ element }) => element.hasAttribute('data-navigation-top')).map(({ element, rect }) => ({
        id: element.dataset.navigationTop ?? '', kind: element.dataset.navigationKind as 'group' | 'section',
        box: rect,
        heading: element.querySelector<HTMLElement>('[data-navigation-heading]')?.getBoundingClientRect(),
        rows: measured.filter(({ element: row }) => row !== element && row.hasAttribute('data-navigation-section')
          && row.closest('[data-navigation-top]') === element && !row.closest('[inert]')).map(({ element: row, rect: box }) => ({
          id: row.dataset.navigationSection ?? '', box,
        })),
      })),
    }
    measured.forEach(({ element, rect, beforeTop, parentTranslation }) => {
      const isGroup = element.dataset.navigationContainer !== undefined
      const isSource = move.current?.kind === 'group'
        ? element.closest<HTMLElement>('[data-navigation-container]')?.dataset.navigationContainer === move.current.id
        : element.dataset.navigationSection === move.current?.id
      if (beforeTop !== undefined && (move.current || committed.current) && !isSource && !reduced()) {
        const parent = !isGroup ? element.closest<HTMLElement>('[data-navigation-container]') : null
        const previousParent = parent ? rects.current.get(`group:${parent.dataset.navigationContainer}`) : undefined
        const parentTop = parent ? next.get(`group:${parent.dataset.navigationContainer}`)?.top : undefined
        const parentShift = previousParent && parentTop !== undefined
          ? previousParent.top - scrollDelta + parentTranslation - parentTop : 0
        const shift = beforeTop - rect.top - parentShift
        if (shift !== 0) animateNavigation(element, [{ transform: `translateY(${shift}px)` }, { transform: 'translateY(0)' }],
          { duration: 180, easing: 'cubic-bezier(0.2,0,0,1)' })
      }
    })
    rects.current = next
    rectsScrollTop.current = scrollTop
    committed.current = false
  }, [preview, layout, ghost?.settling])
  useLayoutEffect(() => {
    const pending = focusAfterMove.current
    if (!pending || move.current) return
    focusAfterMove.current = undefined
    const elements = [...(rail.current?.querySelectorAll<HTMLElement>('[data-navigation-section], [data-navigation-container]') ?? [])]
    const entry = elements.filter(element => !element.closest('[inert]')).find(element => pending.source.kind === 'group'
      ? element.dataset.navigationContainer === pending.source.id : element.dataset.navigationSection === pending.source.id)
    const fallback = elements.find(element => element.dataset.navigationContainer === pending.group)
    ;(entry ?? fallback)?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
  })
  const stop = () => {
    cancelAnimations()
    const source = move.current
    if (source && pointerId.current === undefined) {
      focusAfterMove.current = { source,
        group: (draft.current ?? layout).nodes.find(node => node.kind === 'group' && node.sectionIds.includes(source.id))?.id,
      }
    }
    clearTimeout(armed.current); armed.current = undefined
    clearTimeout(settlement.current); settlement.current = undefined
    draft.current = undefined; dragGeometry.current = undefined; setPreview(undefined); setGhost(undefined)
    lastProbe.current = undefined; headerLatch.current = undefined
    move.current = undefined; target.current = undefined; velocity.current = 0; pointer.current = undefined; pointerId.current = undefined
    if (frame.current !== undefined) cancelAnimationFrame(frame.current)
    frame.current = undefined
  }
  const sourceKey = JSON.stringify(layout)
  useEffect(() => {
    if (move.current || armed.current !== undefined) stop()
    setContextMenu(undefined)
  }, [sourceKey])
  const finish = () => {
    clearTimeout(armed.current); armed.current = undefined
    if (!move.current || settlement.current !== undefined) return
    const commit = () => {
      const next = draft.current
      if (next && JSON.stringify(next) !== JSON.stringify(layout)) { committed.current = true; mutate(() => next) }
      stop()
    }
    if (!ghost || reduced()) { commit(); return }
    if (frame.current !== undefined) cancelAnimationFrame(frame.current)
    frame.current = undefined
    setGhost(current => current && { ...current, settling: true })
    settlement.current = setTimeout(commit, 180)
  }
  const applyDrop = (source: Move, destination: Target, current = layout) => {
    target.current = destination
    project(source.kind === 'group'
      ? moveLayoutGroup(current, source.id, destination.index)
      : moveLayoutSection(current, source.id,
        destination.kind === 'into' || destination.kind === 'inside' ? destination.group : undefined, destination.index))
  }
  const locate = (point: { clientX: number; clientY: number }) => {
    const source = move.current
    if (!source || settlement.current !== undefined) return
    const viewport = rail.current?.getBoundingClientRect()
    if (!viewport) return
    velocity.current = settingsSectionAutoScroll(point.clientY, viewport.top, viewport.bottom)
    const scrollTop = rail.current?.scrollTop ?? 0
    if (lastProbe.current?.x === point.clientX && lastProbe.current.y === point.clientY && lastProbe.current.scrollTop === scrollTop) return
    lastProbe.current = { x: point.clientX, y: point.clientY, scrollTop }
    if (viewport.width > 0 && (point.clientX < viewport.left || point.clientX > viewport.right)) {
      headerLatch.current = undefined; target.current = undefined; project(layout); return
    }
    const geometry = dragGeometry.current
    const y = point.clientY + (rail.current?.scrollTop ?? 0) - (geometry?.scrollTop ?? 0)
    const current = draft.current ?? layout
    let destination: Target | undefined
    if (geometry?.nodes.some(node => node.box.height > 0)) {
      const latch = headerLatch.current
      const heading = geometry.nodes.find(node => node.id === latch?.group && node.kind === 'group')?.heading
      // Removing the source may move an accepted group heading away from a stationary pointer.
      if (latch && heading && target.current?.kind === 'into' && target.current.group === latch.group) {
        const contentY = point.clientY + scrollTop
        if (contentY >= Math.min(latch.top, heading.top + geometry.scrollTop)
          && contentY <= Math.max(latch.bottom, heading.bottom + geometry.scrollTop)
          && point.clientX >= latch.left && point.clientX <= latch.right) return
      }
      headerLatch.current = undefined
      const placeholder = rail.current?.querySelector<HTMLElement>('[data-placeholder="true"]')
      const reserved = placeholder && !placeholder.closest('[inert]')
        ? rects.current.get(source.kind === 'group' ? `group:${source.id}` : source.id) : undefined
      if (target.current && reserved && y >= reserved.top && y <= reserved.bottom
        && point.clientX >= reserved.left && point.clientX <= reserved.right) return
      const hit = geometry.nodes.find(node => y >= node.box.top && y <= node.box.bottom
        && point.clientX >= node.box.left && point.clientX <= node.box.right)
      if (source.kind === 'section' && hit?.kind === 'group') {
        const group = current.nodes.find(node => node.kind === 'group' && node.id === hit.id)
        if (group?.kind === 'group') {
          const heading = hit.heading
          if (heading && y >= heading.top && y <= heading.bottom) destination = { kind: 'into', group: hit.id, index: 0 }
          else if (!group.collapsed) {
            const remaining = hit.rows.filter(row => row.id !== source.id)
            const next = remaining.find(row => y < row.box.top + row.box.height / 2)
            const ids = group.sectionIds.filter(id => id !== source.id)
            destination = { kind: 'inside', group: hit.id, index: next ? ids.indexOf(next.id) : ids.length }
          } else destination = { kind: 'into', group: hit.id, index: 0 }
        }
      }
      if (!destination) {
        const remaining = geometry.nodes.filter(node => node.id !== source.id || node.kind !== source.kind)
        const next = remaining.find(node => y < node.box.top + node.box.height / 2)
        const rest = current.nodes.filter(node => node.kind !== source.kind || node.id !== source.id)
        destination = { kind: source.kind === 'group' ? 'group' : 'standalone',
          index: next ? rest.findIndex(node => node.id === next.id && node.kind === next.kind) : rest.length }
      }
    } else {
      // Non-layout renderers can identify a target element without measurable boxes.
      const hit = document.elementFromPoint(point.clientX, point.clientY)?.closest<HTMLElement>('[data-navigation-group], [data-navigation-section]')
      if (!hit || !rail.current?.contains(hit)) return
      const groupId = hit.dataset.navigationGroup
      const sectionId = hit.dataset.navigationSection
      if (source.kind === 'section' && groupId) {
        const group = layout.nodes.find(node => node.kind === 'group' && node.id === groupId)
        if (group?.kind === 'group') {
          const ids = group.sectionIds.filter(id => id !== source.id)
          const bounds = hit.getBoundingClientRect()
          destination = sectionId ? { kind: 'inside', group: groupId,
            index: ids.indexOf(sectionId) + (point.clientY > bounds.top + bounds.height / 2 ? 1 : 0) }
            : { kind: 'into', group: groupId, index: 0 }
        }
      } else {
        const top = hit.closest<HTMLElement>('[data-navigation-top]')
        const rest = layout.nodes.filter(node => node.id !== source.id || node.kind !== source.kind)
        const index = rest.findIndex(node => node.id === top?.dataset.navigationTop && node.kind === top.dataset.navigationKind)
        if (index >= 0) destination = { kind: source.kind === 'group' ? 'group' : 'standalone',
          index: index + (point.clientY > hit.getBoundingClientRect().top + hit.getBoundingClientRect().height / 2 ? 1 : 0) }
      }
    }
    if (destination && JSON.stringify(target.current) !== JSON.stringify(destination)) {
      if (destination.kind === 'into' && geometry) {
        const heading = geometry.nodes.find(node => node.id === destination.group && node.kind === 'group')?.heading
        if (heading) headerLatch.current = { group: destination.group,
          top: heading.top + geometry.scrollTop, bottom: heading.bottom + geometry.scrollTop, left: heading.left, right: heading.right }
      }
      applyDrop(source, destination, current)
    }
  }
  handlers.current = {
    finish, cancel: stop,
    key: (event) => { if (move.current) interaction(move.current).onKeyDown(event as unknown as ReactKeyboardEvent<HTMLButtonElement>) },
    track: (event) => {
      if (pointerId.current !== event.pointerId) return
      if (armed.current !== undefined && Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 8) {
        clearTimeout(armed.current); armed.current = undefined
      }
      if (!move.current || settlement.current !== undefined) return
      event.preventDefault()
      pointer.current = { clientX: event.clientX, clientY: event.clientY }
      setGhost(current => current && { ...current, y: Math.max(current.viewport.top,
        Math.min(event.clientY - offset.current.y, current.viewport.bottom - current.height)),
      })
      locate(pointer.current)
    },
    tick: () => {
      if (!move.current || settlement.current !== undefined) return
      if (rail.current) rail.current.scrollTop += velocity.current
      if (pointer.current) locate(pointer.current)
      frame.current = requestAnimationFrame(() => { handlers.current.tick() })
    },
  }
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && (move.current || armed.current !== undefined)) {
        event.preventDefault(); event.stopPropagation(); handlers.current.cancel()
      } else if (move.current && pointerId.current === undefined) {
        event.stopPropagation(); handlers.current.key(event)
      }
    }
    const track = (event: PointerEvent) => { handlers.current.track(event) }
    const up = (event: PointerEvent) => { if (pointerId.current === event.pointerId) handlers.current.finish() }
    const abort = () => { handlers.current.cancel() }
    const preventSelection = (event: Event) => { if (move.current) event.preventDefault() }
    window.addEventListener('pointermove', track, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', abort)
    window.addEventListener('blur', abort)
    window.addEventListener('keydown', cancel, true)
    document.addEventListener('selectstart', preventSelection)
    document.addEventListener('touchmove', preventSelection, { passive: false })
    return () => {
      clearTimeout(armed.current); clearTimeout(settlement.current)
      cancelAnimations()
      window.removeEventListener('pointermove', track); window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', abort); window.removeEventListener('blur', abort)
      window.removeEventListener('keydown', cancel, true); document.removeEventListener('selectstart', preventSelection)
      document.removeEventListener('touchmove', preventSelection)
      if (frame.current !== undefined) cancelAnimationFrame(frame.current)
    }
  }, [])
  const openContext = (event: ReactMouseEvent<HTMLElement> | ReactKeyboardEvent<HTMLElement>, contextTarget: ContextTarget) => {
    if (event.defaultPrevented) return
    event.preventDefault(); event.stopPropagation()
    if (move.current || settlement.current !== undefined) return
    clearTimeout(armed.current); armed.current = undefined; pointerId.current = undefined
    const trigger = event.currentTarget instanceof HTMLButtonElement ? event.currentTarget
      : event.currentTarget.querySelector<HTMLButtonElement>('button') ?? event.currentTarget
    const bounds = trigger.getBoundingClientRect()
    const mouse = 'clientX' in event && (event.clientX !== 0 || event.clientY !== 0)
    setMenu(undefined)
    setContextMenu({ target: contextTarget, trigger,
      x: mouse ? event.clientX : bounds.left, y: mouse ? event.clientY : bounds.bottom })
  }
  const keyboardContext = (event: ReactKeyboardEvent<HTMLElement>, contextTarget: ContextTarget): boolean => {
    if (move.current || !(event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey)) return false
    if (event.repeat || event.nativeEvent.isComposing || event.ctrlKey || event.altKey || event.metaKey) return false
    openContext(event, contextTarget)
    return true
  }
  const organizeEntries: readonly MenuEntry[] = [
    { id: 'new-group', label: t('nav.addGroup') }, { id: 'organize', label: t('nav.organize') },
  ]
  const menuEntries = (contextTarget: ContextTarget): readonly MenuEntry[] => contextTarget.kind === 'blank' ? organizeEntries
    : contextTarget.kind === 'group' ? [
      { id: 'rename', label: t('nav.renameGroup') }, { id: 'delete', label: t('nav.deleteGroup'), danger: true },
      { id: 'hide', label: t('nav.hideGroup') }, { type: 'separator', id: 'organization' }, ...organizeEntries,
    ] : [
      { id: 'hide', label: t('nav.hideItem') },
      ...(contextTarget.group === undefined ? [] : [{ id: 'detach', label: t('nav.dropStandalone') }]),
      ...groups.filter(group => group.id !== contextTarget.group)
        .map(group => ({ id: `to:${group.id}`, label: `${t('nav.moveTo')}: ${group.label}` })),
      { type: 'separator', id: 'organization' }, ...organizeEntries,
    ]
  const selectMenuAction = (contextTarget: ContextTarget, id: string) => {
    setMenu(undefined); setContextMenu(undefined)
    if (id === 'new-group' || id === 'organize') { onOrganize(id === 'new-group' ? 'create' : 'manage'); return }
    if (contextTarget.kind === 'group') {
      if (id === 'hide') mutate(current => setLayoutGroupState(current, contextTarget.id, { hidden: true }))
      else if (id === 'rename' || id === 'delete') onManage(contextTarget.id, id)
    } else if (contextTarget.kind === 'section') mutate((current) => {
      if (id === 'hide') return setLayoutSectionHidden(current, contextTarget.id, true)
      if (id === 'detach') return moveLayoutSection(current, contextTarget.id, undefined,
        current.nodes.findIndex(node => node.id === contextTarget.group) + 1)
      return id.startsWith('to:') ? moveLayoutSection(current, contextTarget.id, id.slice(3), 0) : current
    })
  }
  const targetForMove = (source: Move): ContextTarget => {
    const group = source.kind === 'section' ? layout.nodes.find(node => node.kind === 'group' && node.sectionIds.includes(source.id))?.id : undefined
    return source.kind === 'group' ? source : { kind: 'section', id: source.id, ...(group === undefined ? {} : { group }) }
  }
  const interaction = (source: Move) => ({
    'aria-describedby': hintId,
    onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>) => { openContext(event, targetForMove(source)) },
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || move.current) return
      suppress.current = false
      pointerId.current = event.pointerId
      origin.current = { x: event.clientX, y: event.clientY }
      const element = event.currentTarget
      clearTimeout(armed.current)
      armed.current = setTimeout(() => {
        armed.current = undefined; suppress.current = true; move.current = source
        const container = element.closest<HTMLElement>(source.kind === 'group'
          ? '[data-navigation-container]' : '[data-navigation-section]')
        const bounds = (container ?? element).getBoundingClientRect()
        offset.current = { x: origin.current.x - bounds.left, y: origin.current.y - bounds.top }
        const group = groups.find(value => value.id === source.id)
        const copyRow = (id: string, label: string) => <div className={css.row} key={id}>
          <div className={css.page} aria-current={id === active ? 'true' : undefined}>
            <span className={css.sectionIcon}>{icon(id)}</span><span className={css.label}>{label}</span>
          </div><span className={`${css.tool} ${css.more}`} />
        </div>
        const content = source.kind === 'group' ? <>
          <div className={css.heading}><div className={css.page}>{group?.label}</div><span className={css.ghostTools} /></div>
          {!group?.collapsed && <div className={css.membersList}>{group?.rows.map(row => copyRow(row.id, row.label))}</div>}</>
          : copyRow(source.id, element.textContent)
        setGhost({ content, x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height,
          viewport: rail.current?.getBoundingClientRect() ?? bounds, settling: false })
        project(layout)
        setMenu(undefined); setContextMenu(undefined)
        frame.current = requestAnimationFrame(() => { handlers.current.tick() })
      }, 200)
    },
    onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (keyboardContext(event, targetForMove(source))) return
      if (event.key === ' ' && !move.current) {
        event.preventDefault(); move.current = source; pointerId.current = undefined
        suppress.current = true; project(layout); rail.current?.focus(); return
      }
      if (!move.current || settlement.current !== undefined) return
      if (event.key === 'Enter') { event.preventDefault(); finish(); return }
      if (event.key === ' ') { event.preventDefault(); return }
      if (!event.key.startsWith('Arrow')) return
      event.preventDefault(); event.stopPropagation()
      const current = draft.current ?? layout
      const parent = source.kind === 'section' ? current.nodes.find(node => node.kind === 'group' && node.sectionIds.includes(source.id)) : undefined
      const topIndex = parent ? current.nodes.indexOf(parent)
        : current.nodes.findIndex(node => node.kind === source.kind && node.id === source.id)
      const shown = new Set(visibleSettingsNodes(rows, current).map(node => `${node.kind}:${node.id}`))
      const isVisible = (node: SettingsNavigationLayout['nodes'][number]) => shown.has(`${node.kind}:${node.id}`)
      const direction = ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1
      if (source.kind === 'group') {
        const remaining = current.nodes.filter(node => node.kind !== 'group' || node.id !== source.id)
        const visible = remaining.filter(isVisible)
        const next = direction < 0 ? visible.filter(node => current.nodes.indexOf(node) < topIndex).at(-1)
          : visible.find(node => current.nodes.indexOf(node) > topIndex)
        if (next) applyDrop(source, { kind: 'group', index: remaining.indexOf(next) + (direction > 0 ? 1 : 0) }, current)
      } else if (event.key === 'ArrowLeft' && parent) {
        applyDrop(source, { kind: 'standalone', index: topIndex }, current)
      } else if (event.key === 'ArrowRight') {
        const next = current.nodes.slice(topIndex + 1).find(node => node.kind === 'group' && isVisible(node))
        if (next) applyDrop(source, { kind: 'into', group: next.id, index: 0 }, current)
      } else if (parent?.kind === 'group') {
        const visible = parent.sectionIds.filter(id => !current.hiddenIds.includes(id) && rows.some(row => row.id === id))
        const next = visible[visible.indexOf(source.id) + direction]
        if (next) {
          const ids = parent.sectionIds.filter(id => id !== source.id)
          applyDrop(source, { kind: 'inside', group: parent.id, index: ids.indexOf(next) + (direction > 0 ? 1 : 0) }, current)
        } else applyDrop(source, { kind: 'standalone', index: topIndex + (direction > 0 ? 1 : 0) }, current)
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const remaining = current.nodes.filter(node => node.kind !== 'section' || node.id !== source.id)
        const next = direction < 0 ? remaining.filter(node => current.nodes.indexOf(node) < topIndex && isVisible(node)).at(-1)
          : remaining.find(node => current.nodes.indexOf(node) > topIndex && isVisible(node))
        if (next?.kind === 'group') applyDrop(source, { kind: direction > 0 || next.collapsed ? 'into' : 'inside', group: next.id,
          index: direction > 0 || next.collapsed ? 0 : next.sectionIds.length }, current)
        else if (next) applyDrop(source, { kind: 'standalone', index: remaining.indexOf(next) + (direction > 0 ? 1 : 0) }, current)
      }

    },
  })
  const dropTarget = target.current
  const indicator = (kind: 'group' | 'section' | 'members', id: string) => {
    if (ghost?.settling) return null
    const show = move.current?.kind === kind && move.current.id === id
    return show && dropTarget && dropTarget.kind !== 'into'
      ? <span className={css.dropIndicator} data-navigation-drop-indicator data-scope={dropTarget.kind}
        aria-hidden="true" /> : null
  }
  const renderRow = (row: SettingsSectionRow, groupId?: string) => <div key={`section:${row.id}`} className={css.row}
    data-placeholder={Boolean(ghost && move.current?.kind === 'section' && move.current.id === row.id)}
    data-navigation-group={groupId} data-navigation-section={row.id}
    data-navigation-top={groupId === undefined ? row.id : undefined} data-navigation-kind={groupId === undefined ? 'section' : undefined}>
    {indicator('section', row.id)}
    <button type="button" className={css.page} {...interaction({ kind: 'section', id: row.id })}
      aria-current={row.id === active ? 'true' : undefined} data-modal-autofocus={row.id === active && !groups.some(group => group.id === groupId && group.collapsed) ? '' : undefined}
      onFocus={(event) => { event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }}
      onClick={() => { if (!suppress.current && !move.current) onSelect(row.id); suppress.current = false }}>
      <span className={css.sectionIcon} aria-hidden="true">{icon(row.id)}</span><span className={css.label}>{row.label}</span></button>
    <Menu open={menu === `section:${row.id}`} onClose={() => { setMenu(undefined) }} portal contextual autoFocus
      items={menuEntries({ kind: 'section', id: row.id, ...(groupId === undefined ? {} : { group: groupId }) })}
      onSelect={(id) => { selectMenuAction({ kind: 'section', id: row.id, ...(groupId === undefined ? {} : { group: groupId }) }, id) }}
      anchor={<button type="button" className={`${css.tool} ${css.more}`} data-open={menu === `section:${row.id}`}
        aria-label={`${t('nav.organize')}: ${row.label}`} onClick={() => { setContextMenu(undefined); setMenu(`section:${row.id}`) }}>···</button>} />
  </div>
  const destination = target.current
  const announcement = !move.current || !destination ? '' : destination.kind === 'into' || destination.kind === 'inside'
    ? t('nav.dropInGroup', { name: groups.find(group => group.id === destination.group)?.label ?? '' })
    : t(destination.kind === 'group' ? 'nav.dropGroup' : 'nav.dropStandalone')
  return <div ref={rail} className={css.rail} data-scrollbar-hovered={scrollbarHovered}
    onPointerEnter={hoverScrollbar} onPointerMove={hoverScrollbar} onPointerLeave={() => { setScrollbarHovered(false) }}
    data-dragging={move.current !== undefined} tabIndex={-1}
    onContextMenu={(event) => {
      if (event.target instanceof Element && event.target.closest('[data-navigation-section], [data-navigation-heading], [role="menu"]')) return
      openContext(event, { kind: 'blank' })
    }}
    onKeyDown={(event) => { if (event.target === event.currentTarget) keyboardContext(event, { kind: 'blank' }) }}>
    <span id={hintId} className={css.hidden}>{t('nav.dragHint')}</span>
    <span className={css.hidden} role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
    {nodes.length === 0 ? <p>{t('nav.empty')}</p> : null}
    {nodes.map(node => node.kind === 'section' ? renderRow(node.row) : <div key={`group:${node.id}`} className={css.group}
      data-navigation-container={node.id} data-navigation-top={node.id} data-navigation-kind="group"
      data-drop-into={!ghost?.settling && destination?.kind === 'into' && destination.group === node.id}
      data-placeholder={Boolean(ghost && move.current?.kind === 'group' && move.current.id === node.id)}>
      {indicator('group', node.id)}
      <div className={css.heading} data-navigation-heading data-navigation-group={node.id}
        onContextMenu={(event) => { openContext(event, { kind: 'group', id: node.id }) }}
        onKeyDown={(event) => { keyboardContext(event, { kind: 'group', id: node.id }) }}>
        <button type="button" className={css.page} {...interaction({ kind: 'group', id: node.id })}
          data-modal-autofocus={node.collapsed && node.rows.some(row => row.id === active) ? '' : undefined}>{node.label}</button>
        <Menu open={menu === node.id} onClose={() => { setMenu(undefined) }} portal contextual autoFocus
          items={menuEntries({ kind: 'group', id: node.id })}
          onSelect={(id) => { selectMenuAction({ kind: 'group', id: node.id }, id) }}
          anchor={<button type="button" className={`${css.tool} ${css.more}`} data-open={menu === node.id}
            aria-label={`${t('nav.organize')}: ${node.label}`} onClick={() => { setContextMenu(undefined); setMenu(node.id) }}>···</button>} />
        <button type="button" className={css.tool} aria-expanded={!node.collapsed} aria-label={node.label}
          onClick={() => { mutate(current => setLayoutGroupState(current, node.id, { collapsed: !node.collapsed })) }}>
          <span className={css.chevron} data-collapsed={node.collapsed}>⌃</span></button>
      </div>
      <div className={css.members} data-collapsed={node.collapsed} aria-hidden={node.collapsed} ref={(element) => { element?.toggleAttribute('inert', node.collapsed) }}>
        <div className={css.membersClip}><div className={css.membersList}>{indicator('members', node.id)}{node.rows.map(row => renderRow(row, node.id))}</div></div>
      </div>
    </div>)}
    {contextMenu ? <Menu open contextual portal autoFocus anchor={null}
      items={menuEntries(contextMenu.target)} returnFocus={() => contextMenu.trigger}
      getAnchorRect={() => new DOMRect(contextMenu.x, contextMenu.y, 0, 0)}
      onClose={() => { setContextMenu(undefined) }} onSelect={(id) => { selectMenuAction(contextMenu.target, id) }} /> : null}
    {ghost ? createPortal(<div className={css.dragViewport} aria-hidden="true"
      style={{ left: ghost.viewport.left, top: ghost.viewport.top, width: ghost.viewport.width, height: ghost.viewport.height }}>
      <div ref={floating} className={css.ghost} data-navigation-ghost data-phase={ghost.settling ? 'settling' : 'dragging'} aria-hidden="true"
        style={{ transform: `translate3d(${ghost.x - ghost.viewport.left}px, ${ghost.y - ghost.viewport.top}px, 0)`, width: ghost.width, height: ghost.height }}>
        {ghost.content}</div></div>, document.body) : null}
  </div>
}

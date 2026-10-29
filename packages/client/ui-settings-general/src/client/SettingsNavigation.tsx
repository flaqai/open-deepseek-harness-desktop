import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, ReactElement, PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsNavigationLayout } from '../types.ts'
import type { SettingsSectionRow, SettingsRootComponentProps } from './shell-contract.ts'
import { moveLayoutGroup, moveLayoutSection, setLayoutGroupState, setLayoutSectionHidden, visibleSettingsGroups } from './section-layout.ts'
import { settingsSectionAutoScroll } from './section-order.ts'
import css from './SettingsNavigation.module.css'

type Move = { kind: 'group' | 'section'; id: string }
type Target = { group: string; section?: string; after: boolean }
interface Props {
  rows: readonly SettingsSectionRow[]
  layout: SettingsNavigationLayout
  active: string | undefined
  t: SettingsRootComponentProps['t']
  mutate: (operation: (layout: SettingsNavigationLayout) => SettingsNavigationLayout) => void
  onSelect: (id: string) => void
  onManage: (id: string, action: 'rename' | 'delete') => void
  icon: (id: string) => ReactNode
}

/** Direct manipulation of navigation groups and entries, with keyboard equivalents. */
export function SettingsNavigation({ rows, layout, active, t, mutate, onSelect, onManage, icon }: Props): ReactElement {
  const hintId = useId()
  const rail = useRef<HTMLDivElement>(null)
  const move = useRef<Move | undefined>(undefined)
  const target = useRef<Target | undefined>(undefined)
  const velocity = useRef(0)
  const frame = useRef<number | undefined>(undefined)
  const pointer = useRef<{ clientX: number; clientY: number } | undefined>(undefined)
  const [menu, setMenu] = useState<string>()
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
  const dragGeometry = useRef<{
    scrollTop: number
    groups: { id: string; box: DOMRect; rows: { id: string; box: DOMRect }[] }[]
  } | undefined>(undefined)
  const rects = useRef(new Map<string, DOMRect>())
  const handlers = useRef({
    track: (_event: PointerEvent) => {}, finish: () => {}, cancel: () => {}, tick: () => {}, key: (_event: KeyboardEvent) => {},
  })
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const groups = visibleSettingsGroups(rows, preview ?? layout)
  const project = (next: SettingsNavigationLayout) => { draft.current = next; setPreview(next) }
  useLayoutEffect(() => {
    const next = new Map<string, DOMRect>()
    rail.current?.querySelectorAll<HTMLElement>('[data-navigation-section], [data-navigation-container]').forEach((element) => {
      const key = element.dataset.navigationSection ?? `group:${element.dataset.navigationContainer}`
      const transform = getComputedStyle(element).transform
      const translateY = transform.startsWith('matrix(') ? Number(transform.slice(7, -1).split(',')[5]) : 0
      const previous = rects.current.get(key)
      if (move.current) element.getAnimations().forEach((animation) => { animation.cancel() })
      const rect = element.getBoundingClientRect()
      const beforeTop = previous === undefined ? undefined : previous.top + translateY
      next.set(key, rect)
      const isGroup = element.dataset.navigationContainer !== undefined
      if (beforeTop !== undefined && move.current && isGroup === (move.current.kind === 'group')
        && beforeTop !== rect.top && !reduced()) {
        element.animate([{ transform: `translateY(${beforeTop - rect.top}px)` }, { transform: 'translateY(0)' }],
          { duration: 180, easing: 'cubic-bezier(0.2,0,0,1)' })
      }
    })
    rects.current = next
  }, [preview, layout])
  useLayoutEffect(() => {
    const pending = focusAfterMove.current
    if (!pending || move.current) return
    focusAfterMove.current = undefined
    const elements = [...(rail.current?.querySelectorAll<HTMLElement>('[data-navigation-section], [data-navigation-container]') ?? [])]
    const entry = elements.find(element => pending.source.kind === 'group'
      ? element.dataset.navigationContainer === pending.source.id : element.dataset.navigationSection === pending.source.id)
    const fallback = elements.find(element => element.dataset.navigationContainer === pending.group)
    ;(entry ?? fallback)?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
  })
  const stop = () => {
    const source = move.current
    if (source && pointerId.current === undefined) {
      focusAfterMove.current = { source,
        group: (draft.current ?? layout).groups.find(group => group.sectionIds.includes(source.id))?.id,
      }
    }
    clearTimeout(armed.current); armed.current = undefined
    clearTimeout(settlement.current); settlement.current = undefined
    draft.current = undefined; dragGeometry.current = undefined; setPreview(undefined); setGhost(undefined)
    move.current = undefined; target.current = undefined; velocity.current = 0; pointer.current = undefined; pointerId.current = undefined
    if (frame.current !== undefined) cancelAnimationFrame(frame.current)
    frame.current = undefined
  }
  const sourceKey = JSON.stringify(layout)
  useEffect(() => { if (move.current || armed.current !== undefined) stop() }, [sourceKey])
  const finish = () => {
    clearTimeout(armed.current); armed.current = undefined
    if (!move.current || settlement.current !== undefined) return
    const source = move.current
    const commit = () => {
      const next = draft.current
      if (next && JSON.stringify(next) !== JSON.stringify(layout)) mutate(() => next)
      stop()
    }
    if (!ghost || reduced()) { commit(); return }
    if (frame.current !== undefined) cancelAnimationFrame(frame.current)
    frame.current = undefined
    const destination = [...(rail.current?.querySelectorAll<HTMLElement>('[data-navigation-section], [data-navigation-container]') ?? [])]
      .find(element => source.kind === 'group'
        ? element.dataset.navigationContainer === source.id : element.dataset.navigationSection === source.id)
    const groupId = draft.current?.groups.find(group => group.sectionIds.includes(source.id))?.id
    const collapsed = [...(rail.current?.querySelectorAll<HTMLElement>('[data-navigation-group]') ?? [])]
      .find(element => element.dataset.navigationGroup === groupId)
    const bounds = (destination ?? collapsed)?.getBoundingClientRect()
    setGhost(current => current && { ...current, settling: true,
      ...(bounds ? { x: bounds.left, y: bounds.top, width: bounds.width } : {}),
    })
    settlement.current = setTimeout(commit, 180)
  }
  const applyDrop = (source: Move, destination: Target) => {
    const current = draft.current ?? layout
    if (source.kind === 'group') {
      if (source.id === destination.group) return
      const rest = current.groups.filter(group => group.id !== source.id)
      const index = rest.findIndex(group => group.id === destination.group)
      project(moveLayoutGroup(current, source.id, index + (destination.after ? 1 : 0)))
    } else {
      if (source.id === destination.section) return
      const group = current.groups.find(value => value.id === destination.group)
      const ids = group?.sectionIds.filter(id => id !== source.id) ?? []
      const index = destination.section === undefined ? ids.length : ids.indexOf(destination.section) + (destination.after ? 1 : 0)
      project(moveLayoutSection(current, source.id, destination.group, index))
    }
  }
  const locate = (point: { clientX: number; clientY: number }) => {
    if (!move.current || settlement.current !== undefined) return
    const viewport = rail.current?.getBoundingClientRect()
    if (!viewport) return
    velocity.current = settingsSectionAutoScroll(point.clientY, viewport.top, viewport.bottom)
    const geometry = dragGeometry.current
    if (geometry && geometry.groups.some(group => group.box.height > 0)) {
      const y = point.clientY - offset.current.y + (ghost?.height ?? 0) / 2
        + (rail.current?.scrollTop ?? 0) - geometry.scrollTop
      let destination: Target | undefined
      if (move.current.kind === 'group') {
        const remaining = geometry.groups.filter(group => group.id !== move.current?.id)
        const next = remaining.find(group => y < group.box.top + group.box.height / 2)
        const last = remaining.at(-1)
        if (next) destination = { group: next.id, after: false }
        else if (last) destination = { group: last.id, after: true }
      } else {
        const group = geometry.groups.find(value => y <= value.box.bottom) ?? geometry.groups.at(-1)
        if (group) {
          const remaining = group.rows.filter(row => row.id !== move.current?.id)
          const next = remaining.find(row => y < row.box.top + row.box.height / 2)
          const last = remaining.at(-1)
          destination = next ? { group: group.id, section: next.id, after: false }
            : last ? { group: group.id, section: last.id, after: true } : { group: group.id, after: true }
        }
      }
      if (destination && (target.current?.group !== destination.group || target.current.section !== destination.section
        || target.current.after !== destination.after)) {
        target.current = destination
        applyDrop(move.current, destination)
      }
      return
    }
    const element = document.elementFromPoint(point.clientX, point.clientY)?.closest<HTMLElement>('[data-navigation-group]')
    if (!element || !rail.current?.contains(element)) return
    const group = element.dataset.navigationGroup
    if (!group) return
    const section = move.current.kind === 'section' ? element.dataset.navigationSection : undefined
    if (move.current.kind === 'group' ? move.current.id === group : move.current.id === section) return
    const hit = move.current.kind === 'group' ? element.closest<HTMLElement>('[data-navigation-container]') ?? element : element
    const bounds = hit.getBoundingClientRect()
    const destination: Target = {
      group, ...(section === undefined ? {} : { section }), after: point.clientY > bounds.top + bounds.height / 2,
    }
    if (target.current?.group !== destination.group || target.current.section !== destination.section
      || target.current.after !== destination.after) {
      target.current = destination
      applyDrop(move.current, destination)
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
      window.removeEventListener('pointermove', track); window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', abort); window.removeEventListener('blur', abort)
      window.removeEventListener('keydown', cancel, true); document.removeEventListener('selectstart', preventSelection)
      document.removeEventListener('touchmove', preventSelection)
      if (frame.current !== undefined) cancelAnimationFrame(frame.current)
    }
  }, [])
  const interaction = (source: Move) => ({
    'aria-describedby': hintId,
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
        dragGeometry.current = { scrollTop: rail.current?.scrollTop ?? 0,
          groups: [...(rail.current?.querySelectorAll<HTMLElement>('[data-navigation-container]') ?? [])].map(group => ({
            id: group.dataset.navigationContainer ?? '', box: group.getBoundingClientRect(),
            rows: [...group.querySelectorAll<HTMLElement>('[data-navigation-section]')].map(row => ({
              id: row.dataset.navigationSection ?? '', box: row.getBoundingClientRect(),
            })),
          })),
        }
        const group = groups.find(value => value.id === source.id)
        const content = source.kind === 'group' ? <>
          <div className={css.heading}><div className={css.page}>{group?.label || t('nav.ungrouped')}</div></div>
          {!group?.collapsed && group?.rows.map(row => <div className={css.page} key={row.id}>{icon(row.id)}
            <span className={css.label}>{row.label}</span></div>)}</>
          : <div className={css.page}>{icon(source.id)}
            <span className={css.label}>{element.textContent}</span></div>
        setGhost({ content, x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height,
          viewport: rail.current?.getBoundingClientRect() ?? bounds, settling: false })
        project(layout)
        setMenu(undefined)
        frame.current = requestAnimationFrame(() => { handlers.current.tick() })
      }, 350)
    },
    onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => {
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
      const visible = current.groups.filter(group => !group.hidden)
      const index = visible.findIndex(group => source.kind === 'group' ? group.id === source.id : group.sectionIds.includes(source.id))
      const group = visible[index]
      if (!group) return
      const direction = ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1
      if (source.kind === 'group') {
        const next = visible[index + direction]
        if (next) project(moveLayoutGroup(current, source.id, current.groups.findIndex(value => value.id === next.id)))
      } else if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
        const next = visible[index + direction]
        if (next) project(moveLayoutSection(current, source.id, next.id, next.sectionIds.length))
      } else project(moveLayoutSection(current, source.id, group.id, group.sectionIds.indexOf(source.id) + direction))
    },
  })
  return <div ref={rail} className={css.rail} data-dragging={move.current !== undefined} tabIndex={-1}>
    <span id={hintId} className={css.hidden}>{t('nav.dragHint')}</span>
    {groups.length === 0 ? <p>{t('nav.empty')}</p> : null}
    {groups.map(group => <div key={group.id} className={css.group} data-navigation-container={group.id} data-placeholder={Boolean(ghost && move.current?.kind === 'group' && move.current.id === group.id)}>
      <div className={css.heading} data-navigation-group={group.id}>
        <button type="button" className={css.page} {...interaction({ kind: 'group', id: group.id })}>{group.id === 'ungrouped' ? t('nav.ungrouped') : group.label}</button>
        <Menu open={menu === group.id} onClose={() => { setMenu(undefined) }} portal
          items={[...(group.id === 'ungrouped' ? [] : [{ id: 'rename', label: t('nav.renameGroup') }, { id: 'delete', label: t('nav.deleteGroup') }]), { id: 'hide', label: t('nav.hideGroup') }]}
          onSelect={(id) => {
            setMenu(undefined)
            if (id === 'hide') mutate(current => setLayoutGroupState(current, group.id, { hidden: true }))
            else if (id === 'rename' || id === 'delete') onManage(group.id, id)
          }}
          anchor={<button type="button" className={`${css.tool} ${css.more}`} data-open={menu === group.id} aria-label={`${t('nav.organize')}: ${group.label || t('nav.ungrouped')}`} onClick={() => { setMenu(group.id) }}>···</button>} />
        <button type="button" className={css.tool} aria-expanded={!group.collapsed} aria-label={group.label || t('nav.ungrouped')}
          onClick={() => { mutate(current => setLayoutGroupState(current, group.id, { collapsed: !group.collapsed })) }}>
          <span className={css.chevron} data-collapsed={group.collapsed}>⌃</span></button>
      </div>
      {!group.collapsed ? group.rows.map(row => <div key={row.id} className={css.row} data-placeholder={Boolean(ghost && move.current?.kind === 'section' && move.current.id === row.id)}
        data-navigation-group={group.id} data-navigation-section={row.id}>
        <button type="button" className={css.page} {...interaction({ kind: 'section', id: row.id })} aria-current={row.id === active ? 'true' : undefined} data-modal-autofocus={row.id === active ? '' : undefined}
          onFocus={(event) => { event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }} onClick={() => { if (!suppress.current && !move.current) onSelect(row.id); suppress.current = false }}>{icon(row.id)}<span className={css.label}>{row.label}</span></button>
        <Menu open={menu === `section:${row.id}`} onClose={() => { setMenu(undefined) }} portal
          items={[{ id: 'hide', label: t('nav.hideItem') }, ...groups.filter(value => value.id !== group.id).map(value => ({ id: `to:${value.id}`, label: `${t('nav.moveTo')}: ${value.label || t('nav.ungrouped')}` }))]}
          onSelect={(id) => { setMenu(undefined); mutate((current) => {
            if (id === 'hide') return setLayoutSectionHidden(current, row.id, true)
            const destination = id.startsWith('to:') ? id.slice(3) : group.id
            const targetGroup = current.groups.find(value => value.id === destination)
            const index = targetGroup?.sectionIds.length ?? 0
            return moveLayoutSection(current, row.id, destination, index)
          }) }} anchor={<button type="button" className={`${css.tool} ${css.more}`} data-open={menu === `section:${row.id}`} aria-label={`${t('nav.organize')}: ${row.label}`} onClick={() => { setMenu(`section:${row.id}`) }}>···</button>} />
      </div>) : null}
    </div>)}
    {ghost ? createPortal(<div className={css.dragViewport} aria-hidden="true"
      style={{ left: ghost.viewport.left, top: ghost.viewport.top, width: ghost.viewport.width, height: ghost.viewport.height }}>
      <div className={css.ghost} data-navigation-ghost data-phase={ghost.settling ? 'settling' : 'dragging'} aria-hidden="true"
        style={{ left: ghost.x - ghost.viewport.left, top: ghost.y - ghost.viewport.top, width: ghost.width, height: ghost.height }}>
        {ghost.content}</div></div>, document.body) : null}
  </div>
}

/**
 * Settings shell root: the sidebar-foot trigger row plus the centered modal
 * panel (figma 501:29947, 1080x700) with the section nav rail. The shell is
 * a pure composition face — slot-owned text (trigger label, panel title,
 * close label, sections) arrives from registrants through slots; accessible
 * names resolve from localized content (trigger: shell locale; dialog:
 * aria-labelledby the title node; close: visually-hidden slot text). Modal
 * open state and the active section id are component-local viewing state;
 * the onboarding coordinator mounts exactly one ordered registrant while the
 * sessions-derived empty-Hero fact is active. Visible dialog chrome belongs
 * to the step, so a mounted-but-deciding step paints nothing here.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import {
  ConnectionIndicator,
  IconAgentPresetOutline16, IconCheckOutline16, IconCloseOutline16, IconDataOutline16,
  IconReorderOutline16,
  IconLinkOutline16, IconPersonalizationOutline16, IconSettingsOutline16, IconWarningOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConnectionIndicatorState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsOnboardingSectionRequest } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsRootComponentProps, SettingsSectionRow } from './shell-contract.ts'
import {
  moveSettingsSection, moveSettingsSectionToIndex, orderSettingsSections,
  settingsSectionAutoScroll, settingsSectionRowShift, settingsSectionTargetIndex,
  type SettingsSectionBox,
} from './section-order.ts'
import css from './SettingsRoot.module.css'

const RECOVERY_CONFIRMATION_MS = 2_000

/** Nav glyph by section id; unknown ids fall back to the settings gear. */
function navIcon(id: string) {
  if (id === 'models') return <IconDataOutline16 className={css.navIcon} size={16} />
  if (id === 'agent-presets') return <IconAgentPresetOutline16 className={css.navIcon} size={16} />
  if (id === 'external-tools') return <IconLinkOutline16 className={css.navIcon} size={16} />
  if (id === 'plugin-restore') return <IconPersonalizationOutline16 className={css.navIcon} size={16} />
  if (id === 'plugins') return <IconPersonalizationOutline16 className={css.navIcon} size={16} />
  if (id === 'diagnostics') return <IconWarningOutline16 className={css.navIcon} size={16} />
  return <IconSettingsOutline16 className={css.navIcon} size={16} />
}

type PanelProps = {
  rows: readonly SettingsSectionRow[]
  storedOrder: readonly string[]
  renderSlot: SettingsRootComponentProps['renderSlot']
  t: SettingsRootComponentProps['t']
  activeId: string | undefined
  onSelect: (id: string) => void
  onReorder: (ids: readonly string[]) => void
  onClose: () => void
  preferredSubsectionId?: string
}

const POINTER_DRAG_THRESHOLD = 4
const SECTION_SORT_ANIMATION_MS = 180

/** Query motion preference while tolerating DOM test hosts without matchMedia. */
function prefersReducedMotion(): boolean {
  const matchMedia = Reflect.get(window, 'matchMedia') as unknown
  return typeof matchMedia === 'function'
    && (matchMedia.call(window, '(prefers-reduced-motion: reduce)') as MediaQueryList).matches
}

type SectionDragState = {
  id: string
  phase: 'dragging' | 'settling' | 'cancelling'
  sourceIndex: number
  targetIndex: number
  startPointerY: number
  pointerY: number
  originTop: number
  originLeft: number
  width: number
  height: number
  listTop: number
  listScrollTop: number
  boxes: readonly SettingsSectionBox[]
}

type ArmedSectionDrag = {
  id: string
  pointerId: number
  startX: number
  startY: number
  handle: HTMLButtonElement
}

type OnboardingPanelProps = {
  request: SettingsOnboardingSectionRequest
  available: boolean
  renderSlot: SettingsRootComponentProps['renderSlot']
  t: SettingsRootComponentProps['t']
  onBack: () => void
  onComplete: () => void
}

const ONBOARDING_SECTION_STEPS = [
  'onboarding.step.models',
  'onboarding.step.phone',
  'onboarding.step.messages',
  'onboarding.step.codex',
  'onboarding.step.ready',
] as const

/** Reuse one settings section inside the selected first-run progress shell. */
function OnboardingSectionPanel({ request, available, renderSlot, t, onBack, onComplete }: OnboardingPanelProps) {
  const titleId = useId()
  const backButton = useRef<HTMLButtonElement | null>(null)

  useEffect(() => { backButton.current?.focus() }, [])

  return createPortal((
    <div className={clsx(css.overlay, css.onboardingOverlay)} role="presentation">
      <div className={css.mask} aria-hidden="true" />
      <div className={css.onboardingPanel} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <aside className={css.onboardingRail}>
          <h2 id={titleId} className={css.onboardingRailTitle}>{t('onboarding.start')}</h2>
          {ONBOARDING_SECTION_STEPS.map((label, index) => {
            const step = index + 1
            const active = step === request.step
            const complete = step < request.step
            return (
              <div key={step} className={css.onboardingStep} data-active={active ? 'true' : undefined}>
                <span className={clsx(css.onboardingStepNumber, complete && css.onboardingStepComplete)}>
                  {complete ? <IconCheckOutline16 size={14} /> : step}
                </span>
                <span>{t(label)}</span>
              </div>
            )
          })}
        </aside>
        <div className={css.onboardingSectionContent}>
          <div className={css.onboardingSectionBody}>
            {available
              ? renderSlot('settings.section', {
                close: onBack,
                ...request.subsectionId === undefined
                  ? {}
                  : { preferredSubsectionId: request.subsectionId },
              }, { only: request.sectionId })
              : (
                <div className={css.onboardingSectionUnavailable} role="status">
                  <h3>{t('onboarding.sectionUnavailable.title')}</h3>
                  <p>{t('onboarding.sectionUnavailable.description')}</p>
                </div>
              )}
          </div>
          <footer className={css.onboardingFooter}>
            <button ref={backButton} type="button" className={css.onboardingBack} onClick={onBack}>
              {t('onboarding.back')}
            </button>
            <button type="button" className={css.onboardingDone} disabled={!available} onClick={onComplete}>
              {t('onboarding.done')}
            </button>
          </footer>
        </div>
      </div>
    </div>
  ), document.body)
}

/**
 * The modal layer: full-viewport mask + centered panel. Close paths: the
 * header button, a mask click, and document-level Escape (mounted only while
 * open, so the listener lifetime is the panel's).
 */
function SettingsPanel({
  rows, storedOrder, renderSlot, t, activeId, onSelect, onReorder, onClose, preferredSubsectionId,
}: PanelProps) {
  // Entries can unmount underneath the requested id, so the render-time
  // projection falls back to the first row when the id is gone.
  const active = rows.find(r => r.id === activeId)?.id ?? rows[0]?.id
  const titleId = useId()
  const navList = useRef<HTMLDivElement | null>(null)
  const rowElements = useRef(new Map<string, HTMLDivElement>())
  const armedDrag = useRef<ArmedSectionDrag>()
  const dragFrame = useRef<number | null>(null)
  const settleTimer = useRef<number | null>(null)
  const latestPointer = useRef({ x: 0, y: 0 })
  const dragState = useRef<SectionDragState>()
  const [drag, setDrag] = useState<SectionDragState>()

  const publishDrag = useCallback((next: SectionDragState | undefined) => {
    dragState.current = next
    setDrag(next)
  }, [])

  const clearScheduledDragWork = useCallback(() => {
    if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current)
    if (settleTimer.current !== null) window.clearTimeout(settleTimer.current)
    dragFrame.current = null
    settleTimer.current = null
  }, [])

  const releasePointer = useCallback(() => {
    const armed = armedDrag.current
    armedDrag.current = undefined
    if (armed === undefined || typeof armed.handle.releasePointerCapture !== 'function') return
    if (typeof armed.handle.hasPointerCapture === 'function'
      && !armed.handle.hasPointerCapture(armed.pointerId)) return
    armed.handle.releasePointerCapture(armed.pointerId)
  }, [])

  const measureRows = useCallback(() => {
    const list = navList.current
    if (list === null) return undefined
    const listBox = list.getBoundingClientRect()
    const boxes: SettingsSectionBox[] = []
    for (const row of rows) {
      const element = rowElements.current.get(row.id)
      if (element === undefined) return undefined
      const box = element.getBoundingClientRect()
      const top = box.top - listBox.top + list.scrollTop
      boxes.push({ id: row.id, top, bottom: top + box.height, height: box.height })
    }
    return { list, listBox, boxes }
  }, [rows])

  const reorderRelativeTo = useCallback((
    dragged: string,
    target: string,
    position: 'before' | 'after',
  ) => {
    const ids = rows.map(row => row.id)
    const next = moveSettingsSection(ids, storedOrder, dragged, target, position)
    if (next.join('\u0000') !== storedOrder.join('\u0000')) onReorder(next)
  }, [onReorder, rows, storedOrder])

  const updateDragFrame = useRef<() => void>(() => {})
  const scheduleDragFrame = useCallback(() => {
    dragFrame.current ??= requestAnimationFrame(() => {
      dragFrame.current = null
      updateDragFrame.current()
    })
  }, [])

  updateDragFrame.current = () => {
    const current = dragState.current
    const list = navList.current
    if (current === undefined || current.phase !== 'dragging' || list === null) return
    const listBox = list.getBoundingClientRect()
    const point = latestPointer.current
    const scrollVelocity = settingsSectionAutoScroll(point.y, listBox.top, listBox.bottom)
    const previousScrollTop = list.scrollTop
    if (scrollVelocity !== 0) list.scrollTop += scrollVelocity
    const draggedCenterInList = current.originTop
      + (point.y - current.startPointerY)
      + current.height / 2
      - listBox.top
      + list.scrollTop
    const targetIndex = settingsSectionTargetIndex(
      current.boxes,
      current.sourceIndex,
      draggedCenterInList,
    )
    publishDrag({
      ...current,
      pointerY: point.y,
      targetIndex,
      listTop: listBox.top,
      listScrollTop: list.scrollTop,
    })
    if (list.scrollTop !== previousScrollTop) scheduleDragFrame()
  }

  const finishVisualDrag = useCallback((commit: boolean) => {
    const current = dragState.current
    if (current === undefined) return
    clearScheduledDragWork()
    publishDrag({
      ...current,
      phase: commit ? 'settling' : 'cancelling',
      targetIndex: commit ? current.targetIndex : current.sourceIndex,
    })
    const reduced = prefersReducedMotion()
    settleTimer.current = window.setTimeout(() => {
      const settled = dragState.current
      if (commit && settled !== undefined) {
        const next = moveSettingsSectionToIndex(
          rows.map(row => row.id),
          storedOrder,
          settled.id,
          settled.targetIndex,
        )
        if (next.join('\u0000') !== storedOrder.join('\u0000')) onReorder(next)
      }
      publishDrag(undefined)
      settleTimer.current = null
    }, reduced ? 0 : SECTION_SORT_ANIMATION_MS)
  }, [clearScheduledDragWork, onReorder, publishDrag, rows, storedOrder])

  const cancelPointerDrag = useCallback(() => {
    releasePointer()
    if (dragState.current === undefined) {
      clearScheduledDragWork()
      return
    }
    finishVisualDrag(false)
  }, [clearScheduledDragWork, finishVisualDrag, releasePointer])

  const beginPointerDrag = useCallback((event: PointerEvent<HTMLButtonElement>, id: string) => {
    if (event.button !== 0 || !event.isPrimary || dragState.current !== undefined) return
    event.preventDefault()
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    latestPointer.current = { x: event.clientX, y: event.clientY }
    armedDrag.current = {
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      handle: event.currentTarget,
    }
  }, [])

  const movePointerDrag = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    const armed = armedDrag.current
    if (armed === undefined || armed.pointerId !== event.pointerId) return
    event.preventDefault()
    latestPointer.current = { x: event.clientX, y: event.clientY }
    if (dragState.current === undefined) {
      const distance = Math.hypot(event.clientX - armed.startX, event.clientY - armed.startY)
      if (distance < POINTER_DRAG_THRESHOLD) return
      const measured = measureRows()
      const sourceIndex = rows.findIndex(row => row.id === armed.id)
      const sourceElement = rowElements.current.get(armed.id)
      if (measured === undefined || sourceIndex === -1 || sourceElement === undefined) return
      const sourceBox = sourceElement.getBoundingClientRect()
      publishDrag({
        id: armed.id,
        phase: 'dragging',
        sourceIndex,
        targetIndex: sourceIndex,
        startPointerY: armed.startY,
        pointerY: event.clientY,
        originTop: sourceBox.top,
        originLeft: sourceBox.left,
        width: sourceBox.width,
        height: sourceBox.height,
        listTop: measured.listBox.top,
        listScrollTop: measured.list.scrollTop,
        boxes: measured.boxes,
      })
    }
    scheduleDragFrame()
  }, [measureRows, publishDrag, rows, scheduleDragFrame])

  const endPointerDrag = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    const armed = armedDrag.current
    if (armed === undefined || armed.pointerId !== event.pointerId) return
    latestPointer.current = { x: event.clientX, y: event.clientY }
    updateDragFrame.current()
    const current = dragState.current
    const listBox = navList.current?.getBoundingClientRect()
    releasePointer()
    if (current === undefined) return
    const inside = listBox !== undefined
      && event.clientX >= listBox.left && event.clientX <= listBox.right
      && event.clientY >= listBox.top && event.clientY <= listBox.bottom
    finishVisualDrag(inside)
  }, [finishVisualDrag, releasePointer])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (armedDrag.current !== undefined || dragState.current !== undefined) {
        e.preventDefault()
        cancelPointerDrag()
        return
      }
      onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [cancelPointerDrag, onClose])

  useEffect(() => () => {
    clearScheduledDragWork()
    armedDrag.current = undefined
    dragState.current = undefined
  }, [clearScheduledDragWork])

  // Entering the dialog focuses the close button; the root restores its trigger on close.
  const closeButton = useRef<HTMLButtonElement | null>(null)
  useEffect(() => { closeButton.current?.focus() }, [])

  const draggedRow = drag === undefined ? undefined : rows.find(row => row.id === drag.id)
  const targetBox = drag === undefined ? undefined : drag.boxes[drag.targetIndex]
  const ghostOffset = drag === undefined
    ? 0
    : drag.phase === 'dragging'
      ? drag.pointerY - drag.startPointerY
      : drag.phase === 'settling' && targetBox !== undefined
        ? drag.listTop - drag.listScrollTop + targetBox.top - drag.originTop
        : 0

  return (
    <div className={css.overlay} role="presentation">
      <div className={css.mask} aria-hidden="true" onClick={onClose} />
      <div className={css.panel} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <nav className={css.nav}>
          <div className={css.navTitle} id={titleId}>{renderSlot('settings.header', {})}</div>
          <div
            ref={navList}
            className={css.navList}
            role="list"
            data-sorting={drag === undefined ? undefined : 'true'}
          >
            {rows.map((row, index) => {
              const rowShift = drag === undefined || drag.phase === 'cancelling'
                ? 0
                : settingsSectionRowShift(drag.boxes, drag.sourceIndex, drag.targetIndex, index)
              return (
                <div
                  key={row.id}
                  ref={(element) => {
                    if (element === null) rowElements.current.delete(row.id)
                    else rowElements.current.set(row.id, element)
                  }}
                  className={css.navItem}
                  role="listitem"
                  style={{ transform: `translateY(${rowShift}px)` }}
                  data-active={row.id === active ? 'true' : undefined}
                  data-placeholder={drag?.id === row.id ? 'true' : undefined}
                >
                  <button
                    type="button"
                    className={clsx(css.navCell, row.id === active && css.active)}
                    aria-current={row.id === active ? 'true' : undefined}
                    onClick={() => { onSelect(row.id) }}
                  >
                    {navIcon(row.id)}
                    <span className={css.navLabel}>{row.label}</span>
                  </button>
                  <button
                    type="button"
                    className={css.dragHandle}
                    aria-label={`${t('nav.reorder')}: ${row.label}`}
                    onPointerDown={(event) => { beginPointerDrag(event, row.id) }}
                    onPointerMove={movePointerDrag}
                    onPointerUp={endPointerDrag}
                    onPointerCancel={() => { cancelPointerDrag() }}
                    onKeyDown={(event) => {
                      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                      const index = rows.findIndex(candidate => candidate.id === row.id)
                      const target = rows[index + (event.key === 'ArrowUp' ? -1 : 1)]
                      if (target === undefined) return
                      event.preventDefault()
                      reorderRelativeTo(row.id, target.id, event.key === 'ArrowUp' ? 'before' : 'after')
                    }}
                  >
                    <IconReorderOutline16 size={16} />
                  </button>
                </div>
              )
            })}
            {drag !== undefined && drag.phase !== 'cancelling' && targetBox !== undefined && (
              <span
                className={css.dropIndicator}
                style={{ top: targetBox.top }}
                aria-hidden="true"
              />
            )}
          </div>
          {drag !== undefined && draggedRow !== undefined && (
            <div
              className={clsx(css.navItem, css.dragGhost)}
              data-active={draggedRow.id === active ? 'true' : undefined}
              data-phase={drag.phase}
              style={{
                top: drag.originTop,
                left: drag.originLeft,
                width: drag.width,
                height: drag.height,
                transform: `translateY(${ghostOffset}px)`,
              }}
              aria-hidden="true"
            >
              <div className={css.navCell}>
                {navIcon(draggedRow.id)}
                <span className={css.navLabel}>{draggedRow.label}</span>
              </div>
              <div className={css.dragHandle}>
                <IconReorderOutline16 size={16} />
              </div>
            </div>
          )}
        </nav>
        <div className={css.content}>
          <div className={css.header}>
            <div className={css.actions}>{renderSlot('settings.action', {})}</div>
            <button ref={closeButton} type="button" className={css.close} onClick={onClose}>
              <IconCloseOutline16 size={14} />
              <span className={css.hiddenLabel}>{renderSlot('settings.close', {})}</span>
            </button>
          </div>
          <div className={css.options}>
            {active !== undefined && renderSlot('settings.section', {
              close: onClose,
              ...(preferredSubsectionId === undefined ? {} : { preferredSubsectionId }),
            }, { only: active })}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Render the settings trigger and panel.
 * @param props - composed slot props (contract/slots.ts).
 * @returns the settings shell element tree.
 */
export function SettingsRoot(props: SettingsRootComponentProps) {
  const {
    wide, reconnect, useConnectionState, useSections, useOnboardingSteps, useNavigation,
    useSectionOrder, useSessions, setSectionOrder, renderSlot, t,
  } = props
  const [open, setOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | undefined>(undefined)
  const [preferredSubsectionId, setPreferredSubsectionId] = useState<string | undefined>()
  const [onboardingSection, setOnboardingSection] = useState<SettingsOnboardingSectionRequest>()
  const [completedOnboarding, setCompletedOnboarding] = useState<ReadonlySet<string>>(() => new Set())
  const [showRecovery, setShowRecovery] = useState(false)
  const triggerButton = useRef<HTMLButtonElement | null>(null)
  const wasOpen = useRef(open)
  const close = useCallback(() => {
    setOpen(false)
    setActiveId(undefined)
    setPreferredSubsectionId(undefined)
  }, [])
  // Restore after the close commit, when the dialog can no longer own focus.
  useEffect(() => {
    if (wasOpen.current && !open) triggerButton.current?.focus()
    wasOpen.current = open
  }, [open])
  // The ledger tick keeps the nav rows fresh: registrants re-register with
  // freshly localized text on locale change, and the trigger/header/close
  // seats re-render through their own outlets' subscriptions.
  const rows = useSections(s => s)
  const connectionState = useConnectionState(state => state)
  const previousConnectionState = useRef(connectionState)
  const onboardingSteps = useOnboardingSteps(s => s)
  const navigation = useNavigation(s => s)
  const storedSectionOrder = useSectionOrder(s => s)
  const [optimisticSectionOrder, setOptimisticSectionOrder] = useState<readonly string[]>()
  const persistGeneration = useRef(0)
  const effectiveSectionOrder = optimisticSectionOrder ?? storedSectionOrder
  const orderedRows = useMemo(
    () => orderSettingsSections(rows, effectiveSectionOrder),
    [effectiveSectionOrder, rows],
  )
  const reorderSections = useCallback((ids: readonly string[]) => {
    const generation = ++persistGeneration.current
    setOptimisticSectionOrder(ids)
    void setSectionOrder(ids).finally(() => {
      if (persistGeneration.current === generation) setOptimisticSectionOrder(undefined)
    })
  }, [setSectionOrder])

  useEffect(() => {
    if (navigation === undefined) return
    setOpen(true)
    setActiveId(navigation.sectionId)
    setPreferredSubsectionId(navigation.subsectionId)
  }, [navigation?.revision])
  const onboardingActive = useSessions(state =>
    state.phase === 'ready'
    && (state.current === undefined || state.byId[state.current]?.blank === true))
  const onboardingStep = onboardingActive
    ? onboardingSteps.find(step => !completedOnboarding.has(step.id))
    : undefined

  useEffect(() => {
    if (onboardingActive) return
    setCompletedOnboarding(new Set())
    setOnboardingSection(undefined)
  }, [onboardingActive])

  useLayoutEffect(() => {
    const previous = previousConnectionState.current
    previousConnectionState.current = connectionState
    if (connectionState !== 'connected') {
      setShowRecovery(false)
      return
    }
    if (previous !== 'disconnected' && previous !== 'connecting') return
    setShowRecovery(true)
    const timeout = window.setTimeout(() => { setShowRecovery(false) }, RECOVERY_CONFIRMATION_MS)
    return () => { window.clearTimeout(timeout) }
  }, [connectionState])

  const completeOnboardingStep = useCallback((id: string) => {
    setCompletedOnboarding((previous) => {
      if (previous.has(id)) return previous
      return new Set([...previous, id])
    })
  }, [])

  let connectionIndicator: ConnectionIndicatorState | undefined
  if (connectionState === 'disconnected') {
    connectionIndicator = 'disconnected'
  } else if (connectionState === 'connecting') {
    connectionIndicator = 'connecting'
  } else if (showRecovery) {
    connectionIndicator = 'recovered'
  }

  return (
    <>
      <div className={clsx(css.triggerRow, !wide && css.railRow)}>
        <button
          ref={triggerButton}
          type="button"
          className={clsx(css.trigger, !wide && css.rail)}
          aria-label={t('trigger')}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => { setOpen(true) }}
        >
          {renderSlot('settings.trigger', { wide })}
        </button>
        <ConnectionIndicator
          state={wide ? connectionIndicator : undefined}
          disconnectedLabel={t('connection.error')}
          reconnectLabel={t('connection.retry')}
          connectingLabel={t('connection.connecting')}
          recoveredLabel={t('connection.connected')}
          reconnectActionLabel={t('connection.reconnect')}
          restartActionLabel={t('connection.restart')}
          onReconnect={reconnect}
        />
      </div>
      {open && (
        <SettingsPanel
          rows={orderedRows}
          storedOrder={effectiveSectionOrder}
          renderSlot={renderSlot}
          t={t}
          activeId={activeId}
          onSelect={(id) => { setActiveId(id); setPreferredSubsectionId(undefined) }}
          onReorder={reorderSections}
          onClose={close}
          {...preferredSubsectionId === undefined ? {} : { preferredSubsectionId }}
        />
      )}
      {/* Dialog chrome and `#root` inert ownership live inside each step's
          visible branch. A step still deciding (private facts loading)
          renders null, so nothing paints or blocks while it decides. */}
      {onboardingStep !== undefined && renderSlot('settings.onboarding', {
        stepId: onboardingStep.id,
        complete: () => { completeOnboardingStep(onboardingStep.id) },
        openSection: setOnboardingSection,
      }, { only: onboardingStep.id })}
      {onboardingSection !== undefined && (
        <OnboardingSectionPanel
          request={onboardingSection}
          available={orderedRows.some(row => row.id === onboardingSection.sectionId)}
          renderSlot={renderSlot}
          t={t}
          onBack={() => { setOnboardingSection(undefined) }}
          onComplete={() => {
            onboardingSection.complete()
            setOnboardingSection(undefined)
          }}
        />
      )}
    </>
  )
}

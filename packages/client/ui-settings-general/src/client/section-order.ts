import type { SettingsSectionRow } from './shell-contract.ts'

/** Drop edge selected from the pointer's position within a navigation row. */
export type SectionDropPosition = 'before' | 'after'

/** Viewport geometry captured for one visible settings row. */
export interface SettingsSectionBox {
  id: string
  top: number
  bottom: number
  height: number
}

/**
 * Remove empty and duplicate ids from a durable navigation order.
 *
 * @param order - Stored section ids in their requested order.
 * @returns The first occurrence of each non-empty id.
 */
export function normalizeSectionOrder(order: readonly string[]): readonly string[] {
  const seen = new Set<string>()
  return order.filter((id) => {
    if (id.length === 0 || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

/**
 * Apply a durable id order to the currently registered rows. Newly registered
 * plugin sections remain visible at the end in their canonical ledger order.
 *
 * @param rows - Currently registered settings rows in canonical order.
 * @param storedOrder - Durable section ids, which may include absent plugins.
 * @returns Registered rows ordered by durable ids, followed by new rows.
 */
export function orderSettingsSections(
  rows: readonly SettingsSectionRow[],
  storedOrder: readonly string[],
): readonly SettingsSectionRow[] {
  const normalized = normalizeSectionOrder(storedOrder)
  if (normalized.length === 0) return rows
  const byId = new Map(rows.map(row => [row.id, row]))
  const ordered = normalized.flatMap(id => byId.get(id) ?? [])
  const known = new Set(normalized)
  const newRows = rows.filter(row => !known.has(row.id))
  for (const row of newRows) {
    if (row.id !== 'orb') {
      ordered.push(row)
      continue
    }
    const tools = ordered.findIndex(candidate => candidate.id === 'external-tools')
    const presets = ordered.findIndex(candidate => candidate.id === 'agent-presets')
    const position = tools >= 0 ? tools + 1 : presets >= 0 ? presets : ordered.length
    ordered.splice(position, 0, row)
  }
  return ordered
}

/**
 * Compute one visible row move and preserve stale ids for reinstalled plugins.
 *
 * @param visibleIds - Ids currently rendered in the navigation list.
 * @param storedOrder - Durable ids, including any currently absent plugin sections.
 * @param draggedId - Visible section being moved.
 * @param targetId - Visible section that defines the insertion edge.
 * @param position - Edge of the target at which to insert the dragged section.
 * @returns The updated visible order followed by preserved absent ids.
 */
export function moveSettingsSection(
  visibleIds: readonly string[],
  storedOrder: readonly string[],
  draggedId: string,
  targetId: string,
  position: SectionDropPosition,
): readonly string[] {
  if (draggedId === targetId || !visibleIds.includes(draggedId) || !visibleIds.includes(targetId)) {
    return normalizeSectionOrder(storedOrder)
  }
  const next = visibleIds.filter(id => id !== draggedId)
  const targetIndex = next.indexOf(targetId)
  next.splice(targetIndex + (position === 'after' ? 1 : 0), 0, draggedId)

  const visible = new Set(visibleIds)
  const hidden = normalizeSectionOrder(storedOrder).filter(id => !visible.has(id))
  return [...next, ...hidden]
}

/**
 * Resolve an insertion index from the dragged row center and the remaining row centers.
 *
 * @param boxes - Measured boxes for all visible rows.
 * @param sourceIndex - Original index of the dragged row.
 * @param draggedCenterY - Current viewport Y coordinate of the dragged row center.
 * @returns The bounded index at which the dragged row would be inserted.
 */
export function settingsSectionTargetIndex(
  boxes: readonly SettingsSectionBox[],
  sourceIndex: number,
  draggedCenterY: number,
): number {
  if (boxes.length <= 1) return 0
  let target = 0
  for (let index = 0; index < boxes.length; index += 1) {
    if (index === sourceIndex) continue
    const box = boxes[index]
    if (box === undefined) continue
    if (draggedCenterY > box.top + box.height / 2) target += 1
  }
  return Math.min(boxes.length - 1, target)
}

/**
 * Translate one non-dragged row to fill the source slot and leave the target slot empty.
 *
 * @param boxes - Measured boxes for all visible rows.
 * @param sourceIndex - Original index of the dragged row.
 * @param targetIndex - Current insertion index of the dragged row.
 * @param rowIndex - Index of the non-dragged row being rendered.
 * @returns The vertical translation in pixels for the rendered row.
 */
export function settingsSectionRowShift(
  boxes: readonly SettingsSectionBox[],
  sourceIndex: number,
  targetIndex: number,
  rowIndex: number,
): number {
  const current = boxes[rowIndex]
  if (current === undefined) return 0
  if (targetIndex < sourceIndex && rowIndex >= targetIndex && rowIndex < sourceIndex) {
    return (boxes[rowIndex + 1]?.top ?? current.bottom) - current.top
  }
  if (targetIndex > sourceIndex && rowIndex > sourceIndex && rowIndex <= targetIndex) {
    return (boxes[rowIndex - 1]?.top ?? current.top) - current.top
  }
  return 0
}

/**
 * Move one visible id to a resolved insertion index while retaining absent plugin ids.
 *
 * @param visibleIds - Ids currently rendered in the navigation list.
 * @param storedOrder - Durable ids, including any currently absent plugin sections.
 * @param draggedId - Visible section being moved.
 * @param targetIndex - Bounded insertion index in the visible list.
 * @returns The updated visible order followed by preserved absent ids.
 */
export function moveSettingsSectionToIndex(
  visibleIds: readonly string[],
  storedOrder: readonly string[],
  draggedId: string,
  targetIndex: number,
): readonly string[] {
  const sourceIndex = visibleIds.indexOf(draggedId)
  if (sourceIndex === -1) return normalizeSectionOrder(storedOrder)
  const next = visibleIds.filter(id => id !== draggedId)
  next.splice(Math.max(0, Math.min(targetIndex, next.length)), 0, draggedId)
  const visible = new Set(visibleIds)
  const hidden = normalizeSectionOrder(storedOrder).filter(id => !visible.has(id))
  return [...next, ...hidden]
}

/**
 * Resolve request-animation-frame auto-scroll velocity near a scrollport edge.
 *
 * @param pointerY - Current viewport Y coordinate of the pointer.
 * @param top - Top edge of the scrollport.
 * @param bottom - Bottom edge of the scrollport.
 * @param edge - Size in pixels of each active edge zone.
 * @param maximum - Maximum absolute scroll delta per animation frame.
 * @returns A signed scroll delta, or zero outside the edge zones.
 */
export function settingsSectionAutoScroll(
  pointerY: number,
  top: number,
  bottom: number,
  edge = 28,
  maximum = 8,
): number {
  if (pointerY < top || pointerY > bottom) return 0
  if (pointerY < top + edge) return -maximum * (1 - (pointerY - top) / edge)
  if (pointerY > bottom - edge) return maximum * (1 - (bottom - pointerY) / edge)
  return 0
}

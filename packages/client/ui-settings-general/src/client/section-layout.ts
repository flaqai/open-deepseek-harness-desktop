/** Immutable navigation edits; feature activation and Profile writes belong to callers. */
import type { SettingsNavigationLayout, SettingsNavigationNode } from '../types.ts'
import type { SettingsSectionRow } from './shell-contract.ts'
import { normalizeSectionOrder } from './section-order.ts'

/** Read either supported preference without modifying its source.
 * @param input Untrusted versioned preference.
 * @returns Normalized version-2 layout, or undefined for an unsupported envelope.
 */
export function normalizeSettingsLayout(input: unknown): SettingsNavigationLayout | undefined {
  if (!input || typeof input !== 'object' || !('version' in input) || !('hiddenIds' in input) || !Array.isArray(input.hiddenIds)) return undefined
  const legacy = input.version === 1
  const raw = legacy && 'groups' in input ? input.groups : input.version === 2 && 'nodes' in input ? input.nodes : undefined
  if (!Array.isArray(raw)) return undefined
  const nodes: SettingsNavigationNode[] = []
  const groups = new Set<string>(); const sections = new Set<string>()
  const hiddenIds = normalizeSectionOrder(input.hiddenIds.filter((id): id is string => typeof id === 'string' && id.trim() !== '')).slice()
  const accept = (id: unknown): id is string => {
    if (typeof id !== 'string' || !id.trim() || sections.has(id)) return false
    sections.add(id); return true
  }
  const rawNodes: readonly unknown[] = raw
  for (const candidate of rawNodes) {
    if (!candidate || typeof candidate !== 'object') continue
    const row = candidate as Record<string, unknown>
    if (typeof row.id !== 'string' || !row.id.trim()) continue
    if (!legacy && row.kind === 'section') { if (accept(row.id)) nodes.push({ kind: 'section', id: row.id }); continue }
    if ((!legacy && row.kind !== 'group') || typeof row.label !== 'string' || !Array.isArray(row.sectionIds) || groups.has(row.id)) continue
    const label = row.label.trim().slice(0, 40)
    if (row.id !== 'ungrouped' && !label) continue
    groups.add(row.id)
    const ids = (row.sectionIds as unknown[]).filter(accept)
    if (legacy && row.id === 'ungrouped') {
      nodes.push(...ids.map((id: string) => ({ kind: 'section' as const, id })))
      if (row.hidden === true) hiddenIds.push(...ids)
    } else nodes.push({ kind: 'group', id: row.id, label, sectionIds: ids,
      ...(typeof row.hidden === 'boolean' ? { hidden: row.hidden } : {}),
      ...(typeof row.collapsed === 'boolean' ? { collapsed: row.collapsed } : {}),
    })
  }
  return { version: 2, nodes, hiddenIds: [...new Set(hiddenIds)] }
}

/** Append newly registered pages, retaining missing plugin identities.
 * @param rows Registered settings pages.
 * @param stored Accepted persisted layout.
 * @param legacyOrder Previous flat section order.
 * @returns Layout with new pages appended as independent entries.
 */
export function resolveSettingsLayout(
  rows: readonly SettingsSectionRow[], stored: SettingsNavigationLayout | undefined, legacyOrder: readonly string[],
): SettingsNavigationLayout {
  const layout = normalizeSettingsLayout(stored) ?? { version: 2, nodes: normalizeSectionOrder(legacyOrder).map(id => ({ kind: 'section' as const, id })), hiddenIds: [] }
  const known = new Set(layout.nodes.flatMap(node => node.kind === 'group' ? node.sectionIds : [node.id]))
  return { ...layout, nodes: [...layout.nodes, ...rows.filter(row => !known.has(row.id)).map(row => ({ kind: 'section' as const, id: row.id }))] }
}

/** Visible navigation nodes, including empty and collapsed group targets.
 * @param rows Registered pages and their current labels.
 * @param layout Normalized navigation preference.
 * @returns Visible ordered entries and group drop targets.
 */
export function visibleSettingsNodes(rows: readonly SettingsSectionRow[], layout: SettingsNavigationLayout): ({ kind: 'section'; id: string; row: SettingsSectionRow } | { kind: 'group'; id: string; label: string; collapsed: boolean; rows: SettingsSectionRow[] })[] {
  const byId = new Map(rows.map(row => [row.id, row])); const hidden = new Set(layout.hiddenIds)
  return layout.nodes.flatMap((node): ReturnType<typeof visibleSettingsNodes> => {
    if (node.kind === 'section') { const row = byId.get(node.id); return row && !hidden.has(node.id) ? [{ kind: 'section', id: node.id, row }] : [] }
    return node.hidden ? [] : [{ kind: 'group', id: node.id, label: node.label, collapsed: node.collapsed ?? false,
      rows: node.sectionIds.flatMap(id => hidden.has(id) ? [] : byId.get(id) ?? []) }]
  })
}

/** Visible custom groups for group-management consumers.
 * @param rows Registered settings pages.
 * @param layout Normalized navigation preference.
 * @returns Visible custom groups, including empty groups.
 */
export function visibleSettingsGroups(rows: readonly SettingsSectionRow[], layout: SettingsNavigationLayout): Extract<ReturnType<typeof visibleSettingsNodes>[number], { kind: 'group' }>[] {
  return visibleSettingsNodes(rows, layout).filter(node => node.kind === 'group')
}

/** Set group visibility or expansion without changing membership.
 * @param layout Current preference.
 * @param id Group identity.
 * @param state Visibility and expansion changes.
 * @returns Updated preference with membership retained.
 */
export function setLayoutGroupState(
  layout: SettingsNavigationLayout, id: string, state: { hidden?: boolean; collapsed?: boolean },
): SettingsNavigationLayout {
  return { ...layout, nodes: layout.nodes.map(node => node.kind === 'group' && node.id === id ? { ...node, ...state } : node) }
}

/** Move a page to a group, or to top-level order when targetGroupId is undefined; index is after source removal.
 * @param layout Current preference.
 * @param sectionId Page identity to move.
 * @param targetGroupId Destination group, or undefined for independent placement.
 * @param targetIndex Insertion index after source removal.
 * @returns Updated preference, or the original for an invalid move.
 */
export function moveLayoutSection(
  layout: SettingsNavigationLayout, sectionId: string, targetGroupId: string | undefined, targetIndex: number,
): SettingsNavigationLayout {
  if (!layout.nodes.some(node => node.kind === 'section' ? node.id === sectionId : node.sectionIds.includes(sectionId))
    || (targetGroupId !== undefined && !layout.nodes.some(node => node.kind === 'group' && node.id === targetGroupId))) return layout
  const nodes = layout.nodes.filter(node => !(node.kind === 'section' && node.id === sectionId)).map(node => node.kind === 'group' ? { ...node, sectionIds: node.sectionIds.filter(id => id !== sectionId) } : node)
  if (targetGroupId === undefined) nodes.splice(Math.max(0, Math.min(nodes.length, targetIndex)), 0, { kind: 'section', id: sectionId })
  else for (const node of nodes) if (node.kind === 'group' && node.id === targetGroupId) node.sectionIds.splice(Math.max(0, Math.min(node.sectionIds.length, targetIndex)), 0, sectionId)
  return { ...layout, nodes }
}

/** Move an entire group within top-level order; index is after removal.
 * @param layout Current preference.
 * @param groupId Group identity to move.
 * @param targetIndex Top-level insertion index after removal.
 * @returns Updated order without membership changes.
 */
export function moveLayoutGroup(layout: SettingsNavigationLayout, groupId: string, targetIndex: number): SettingsNavigationLayout {
  const group = layout.nodes.find(node => node.kind === 'group' && node.id === groupId)
  if (!group) return layout
  const nodes = layout.nodes.filter(node => node !== group)
  nodes.splice(Math.max(0, Math.min(nodes.length, targetIndex)), 0, group)
  return { ...layout, nodes }
}

/** Rename a custom group without changing its identity.
 * @param layout Current preference.
 * @param id Group identity.
 * @param label User-authored name, trimmed to forty characters.
 * @returns Updated preference; blank names leave it unchanged.
 */
export function renameLayoutGroup(layout: SettingsNavigationLayout, id: string, label: string): SettingsNavigationLayout {
  const name = label.trim().slice(0, 40)
  return !name ? layout : { ...layout, nodes: layout.nodes.map(node => node.kind === 'group' && node.id === id ? { ...node, label: name } : node) }
}

/** Unwrap members into independent entries at the removed group's position.
 * @param layout Current preference.
 * @param id Group identity to remove.
 * @returns Preference with members independently ordered at the original group position.
 */
export function removeLayoutGroup(layout: SettingsNavigationLayout, id: string): SettingsNavigationLayout {
  return { ...layout, nodes: layout.nodes.flatMap(node => node.kind === 'group' && node.id === id ? node.sectionIds.map(sectionId => ({ kind: 'section' as const, id: sectionId })) : [node]) }
}

/** Append a uniquely named empty group.
 * @param layout Current preference.
 * @param id Unique group identity.
 * @param label User-authored group name.
 * @returns Preference with an empty group appended, or the original for invalid input.
 */
export function addLayoutGroup(layout: SettingsNavigationLayout, id: string, label: string): SettingsNavigationLayout {
  if (!id.trim() || !label.trim() || layout.nodes.some(node => node.id === id)) return layout
  return { ...layout, nodes: [...layout.nodes, { kind: 'group', id, label: label.trim().slice(0, 40), sectionIds: [] }] }
}

/** Hide navigation only, retaining feature activation.
 * @param layout Current preference.
 * @param id Page identity.
 * @param hidden Whether the navigation entry is hidden.
 * @returns Updated visibility without changing membership or feature activation.
 */
export function setLayoutSectionHidden(layout: SettingsNavigationLayout, id: string, hidden: boolean): SettingsNavigationLayout {
  return { ...layout, hiddenIds: [...layout.hiddenIds.filter(value => value !== id), ...hidden ? [id] : []] }
}

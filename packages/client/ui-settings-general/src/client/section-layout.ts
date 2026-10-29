/** Immutable settings navigation projection and edits; no plugin state is changed. */
import type { SettingsNavigationLayout, SettingsNavigationGroup } from '../types.ts'
import type { SettingsSectionRow } from './shell-contract.ts'
import { normalizeSectionOrder } from './section-order.ts'

/** Validate the durable preference and retain absent plugin identities.
 * @param input Untrusted stored configuration.
 * @returns A normalized layout, or undefined for an unsupported envelope.
 */
export function normalizeSettingsLayout(input: unknown): SettingsNavigationLayout | undefined {
  if (input === null || typeof input !== 'object' || !('version' in input) || input.version !== 1
    || !('groups' in input) || !Array.isArray(input.groups) || !('hiddenIds' in input) || !Array.isArray(input.hiddenIds)) return undefined
  const groupIds = new Set<string>()
  const sectionIds = new Set<string>()
  const groups: SettingsNavigationGroup[] = []
  const rawGroups: readonly unknown[] = input.groups
  for (const row of rawGroups) {
    if (row === null || typeof row !== 'object' || !('id' in row) || typeof row.id !== 'string' || row.id.trim() === ''
      || groupIds.has(row.id) || !('label' in row) || typeof row.label !== 'string' || !('sectionIds' in row) || !Array.isArray(row.sectionIds)) continue
    const label = row.id === 'ungrouped' ? '' : row.label.trim().slice(0, 40)
    if (row.id !== 'ungrouped' && label === '') continue
    groupIds.add(row.id)
    const ids = row.sectionIds.filter((id: unknown): id is string => typeof id === 'string' && id.trim() !== '')
      .filter((id: string) => { if (sectionIds.has(id)) return false; sectionIds.add(id); return true })
    groups.push({ id: row.id, label, sectionIds: ids,
      ...'hidden' in row && typeof row.hidden === 'boolean' ? { hidden: row.hidden } : {},
      ...'collapsed' in row && typeof row.collapsed === 'boolean' ? { collapsed: row.collapsed } : {},
    })
  }
  if (!groupIds.has('ungrouped')) groups.unshift({ id: 'ungrouped', label: '', sectionIds: [] })
  return { version: 1, groups, hiddenIds: normalizeSectionOrder(input.hiddenIds.filter((id: unknown): id is string => typeof id === 'string' && id.trim() !== '')) .slice() }
}

/** Resolve registered pages without writing migration state.
 * @param rows Current ledger rows.
 * @param stored Accepted grouped preference.
 * @param legacyOrder Previous flat order.
 * @returns Layout with newly registered pages appended to the ungrouped group.
 */
export function resolveSettingsLayout(
  rows: readonly SettingsSectionRow[], stored: SettingsNavigationLayout | undefined, legacyOrder: readonly string[],
): SettingsNavigationLayout {
  const layout = normalizeSettingsLayout(stored) ?? { version: 1, groups: [{ id: 'ungrouped', label: '', sectionIds: [...normalizeSectionOrder(legacyOrder)] }], hiddenIds: [] }
  const known = new Set(layout.groups.flatMap(group => group.sectionIds))
  const fresh = rows.filter(row => !known.has(row.id)).map(row => row.id)
  return { ...layout, groups: layout.groups.map(group => group.id === 'ungrouped' ? { ...group, sectionIds: [...group.sectionIds, ...fresh] } : group) }
}

/** Project visible groups with current localized labels.
 * @param rows Registered sections.
 * @param layout Resolved preference.
 * @returns Visible groups, including empty drop targets.
 */
export function visibleSettingsGroups(
  rows: readonly SettingsSectionRow[], layout: SettingsNavigationLayout,
): { id: string; label: string; collapsed: boolean; rows: SettingsSectionRow[] }[] {
  const byId = new Map(rows.map(row => [row.id, row]))
  const hidden = new Set(layout.hiddenIds)
  return layout.groups.filter(group => !group.hidden).map(group => ({
    id: group.id, label: group.label,
    collapsed: group.collapsed ?? false,
    rows: group.sectionIds.flatMap(id => hidden.has(id) ? [] : byId.get(id) ?? []),
  }))
}

/** Update group visibility or expansion without changing its members.
 * @param layout Current navigation.
 * @param id Group identity.
 * @param state Desired presentation fields.
 * @returns Updated preference.
 */
export function setLayoutGroupState(
  layout: SettingsNavigationLayout, id: string, state: { hidden?: boolean; collapsed?: boolean },
): SettingsNavigationLayout {
  return { ...layout, groups: layout.groups.map(group => group.id === id ? { ...group, ...state } : group) }
}

/** Move one page, preserving hidden state and absent plugin ids.
 * @param layout Current preference.
 * @param sectionId Page to move.
 * @param targetGroupId Destination group.
 * @param targetIndex Insertion index after removing the source.
 * @returns Detached updated preference.
 */
export function moveLayoutSection(
  layout: SettingsNavigationLayout, sectionId: string, targetGroupId: string, targetIndex: number,
): SettingsNavigationLayout {
  if (!layout.groups.some(group => group.id === targetGroupId)
    || !layout.groups.some(group => group.sectionIds.includes(sectionId))) return layout
  return { ...layout, groups: layout.groups.map((group) => {
    const sectionIds = group.sectionIds.filter(id => id !== sectionId)
    if (group.id === targetGroupId) sectionIds.splice(Math.max(0, Math.min(sectionIds.length, targetIndex)), 0, sectionId)
    return { ...group, sectionIds }
  }) }
}

/** Reorder groups without changing their membership.
 * @param layout Current preference.
 * @param groupId Group to move.
 * @param targetIndex Destination index after removal.
 * @returns Updated preference.
 */
export function moveLayoutGroup(layout: SettingsNavigationLayout, groupId: string, targetIndex: number): SettingsNavigationLayout {
  const group = layout.groups.find(item => item.id === groupId)
  if (group === undefined) return layout
  const groups = layout.groups.filter(item => item.id !== groupId)
  groups.splice(Math.max(0, Math.min(groups.length, targetIndex)), 0, group)
  return { ...layout, groups }
}

/** Rename a custom group.
 * @param layout Current preference.
 * @param id Group identity.
 * @param label User-authored group name.
 * @returns Updated preference; blank names and ungrouped are unchanged.
 */
export function renameLayoutGroup(layout: SettingsNavigationLayout, id: string, label: string): SettingsNavigationLayout {
  const name = label.trim().slice(0, 40)
  if (id === 'ungrouped' || name === '') return layout
  return { ...layout, groups: layout.groups.map(group => group.id === id ? { ...group, label: name } : group) }
}

/** Remove a group and retain every member in the ungrouped group.
 * @param layout Current preference.
 * @param id Custom group to remove.
 * @returns Updated preference.
 */
export function removeLayoutGroup(layout: SettingsNavigationLayout, id: string): SettingsNavigationLayout {
  if (id === 'ungrouped') return layout
  const removed = layout.groups.find(group => group.id === id)
  if (removed === undefined) return layout
  return { ...layout, groups: layout.groups.filter(group => group.id !== id).map(group => group.id === 'ungrouped' ? { ...group, sectionIds: [...group.sectionIds, ...removed.sectionIds] } : group) }
}

/** Add a uniquely identified custom group.
 * @param layout Current preference.
 * @param id Caller-generated group id.
 * @param label User-authored name.
 * @returns Updated preference.
 */
export function addLayoutGroup(layout: SettingsNavigationLayout, id: string, label: string): SettingsNavigationLayout {
  if (id.trim() === '' || label.trim() === '' || layout.groups.some(group => group.id === id)) return layout
  return { ...layout, groups: [...layout.groups, { id, label: label.trim().slice(0, 40), sectionIds: [] }] }
}

/** Change navigation visibility, never feature activation.
 * @param layout Current preference.
 * @param id Section identity.
 * @param hidden Desired hidden state.
 * @returns Updated preference.
 */
export function setLayoutSectionHidden(layout: SettingsNavigationLayout, id: string, hidden: boolean): SettingsNavigationLayout {
  return { ...layout, hiddenIds: [...layout.hiddenIds.filter(value => value !== id), ...hidden ? [id] : []] }
}

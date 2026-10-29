import { expect, it } from 'vitest'
import { addLayoutGroup, moveLayoutGroup, moveLayoutSection, normalizeSettingsLayout, removeLayoutGroup, renameLayoutGroup, resolveSettingsLayout, setLayoutSectionHidden, visibleSettingsGroups } from '../src/client/section-layout.ts'

const rows = ['general', 'models', 'plugins'].map((id, order) => ({ id, order, label: id }))

it('inherits legacy order without writing and appends new pages', () => {
  const legacy = ['models', 'missing', 'general']
  const layout = resolveSettingsLayout(rows, undefined, legacy)
  expect(layout.groups[0]?.sectionIds).toEqual(['models', 'missing', 'general', 'plugins'])
  expect(legacy).toEqual(['models', 'missing', 'general'])
})

it('normalizes untrusted persisted values while preserving absent page identities', () => {
  expect(normalizeSettingsLayout({ version: 2 })).toBeUndefined()
  expect(normalizeSettingsLayout({ version: 1, groups: [null, { id: 'a', label: ' A ', sectionIds: ['models', 'models', 7, 'missing'] }, { id: 'a', label: 'dup', sectionIds: ['general'] }, { id: 'b', label: ' ', sectionIds: [] }], hiddenIds: ['missing', 8, 'missing'] }))
    .toEqual({ version: 1, groups: [{ id: 'ungrouped', label: '', sectionIds: [] }, { id: 'a', label: 'A', sectionIds: ['models', 'missing'] }], hiddenIds: ['missing'] })
})

it('moves pages within and across groups without losing absent or hidden pages', () => {
  const initial = resolveSettingsLayout(rows, undefined, ['missing'])
  const group = addLayoutGroup(initial, 'work', 'Work')
  const moved = moveLayoutSection(group, 'models', 'work', 0)
  expect(moved.groups[1]?.sectionIds).toEqual(['models'])
  expect(initial.groups[0]?.sectionIds).toContain('models')
  const reordered = moveLayoutSection(moved, 'plugins', 'ungrouped', 0)
  expect(reordered.groups[0]?.sectionIds).toEqual(['plugins', 'missing', 'general'])
  expect(moveLayoutSection(moved, 'absent', 'work', 0)).toBe(moved)
})

it('renames and reorders groups and returns deleted members to ungrouped', () => {
  const initial = resolveSettingsLayout(rows, undefined, [])
  const grouped = moveLayoutSection(addLayoutGroup(initial, 'work', 'Work'), 'models', 'work', 0)
  expect(renameLayoutGroup(grouped, 'work', '  Models  ').groups[1]?.label).toBe('Models')
  expect(renameLayoutGroup(grouped, 'work', ' ')).toBe(grouped)
  expect(renameLayoutGroup(grouped, 'ungrouped', 'x')).toBe(grouped)
  expect(moveLayoutGroup(grouped, 'work', 0).groups[0]?.id).toBe('work')
  expect(removeLayoutGroup(grouped, 'work').groups[0]?.sectionIds).toEqual(['general', 'plugins', 'models'])
  expect(removeLayoutGroup(grouped, 'ungrouped')).toBe(grouped)
})

it('hides every page without changing layout membership and restores them', () => {
  const initial = resolveSettingsLayout(rows, undefined, [])
  const hidden = rows.reduce((layout, row) => setLayoutSectionHidden(layout, row.id, true), initial)
  expect(visibleSettingsGroups(rows, hidden)[0]?.rows).toEqual([])
  expect(hidden.groups).toBe(initial.groups)
  expect(visibleSettingsGroups(rows, setLayoutSectionHidden(hidden, 'models', false))[0]?.rows.map(row => row.id)).toEqual(['models'])
})

it('restores a reinstalled page to its saved group and uses its current label', () => {
  const initial = moveLayoutSection(addLayoutGroup(resolveSettingsLayout(rows, undefined, []), 'work', 'Work'), 'models', 'work', 0)
  const absent = resolveSettingsLayout(rows.filter(row => row.id !== 'models'), initial, [])
  const restored = resolveSettingsLayout(rows.map(row => ({ ...row, label: `localized ${row.id}` })), absent, [])
  expect(visibleSettingsGroups(rows.map(row => ({ ...row, label: `localized ${row.id}` })), restored)[1]?.rows[0]?.label).toBe('localized models')
})

it('handles empty groups and no-op moves without dropping pages', () => {
  const initial = resolveSettingsLayout(rows, undefined, [])
  const empty = addLayoutGroup(initial, 'empty', 'Empty')
  expect(visibleSettingsGroups(rows, empty)).toHaveLength(2)
  expect(removeLayoutGroup(empty, 'empty')).toEqual(initial)
  expect(addLayoutGroup(empty, 'empty', 'Duplicate')).toBe(empty)
  expect(addLayoutGroup(empty, 'bad', ' ')).toBe(empty)
  expect(moveLayoutGroup(empty, 'empty', 1)).toEqual(empty)
  expect(moveLayoutGroup(empty, 'missing', 0)).toBe(empty)
  expect(moveLayoutSection(initial, 'general', 'ungrouped', 0)).toEqual(initial)
  expect(moveLayoutSection(initial, 'general', 'missing', 0)).toBe(initial)
})

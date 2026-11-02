import { expect, it } from 'vitest'
import { addLayoutGroup, moveLayoutGroup, moveLayoutSection, normalizeSettingsLayout, removeLayoutGroup, renameLayoutGroup, resolveSettingsLayout, setLayoutSectionHidden, visibleSettingsNodes } from '../src/client/section-layout.ts'
const rows = ['general', 'models', 'plugins'].map((id, order) => ({ id, order, label: id }))
const initial = () => resolveSettingsLayout(rows, undefined, ['missing'])
it('inherits legacy order, retains missing plugins and appends new standalone pages', () => {
  expect(initial().nodes.map(node => node.id)).toEqual(['missing', 'general', 'models', 'plugins'])
})
it('migrates at the original ungrouped position without mutating source or losing collapsed members', () => {
  const source = { version: 1, groups: [{ id: 'work', label: 'Work', sectionIds: ['plugins'], collapsed: true }, { id: 'ungrouped', label: '', sectionIds: ['models', 'missing'], collapsed: true, hidden: true }], hiddenIds: ['general'] }
  const before = JSON.stringify(source)
  const migrated = normalizeSettingsLayout(source)!
  expect(migrated).toEqual({ version: 2, nodes: [{ kind: 'group', id: 'work', label: 'Work', sectionIds: ['plugins'], collapsed: true }, { kind: 'section', id: 'models' }, { kind: 'section', id: 'missing' }], hiddenIds: ['general', 'models', 'missing'] })
  expect(normalizeSettingsLayout(migrated)).toEqual(migrated)
  expect(JSON.stringify(source)).toBe(before)
})
it('rejects unsupported envelopes and normalizes duplicate and invalid identities', () => {
  expect(normalizeSettingsLayout({ version: 3, nodes: [], hiddenIds: [] })).toBeUndefined()
  expect(normalizeSettingsLayout({ version: 2, nodes: [null, { kind: 'section', id: 'models' }, { kind: 'group', id: 'a', label: ' A ', sectionIds: ['models', 'missing', 7] }], hiddenIds: [7, 'missing', 'missing'] }))
    .toEqual({ version: 2, nodes: [{ kind: 'section', id: 'models' }, { kind: 'group', id: 'a', label: 'A', sectionIds: ['missing'] }], hiddenIds: ['missing'] })
})
it('moves standalone entries into groups, inserts at the front and unwraps at the same position', () => {
  const grouped = moveLayoutSection(addLayoutGroup(initial(), 'work', 'Work'), 'models', 'work', 0)
  const next = moveLayoutSection(grouped, 'general', 'work', 0)
  expect(next.nodes.at(-1)).toMatchObject({ sectionIds: ['general', 'models'] })
  const reordered = moveLayoutGroup(next, 'work', 1)
  expect(reordered.nodes.map(node => node.id)).toEqual(['missing', 'work', 'plugins'])
  const unwrapped = removeLayoutGroup(reordered, 'work')
  expect(unwrapped.nodes.map(node => node.id)).toEqual(['missing', 'general', 'models', 'plugins'])
  expect(grouped.nodes.at(-1)).toMatchObject({ sectionIds: ['models'] })
})
it('moves group members into arbitrary standalone positions without changing hidden state', () => {
  const grouped = moveLayoutSection(addLayoutGroup(initial(), 'work', 'Work'), 'models', 'work', 0)
  const moved = moveLayoutSection(setLayoutSectionHidden(grouped, 'models', true), 'models', undefined, 1)
  expect(moved.nodes.map(node => node.id)).toEqual(['missing', 'models', 'general', 'plugins', 'work'])
  expect(moved.hiddenIds).toEqual(['models'])
  expect(visibleSettingsNodes(rows, moved).map(node => node.id)).toEqual(['general', 'plugins', 'work'])
})
it('preserves group membership when a plugin disappears and returns with its localized name', () => {
  const grouped = moveLayoutSection(addLayoutGroup(initial(), 'work', 'Work'), 'models', 'work', 0)
  const absent = resolveSettingsLayout(rows.filter(row => row.id !== 'models'), grouped, [])
  const localized = rows.map(row => ({ ...row, label: `localized ${row.id}` }))
  const group = visibleSettingsNodes(localized, resolveSettingsLayout(localized, absent, [])).at(-1)
  expect(group?.kind === 'group' && group.rows[0]?.label).toBe('localized models')
})
it('retains empty groups and rejects invalid destination and duplicate group creation', () => {
  const layout = addLayoutGroup(initial(), 'work', 'Work')
  expect(visibleSettingsNodes(rows, layout).at(-1)).toMatchObject({ kind: 'group', rows: [] })
  expect(addLayoutGroup(layout, 'work', 'Duplicate')).toBe(layout)
  expect(moveLayoutSection(layout, 'models', 'absent', 0)).toBe(layout)
  expect(renameLayoutGroup(layout, 'work', ' Models ').nodes.at(-1)).toMatchObject({ label: 'Models' })
})

import { describe, expect, it } from 'vitest'
import {
  moveSettingsSection, moveSettingsSectionToIndex, normalizeSectionOrder, orderSettingsSections,
  settingsSectionAutoScroll, settingsSectionRowShift, settingsSectionTargetIndex,
} from '../src/client/section-order.ts'

const rows = [
  { id: 'general', order: 0, label: 'General' },
  { id: 'models', order: 10, label: 'Models' },
  { id: 'plugins', order: 20, label: 'Plugins' },
]

describe('settings section order', () => {
  it('deduplicates durable ids and ignores empty values', () => {
    expect(normalizeSectionOrder(['models', '', 'models', 'general'])).toEqual(['models', 'general'])
  })

  it('applies known ids and appends newly registered plugin sections canonically', () => {
    expect(orderSettingsSections(rows, ['models', 'general']).map(row => row.id)).toEqual([
      'models', 'general', 'plugins',
    ])
  })

  it('inserts the new orb page after tools without rearranging a saved navigation order', () => {
    const extended = [
      { id: 'agent-presets', order: 20, label: 'Presets' },
      { id: 'orb', order: 19, label: 'Orb' },
      { id: 'external-tools', order: 18, label: 'Tools' },
      ...rows,
    ].sort((a, b) => a.order - b.order)
    expect(orderSettingsSections(extended, ['models', 'external-tools', 'general', 'agent-presets']).map(row => row.id)).toEqual([
      'models', 'external-tools', 'orb', 'general', 'agent-presets', 'plugins',
    ])
  })

  it('moves visible ids while retaining absent plugin ids for a later reinstall', () => {
    expect(moveSettingsSection(
      ['general', 'models', 'plugins'],
      ['general', 'removed-plugin', 'models', 'plugins'],
      'plugins',
      'general',
      'before',
    )).toEqual(['plugins', 'general', 'models', 'removed-plugin'])
  })

  it('resolves the first and last insertion slots from row centers', () => {
    const boxes = [
      { id: 'general', top: 0, bottom: 40, height: 40 },
      { id: 'models', top: 44, bottom: 84, height: 40 },
      { id: 'plugins', top: 88, bottom: 128, height: 40 },
    ]
    expect(settingsSectionTargetIndex(boxes, 1, -10)).toBe(0)
    expect(settingsSectionTargetIndex(boxes, 1, 150)).toBe(2)
    expect(settingsSectionRowShift(boxes, 1, 0, 0)).toBe(44)
    expect(settingsSectionRowShift(boxes, 1, 2, 2)).toBe(-44)
  })

  it('moves to a measured insertion index and retains temporarily absent plugin ids', () => {
    expect(moveSettingsSectionToIndex(
      ['general', 'models', 'plugins'],
      ['general', 'removed-plugin', 'models', 'plugins'],
      'models',
      2,
    )).toEqual(['general', 'plugins', 'models', 'removed-plugin'])
  })

  it('scrolls only near a navigation edge and ignores pointers outside it', () => {
    expect(settingsSectionAutoScroll(105, 100, 300)).toBeLessThan(0)
    expect(settingsSectionAutoScroll(295, 100, 300)).toBeGreaterThan(0)
    expect(settingsSectionAutoScroll(200, 100, 300)).toBe(0)
    expect(settingsSectionAutoScroll(80, 100, 300)).toBe(0)
  })
})

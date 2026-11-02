// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useNavigationLayout } from '../src/client/use-navigation-layout.ts'
import { addLayoutGroup, moveLayoutSection, resolveSettingsLayout, setLayoutSectionHidden, setLayoutGroupState, visibleSettingsGroups, normalizeSettingsLayout } from '../src/client/section-layout.ts'

afterEach(cleanup)
const initial = moveLayoutSection(addLayoutGroup(resolveSettingsLayout([{ id: 'models', label: 'Models', order: 0 }], undefined, []), 'work', 'Work'), 'models', 'work', 0)

it('persists ordered edits and ignores stale Profile echoes during a save', async () => {
  let release: (() => void) | undefined
  const save = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve })).mockResolvedValue(undefined)
  const { result, rerender } = renderHook(({ source }) => useNavigationLayout(source, save), { initialProps: { source: initial } })
  act(() => {
    result.current.mutate(layout => setLayoutSectionHidden(layout, 'models', true))
    result.current.mutate(layout => setLayoutGroupState(layout, 'work', { collapsed: true }))
  })
  expect(save).toHaveBeenCalledTimes(1)
  rerender({ source: { ...initial } })
  rerender({ source: setLayoutSectionHidden(initial, 'models', true) })
  expect(result.current.layout.hiddenIds).toEqual(['models'])
  expect(result.current.layout.nodes[0]?.kind === 'group' && result.current.layout.nodes[0].collapsed).toBe(true)
  act(() => { release?.() })
  await waitFor(() => { expect(result.current.saving).toBe(false) })
  expect(save).toHaveBeenCalledTimes(2)
  expect(save.mock.calls[1]?.[0]).toMatchObject({ hiddenIds: ['models'], nodes: [{ collapsed: true }] })
})

it('does not start queued writes after the settings panel unmounts', async () => {
  let release: (() => void) | undefined
  const save = vi.fn(() => new Promise<void>((resolve) => { release = resolve }))
  const { result, unmount } = renderHook(() => useNavigationLayout(initial, save))
  act(() => {
    result.current.mutate(layout => setLayoutSectionHidden(layout, 'models', true))
    result.current.mutate(layout => setLayoutGroupState(layout, 'work', { collapsed: true }))
  })
  unmount()
  await act(async () => { release?.(); await Promise.resolve() })
  expect(save).toHaveBeenCalledTimes(1)
})

it('rolls back failed edits and discards dependent queued writes', async () => {
  let rejectSave: ((error: Error) => void) | undefined
  const save = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectSave = reject }))
  const { result } = renderHook(() => useNavigationLayout(initial, save))
  act(() => {
    result.current.mutate(layout => setLayoutSectionHidden(layout, 'models', true))
    result.current.mutate(layout => setLayoutGroupState(layout, 'work', { collapsed: true }))
    rejectSave?.(new Error('failed'))
  })
  await waitFor(() => { expect(result.current.failed).toBe(true) })
  expect(result.current.layout).toEqual(initial)
  expect(save).toHaveBeenCalledTimes(1)
})

it('retains group membership and individual hidden state through group hiding and collapse', () => {
  const hidden = setLayoutGroupState(setLayoutSectionHidden(initial, 'models', true), 'work', { hidden: true, collapsed: true })
  expect(visibleSettingsGroups([], hidden)).toEqual([])
  const restored = normalizeSettingsLayout(setLayoutGroupState(hidden, 'work', { hidden: false }))
  expect(restored?.nodes[0]).toMatchObject({ collapsed: true, sectionIds: ['models'] })
  expect(restored?.hiddenIds).toEqual(['models'])
  expect(visibleSettingsGroups([], restored ?? initial)).toHaveLength(1)
})

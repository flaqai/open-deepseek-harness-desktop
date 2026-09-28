// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { OrbSettingsSection, type OrbSettingsSectionProps } from '../src/client/OrbSettingsSection.tsx'
import type { OrbRuntimeStatus, OrbSettingsView } from '../src/client/orb-bridge.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const settings = {
  visible: true, showAtStartup: true, selectionToolbar: false, backend: 'official-native',
  avatar: 'deepseek', anchor: 'right',
} as const

const ready: OrbRuntimeStatus = {
  mode: 'local',
  backendAvailability: { orb: 'unsupported', 'official-native': 'ready', 'official-mcp': 'not-installed' },
  permission: { screen: 'unknown', accessibility: 'denied' },
  activeTasks: 0, taskInspection: 'known', pendingRestart: false,
  selectionAvailable: true, backgroundAvailable: true,
}

function mount(view: OrbSettingsView, canSelectBackend = true) {
  const update = vi.fn(async () => {})
  const selectBackend = vi.fn(async () => {})
  const restart = vi.fn(async () => {})
  const openTools = vi.fn()
  const messages: Readonly<Record<string, string>> = zh
  const t = (key: string, params?: Readonly<Record<string, string | number>>) => {
    const raw = messages[key] ?? key
    return Object.entries(params ?? {}).reduce((value, [name, replacement]) =>
      value.replaceAll(`{${name}}`, String(replacement)), raw)
  }
  const props = {
    t, useOrb: (select: (state: OrbSettingsView) => unknown) => select(view),
    update, selectBackend, canSelectBackend, restart, canRestart: true, openTools, reload: vi.fn(), close: vi.fn(),
  } as unknown as OrbSettingsSectionProps
  render(<OrbSettingsSection {...props} />)
  return { update, selectBackend, restart, openTools }
}

it('shows only observed capabilities and preserves the normal approval warning', () => {
  const actions = mount({ phase: 'ready', settings, status: ready })
  expect(screen.getByText(zh.backgroundHint)).toBeTruthy()
  expect(screen.getByText('运行中的任务：0')).toBeTruthy()
  expect(screen.getByText(zh.permissionDenied)).toBeTruthy()
  const backend = screen.getByRole('combobox', { name: zh.backend }) as HTMLSelectElement
  expect(backend.disabled).toBe(false)
  expect((screen.getByRole('option', { name: zh.orbBackend }) as HTMLOptionElement).disabled).toBe(true)
  expect((screen.getByRole('option', { name: zh.officialMcp }) as HTMLOptionElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: zh.tools }))
  expect(actions.openTools).toHaveBeenCalledOnce()
})

it('does not treat failed task inspection or missing bridge methods as permission to switch', () => {
  mount({ phase: 'ready', settings, status: { ...ready, activeTasks: 0, taskInspection: 'unknown' } })
  expect((screen.getByRole('combobox', { name: zh.backend }) as HTMLSelectElement).disabled).toBe(true)
  expect(screen.getAllByText(zh.taskStatusUnknown).length).toBeGreaterThan(0)
  cleanup()
  mount({ phase: 'ready', settings, status: ready }, false)
  expect((screen.getByRole('combobox', { name: zh.backend }) as HTMLSelectElement).disabled).toBe(true)
})

it('keeps NAS remote-chat presentation available but disables local controls', () => {
  const actions = mount({ phase: 'ready', settings, status: { ...ready, mode: 'nas', selectionAvailable: false } })
  const visible = screen.getByRole('checkbox', { name: zh.visible }) as HTMLInputElement
  expect(visible.disabled).toBe(false)
  fireEvent.click(visible)
  expect(actions.update).toHaveBeenCalledWith({ visible: false })
  expect((screen.getByRole('checkbox', { name: zh.showAtStartup }) as HTMLInputElement).disabled).toBe(false)
  expect((screen.getByRole('combobox', { name: zh.avatar }) as HTMLSelectElement).disabled).toBe(false)
  expect((screen.getByRole('checkbox', { name: zh.selectionToolbar }) as HTMLInputElement).disabled).toBe(true)
  expect((screen.getByRole('combobox', { name: zh.backend }) as HTMLSelectElement).disabled).toBe(true)
  expect(screen.getByText(zh.unavailable)).toBeTruthy()
})

it('offers but does not automatically invoke quick restart after a backend change', () => {
  const actions = mount({ phase: 'ready', settings, status: { ...ready, pendingRestart: true } })
  expect(actions.restart).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: zh.restartNow }))
  expect(actions.restart).toHaveBeenCalledOnce()
})

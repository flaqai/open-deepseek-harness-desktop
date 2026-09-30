// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type {} from '../src/client/index.ts'
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

const unused = (): never => { throw new Error('OrbSettingsSection does not consume framework hooks') }
const globals: GlobalStandardProps = {
  usePanelInfo: unused, useSessions: unused, useSessionStatus: unused,
  useSessionRetainInfo: unused, useResource: unused, useWorkspaces: unused,
}

function mount(view: OrbSettingsView, canSelectBackend = true) {
  const update = vi.fn(async () => {})
  const selectBackend = vi.fn(async () => {})
  const restart = vi.fn(async () => {})
  const openTools = vi.fn()
  const props: OrbSettingsSectionProps = {
    ...globals,
    t: makeTranslate(zh), useOrb: <T,>(select: (state: OrbSettingsView) => T): T => select(view),
    update, selectBackend, canSelectBackend, restart, canRestart: true, openTools, reload: vi.fn(), close: vi.fn(),
  }
  render(<OrbSettingsSection {...props} />)
  return { update, selectBackend, restart, openTools }
}

it('shows only observed capabilities and preserves the normal approval warning', () => {
  const actions = mount({ phase: 'ready', settings, status: ready })
  expect(screen.getByText(zh.backgroundHint)).toBeTruthy()
  expect(screen.getByText(zh.automaticSelectionNeedsAccessibility)).toBeTruthy()
  expect(screen.getByText('运行中的任务：0')).toBeTruthy()
  expect(screen.getByText(zh.permissionDenied)).toBeTruthy()
  const backend = screen.getByRole('combobox', { name: zh.backend })
  expect(backend.hasAttribute('disabled')).toBe(false)
  expect(screen.getByRole('option', { name: zh.orbBackend }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('option', { name: zh.officialMcp }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: zh.tools }))
  expect(actions.openTools).toHaveBeenCalledOnce()
})

it('does not treat failed task inspection or missing bridge methods as permission to switch', () => {
  mount({ phase: 'ready', settings, status: { ...ready, activeTasks: 0, taskInspection: 'unknown' } })
  expect(screen.getByRole('combobox', { name: zh.backend }).hasAttribute('disabled')).toBe(true)
  expect(screen.getAllByText(zh.taskStatusUnknown).length).toBeGreaterThan(0)
  cleanup()
  mount({ phase: 'ready', settings, status: ready }, false)
  expect(screen.getByRole('combobox', { name: zh.backend }).hasAttribute('disabled')).toBe(true)
})

it('keeps NAS remote-chat presentation available but disables local controls', () => {
  const actions = mount({ phase: 'ready', settings, status: { ...ready, mode: 'nas', selectionAvailable: false } })
  const visible = screen.getByRole('checkbox', { name: zh.visible })
  expect(visible.hasAttribute('disabled')).toBe(false)
  fireEvent.click(visible)
  expect(actions.update).toHaveBeenCalledWith({ visible: false })
  expect(screen.getByRole('checkbox', { name: zh.showAtStartup }).hasAttribute('disabled')).toBe(false)
  expect(screen.getByRole('combobox', { name: zh.avatar }).hasAttribute('disabled')).toBe(false)
  expect(screen.getByRole('checkbox', { name: zh.selectionToolbar }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('combobox', { name: zh.backend }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByText(zh.unavailable)).toBeTruthy()
  expect(screen.queryByText(zh.automaticSelectionNeedsAccessibility)).toBeNull()
})

it('offers but does not automatically invoke quick restart after a backend change', () => {
  const actions = mount({ phase: 'ready', settings, status: { ...ready, pendingRestart: true } })
  expect(actions.restart).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: zh.restartNow }))
  expect(actions.restart).toHaveBeenCalledOnce()
})

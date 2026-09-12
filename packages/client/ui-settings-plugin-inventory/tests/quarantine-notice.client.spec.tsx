// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import {
  QuarantineNotice,
  quarantineNotice,
  type QuarantineNoticeProps,
} from '../src/client/QuarantineNotice.tsx'
import { en, type PluginInventoryLocaleKey } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

const HEALTHY = {
  entries: [],
  dependencyHealth: { lastRepair: null, quarantined: [], issues: [], diagnosticMode: null },
} as unknown as PluginInventorySnapshot

const QUARANTINED = {
  entries: [],
  dependencyHealth: {
    lastRepair: { status: 'quarantined', conflicts: [], issues: [] },
    quarantined: [{
      quarantineId: '00000000-0000-4000-8000-000000000001',
      profile: 'web',
      packageName: '@linxin666/dsh-client-ui-task-board',
      packageSpec: '^0.3.6',
      installedVersion: '0.3.6',
      quarantinedAt: '2026-08-31T08:00:00.000Z',
      reason: 'client-module-unavailable',
      conflicts: [],
    }],
    issues: [],
    diagnosticMode: null,
  },
} as unknown as PluginInventorySnapshot

const t = (key: PluginInventoryLocaleKey): string => en[key]

function props(overrides: Partial<QuarantineNoticeProps> = {}): QuarantineNoticeProps {
  return {
    list: vi.fn(async () => HEALTHY),
    dismissDependencyHealth: vi.fn(async () => true),
    openDiagnostics: vi.fn(),
    t,
    ...overrides,
  } as QuarantineNoticeProps
}

describe('QuarantineNotice', () => {
  it('projects only an unacknowledged quarantine repair into a notice', () => {
    expect(quarantineNotice(HEALTHY)).toBeNull()
    expect(quarantineNotice(QUARANTINED)).toMatchObject({
      records: [expect.objectContaining({ packageName: '@linxin666/dsh-client-ui-task-board' })],
    })
  })

  it('shows a restart-time quarantine on the first healthy client render', async () => {
    render(<QuarantineNotice {...props({ list: vi.fn(async () => QUARANTINED) })} />)

    expect(await screen.findByRole('dialog', { name: en['quarantineNotice.title'] })).toBeTruthy()
    expect(screen.getByText('@linxin666/dsh-client-ui-task-board')).toBeTruthy()
    expect(screen.getByText(en['health.quarantine.analysis.client-module-unavailable'])).toBeTruthy()
  })

  it('detects a quarantine created after installation while the client stays open', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce(HEALTHY)
      .mockResolvedValue(QUARANTINED)
    render(<QuarantineNotice {...props({ list })} />)
    await waitFor(() => { expect(list).toHaveBeenCalledOnce() })
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.focus(window)

    expect(await screen.findByRole('dialog', { name: en['quarantineNotice.title'] })).toBeTruthy()
  })

  it('acknowledges the notice without removing the durable quarantine record', async () => {
    const dismissDependencyHealth = vi.fn(async () => true)
    render(<QuarantineNotice {...props({
      list: vi.fn(async () => QUARANTINED),
      dismissDependencyHealth,
    })} />)
    fireEvent.click(await screen.findByText(en['quarantineNotice.dismiss']))

    await waitFor(() => {
      expect(dismissDependencyHealth).toHaveBeenCalledWith({ profile: 'web' })
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })

  it('acknowledges before opening the existing Diagnostics section', async () => {
    const dismissDependencyHealth = vi.fn(async () => true)
    const openDiagnostics = vi.fn()
    render(<QuarantineNotice {...props({
      list: vi.fn(async () => QUARANTINED),
      dismissDependencyHealth,
      openDiagnostics,
    })} />)
    fireEvent.click(await screen.findByRole('button', { name: en['quarantineNotice.openDiagnostics'] }))

    expect(openDiagnostics).toHaveBeenCalledOnce()
    await waitFor(() => { expect(dismissDependencyHealth).toHaveBeenCalledWith({ profile: 'web' }) })
  })

  it('restores the notice when its acknowledgement cannot be saved', async () => {
    const dismissDependencyHealth = vi.fn(async () => { throw new Error('offline') })
    render(<QuarantineNotice {...props({
      list: vi.fn(async () => QUARANTINED),
      dismissDependencyHealth,
    })} />)
    fireEvent.click(await screen.findByText(en['quarantineNotice.dismiss']))

    expect((await screen.findByRole('alert')).textContent).toBe(en['quarantineNotice.dismissFailed'])
    expect(screen.getByRole('dialog', { name: en['quarantineNotice.title'] })).toBeTruthy()
  })
})

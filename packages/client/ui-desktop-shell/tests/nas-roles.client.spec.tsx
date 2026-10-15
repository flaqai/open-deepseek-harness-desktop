// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NasRole } from '@deepseek-ai/dsh-nas-protocol'
import type { DesktopNasBridge } from '../src/client/bridge.ts'
import { NasRuntimeSection, type NasRuntimeSectionProps } from '../src/client/NasRuntimeSection.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

function mount(role: NasRole) {
  const device = { id: 'a'.repeat(32), name: 'Laptop', createdAt: '2026-10-15T00:00:00Z', expiresAt: '2027-10-15T00:00:00Z', role }
  const status = { selection: { kind: 'local' as const }, secureStorageAvailable: true,
    servers: [{ id: 'nas-1', name: 'Home NAS', baseUrl: 'https://nas.example' }] }
  const me = vi.fn(async () => device)
  const devices = vi.fn(async () => [device])
  const invite = vi.fn(async (_server: string, assigned: NasRole) => ({ code: '12345678', role: assigned, expiresAt: '2027-10-15T00:00:00Z' }))
  const bridge: DesktopNasBridge = {
    get: vi.fn(async () => status), me, discover: vi.fn(async () => []),
    inspect: vi.fn(async () => ({ fingerprint: 'AA' })), pair: vi.fn(async () => status),
    select: vi.fn(async () => ({ restarting: true as const })), remove: vi.fn(async () => status),
    test: vi.fn(async () => ({ healthy: true as const, version: 'test' })),
    devices, revokeDevice: vi.fn(async () => []), invite,
    setDeviceRole: vi.fn(async () => []), onStatus: () => () => {},
  }
  const dictionary: Readonly<Record<string, string>> = en
  const t: NasRuntimeSectionProps['t'] = (key, params) => {
    let value = dictionary[key] ?? key
    for (const [name, replacement] of Object.entries(params ?? {})) value = value.replaceAll(`{${name}}`, String(replacement))
    return value
  }
  render(<NasRuntimeSection {...({} as NasRuntimeSectionProps)} bridge={bridge} t={t} />)
  return { ...bridge, me, devices, invite }
}

describe('NAS device-role settings', () => {
  it.each(['user', 'readonly'] as const)('withholds management controls from %s devices', async (role) => {
    const bridge = mount(role)
    await screen.findByText('Home NAS')
    expect(screen.queryByRole('button', { name: en['nas.devices'] })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en['nas.role.check'] }))
    await waitFor(() => { expect(bridge.me).toHaveBeenCalledWith('nas-1') })
    await screen.findByText(`${en['nas.role']}: ${en[`nas.role.${role}`]}`)
    expect(screen.queryByRole('button', { name: en['nas.devices'] })).toBeNull()
    expect(screen.queryByRole('button', { name: en['nas.invite.create'] })).toBeNull()
    expect(bridge.devices).not.toHaveBeenCalled()
  })

  it('requires a confirmed administrator and defaults invitations to user', async () => {
    const bridge = mount('admin')
    expect(screen.queryByRole('button', { name: en['nas.invite.create'] })).toBeNull()
    const invite = await screen.findByRole('button', { name: en['nas.invite.create'] })
    expect(bridge.me).toHaveBeenCalledWith('nas-1')
    fireEvent.click(invite)
    await waitFor(() => { expect(bridge.invite).toHaveBeenCalledWith('nas-1', 'user') })
    expect(await screen.findByRole('status')).toHaveProperty('textContent', expect.stringContaining('12345678'))
  })
})

/** Electron IPC adapter for the Desktop NAS runtime authority. */

import type { IpcMain, WebContents } from 'electron'
import { DESKTOP_IPC } from './desktop-ipc-protocol.ts'
import type { DesktopNasRuntimeAuthority } from './nas-runtime-authority.ts'
import type { DesktopRuntimeSelection, NasPairingRequest, NasRuntimeStatus } from './nas-runtime.ts'
import { normalizeNasBaseUrl } from './nas-runtime.ts'
import { isNasRole, type NasRole } from '@deepseek-ai/dsh-nas-protocol'

export interface NasRuntimeIpcOptions {
  readonly authority: DesktopNasRuntimeAuthority
  readonly assertRenderer: (sender: WebContents) => void
}

function parseId(value: unknown, message: string): string {
  if (typeof value !== 'string' || value === '') throw new TypeError(message)
  return value
}

function parseDeviceId(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('desktop: invalid NAS device revocation request')
  return value
}

function parseRole(value: unknown): NasRole {
  if (!isNasRole(value)) throw new TypeError('desktop: invalid NAS role')
  return value
}

function parseSelection(raw: unknown): DesktopRuntimeSelection {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new TypeError('desktop: invalid runtime selection')
  }
  const source = raw as Record<string, unknown>
  if (source.kind === 'local') return { kind: 'local' }
  if (source.kind === 'nas' && typeof source.serverId === 'string') return { kind: 'nas', serverId: source.serverId }
  throw new TypeError('desktop: invalid runtime selection')
}

function parsePairingRequest(raw: unknown): NasPairingRequest {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new TypeError('desktop: invalid NAS pairing request')
  }
  const source = raw as Record<string, unknown>
  const allowed = new Set(['baseUrl', 'code', 'deviceName', 'certificateFingerprint'])
  if (Object.keys(source).some(key => !allowed.has(key))
    || typeof source.baseUrl !== 'string' || typeof source.code !== 'string'
    || typeof source.deviceName !== 'string' || typeof source.certificateFingerprint !== 'string') {
    throw new TypeError('desktop: invalid NAS pairing request')
  }
  return {
    baseUrl: normalizeNasBaseUrl(source.baseUrl),
    code: source.code,
    deviceName: source.deviceName,
    certificateFingerprint: source.certificateFingerprint,
  }
}

/** Register the fixed NAS IPC vocabulary; all NAS policy remains inside the authority. */
export function registerNasRuntimeIpc(ipc: IpcMain, options: NasRuntimeIpcOptions): void {
  const { authority, assertRenderer } = options
  ipc.handle(DESKTOP_IPC.nasMe, async (event, serverId: unknown) => {
    assertRenderer(event.sender)
    return authority.execute({ kind: 'me', serverId: parseId(serverId, 'desktop: invalid NAS id') })
  })
  ipc.handle(DESKTOP_IPC.nasInvite, async (event, serverId: unknown, role: unknown) => {
    assertRenderer(event.sender)
    return authority.execute({ kind: 'invite', serverId: parseId(serverId, 'desktop: invalid NAS id'), role: parseRole(role) })
  })
  ipc.handle(DESKTOP_IPC.nasSetDeviceRole, async (event, serverId: unknown, deviceId: unknown, role: unknown) => {
    assertRenderer(event.sender)
    return authority.execute({ kind: 'set-device-role', serverId: parseId(serverId, 'desktop: invalid NAS id'),
      deviceId: parseDeviceId(deviceId), role: parseRole(role) })
  })
  ipc.handle(DESKTOP_IPC.nasGet, (event): NasRuntimeStatus => {
    assertRenderer(event.sender)
    return authority.status()
  })
  ipc.handle(DESKTOP_IPC.nasDiscover, async (event) => {
    assertRenderer(event.sender)
    return authority.execute({ kind: 'discover' })
  })
  ipc.handle(DESKTOP_IPC.nasInspect, async (event, rawBaseUrl: unknown) => {
    assertRenderer(event.sender)
    if (typeof rawBaseUrl !== 'string') throw new TypeError('desktop: NAS address must be a string')
    return authority.execute({ kind: 'inspect-certificate', baseUrl: rawBaseUrl })
  })
  ipc.handle(DESKTOP_IPC.nasPair, async (event, raw: unknown): Promise<NasRuntimeStatus> => {
    assertRenderer(event.sender)
    return authority.execute({ kind: 'pair', request: parsePairingRequest(raw) })
  })
  ipc.handle(DESKTOP_IPC.nasSelect, async (event, raw: unknown): Promise<{ restarting: true }> => {
    assertRenderer(event.sender)
    return authority.execute({ kind: 'select', selection: parseSelection(raw) })
  })
  ipc.handle(DESKTOP_IPC.nasRemove, async (event, serverId: unknown): Promise<NasRuntimeStatus> => {
    assertRenderer(event.sender)
    return authority.execute({
      kind: 'remove', serverId: parseId(serverId, 'desktop: invalid NAS id'),
    })
  })
  ipc.handle(DESKTOP_IPC.nasTest, async (event, serverId: unknown) => {
    assertRenderer(event.sender)
    return authority.execute({
      kind: 'test', serverId: parseId(serverId, 'desktop: invalid NAS id'),
    })
  })
  ipc.handle(DESKTOP_IPC.nasDevices, async (event, serverId: unknown) => {
    assertRenderer(event.sender)
    return authority.execute({
      kind: 'list-devices', serverId: parseId(serverId, 'desktop: invalid NAS id'),
    })
  })
  ipc.handle(DESKTOP_IPC.nasRevokeDevice, async (event, serverId: unknown, deviceId: unknown) => {
    assertRenderer(event.sender)
    return authority.execute({
      kind: 'revoke-device',
      serverId: parseId(serverId, 'desktop: invalid NAS device revocation request'),
      deviceId: parseDeviceId(deviceId),
    })
  })
}

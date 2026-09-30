import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ipcMain, type WebContents } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DESKTOP_IPC } from '../src/desktop-ipc-protocol.ts'
import { DesktopNasRuntimeAuthority } from '../src/nas-runtime-authority.ts'
import { NasRuntimeStore } from '../src/nas-runtime.ts'
import { registerNasRuntimeIpc } from '../src/nas-runtime-ipc.ts'

type Handler = (event: { sender: WebContents }, ...args: unknown[]) => unknown
const electron = vi.hoisted(() => ({ handlers: new Map<string, Handler>() }))
vi.mock('electron', () => ({ ipcMain: {
  handle: (channel: string, handler: Handler) => { electron.handlers.set(channel, handler) },
} }))
const roots: string[] = []
afterEach(() => {
  electron.handlers.clear()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function bench() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-nas-ipc-'))
  roots.push(root)
  const store = new NasRuntimeStore(join(root, 'runtimes.json'), join(root, 'secrets.json'), {
    available: true,
    seal: value => Buffer.from(value).toString('base64'),
    open: value => Buffer.from(value, 'base64').toString('utf8'),
  })
  const authority = new DesktopNasRuntimeAuthority({
    store,
    network: {
      discover: async () => [], inspectCertificate: async () => 'AA'.repeat(32),
      health: async () => { throw new Error('unexpected health request') },
      pair: async () => { throw new Error('unexpected pairing request') },
      devices: async () => [], revokeDevice: async () => [],
    },
    connection: {
      capture: () => undefined, begin: () => {}, ready: () => {}, fail: async () => {},
    },
    lifecycle: { stopActiveProfileServices: async () => {}, restartAfter: () => {} },
    publishStatus: () => {},
  })
  const execute = vi.spyOn(authority, 'execute')
  const assertRenderer = vi.fn()
  registerNasRuntimeIpc(ipcMain, { authority, assertRenderer })
  const sender = {} as WebContents
  const invoke = (channel: string, ...args: unknown[]): unknown => {
    const handler = electron.handlers.get(channel)
    if (handler === undefined) throw new Error(`Missing handler for ${channel}`)
    return handler({ sender }, ...args)
  }
  return { handlers: electron.handlers, execute, assertRenderer, sender, invoke }
}

describe('NAS runtime IPC adapter', () => {
  it('registers the fixed channel vocabulary and maps validated selections to the authority', async () => {
    const b = bench()
    expect([...b.handlers.keys()]).toEqual([
      DESKTOP_IPC.nasGet, DESKTOP_IPC.nasDiscover, DESKTOP_IPC.nasInspect, DESKTOP_IPC.nasPair,
      DESKTOP_IPC.nasSelect, DESKTOP_IPC.nasRemove, DESKTOP_IPC.nasTest, DESKTOP_IPC.nasDevices,
      DESKTOP_IPC.nasRevokeDevice,
    ])
    await expect(b.invoke(DESKTOP_IPC.nasSelect, { kind: 'local' })).resolves.toEqual({ restarting: true })
    expect(b.execute).toHaveBeenCalledWith({ kind: 'select', selection: { kind: 'local' } })
    expect(b.assertRenderer).toHaveBeenCalledWith(b.sender)
  })

  it('rejects unknown pairing fields before they reach the authority', async () => {
    const b = bench()
    await expect(b.invoke(DESKTOP_IPC.nasPair, {
      baseUrl: 'https://nas.example.com', code: '12345678', deviceName: 'Mac mini',
      certificateFingerprint: 'AA'.repeat(32), unexpected: true,
    })).rejects.toThrow(/invalid NAS pairing request/)
    expect(b.execute).not.toHaveBeenCalled()
  })
})

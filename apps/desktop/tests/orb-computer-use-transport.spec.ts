import { describe, expect, it, vi } from 'vitest'
import { request as httpRequest } from 'node:http'
import { startOrbComputerUseTransport } from '../src/orb-computer-use-transport.ts'
import type { OrbComputerUseBackend, OrbComputerUseObservation } from '../src/orb-computer-use-backend.ts'
import { createDesktopOrbHttpBackend } from '../../desktop-host/src/orb-computer-use-client.ts'

const SECRET = 'A'.repeat(43)
const FRAME: OrbComputerUseObservation = {
  frameId: 1,
  frame: {
    data: Uint8Array.from([137, 80, 78, 71]), mediaType: 'image/png',
    bounds: { x: 10, y: 20, width: 100, height: 80 }, windowId: '42', appName: 'Editor',
  },
}

function fixture() {
  const observe = vi.fn(async () => FRAME)
  const act = vi.fn(async () => ({ ...FRAME, frameId: 2 }))
  const close = vi.fn(async () => {})
  const backend: OrbComputerUseBackend = { observe, act, close }
  return { backend, observe, act, close }
}

describe('private Orb native transport', () => {
  it('requires the generation secret and exact authority before calling native code', async () => {
    const f = fixture()
    const transport = await startOrbComputerUseTransport({ secret: () => SECRET, openBackend: async () => f.backend })
    try {
      const url = `${transport.origin}/orb-computer-use/v1`
      const missing = await fetch(url, { method: 'POST', body: JSON.stringify({ operation: 'observe' }), headers: { 'Content-Type': 'application/json' } })
      expect(missing.status).toBe(403)
      const wrongHost = await new Promise<number>((resolve, reject) => {
        const request = httpRequest(url, { method: 'POST', headers: {
          'Content-Type': 'application/json', 'x-dsh-desktop-orb-secret': SECRET, Host: 'localhost:80',
        } }, (response) => { response.resume(); resolve(response.statusCode ?? 0) })
        request.on('error', reject)
        request.end(JSON.stringify({ operation: 'observe' }))
      })
      expect(wrongHost).toBe(403)
      const browserOrigin = await fetch(url, { method: 'POST', body: JSON.stringify({ operation: 'observe' }), headers: {
        'Content-Type': 'application/json', 'x-dsh-desktop-orb-secret': SECRET, Origin: 'http://evil.example',
      } })
      expect(browserOrigin.status).toBe(403)
      expect(f.observe).not.toHaveBeenCalled()
    } finally { await transport.close() }
    expect(f.close).not.toHaveBeenCalled()
  })

  it('forwards only bounded operations and aborts active requests on teardown', async () => {
    const f = fixture()
    const observed = vi.fn()
    const transport = await startOrbComputerUseTransport({
      secret: () => SECRET, openBackend: async () => f.backend, onObservation: observed,
    })
    const url = `${transport.origin}/orb-computer-use/v1`
    const request = (body: object) => fetch(url, { method: 'POST', headers: {
      'Content-Type': 'application/json', 'x-dsh-desktop-orb-secret': SECRET,
    }, body: JSON.stringify(body) })
    try {
      const response = await request({ operation: 'observe' })
      expect(response.status).toBe(200)
      const observation = await response.json() as { frame: { data: string } }
      expect(observation.frame.data).toBe(Buffer.from(FRAME.frame.data).toString('base64'))
      expect(observed).toHaveBeenCalledOnce()
      const invalid = await request({ operation: 'act', frameId: 1, action: { kind: 'click', position: [1001, 0], button: 'left', count: 1 } })
      expect(invalid.status).toBe(400)
      expect(f.act).not.toHaveBeenCalled()
      const acted = await request({ operation: 'act', frameId: 1, action: { kind: 'click', position: [500, 500], button: 'left', count: 1 } })
      expect(acted.status).toBe(200)
      expect(f.act).toHaveBeenCalledOnce()
    } finally { await transport.close() }
  })

  it('connects the Host client to Desktop without a renderer channel', async () => {
    const f = fixture()
    const transport = await startOrbComputerUseTransport({ secret: () => SECRET, openBackend: async () => f.backend })
    const release = vi.fn(async () => {})
    const client = await createDesktopOrbHttpBackend({ origin: transport.origin, secret: SECRET }, async () => release)
    try {
      expect((await client.observe()).frame.windowId).toBe('42')
      expect((await client.act(1, { kind: 'click', position: [500, 500], button: 'left', count: 1 })).frameId).toBe(2)
      expect(f.act).toHaveBeenCalledOnce()
    } finally {
      await client.close()
      await transport.close()
    }
    expect(release).toHaveBeenCalledOnce()
  })

  it('aborts an in-flight native observation before closing its backend', async () => {
    const f = fixture()
    let started: (() => void) | undefined
    const entered = new Promise<void>((resolve) => { started = resolve })
    const aborted = vi.fn()
    f.backend.observe = async (signal) => {
      started?.()
      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener('abort', () => { aborted(); reject(new Error('aborted')) }, { once: true })
      })
      return FRAME
    }
    const transport = await startOrbComputerUseTransport({ secret: () => SECRET, openBackend: async () => f.backend })
    const pending = fetch(`${transport.origin}/orb-computer-use/v1`, { method: 'POST', headers: {
      'Content-Type': 'application/json', 'x-dsh-desktop-orb-secret': SECRET,
    }, body: JSON.stringify({ operation: 'observe' }) }).catch(() => undefined)
    await entered
    await transport.close()
    await pending
    expect(aborted).toHaveBeenCalledOnce()
    expect(f.close).toHaveBeenCalledOnce()
  })

  it('revokes the old token and backend before opening the next Host generation', async () => {
    let secret: string | undefined = SECRET
    const old = fixture()
    const next = fixture()
    const openBackend = vi.fn().mockResolvedValueOnce(old.backend).mockResolvedValueOnce(next.backend)
    const transport = await startOrbComputerUseTransport({ secret: () => secret, openBackend })
    const request = (token: string) => fetch(`${transport.origin}/orb-computer-use/v1`, { method: 'POST', headers: {
      'Content-Type': 'application/json', 'x-dsh-desktop-orb-secret': token,
    }, body: JSON.stringify({ operation: 'observe' }) })
    try {
      expect((await request(SECRET)).status).toBe(200)
      secret = 'B'.repeat(43)
      transport.invalidateGeneration()
      expect((await request(SECRET)).status).toBe(403)
      expect((await request(secret)).status).toBe(200)
      expect(old.close).toHaveBeenCalledOnce()
      expect(next.observe).toHaveBeenCalledOnce()
    } finally { await transport.close() }
    expect(next.close).toHaveBeenCalledOnce()
  })
})

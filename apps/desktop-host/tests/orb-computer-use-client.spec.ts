import { describe, expect, it, vi } from 'vitest'
import { consumeDesktopOrbEndpoint, createDesktopOrbHttpBackend } from '../src/orb-computer-use-client.ts'

const endpoint = { origin: 'http://127.0.0.1:12345', secret: 'A'.repeat(43) }
const frame = {
  frameId: 1,
  frame: { data: Buffer.from([137, 80, 78, 71]).toString('base64'), mediaType: 'image/png',
    bounds: { x: 0, y: 0, width: 100, height: 100 }, windowId: '42', appName: 'Editor' },
}

describe('Host Orb native client', () => {
  it('consumes launch-only authority and rejects non-loopback endpoints', () => {
    const environment = { DSH_DESKTOP_ORB_NATIVE_ORIGIN: endpoint.origin, DSH_DESKTOP_ORB_NATIVE_SECRET: endpoint.secret }
    expect(consumeDesktopOrbEndpoint(environment)).toEqual(endpoint)
    expect(environment).not.toHaveProperty('DSH_DESKTOP_ORB_NATIVE_SECRET')
    expect(environment).not.toHaveProperty('DSH_DESKTOP_ORB_NATIVE_ORIGIN')
    expect(() => consumeDesktopOrbEndpoint({ DSH_DESKTOP_ORB_NATIVE_ORIGIN: 'http://localhost:12345', DSH_DESKTOP_ORB_NATIVE_SECRET: endpoint.secret })).toThrow('invalid Desktop endpoint')
    expect(() => consumeDesktopOrbEndpoint({ DSH_DESKTOP_ORB_NATIVE_ORIGIN: endpoint.origin })).toThrow('incomplete Desktop endpoint')
  })

  it('reserves before transport use and decodes one bounded screenshot', async () => {
    const release = vi.fn(async () => {})
    const acquire = vi.fn(async () => release)
    const fetcher = vi.fn(async () => Response.json(frame))
    const backend = await createDesktopOrbHttpBackend(endpoint, acquire, fetcher)
    try {
      const result = await backend.observe()
      expect(result.frame.data).toEqual(Buffer.from([137, 80, 78, 71]))
      expect(acquire).toHaveBeenCalledOnce()
      expect(fetcher).toHaveBeenCalledWith(`${endpoint.origin}/orb-computer-use/v1`, expect.objectContaining({
        method: 'POST', headers: expect.objectContaining({ 'x-dsh-desktop-orb-secret': endpoint.secret }),
      }))
    } finally { await backend.close() }
    expect(release).toHaveBeenCalledOnce()
  })

  it('rejects an oversized or malformed screenshot', async () => {
    const backend = await createDesktopOrbHttpBackend(endpoint, async () => async () => {}, async () => new Response('{}', {
      headers: { 'Content-Length': String(45 * 1024 * 1024) },
    }))
    try { await expect(backend.observe()).rejects.toThrow('response too large') }
    finally { await backend.close() }
  })
})

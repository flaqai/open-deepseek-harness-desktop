import { Context } from '@deepseek-ai/cordis'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import Analytics from '@deepseek-ai/dsh-client-product-analytics'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { describe, expect, it, onTestFinished } from 'vitest'
import { connectDesktopWelcome } from '../src/welcome-backend.ts'
import { needsWelcome } from '../src/welcome-api.ts'

describe('native desktop welcome', () => {
  it.each([undefined, false, true])('reads the actual optional analytics RPC policy: %s', async (enabled) => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await ctx.plugin((owner) => {
      new HostConnectionService(owner, [], {} as ConstructorParameters<typeof HostConnectionService>[2])
    }).await()
    await ctx.plugin(TypertRegistry).await()
    await ctx.plugin(Gateway).await()
    if (enabled !== undefined) {
      ctx.provide('deepseekAccount', { getDeviceIdentity: async () => undefined } as never)
      ctx.provide('productTelemetry', { emit: () => {} } as never)
      await ctx.plugin(Analytics, { enabled }).await()
    }
    const shared = (ctx.connection as HostConnectionService).createSharedFetchHandler('/api')
    const backend = await connectDesktopWelcome('http://127.0.0.1:1234/', async (input, init) =>
      init?.method === 'POST' ? shared.fetch(new Request(input, init)) : new Response(''))
    await expect(backend.analyticsEnabled()).resolves.toBe(enabled ?? false)
    if (enabled === true) {
      await expect(backend.report({ eventName: 'auth_page_view', timestamp: 1, attributes: {} })).resolves.toBeUndefined()
    }
  })

  it.each([401, 403, 500])('reports an analytics HTTP %s failure instead of treating it as an absent service', async (status) => {
    const backend = await connectDesktopWelcome('http://127.0.0.1:1234/', async (_input, init) =>
      new Response('', { status: init?.method === 'POST' ? status : 200 }))
    await expect(backend.analyticsEnabled()).rejects.toThrow(`Web request failed (${String(status)})`)
  })

  it('opens only when neither account nor API key is configured', () => {
    expect(needsWelcome({ loggedIn: false, hasApiKey: false })).toBe(true)
    expect(needsWelcome({ loggedIn: false, hasApiKey: false, wasPresented: true })).toBe(false)
    expect(needsWelcome({ loggedIn: true, hasApiKey: false })).toBe(false)
    expect(needsWelcome({ loggedIn: false, hasApiKey: true })).toBe(false)
  })

  it('reads credential metadata without exposing the key and writes through the Host RPC', async () => {
    const calls: string[] = []
    const send = async (input: string, init?: RequestInit): Promise<Response> => {
      if (init?.method !== 'POST') return new Response('', { status: 200 })
      if (typeof init.body !== 'string') throw new Error('expected JSON RPC body')
      const request = JSON.parse(init.body) as { rpcId: string; method: string; payload: { args: Record<string, unknown> } }
      calls.push(request.method)
      const values: Record<string, unknown> = {
        'settings/describe': { namespaces: [
          { ns: 'llm-deepseek', value: { apiKeyEnv: 'DEEPSEEK_API_KEY' } },
          { ns: 'locale', value: { preference: 'zh-CN' } },
        ] },
        'llm/listConfigurableProviders': [],
        'credentials/describe': { DEEPSEEK_API_KEY: { configured: false, writable: true } },
        'account/getState': { status: 'signed-out', links: { usageUrl: 'https://example.com/usage', topUpUrl: 'https://example.com/topup' }, attempt: null },
        'credentials/set': undefined,
      }
      expect(input).toContain(`/api/${request.method}`)
      return Response.json({ type: 'server-response', rpcId: request.rpcId, result: { ok: true, value: values[request.method] } })
    }
    const backend = await connectDesktopWelcome('http://127.0.0.1:1234/?auth=one-time', send)
    expect(await backend.read()).toEqual({ loggedIn: false, hasApiKey: false, writable: true, localePreference: 'zh-CN' })
    expect(await backend.save('sk-valid')).toEqual({ ok: true })
    expect(await backend.save('invalid key')).toEqual({ ok: false })
    expect(calls.filter(call => call === 'credentials/set')).toHaveLength(1)
  })
})

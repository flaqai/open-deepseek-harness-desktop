import { describe, expect, it } from 'vitest'
import { connectDesktopWelcome } from '../src/welcome-backend.ts'
import { needsWelcome } from '../src/welcome-api.ts'

describe('native desktop welcome', () => {
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

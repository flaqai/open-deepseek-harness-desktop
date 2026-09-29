import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import ComputerUse from '@deepseek-ai/dsh-computer-use'
import { ComputerUseProviderName } from '@deepseek-ai/dsh-computer-use/brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { mountDesktopOrbComputerUse } from '../src/orb-computer-use-binding.ts'
import type { OrbBackendOpener } from '../src/orb-computer-use-binding.ts'
import type { DesktopOrbHttpBackend } from '../src/orb-computer-use-client.ts'

const endpoint = { origin: 'http://127.0.0.1:17777', secret: 'A'.repeat(43) }
const sessionId = SessionId('session-11111111-1111-4111-8111-111111111111')
const agent = { id: sessionId, session: { id: sessionId } } as Agent
const frame = {
  frameId: 1,
  frame: {
    data: Uint8Array.from([137, 80, 78, 71]), mediaType: 'image/png' as const,
    bounds: { x: 0, y: 0, width: 2, height: 2 }, windowId: 'front', appName: 'Editor',
  },
}

let ctx: Context
let ownsCaller: ReturnType<typeof vi.fn>
let observe: Mock<DesktopOrbHttpBackend['observe']>
let act: Mock<DesktopOrbHttpBackend['act']>
let close: Mock<DesktopOrbHttpBackend['close']>
let open: Mock<OrbBackendOpener>

beforeEach(async () => {
  ctx = new Context()
  await ctx.plugin(ComputerUse)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  ownsCaller = vi.fn(async () => true)
  observe = vi.fn<DesktopOrbHttpBackend['observe']>(async () => frame)
  act = vi.fn<DesktopOrbHttpBackend['act']>(async () => frame)
  close = vi.fn<DesktopOrbHttpBackend['close']>(async () => {})
  ctx.provide('desktopOrbCaller', { ensure: async () => sessionId, ownsCaller })
  ctx.provide('agents', { get: (id: string) => id === sessionId ? agent : undefined } as never)
  ctx.provide('attachments', { saveImage: async () => ({ attachmentId: 'image-1', mediaType: 'image/png', bytes: 4, width: 1, height: 1 }) } as never)
  open = vi.fn<OrbBackendOpener>(async (_endpoint, acquireExclusive) => {
    const release = await acquireExclusive()
    return { observe, act, async close() { await close(); await release() } }
  })
})

afterEach(async () => { await ctx.fiber.dispose() })

function execute(caller?: Agent) {
  return ctx.tools.execute({
    name: 'orb_observe', arguments: {}, callId: ToolCallId('binding-test'), signal: new AbortController().signal,
    ...caller === undefined ? {} : { agent: caller },
  })
}

describe('Desktop Host Orb Computer Use binding', () => {
  it('fails startup without Host-owned caller identity', async () => {
    const missing = new Context()
    await expect(mountDesktopOrbComputerUse(missing, endpoint, open)).rejects.toThrow('caller identity is unavailable')
    await missing.fiber.dispose()
    expect(open).not.toHaveBeenCalled()
  })

  it('leaves an existing Computer Use provider active', async () => {
    const release = ctx.computerUse.register(ComputerUseProviderName('official-provider'))
    await mountDesktopOrbComputerUse(ctx, endpoint, open)
    expect(ctx.computerUse.providerName).toBe('official-provider')
    expect(open).not.toHaveBeenCalled()
    await release()
  })

  it('admits the exact live Agent only after durable owner verification', async () => {
    await mountDesktopOrbComputerUse(ctx, endpoint, open)
    expect(ctx.computerUse.providerName).toBe('orb-native')
    expect(open).toHaveBeenCalledWith(endpoint, expect.any(Function))

    const noAgent = await execute()
    expect(noAgent.isError).toBe(true)
    const impersonator = await execute({ ...agent })
    expect(impersonator.isError).toBe(true)
    expect(ownsCaller).not.toHaveBeenCalled()
    expect(observe).not.toHaveBeenCalled()

    const allowed = await execute(agent)
    expect(allowed.isError).toBe(false)
    expect(ownsCaller).toHaveBeenCalledWith(sessionId)
    expect(observe).toHaveBeenCalledOnce()

    ownsCaller.mockResolvedValue(false)
    const revoked = await execute(agent)
    expect(revoked.isError).toBe(true)
    expect(observe).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
    expect(close).toHaveBeenCalledOnce()
  })
})

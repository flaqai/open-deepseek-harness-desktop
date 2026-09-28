import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ComputerUse from '@deepseek-ai/dsh-computer-use'
import { ComputerUseProviderName } from '@deepseek-ai/dsh-computer-use/brand'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { OrbAction, OrbBackend, OrbObservation } from '../src/index.ts'
import { createOrbComputerUseProvider, TOOL_NAMES } from '../src/index.ts'
import * as UnboundProvider from '../src/index.ts'

const image = Uint8Array.from([137, 80, 78, 71])
const observation: OrbObservation = {
  frameId: 1,
  frame: {
    data: image,
    mediaType: 'image/png',
    bounds: { x: 10, y: 20, width: 200, height: 100 },
    windowId: 'native-window-1',
    appName: 'Editor',
    windowTitle: 'Draft',
  },
}
const caller = {} as Agent

let ctx: Context
let events: string[]
let backend: OrbBackend
let observeNative: ReturnType<typeof vi.fn>
let actNative: ReturnType<typeof vi.fn>
let closeNative: ReturnType<typeof vi.fn>
let authorize: ReturnType<typeof vi.fn>
let saveImage: ReturnType<typeof vi.fn>

beforeEach(async () => {
  events = []
  authorize = vi.fn(async () => true)
  saveImage = vi.fn(async () => ({
    attachmentId: 'image-1', mediaType: 'image/png', bytes: image.byteLength, width: 1, height: 1,
  }))
  observeNative = vi.fn(async (_signal?: AbortSignal) => observation)
  actNative = vi.fn(async (_frameId: number, _action: OrbAction, _signal?: AbortSignal) => ({ ...observation, frameId: 2 }))
  closeNative = vi.fn(async () => { events.push('backend closed') })
  backend = {
    observe: observeNative,
    act: actNative,
    close: closeNative,
  }
  ctx = new Context()
  await ctx.plugin(ComputerUse)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  ctx.provide('attachments', { saveImage } as never)
})

afterEach(async () => {
  await ctx.fiber.dispose()
})

function provider(open = vi.fn(async (acquireExclusive: () => Promise<() => Promise<void>>) => {
  const release = await acquireExclusive()
  return { ...backend, async close() { await backend.close(); await release() } }
})) {
  return { plugin: createOrbComputerUseProvider({ open, authorize }), open }
}

function execute(name: string, args: unknown = {}, agent: Agent | null = caller) {
  return ctx.tools.execute({
    name, arguments: args, callId: ToolCallId('orb-test'), signal: new AbortController().signal,
    ...agent === null ? {} : { agent },
  })
}

describe('Orb native provider', () => {
  it('fails closed when loaded without a Desktop bridge', async () => {
    await expect(ctx.plugin(UnboundProvider)).rejects.toThrow('Desktop Host bridge is unavailable')
    expect(ctx.computerUse.providerName).toBeUndefined()
    expect(ctx.tools.schemas()).toEqual([])
  })

  it('refuses a backend that did not acquire the exclusive slot', async () => {
    const { plugin } = provider(vi.fn(async () => backend))
    await expect(ctx.plugin(plugin)).rejects.toThrow('did not acquire')
    expect(ctx.computerUse.providerName).toBeUndefined()
    expect(ctx.tools.schemas()).toEqual([])
    expect(closeNative).toHaveBeenCalledOnce()
  })

  it('denies calls without a Host-owned Agent before native access', async () => {
    const { plugin } = provider()
    await ctx.plugin(plugin)
    authorize.mockResolvedValue(false)
    const denied = await execute(TOOL_NAMES[0])
    expect(denied.isError).toBe(true)
    expect(observeNative).not.toHaveBeenCalled()
    const absent = await execute(TOOL_NAMES[0], {}, null)
    expect(absent.isError).toBe(true)
    expect(authorize).toHaveBeenCalledTimes(1)
    expect(observeNative).not.toHaveBeenCalled()
  })

  it('persists each screenshot and passes a stale-frame-safe action to the native backend', async () => {
    const { plugin } = provider()
    const fiber = ctx.plugin(plugin)
    await fiber
    expect(ctx.computerUse.providerName).toBe('orb-native')
    expect(ctx.tools.schemas().map(tool => tool.name)).toEqual(TOOL_NAMES)

    const observed = await execute(TOOL_NAMES[0])
    expect(observed.isError).toBe(false)
    expect(observed.content).toEqual([
      { type: 'text', text: '<frontmost_app>Editor</frontmost_app>\n<frontmost_window>Draft</frontmost_window>\n<frame_id>1</frame_id>\n<coordinate_space>0-1000</coordinate_space>' },
      { type: 'image', attachment: { attachmentId: 'image-1', mediaType: 'image/png', bytes: image.byteLength, width: 1, height: 1 } },
    ])
    expect(saveImage).toHaveBeenCalledWith({ data: image, mediaType: 'image/png', name: 'orb-frontmost-window' })

    const clicked = await execute(TOOL_NAMES[1], { frame_id: 1, position: [250, 750], button: 'right', count: 2 })
    expect(clicked.isError).toBe(false)
    expect(actNative.mock.calls[0]?.slice(0, 2)).toEqual([1, { kind: 'click', position: [250, 750], button: 'right', count: 2 }])
    expect(actNative.mock.calls[0]?.[2]).toBeInstanceOf(AbortSignal)
    const typed = await execute(TOOL_NAMES[2], { frame_id: 2, position: [500, 500], text: 'hello', replace: true, submit: false })
    expect(typed.isError).toBe(false)
    expect(actNative.mock.calls[1]?.slice(0, 2)).toEqual([2, { kind: 'type', position: [500, 500], text: 'hello', replace: true, submit: false }])
    expect(actNative.mock.calls[1]?.[2]).toBeInstanceOf(AbortSignal)

    await fiber.dispose()
    expect(ctx.tools.schemas()).toEqual([])
    expect(ctx.computerUse.providerName).toBeUndefined()
    expect(events).toEqual(['backend closed'])
  })

  it('rejects invalid positions and excessive text before native input', async () => {
    const { plugin } = provider()
    await ctx.plugin(plugin)
    expect((await execute(TOOL_NAMES[1], { frame_id: 1, position: [1001, 0] })).isError).toBe(true)
    expect((await execute(TOOL_NAMES[1], { frame_id: 1, position: [0] })).isError).toBe(true)
    expect((await execute(TOOL_NAMES[2], { frame_id: 1, position: [0, 0], text: 'x'.repeat(32_769) })).isError).toBe(true)
    expect(actNative).not.toHaveBeenCalled()
  })

  it('keeps another provider exclusive before native startup', async () => {
    const { plugin, open } = provider()
    const other = ctx.computerUse.register(ComputerUseProviderName('other'))
    await expect(ctx.plugin(plugin)).rejects.toThrow('already registered')
    expect(open).not.toHaveBeenCalled()
    await other()
  })
})

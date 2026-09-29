/** Loader composition through a real config entry with a Host-supplied bridge. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, FiberState } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import ComputerUse from '@deepseek-ai/dsh-computer-use'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createOrbComputerUseProvider, TOOL_NAMES } from '../src/index.ts'

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(async ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(async root => rm(root, { recursive: true, force: true })))
})

describe('Orb native Loader composition', () => {
  it('shows screenshot tools after Host binding and denies a caller without an Agent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-orb-native-'))
    roots.push(root)
    const close = vi.fn(async () => {})
    const observe = vi.fn(async () => ({
      frameId: 1,
      frame: {
        data: Uint8Array.from([137, 80, 78, 71]), mediaType: 'image/png' as const,
        bounds: { x: 0, y: 0, width: 2, height: 2 }, windowId: 'front', appName: 'Editor',
      },
    }))
    const saveImage = vi.fn(async () => ({ attachmentId: 'image-1', mediaType: 'image/png', bytes: 4, width: 1, height: 1 }))
    const provider = createOrbComputerUseProvider({
      authorize: async (_agent: Agent) => true,
      async open(acquireExclusive) {
        const release = await acquireExclusive()
        return {
          observe,
          act: observe,
          async close() { await close(); await release() },
        }
      },
    })
    const modules = new Map<string, object>([
      ['@deepseek-ai/dsh-computer-use', ComputerUse],
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@fixture/attachments', { name: 'fixture-attachments', apply(ctx: Context) { ctx.provide('attachments', { saveImage } as never) } }],
      ['@deepseek-ai/dsh-computer-use-orb-native', provider],
    ])
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, JSON.stringify([...modules.keys()].map(name => ({ name, config: {} }))))
    const ctx = new Context()
    contexts.push(ctx)
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    if (ctx.loader.internal === undefined) throw new Error('Loader has no module importer')
    ctx.loader.internal.import = async (specifier: string) => {
      const module = modules.get(specifier)
      if (module === undefined) throw new Error(`Unexpected Loader import: ${specifier}`)
      return module
    }
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()

    expect([...ctx.loader.entries()].every(entry => entry.fiber?.state === FiberState.ACTIVE)).toBe(true)
    expect(ctx.computerUse.providerName).toBe('orb-native')
    expect(ctx.tools.schemas().map(tool => tool.name)).toEqual(TOOL_NAMES)
    const denied = await ctx.tools.execute({
      name: TOOL_NAMES[0], arguments: {}, callId: ToolCallId('missing-agent'), signal: new AbortController().signal,
    })
    expect(denied.isError).toBe(true)
    expect(observe).not.toHaveBeenCalled()
    const observed = await ctx.tools.execute({
      name: TOOL_NAMES[0], arguments: {}, callId: ToolCallId('host-owned-agent'),
      signal: new AbortController().signal, agent: {} as Agent,
    })
    expect(observed.isError).toBe(false)
    expect(observed.content).toEqual([
      { type: 'text', text: '<frontmost_app>Editor</frontmost_app>\n<frame_id>1</frame_id>\n<coordinate_space>0-1000</coordinate_space>' },
      { type: 'image', attachment: { attachmentId: 'image-1', mediaType: 'image/png', bytes: 4, width: 1, height: 1 } },
    ])
    expect(saveImage).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
    expect(ctx.get('computerUse')).toBeUndefined()
    expect(ctx.get('tools')).toBeUndefined()
    expect(close).toHaveBeenCalledOnce()
  })
})

/**
 * Explicitly hosted Orb computer-use tools for one authorized caller.
 * @module @deepseek-ai/dsh-computer-use-orb-native
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { ComputerUseProviderName } from '@deepseek-ai/dsh-computer-use/brand'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-computer-use'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'

/** Cordis identity; a bare Loader row intentionally fails without a Desktop bridge. */
export const name = 'computer-use-orb-native'

/** Services needed to reserve the sole provider and persist screenshots. */
export const inject = ['computerUse', 'tools', 'attachments', 'systemPrompt']

/** Native behavior is supplied by the Desktop Host, not configuration text. */
export const Config = Schema.object({})

/** One frontmost-window raster and the global rectangle used by native input. */
export interface OrbFrame {
  readonly data: Uint8Array
  readonly mediaType: 'image/png' | 'image/jpeg'
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  readonly windowId: string
  readonly appName: string
  readonly windowTitle?: string
}

/** Model coordinates are integer millifractions of the latest screenshot. */
export type OrbPosition = readonly [number, number]

/** Direct foreground actions supported by the native bridge. */
export type OrbAction =
  | { readonly kind: 'click'; readonly position: OrbPosition; readonly button: 'left' | 'right'; readonly count: 1 | 2 }
  | { readonly kind: 'type'; readonly position: OrbPosition; readonly text: string; readonly replace: boolean; readonly submit: boolean }

/** Screenshot identity invalidated by a newer observation or any action. */
export interface OrbObservation {
  readonly frameId: number
  readonly frame: OrbFrame
}

/** Live native backend. It owns focus checks, permission checks, and serialization. */
export interface OrbBackend {
  observe(signal?: AbortSignal): Promise<OrbObservation>
  act(frameId: number, action: OrbAction, signal?: AbortSignal): Promise<OrbObservation>
  close(): Promise<void>
}

/** Desktop-owned dependency; no renderer value alone grants computer-use authority. */
export interface OrbHostBridge {
  /** The backend must call acquireExclusive once before exposing operations. */
  open(acquireExclusive: () => Promise<() => Promise<void>>): Promise<OrbBackend>
  /** Check the actual executing Agent against Host-owned caller identity. */
  authorize(agent: Agent, signal: AbortSignal): Promise<boolean>
}

/** Cordis plugin returned after binding the Desktop Host dependencies. */
export interface OrbComputerUsePlugin {
  readonly name: typeof name
  readonly inject: typeof inject
  readonly Config: typeof Config
  apply(ctx: Context): Promise<void>
}

/** The three tool names owned by this provider. */
export const TOOL_NAMES = ['orb_observe', 'orb_click', 'orb_type'] as const

const PROVIDER = ComputerUseProviderName('orb-native')
const TOOL_NAME_SET = new Set<string>(TOOL_NAMES)

const IMAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: true,
  properties: {
    attachmentId: { type: 'string', required: true },
    mediaType: { type: 'string', enum: ['image/png', 'image/jpeg'], required: true },
    bytes: { type: 'integer', required: true },
    width: { type: 'integer', required: true },
    height: { type: 'integer', required: true },
    name: { type: 'string' },
    originalDimensions: {
      type: 'object',
      additionalProperties: false,
      properties: {
        width: { type: 'integer', required: true },
        height: { type: 'integer', required: true },
      },
    },
  },
} as const

const OBSERVATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    frameId: { type: 'integer', required: true },
    appName: { type: 'string', required: true },
    windowTitle: { type: 'string' },
    image: IMAGE_SCHEMA,
  },
} as const

interface ObservationValue {
  frameId: number
  appName: string
  windowTitle?: string
  image: {
    attachmentId: string
    mediaType: 'image/png' | 'image/jpeg'
    bytes: number
    width: number
    height: number
    name?: string
    originalDimensions?: { width: number; height: number }
  }
}

function imageRef(image: ObservationValue['image']): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId(image.attachmentId),
    mediaType: image.mediaType,
    bytes: image.bytes,
    width: image.width,
    height: image.height,
    ...image.name === undefined ? {} : { name: image.name },
    ...image.originalDimensions === undefined ? {} : { originalDimensions: image.originalDimensions },
  }
}

function displayLabel(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').slice(0, 256)
}

function observationContent(value: ObservationValue) {
  const title = value.windowTitle === undefined ? '' : `\n<frontmost_window>${displayLabel(value.windowTitle)}</frontmost_window>`
  return [
    { type: 'text' as const, text: `<frontmost_app>${displayLabel(value.appName)}</frontmost_app>${title}\n<frame_id>${String(value.frameId)}</frame_id>\n<coordinate_space>0-1000</coordinate_space>` },
    { type: 'image' as const, attachment: imageRef(value.image) },
  ]
}

function position(value: readonly number[]): OrbPosition {
  const [x, y] = value
  if (value.length !== 2 || x === undefined || y === undefined
    || value.some(item => !Number.isInteger(item) || item < 0 || item > 1000)) {
    throw new Error('orb computer use: position must be two integers from 0 to 1000')
  }
  return [x, y]
}

function frameId(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('orb computer use: invalid frame_id')
  return value
}

/** A Loader-mounted copy cannot acquire GUI authority without a Host bridge. */
export function apply(_ctx: Context): never {
  throw new Error('orb computer use: Desktop Host bridge is unavailable')
}

/**
 * Bind the provider to a Desktop-owned native backend and caller check.
 * The returned plugin is mounted explicitly by the Host; it never auto-approves tool calls.
 * @param bridge - native operations and Host-owned caller authorization.
 * @returns a Cordis plugin that registers tools only after backend startup.
 */
export function createOrbComputerUseProvider(bridge: OrbHostBridge): OrbComputerUsePlugin {
  return {
    name,
    inject,
    Config,
    async apply(ctx: Context): Promise<void> {
      const lifetime = new AbortController()
      const pending = new Set<Promise<unknown>>()
      let backend: OrbBackend | undefined
      let ready: Promise<void> = Promise.resolve()
      let acquired = false

      ctx.on('internal/plugin', (fiber) => {
        if (fiber === ctx.fiber && fiber.uid === null) lifetime.abort()
      }, { global: true })

      const dispose = ctx.effect(function* () {
        yield ctx.computerUse.register(PROVIDER)
        yield async () => {
          lifetime.abort()
          await ready.catch(() => {})
          await Promise.allSettled(pending)
          await backend?.close()
        }
        const child = ctx.plugin({
          name: 'computer-use-orb-native-tools',
          inject: ['tools', 'attachments', 'systemPrompt'],
          async apply(inner: Context): Promise<void> {
            backend = await bridge.open(() => {
              if (acquired || ctx.computerUse.providerName !== PROVIDER) {
                throw new Error('orb computer use: invalid exclusive reservation')
              }
              acquired = true
              // The parent effect retains registration until after backend.close().
              return Promise.resolve(() => Promise.resolve())
            })
            lifetime.signal.throwIfAborted()
            if (!acquired) throw new Error('orb computer use: native backend did not acquire the exclusive reservation')
            const activeBackend = backend

            inner.on('system-prompt/assemble', async (_assembly, context, next) => {
              const assembled = await next()
              const agent = context.agent
              if (agent !== undefined) {
                const signal = context.signal === undefined
                  ? lifetime.signal : AbortSignal.any([context.signal, lifetime.signal])
                signal.throwIfAborted()
                if (await bridge.authorize(agent, signal)) return assembled
              }
              return { ...assembled, tools: assembled.tools.filter(tool => !TOOL_NAME_SET.has(tool.name)) }
            })

            async function run(exec: ToolExecution, action: (signal: AbortSignal) => Promise<OrbObservation>): Promise<ObservationValue> {
              const signal = AbortSignal.any([exec.signal, lifetime.signal])
              const operation = (async (): Promise<ObservationValue> => {
                signal.throwIfAborted()
                if (exec.agent === undefined || !await bridge.authorize(exec.agent, signal)) {
                  throw new Error('orb computer use: caller is not the Host-owned Orb session')
                }
                signal.throwIfAborted()
                const observed = await action(signal)
                signal.throwIfAborted()
                const saved = await inner.attachments.saveImage({
                  data: observed.frame.data,
                  mediaType: observed.frame.mediaType,
                  name: 'orb-frontmost-window',
                })
                signal.throwIfAborted()
                return {
                  frameId: observed.frameId,
                  appName: observed.frame.appName,
                  ...observed.frame.windowTitle === undefined ? {} : { windowTitle: observed.frame.windowTitle },
                  image: {
                    attachmentId: saved.attachmentId,
                    mediaType: observed.frame.mediaType,
                    bytes: saved.bytes,
                    width: saved.width,
                    height: saved.height,
                    ...saved.name === undefined ? {} : { name: saved.name },
                    ...saved.originalDimensions === undefined ? {} : { originalDimensions: saved.originalDimensions },
                  },
                }
              })()
              pending.add(operation)
              try {
                return await operation
              } finally {
                pending.delete(operation)
              }
            }

            inner.tools.register(defineTool({
              name: TOOL_NAMES[0],
              description: 'Observe the frontmost window and receive a screenshot. Coordinates in its image use integer 0–1000 millifractions.',
              parameters: {},
              output: { schema: OBSERVATION_SCHEMA, render: (_args, value) => observationContent(value) },
              isConcurrencySafe: () => false,
              execute: async (_args, exec) => run(exec, signal => activeBackend.observe(signal)),
            }))
            inner.tools.register(defineTool({
              name: TOOL_NAMES[1],
              description: 'Click the latest observed frontmost window at [x, y] in 0–1000 screenshot coordinates, then return a fresh screenshot. A changed window or stale frame is refused.',
              parameters: {
                frame_id: { type: 'integer', required: true },
                position: { type: 'array', required: true, items: { type: 'integer' } },
                button: { type: 'string', enum: ['left', 'right'], default: 'left' },
                count: { type: 'integer', enum: [1, 2], default: 1 },
              },
              output: { schema: OBSERVATION_SCHEMA, render: (_args, value) => observationContent(value) },
              isConcurrencySafe: () => false,
              execute: async (args, exec) => run(exec, signal => activeBackend.act(frameId(args.frame_id), {
                kind: 'click', position: position(args.position), button: args.button ?? 'left', count: args.count ?? 1,
              }, signal)),
            }))
            inner.tools.register(defineTool({
              name: TOOL_NAMES[2],
              description: 'Focus a field in the latest observed frontmost window, type text, then return a fresh screenshot. A changed window or stale frame is refused.',
              parameters: {
                frame_id: { type: 'integer', required: true },
                position: { type: 'array', required: true, items: { type: 'integer' } },
                text: { type: 'string', required: true },
                replace: { type: 'boolean', default: false },
                submit: { type: 'boolean', default: false },
              },
              output: { schema: OBSERVATION_SCHEMA, render: (_args, value) => observationContent(value) },
              isConcurrencySafe: () => false,
              execute: async (args, exec) => run(exec, (signal) => {
                if (args.text.length < 1 || args.text.length > 32_768) throw new Error('orb computer use: invalid input text length')
                return activeBackend.act(frameId(args.frame_id), {
                  kind: 'type', position: position(args.position), text: args.text,
                  replace: args.replace ?? false, submit: args.submit ?? false,
                }, signal)
              }),
            }))
          },
        })
        yield child.dispose
        ready = Promise.resolve(child).then(() => {})
      }, 'computer-use-orb-native.runtime')

      try {
        await ready
      } catch (error) {
        await dispose()
        throw error
      }
    },
  }
}

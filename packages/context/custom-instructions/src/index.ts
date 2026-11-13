import { renderCustomInstruction } from './prompt.ts'
/** Global and Workspace-scoped user instructions injected into every matching Agent. */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-workspace'
import type {
  CustomInstructionHistory,
  CustomInstructionSettings,
  CustomInstructionVersion,
} from './types.ts'
import {
  CUSTOM_INSTRUCTION_MAX_CHARS,
} from './types.ts'

export type * from './types.ts'

/** Cordis plugin name. */
export const name = 'custom-instructions'

/** Services required to resolve settings and Workspace identity at Agent creation. */
export const inject = ['settings', 'systemPrompt', 'workspaceRegistry']

const VersionSchema: z<CustomInstructionVersion> = z.object({
  id: z.string().min(1).required(),
  text: z.string().max(CUSTOM_INSTRUCTION_MAX_CHARS).required(),
  createdAt: z.number().step(1).min(0).required(),
})

const HistorySchema: z<CustomInstructionHistory> = z.object({
  activeVersion: z.string().min(1),
  versions: z.array(VersionSchema).default([]),
})

/** Profile-owned live values; the settings form writes only these fields. */
export interface Config {
  /** Live global instruction history. */
  global: Volatile<CustomInstructionHistory>
  /** Live instruction histories for individual Workspaces. */
  workspaces: Volatile<Record<string, CustomInstructionHistory>>
  /** Live diagnostic-export disclosure preference. */
  diagnosticExport: Volatile<CustomInstructionSettings['diagnosticExport']>
}

export const Config = z.object({
  global: HistorySchema.default({ versions: [] }).volatile(),
  workspaces: z.dict(HistorySchema).default({}).volatile(),
  diagnosticExport: z.object({
    preference: z.union(['ask', 'include', 'exclude']).default('ask'),
  }).default({ preference: 'ask' }).volatile(),
})

function activeVersion(history: {
  readonly activeVersion?: string
  readonly versions: readonly CustomInstructionVersion[]
} | undefined): CustomInstructionVersion | undefined {
  if (history?.activeVersion === undefined) return undefined
  return history.versions.find(version => version.id === history.activeVersion)
}


function workspaceIdOf(ctx: Context, agent: Agent): string | undefined {
  const cwd = agent.session.header.cwd
  if (cwd === undefined) return undefined
  return ctx.workspaceRegistry.list().find(workspace => workspace.path === cwd)?.id
}

/** Register live settings-backed prompt contexts for every Agent scope. */
export function apply(ctx: Context, config: Config): void {
  ctx.on('agent/created', ({ agent }) => {
    const workspaceId = workspaceIdOf(ctx, agent)
    agent.ctx.systemPrompt.context({
      name: 'custom-instructions:global',
      order: 10_000,
      text: () => renderCustomInstruction('global', activeVersion(config.global.get())),
    })
    if (workspaceId === undefined) return
    agent.ctx.systemPrompt.context({
      name: 'custom-instructions:workspace',
      order: 10_010,
      text: () => renderCustomInstruction(
        workspaceId,
        activeVersion(config.workspaces.get()[workspaceId]),
      ),
    })
  })
}

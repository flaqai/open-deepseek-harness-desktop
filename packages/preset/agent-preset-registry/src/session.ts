/**
 * The session-log record of which preset a session actually runs.
 *
 * The creation header names the preset a session STARTED with, and it is
 * deep-frozen because that is a creation fact. A session may still change
 * preset while it is blank, and the effect of that change outlives the blank
 * window: the first turn — and every turn after it — runs under the newly
 * mounted composition. Recording the change is what keeps the log honest, and
 * it is required outright by the repo's model-visible ⟺ logged rule, since the
 * preset decides the tool schemas and prompt sections the model sees.
 *
 * Reconstruction reads the `agentPreset` Session projection, never the header
 * alone.
 * @module @deepseek-ai/dsh-agent-preset-registry/session
 */

import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'

/** Latest Host-side external-tool resolution committed for a model step. */
export interface ExternalToolsResolvedProjection {
  readonly turn: number
  readonly step: number
  readonly tools: Array<'codex' | 'claude-code'>
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Latest external-tool capability projection, or null before any connected step. */
    externalToolsResolved: ExternalToolsResolvedProjection | null
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The session's agent preset was chosen after creation, while the session
     * was still blank. Log-only: it records the composition later turns ran
     * under, so a resumed or forked session rebuilds the same one instead of
     * the header's creation-time value. In a child Session, an occurrence
     * before its first own `subagent/descriptor` marks an independent spawn
     * selection that cold resume restores instead of joining the parent's
     * composition (`dsh-subagent` README, "Restoring child composition").
     */
    'agent-preset/selected': { agentPreset: string }
    /**
     * Host-connected product tools projected into one model request. The
     * complete array is logged once per step, including an empty array after
     * a prior connected step, so request capabilities remain auditable.
     */
    'external-tools/resolved': {
      turn: number
      step: number
      tools: Array<'codex' | 'claude-code'>
    }
  }
}

const agentPresetSchema = z.union([z.string(), z.null()])

/** Current Session preset, initialized from its header and advanced by selection events. */
export const agentPresetProjectionDefinition = {
  key: 'agentPreset',
  stateSchema: agentPresetSchema,
  init: header => header.agentPreset ?? null,
  apply: (state, event) => event.type === 'agent-preset/selected'
    ? event.data.agentPreset
    : state,
  wire: { viewSchema: agentPresetSchema, view: state => state },
  stateVersion: 1,
} satisfies ProjectionDefinition<'agentPreset', string | null>

const externalToolsResolvedSchema = z.object({
  turn: z.number(),
  step: z.number(),
  tools: z.array(z.union([z.literal('codex'), z.literal('claude-code')])),
}).nullable()

/** Latest external-tool resolution, retained as bounded reconstructed state. */
export const externalToolsResolvedProjectionDefinition = {
  key: 'externalToolsResolved',
  stateSchema: externalToolsResolvedSchema,
  init: () => null,
  apply: (state, event) => event.type === 'external-tools/resolved'
    ? event.data
    : state,
  stateVersion: 1,
} satisfies ProjectionDefinition<'externalToolsResolved', ExternalToolsResolvedProjection | null>

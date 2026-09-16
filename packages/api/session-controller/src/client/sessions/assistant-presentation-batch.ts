/** Frame-sized compaction for browser-only Assistant presentation deltas. */

import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type { SessionTransientEventEntry } from '../contract/events.ts'

type TextDelta = Extract<StreamChunk, { type: 'text-delta' | 'reasoning-delta' }>
type ToolDelta = Extract<StreamChunk, { type: 'tool-call-delta' }>

function sameOwner(left: SessionTransientEventEntry, right: SessionTransientEventEntry): boolean {
  return left.event.data.attemptId === right.event.data.attemptId
    && left.event.data.turn === right.event.data.turn
    && left.event.data.step === right.event.data.step
}

function mergeChunk(left: StreamChunk, right: StreamChunk): StreamChunk | undefined {
  if (left.type !== right.type || !('index' in left) || !('index' in right) || left.index !== right.index) {
    return undefined
  }
  if (left.type === 'text-delta' || left.type === 'reasoning-delta') {
    const next = right as TextDelta
    return { ...left, text: left.text + next.text }
  }
  if (left.type === 'tool-call-delta') {
    const next = right as ToolDelta
    return {
      ...left,
      id: left.id === '' ? next.id : left.id,
      ...next.name === undefined ? {} : { name: next.name },
      argumentsDelta: left.argumentsDelta + next.argumentsDelta,
    }
  }
  return undefined
}

function carriesFirstToken(chunk: StreamChunk): boolean {
  if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') return chunk.text !== ''
  return chunk.type === 'tool-call-delta'
    && (chunk.argumentsDelta !== '' || chunk.name !== undefined)
}

/**
 * Merge only adjacent, same-block token deltas. Block boundaries, usage and
 * finish records remain exact ordering barriers; the durable Assistant stream
 * still retains every original provider chunk.
 * @param entries - Ordered browser-presentation entries from one frame.
 * @returns Entries with adjacent compatible deltas concatenated.
 */
export function coalesceAssistantPresentation(
  entries: readonly SessionTransientEventEntry[],
): readonly SessionTransientEventEntry[] {
  const compacted: SessionTransientEventEntry[] = []
  for (const entry of entries) {
    const previous = compacted.at(-1)
    if (previous === undefined || !sameOwner(previous, entry)) {
      compacted.push(entry)
      continue
    }
    const chunk = mergeChunk(previous.event.data.chunk, entry.event.data.chunk)
    if (chunk === undefined) {
      compacted.push(entry)
      continue
    }
    const firstTokenWasInPrevious = carriesFirstToken(previous.event.data.chunk)
    compacted[compacted.length - 1] = {
      type: 'transient',
      event: {
        ...previous.event,
        time: firstTokenWasInPrevious ? previous.event.time : entry.event.time,
        data: { ...previous.event.data, chunk },
      },
    }
  }
  return compacted
}

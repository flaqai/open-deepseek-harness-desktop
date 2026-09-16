import { describe, expect, it } from 'vitest'
import { LlmAttemptId, ToolCallId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { SessionTransientEventEntry } from '../src/client/contract/events.ts'
import { coalesceAssistantPresentation } from '../src/client/sessions/assistant-presentation-batch.ts'

function entry(index: number, chunk: StreamChunk): SessionTransientEventEntry {
  return {
    type: 'transient',
    event: {
      type: 'assistant/live-chunk',
      seq: index,
      time: index,
      data: {
        attemptId: LlmAttemptId('attempt'),
        turn: 1,
        step: 2,
        chunk,
      },
    },
  }
}

describe('Assistant presentation batching', () => {
  it('coalesces adjacent text and reasoning deltas without crossing block boundaries', () => {
    const compacted = coalesceAssistantPresentation([
      entry(1, { type: 'text-delta', index: 0, text: 'a' }),
      entry(2, { type: 'text-delta', index: 0, text: 'b' }),
      entry(3, { type: 'block-end', index: 0, block: { type: 'text', text: 'ab' } }),
      entry(4, { type: 'reasoning-delta', index: 1, text: 'c' }),
      entry(5, { type: 'reasoning-delta', index: 1, text: 'd' }),
    ])

    expect(compacted.map(item => item.event.data.chunk)).toEqual([
      { type: 'text-delta', index: 0, text: 'ab' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'ab' } },
      { type: 'reasoning-delta', index: 1, text: 'cd' },
    ])
  })

  it('preserves the first useful token time and sequential tool identity semantics', () => {
    const compacted = coalesceAssistantPresentation([
      entry(1, { type: 'tool-call-delta', index: 0, id: ToolCallId(''), argumentsDelta: '' }),
      entry(2, { type: 'tool-call-delta', index: 0, id: ToolCallId('call'), name: 'read', argumentsDelta: '{' }),
      entry(3, { type: 'tool-call-delta', index: 0, id: ToolCallId('ignored'), argumentsDelta: '}' }),
    ])

    expect(compacted).toHaveLength(1)
    expect(compacted[0]?.event.time).toBe(2)
    expect(compacted[0]?.event.data.chunk).toEqual({
      type: 'tool-call-delta',
      index: 0,
      id: 'call',
      name: 'read',
      argumentsDelta: '{}',
    })
  })
})

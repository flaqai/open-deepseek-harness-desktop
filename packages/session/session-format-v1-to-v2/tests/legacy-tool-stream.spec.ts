import { describe, expect, it } from 'vitest'
import { BlockAssembler, expandAssistantStream, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { AssistantStreamRecord, ContentBlock } from '@deepseek-ai/dsh-llm'
import { repairLegacyToolStream } from '../src/legacy-tool-stream.ts'

function fixture() {
  const stream = [
    { type: 'tool-call-chunks', time0: 1, index: 7, id: ToolCallId('original-id'), name: 'read', dt: [], args: ['{'] },
    { type: 'chunk', time: 2, chunk: { type: 'tool-call-delta', index: 7, id: ToolCallId(''), argumentsDelta: '}' } },
    { type: 'chunk', time: 3, chunk: { type: 'block-end', index: 7, block: { type: 'tool-call', id: ToolCallId(''), name: '', arguments: '{}' } } },
  ] satisfies AssistantStreamRecord[]
  const content = [{ type: 'tool-call', id: ToolCallId('legacy-empty-tool-call:fixture:8'), name: 'legacy_invalid_tool', arguments: '{}' }] satisfies ContentBlock[]
  return { stream, content }
}

describe('proven failed tool stream identity alignment', () => {
  it('changes only the final empty block and preserves earlier identities, arguments and times', () => {
    const { stream, content } = fixture()
    const before = JSON.stringify(stream)
    const repaired = repairLegacyToolStream(stream, content, 'fixture')
    const timed = expandAssistantStream(repaired)
    expect(timed.slice(0, 2)).toEqual(expandAssistantStream(stream).slice(0, 2))
    expect(timed[2]).toEqual({ time: 3, chunk: { type: 'block-end', index: 7, block: content[0] } })
    const assembler = new BlockAssembler()
    for (const member of timed) assembler.push(member.chunk)
    expect(assembler.blocks()).toEqual(content)
    expect(JSON.stringify(stream)).toBe(before)
  })

  it('does not infer recovery identities for another session', () => {
    const { stream, content } = fixture()
    expect(repairLegacyToolStream(stream, content, 'other')).toBe(stream)
  })

  it('refuses different argument content', () => {
    const { stream, content } = fixture()
    const changed = [{ ...content[0], arguments: '{"changed":true}' }] as ContentBlock[]
    expect(() => repairLegacyToolStream(stream, changed, 'fixture')).toThrow(/disagrees/)
  })

  it('refuses an absent final block instead of fabricating one', () => {
    const { stream, content } = fixture()
    expect(() => repairLegacyToolStream(stream.slice(0, 2), content, 'fixture')).toThrow()
  })
})

import { describe, expect, it } from 'vitest'
import { de, en, es, fr, ja, ko, pt, ptBR, ru, zh } from '../src/client/locales.ts'

const placeholders = (value: string): string[] => [...value.matchAll(/\{(\w+)\}/gu)].map(match => match[1]!).sort()

describe('selection action locale dictionaries', () => {
  it('translates side conversation actions in all nine languages', () => {
    const keys = ['action.sideAsk', 'status.sideConversation'] as const
    for (const dictionary of [zh, ja, ko, es, fr, de, ptBR, ru]) {
      for (const key of keys) {
        expect(dictionary[key].trim()).not.toBe('')
        expect(dictionary[key]).not.toBe(en[key])
      }
    }
    expect(zh['action.append']).toBe('添加到对话')
    expect(en['action.append']).toBe('Add to conversation')
    expect(pt).toEqual(ptBR)
  })

  it('keeps every shipped dictionary key and placeholder compatible with English', () => {
    for (const dictionary of [zh, ja, ko, es, fr, de, ptBR, pt, ru]) {
      expect(Object.keys(dictionary).sort()).toEqual(Object.keys(en).sort())
      for (const key of Object.keys(en) as (keyof typeof en)[]) {
        expect(placeholders(dictionary[key])).toEqual(placeholders(en[key]))
      }
    }
  })
})

import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { expect, it } from 'vitest'
import { en, zh, ja, es, fr, de, ru, pt, ko } from '../src/client/locales.ts'

it('provides all built-in MCP settings copy and placeholders in every supported language', () => {
  const dictionaries = { zh, en, ja, es, fr, de, ru, pt, ko }
  const locale = new LocaleRuntime(new Context())
  for (const id of ['ja', 'es', 'fr', 'de', 'ru', 'pt', 'ko']) locale.addLanguage({ id, label: id, fallback: 'en' })
  const dispose = locale.register('settings.mcp', dictionaries)
  try {
    for (const [id, dictionary] of Object.entries(dictionaries)) {
      expect(Object.keys(dictionary).sort()).toEqual(Object.keys(en).sort())
      locale.setLocale(id)
      for (const key of Object.keys(en) as (keyof typeof en)[]) {
        expect(dictionary[key].trim(), `${id}:${key}`).not.toBe('')
        expect(dictionary[key].match(/\{\w+\}/gu)?.sort() ?? [], `${id}:${key}`)
          .toEqual(en[key].match(/\{\w+\}/gu)?.sort() ?? [])
        expect(locale.bind('settings.mcp')(key)).toBe(dictionary[key])
      }
    }
  } finally { dispose() }
})

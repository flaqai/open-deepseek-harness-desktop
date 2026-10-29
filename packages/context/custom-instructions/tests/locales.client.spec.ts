import { expect, it } from 'vitest'
import { en } from '../src/client/locales.ts'
import { customInstructionsAdditionalLocales } from '../src/client/locales-extra.ts'

it('provides every custom-instructions label and preserves format arguments in each supported language', () => {
  for (const dictionary of Object.values(customInstructionsAdditionalLocales)) {
    expect(Object.keys(dictionary).sort()).toEqual(Object.keys(en).sort())
    expect(dictionary.title).not.toBe(en.title)
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(dictionary[key].match(/\{\w+\}/gu)?.sort() ?? []).toEqual(en[key].match(/\{\w+\}/gu)?.sort() ?? [])
    }
  }
})

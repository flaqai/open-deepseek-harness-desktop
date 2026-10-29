import { describe, expect, it } from 'vitest'
import { en, ja, es, fr, de, ru, pt } from '../src/client/locales.ts'

for (const [language, dictionary] of Object.entries({ ja, es, fr, de, ru, pt })) {
  describe(`community settings navigation in ${language}`, () => {
    it('localizes navigation management and onboarding recovery without English fallback', () => {
      for (const key of Object.keys(en) as (keyof typeof en)[]) {
        if (key.startsWith('nav.') || key.startsWith('onboarding.')) expect(dictionary[key], key).not.toBe(en[key])
      }
    })
    it('preserves interpolation placeholders', () => {
      for (const key of Object.keys(en) as (keyof typeof en)[]) {
        const placeholders = (copy: string): string[] => [...copy.matchAll(/\{([a-zA-Z]\w*)\}/g)].map(match => match[1]!).sort()
        expect(placeholders(dictionary[key]), key).toEqual(placeholders(en[key]))
      }
    })
  })
}

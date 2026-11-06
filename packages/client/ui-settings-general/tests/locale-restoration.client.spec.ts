import { describe, expect, it } from 'vitest'
import { en, ja, ko, es, fr, de, ru, pt, zh } from '../src/client/locales.ts'

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


it('provides all contextual navigation labels in nine interface languages', () => {
  const labels = ['nav.hideItem', 'nav.hideGroup', 'nav.renameGroup', 'nav.deleteGroup', 'nav.addGroup', 'nav.organize',
    'nav.dropStandalone', 'nav.moveTo', 'nav.restoreEntry'] as const
  const dictionaries = { zh, en, ja, ko, es, fr, de, ru, pt }
  expect(Object.keys(dictionaries)).toHaveLength(9)
  for (const [language, dictionary] of Object.entries(dictionaries)) {
    for (const label of labels) {
      expect(dictionary[label].trim(), `${language}: ${label}`).not.toBe('')
      if (language !== 'en') expect(dictionary[label], `${language}: ${label}`).not.toBe(en[label])
    }
  }
})

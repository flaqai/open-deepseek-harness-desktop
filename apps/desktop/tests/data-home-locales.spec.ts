import { describe, expect, it } from 'vitest'
import { DESKTOP_LOCALE_IDS } from '../src/desktop-locale.ts'
import { copyFor, detailsFor } from '../src/locales/data-home.ts'
import { sourceCopyFor } from '../src/locales/data-home-source.ts'
import { portableCopyFor } from '../src/locales/data-home-portable.ts'

describe('data-home locale coverage', () => {
  it('provides every chooser message and detail for every offered locale', () => {
    const englishKeys = Object.keys(copyFor('en')).sort()

    for (const locale of DESKTOP_LOCALE_IDS) {
      const copy = copyFor(locale)
      const sourceCopy = sourceCopyFor(locale)
      const portableCopy = portableCopyFor(locale)
      expect(Object.keys(sourceCopy).sort(), locale).toEqual(Object.keys(sourceCopyFor('en')).sort())
      for (const [key, value] of Object.entries(sourceCopy)) expect(value.trim(), `${locale}.${key}`).not.toBe('')
      expect(Object.keys(portableCopy).sort(), locale).toEqual(Object.keys(portableCopyFor('en')).sort())
      for (const [key, value] of Object.entries(portableCopy)) expect(value.trim(), `${locale}.${key}`).not.toBe('')
      expect(Object.keys(copy).sort(), locale).toEqual(englishKeys)
      for (const [key, value] of Object.entries(copy)) {
        expect(value.trim(), `${locale}.${key}`).not.toBe('')
      }

      const details = detailsFor(locale)
      expect(Object.keys(details).sort(), locale).toEqual(['fresh', 'imported', 'reused'])
      for (const mode of ['fresh', 'imported', 'reused'] as const) {
        const detail = details[mode]
        for (const [key, value] of [
          ['title', detail.title],
          ['location', detail.location],
          ['sharing', detail.sharing],
          ['plugins', detail.plugins],
          ['builds', detail.builds],
        ] as const) expect(value.trim(), `${locale}.${mode}.${key}`).not.toBe('')
      }
    }
  })

  it('does not fall back to English for the seven additional locales', () => {
    const english = copyFor('en')
    const proofKeys = ['windowTitle', 'importTitle', 'reuseTitle', 'freshTitle', 'continue', 'sourceMissing'] as const

    for (const locale of DESKTOP_LOCALE_IDS.filter(locale => locale !== 'zh' && locale !== 'en')) {
      const copy = copyFor(locale)
      for (const key of proofKeys) expect(copy[key], `${locale}.${key}`).not.toBe(english[key])
      expect(detailsFor(locale).imported.location, `${locale}.details.imported.location`).not.toBe(detailsFor('en').imported.location)
    }
  })
})

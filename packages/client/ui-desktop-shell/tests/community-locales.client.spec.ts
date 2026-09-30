import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { DESKTOP_LANGUAGE_DEFINITIONS, registerDesktopLanguages } from '../src/client/community-locales.ts'

describe('community desktop locales', () => {
  it('keeps Russian third overall and orders the remaining community locales by audience size', () => {
    expect(DESKTOP_LANGUAGE_DEFINITIONS.map(({ id }) => id)).toEqual([
      'ru', 'es', 'fr', 'pt-BR', 'de', 'ja', 'ko',
    ])
  })

  it('registers each locale namespace exactly once after merging desktop additions', () => {
    const ctx = new Context()
    const locale = new LocaleRuntime(ctx)
    ctx.provide('locale', locale)

    const dispose = registerDesktopLanguages(ctx)
    for (const definition of DESKTOP_LANGUAGE_DEFINITIONS) {
      locale.setLocale(definition.id)
      expect(locale.bind('desktop-shell')('nas.title')).toBeTruthy()
      expect(locale.bind('desktop-shell')('nas.address.placeholder')).toContain('https://')
    }
    dispose()
    expect(locale.getLocale().locales.map(language => language.id)).toEqual(['zh', 'en'])
  })

  it('leaves a locale owned by an installed language pack untouched', () => {
    const ctx = new Context()
    const locale = new LocaleRuntime(ctx)
    ctx.provide('locale', locale)
    locale.addLanguage({ id: 'es', label: 'Español', fallback: 'en' })
    locale.register('desktop-shell', 'es', { 'nas.title': 'Owned by language pack' })

    registerDesktopLanguages(ctx)

    locale.setLocale('es')
    expect(locale.bind('desktop-shell')('nas.title')).toBe('Owned by language pack')
    expect(locale.getLocale().locales.map(language => language.id)).toContain('ru')
  })
})

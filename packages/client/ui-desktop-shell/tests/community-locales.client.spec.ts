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

it('keeps official Portuguese copy and resolves a saved pt-BR preference without a duplicate language', () => {
  const ctx = new Context()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  locale.addLanguage({ id: 'pt', label: 'Português', fallback: 'en' })
  locale.register('conversation', 'pt', { 'hero.headline': 'Official Portuguese' })
  const dispose = registerDesktopLanguages(ctx)
  locale.setLocale('pt-BR')
  expect(locale.getLocale().active).toBe('pt')
  expect(locale.bind('conversation')('hero.headline')).toBe('Official Portuguese')
  expect(locale.getLocale().locales.filter(item => item.id.startsWith('pt'))).toHaveLength(1)
  locale.setLocale('ko')
  expect(locale.bind('settings.locale')('language.title')).toBe('언어')
  dispose()
  expect(locale.hasDictionary('conversation', 'pt')).toBe(true)
})

it.each(['community-first', 'official-first'] as const)('keeps official theme and settings copy authoritative with %s activation', async (order) => {
  const theme = await import('../../ui-theme/src/client/locales.ts')
  const settings = await import('../../ui-settings-general/src/client/locales.ts')
  const ctx = new Context()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const disposers: (() => void)[] = []
  const mountOfficial = (): void => {
    disposers.push(locale.register('settings.theme', { zh: theme.zh, en: theme.en, ja: theme.ja }))
    disposers.push(locale.register('settings', { zh: settings.zh, en: settings.en, ja: settings.ja }))
  }
  try {
    if (order === 'official-first') mountOfficial()
    disposers.push(registerDesktopLanguages(ctx))
    if (order === 'community-first') mountOfficial()
    locale.setLocale('ja')
    expect(locale.bind('settings.theme')('appearance.title')).toBe(theme.ja['appearance.title'])
    expect(locale.bind('settings')('title')).toBe(settings.ja.title)
    expect(() => locale.register('settings.theme', 'ja', { 'appearance.title': 'duplicate' })).toThrow('already has locale')
  } finally {
    for (const dispose of disposers.reverse()) dispose()
  }
  expect(locale.hasDictionary('settings.theme', 'ja')).toBe(false)
  expect(locale.bind('settings.theme')('appearance.title')).toBe('appearance.title')
})

it('keeps fallback ownership separate and restores supplemental copy when the primary pack unloads', () => {
  const locale = new LocaleRuntime(new Context())
  locale.setLocale('en')
  const revisions: number[] = []
  const unsubscribe = locale.subscribe(() => { revisions.push(locale.getSnapshot().revision) })
  const fallback = locale.registerFallback('fixture', 'en', { title: 'Supplemental', missing: 'Supplemental key' })
  expect(() => locale.registerFallback('fixture', 'en', { title: 'Second owner' })).toThrow('already has fallback locale')
  const primary = locale.register('fixture', 'en', { title: 'Primary' })
  expect(locale.bind('fixture')('title')).toBe('Primary')
  expect(locale.bind('fixture')('missing')).toBe('Supplemental key')
  expect(() => locale.register('fixture', 'en', { title: 'Second owner' })).toThrow('already has locale')
  primary()
  expect(locale.bind('fixture')('title')).toBe('Supplemental')
  fallback()
  expect(locale.bind('fixture')('title')).toBe('title')
  expect(revisions).toHaveLength(4)
  fallback()
  expect(revisions).toHaveLength(4)
  unsubscribe()
})

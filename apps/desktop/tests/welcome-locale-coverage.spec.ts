import { describe, expect, it } from 'vitest'
import { en, resolveDesktopLocale, resolveDesktopStartupLocale, zh } from '../src/locale.ts'

const languages = [
  ['ja-JP', 'ja', 'ログイン'], ['es-ES', 'es', 'Iniciar sesión'], ['fr-FR', 'fr', 'Connectez-vous'],
  ['de-DE', 'de', 'Anmelden'], ['ru-RU', 'ru', 'Войти'], ['pt-BR', 'pt', 'Faça login'], ['ko-KR', 'ko', '로그인'],
] as const

describe('official native welcome language coverage', () => {
  it.each(languages)('retains the selected %s dictionary through startup', (tag, id, signIn) => {
    const locale = resolveDesktopLocale(tag)
    expect(locale.id).toBe(id)
    expect(resolveDesktopStartupLocale(tag, ['en-US'])).toEqual(locale)
    expect(resolveDesktopStartupLocale(null, [tag, 'en-US'])).toEqual(locale)
    expect(locale.messages.welcomeSignIn).toBe(signIn)
    expect(Object.keys(locale.messages).sort()).toEqual(Object.keys(en).sort())
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(locale.messages[key].match(/\{\w+\}/gu)?.sort() ?? []).toEqual(en[key].match(/\{\w+\}/gu)?.sort() ?? [])
    }
  })

  it('preserves existing community English and Chinese copy and the unsupported-language fallback', () => {
    expect(resolveDesktopLocale('en-US').messages).toBe(en)
    expect(resolveDesktopLocale('zh-CN').messages).toBe(zh)
    expect(resolveDesktopLocale('it-IT').messages).toBe(en)
  })
})

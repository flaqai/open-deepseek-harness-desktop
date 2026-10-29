import { describe, expect, it } from 'vitest'
import { DESKTOP_LOCALE_IDS } from '../src/desktop-locale.ts'
import { nativePromptMessages, nativePromptText } from '../src/locales/native-prompts.ts'
import { permissionNames } from '../src/locales/permission-names.ts'
import { harnessPermissionName } from '../src/permissions.ts'

const tokens = (copy: string): string[] => [...copy.matchAll(/\{\w+\}/g)].map(match => match[0]).sort()

describe('native consent translations', () => {
  for (const locale of DESKTOP_LOCALE_IDS) {
    it(`provides complete prompts and permissions in ${locale}`, () => {
      const reference = nativePromptMessages('en')
      const copy = nativePromptMessages(locale)
      expect(Object.keys(copy).sort()).toEqual(Object.keys(reference).sort())
      for (const key of Object.keys(reference) as (keyof typeof reference)[]) {
        expect(tokens(copy[key]), key).toEqual(tokens(reference[key]))
        if (locale !== 'en') expect(copy[key], key).not.toBe(reference[key])
      }
      const names = permissionNames(locale)
      expect(Object.keys(names).sort()).toEqual(Object.keys(permissionNames('en')).sort())
      for (const key of Object.keys(names)) {
        expect(names[key]?.length, key).toBeGreaterThan(0)
        if (locale !== 'en') expect(names[key], key).not.toBe(permissionNames('en')[key])
      }
      expect(harnessPermissionName('media', { mediaTypes: ['audio'] }, locale)).toBe(names['media:audio'])
      expect(harnessPermissionName('media', { mediaTypes: ['video'] }, locale)).toBe(names['media:video'])
      expect(harnessPermissionName('media', {}, locale)).toBe(names['media:both'])
      expect(harnessPermissionName('unknown', {}, locale)).toBe(names['unknown'])
    })
  }
  it('normalizes regional locales and preserves inserted values literally', () => {
    expect(nativePromptMessages('pt-PT')).toEqual(nativePromptMessages('pt-BR'))
    expect(harnessPermissionName('notifications', {}, 'ja-JP')).toBe(permissionNames('ja')['notifications'])
    expect(nativePromptText('{package}', { package: '{detail} $()' })).toBe('{detail} $()')
  })
})

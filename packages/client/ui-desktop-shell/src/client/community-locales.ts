/** Community desktop language catalog and the locale selector's own copy. */

import type { Context } from '@deepseek-ai/cordis'
import type { LanguageRegistration } from '@deepseek-ai/dsh-client-locale/client'
import { desktopLanguageTitles } from './locales.ts'
import { COMMUNITY_TRANSLATIONS } from './community-translations/index.ts'
import { COMMUNITY_SURFACE_TRANSLATIONS } from './community-translations/surfaces.ts'
import { DOWNLOAD_NETWORK_TRANSLATIONS } from './download-network-locales.ts'
import { NAS_TRANSLATIONS } from './nas-locales.ts'
import { ru } from './locales.ts'

/** Additional languages offered by Open DSH Desktop. */
export const DESKTOP_LANGUAGE_DEFINITIONS = [
  { id: 'ru', label: 'Русский', fallback: 'en' },
  { id: 'es', label: 'Español', fallback: 'en' },
  { id: 'fr', label: 'Français', fallback: 'en' },
  { id: 'pt-BR', label: 'Português (Brasil)', fallback: 'pt' },
  { id: 'de', label: 'Deutsch', fallback: 'en' },
  { id: 'ja', label: '日本語', fallback: 'en' },
  { id: 'ko', label: '한국어', fallback: 'en' },
] as const satisfies readonly LanguageRegistration[]

/**
 * Register the community languages and their selector label as one reversible effect.
 * @param ctx - Desktop-shell client context.
 * @returns Cleanup that removes dictionaries before their language definitions.
 */
export function registerDesktopLanguages(ctx: Context): () => void {
  const disposers: (() => void)[] = []
  try {
    const occupied = new Set(ctx.locale.getSnapshot().locales.map(locale => locale.id.toLowerCase()))
    for (const definition of DESKTOP_LANGUAGE_DEFINITIONS) {
      // A separately installed language pack owns both its catalog row and
      // namespace dictionaries. Leave that locale untouched instead of
      // aborting the complete client plugin tree with duplicate registration.
      const existing = occupied.has(definition.id.toLowerCase()) || (definition.id === 'pt-BR' && occupied.has('pt'))
      if (!existing) disposers.push(ctx.locale.addLanguage({ ...definition, fallback: definition.id === 'pt-BR' && !occupied.has('pt') ? 'en' : definition.fallback }))
      occupied.add(definition.id.toLowerCase())
      disposers.push(ctx.locale.registerFallback('settings.locale', definition.id, {
        'language.title': desktopLanguageTitles[definition.id],
      }))
      const dictionaries: Record<string, Record<string, string>> = {}
      for (const source of [COMMUNITY_TRANSLATIONS[definition.id], COMMUNITY_SURFACE_TRANSLATIONS[definition.id]]) {
        const namespaces = source as Readonly<Record<string, Readonly<Record<string, string>>>>
        for (const [namespace, dictionary] of Object.entries(namespaces)) {
          dictionaries[namespace] = { ...dictionaries[namespace], ...dictionary }
        }
      }
      dictionaries['desktop-shell'] = {
        ...dictionaries['desktop-shell'],
        ...(definition.id === 'ru' ? ru : DOWNLOAD_NETWORK_TRANSLATIONS[definition.id]),
        ...(definition.id === 'ru' ? {} : NAS_TRANSLATIONS[definition.id]),
      }
      for (const [namespace, dictionary] of Object.entries(dictionaries)) {
        disposers.push(ctx.locale.registerFallback(namespace, definition.id, dictionary))
      }
    }
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose()
    throw error
  }
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}

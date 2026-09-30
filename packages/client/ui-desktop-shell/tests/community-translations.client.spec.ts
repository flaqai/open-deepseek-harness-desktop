import { describe, expect, it } from 'vitest'
import { COMMUNITY_TRANSLATIONS } from '../src/client/community-translations/index.ts'
import { COMMUNITY_SURFACE_TRANSLATIONS } from '../src/client/community-translations/surfaces.ts'
import { en as sidebarRight } from '../../ui-sidebar-right/src/client/locales.ts'
import { en as sidebarFiles } from '../../ui-sidebar-files/src/client/locales.ts'
import { en as sidebarDocumentPreview } from '../../ui-sidebar-documentpreview/src/client/locales.ts'
import { en as documentMarkdown } from '../../ui-sidebar-documentpreview/src/client/markdown/locales.ts'
import { en as sidebarPdf } from '../../ui-sidebar-documentpreview/src/client/pdf/locales.ts'
import { en as documentHtml } from '../../ui-sidebar-documentpreview/src/client/html/locales.ts'
import { en as sidebarCodePreview } from '../../ui-sidebar-documentpreview/src/client/code/locales.ts'
import { en as sidebarImage } from '../../ui-sidebar-documentpreview/src/client/image/locales.ts'
import { en as feedback } from '../../ui-message-feedback/src/client/locales.ts'

const localeIds = ['ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru'] as const
type TranslationDictionary = Record<string, string>
type TranslationCatalog = Record<string, TranslationDictionary>
const translations: Record<(typeof localeIds)[number], TranslationCatalog> = {
  ja: { ...COMMUNITY_TRANSLATIONS.ja, ...COMMUNITY_SURFACE_TRANSLATIONS.ja },
  ko: { ...COMMUNITY_TRANSLATIONS.ko, ...COMMUNITY_SURFACE_TRANSLATIONS.ko },
  es: { ...COMMUNITY_TRANSLATIONS.es, ...COMMUNITY_SURFACE_TRANSLATIONS.es },
  fr: { ...COMMUNITY_TRANSLATIONS.fr, ...COMMUNITY_SURFACE_TRANSLATIONS.fr },
  de: { ...COMMUNITY_TRANSLATIONS.de, ...COMMUNITY_SURFACE_TRANSLATIONS.de },
  'pt-BR': { ...COMMUNITY_TRANSLATIONS['pt-BR'], ...COMMUNITY_SURFACE_TRANSLATIONS['pt-BR'] },
  ru: { ...COMMUNITY_TRANSLATIONS.ru, ...COMMUNITY_SURFACE_TRANSLATIONS.ru },
}

const currentSurfaceKeys: TranslationCatalog = {
  sidebarRight,
  sidebarFiles,
  sidebarDocumentPreview,
  documentMarkdown,
  sidebarPdf,
  documentHtml,
  sidebarCodePreview,
  sidebarImage,
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Missing translation entry: ${label}`)
  return value
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{[^{}]+\}/g)].map(match => match[0]).sort()
}

describe('community desktop translations', () => {
  it('translates every current feedback field in all desktop locales', () => {
    for (const locale of localeIds) {
      for (const key of Object.keys(feedback)) {
        expect(translations[locale].feedback?.[key], `${locale}:feedback.${key}`).toBeTruthy()
      }
    }
  })
  it('keeps every bundled locale on the same namespace and key surface', () => {
    const reference = translations.ja
    const namespaces = Object.keys(reference).sort()
    for (const locale of localeIds) {
      const dictionaries = translations[locale]
      expect(Object.keys(dictionaries).sort(), `${locale} namespaces`).toEqual(namespaces)
      for (const namespace of namespaces) {
        expect(
          Object.keys(required(dictionaries[namespace], `${locale}:${namespace}`)).sort(),
          `${locale}:${namespace} keys`,
        ).toEqual(Object.keys(required(reference[namespace], `ja:${namespace}`)).sort())
      }
    }
  })

  it('preserves placeholders and contains no translation transport markers', () => {
    const reference = translations.ja
    for (const locale of localeIds) {
      const dictionaries = translations[locale]
      for (const [namespace, dictionary] of Object.entries(dictionaries)) {
        for (const [key, value] of Object.entries(dictionary)) {
          expect(value, `${locale}:${namespace}.${key}`).not.toMatch(/__DSH(?:ROW|P|NL)/)
          expect(placeholders(value), `${locale}:${namespace}.${key} placeholders`).toEqual(
            placeholders(required(reference[namespace]?.[key], `ja:${namespace}.${key}`)),
          )
        }
      }
    }
  })

  it('retains the authoritative Russian wording on representative upstream keys', () => {
    const russian = translations.ru
    expect(required(russian.common, 'ru:common').cancel).toBe('Отмена')
    expect(required(russian.conversation, 'ru:conversation')['hero.headline']).toBe('К неизведанному')
    expect(required(russian.sidebar, 'ru:sidebar')['session.new']).toBe('Новая сессия')
    expect(required(russian.workspace, 'ru:workspace')['section.workspaces']).toBe('Рабочие пространства')
    expect(required(russian.model, 'ru:model')['trigger.fallback']).toBe('Выбрать модель')
    expect(required(russian.trajectory, 'ru:trajectory')['timing.ttft']).toBe('TTFT')
  })

  it('matches every current right-sidebar and document-preview source key', () => {
    for (const locale of localeIds) {
      for (const [namespace, source] of Object.entries(currentSurfaceKeys)) {
        const translated = required(translations[locale][namespace], `${locale}:${namespace}`)
        expect(Object.keys(translated).sort(), `${locale}:${namespace} keys`).toEqual(Object.keys(source).sort())
        for (const key of Object.keys(source)) {
          expect(translated[key], `${locale}:${namespace}.${key}`).toBeTruthy()
          expect(placeholders(required(translated[key], `${locale}:${namespace}.${key}`))).toEqual(
            placeholders(required(source[key], `en:${namespace}.${key}`)),
          )
        }
      }
    }
  })
})

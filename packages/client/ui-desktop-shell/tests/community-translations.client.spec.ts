import { describe, expect, it } from 'vitest'
import { COMMUNITY_TRANSLATIONS } from '../src/client/community-translations/index.ts'
import { COMMUNITY_SURFACE_TRANSLATIONS } from '../src/client/community-translations/surfaces.ts'
import { en as sidebarRight } from '../../ui-sidebar-right/src/client/locales.ts'
import * as officialSidebarRight from '../../ui-sidebar-right/src/client/locales.ts'
import { en as sidebarFiles } from '../../ui-sidebar-files/src/client/locales.ts'
import { en as sidebarDocumentPreview } from '../../ui-sidebar-documentpreview/src/client/locales.ts'
import { en as documentMarkdown } from '../../ui-sidebar-documentpreview/src/client/markdown/locales.ts'
import { en as sidebarPdf } from '../../ui-sidebar-documentpreview/src/client/pdf/locales.ts'
import { en as documentHtml } from '../../ui-sidebar-documentpreview/src/client/html/locales.ts'
import { en as sidebarCodePreview } from '../../ui-sidebar-documentpreview/src/client/code/locales.ts'
import { en as sidebarImage } from '../../ui-sidebar-documentpreview/src/client/image/locales.ts'
import { en as feedback } from '../../ui-message-feedback/src/client/locales.ts'
import { en as entryCustomization } from '../../ui-entry-customization/src/client/locales.ts'
import { en as approval } from '../../ui-approval/src/client/locales.ts'
import { en as chat } from '../../ui-chat/src/client/locale.ts'
import { en as pluginManager } from '../../ui-plugin-manager/src/client/locales.ts'
import { en as account } from '../../ui-settings-account/src/client/locales.ts'
import { en as models } from '../../ui-settings-models/src/client/locales.ts'
import { en as webSearch } from '../../ui-settings-web-search/src/client/locales.ts'
import { en as workspace } from '../../ui-workspace/src/client/locales.ts'
import { en as sidebar } from '../../ui-sidebar/src/client/locales.ts'
import { en as agentTeam } from '../../../experimental/client-ui-agent-team/src/client/locales.ts'
import { en as sessionLogDownload } from '../../../session-query/session-log-export/src/client/locales.ts'

const localeIds = ['ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru'] as const
type TranslationDictionary = Record<string, string>
type TranslationCatalog = Record<string, TranslationDictionary>
function catalog(locale: (typeof localeIds)[number]): TranslationCatalog {
  const dictionaries: TranslationCatalog = {}
  // Runtime overlays namespaces per key; a surface does not discard its snapshot's other keys.
  for (const source of [COMMUNITY_TRANSLATIONS[locale], COMMUNITY_SURFACE_TRANSLATIONS[locale]]) {
    const namespaces: TranslationCatalog = { ...source }
    for (const [namespace, dictionary] of Object.entries(namespaces)) {
      dictionaries[namespace] = { ...dictionaries[namespace], ...dictionary }
    }
  }
  return dictionaries
}
const translations: Record<(typeof localeIds)[number], TranslationCatalog> = {
  ja: catalog('ja'), ko: catalog('ko'), es: catalog('es'), fr: catalog('fr'),
  de: catalog('de'), 'pt-BR': catalog('pt-BR'), ru: catalog('ru'),
}

const currentSurfaceKeys: TranslationCatalog = {
  entryCustomization,
  sidebarRight,
  sidebarFiles,
  sidebarDocumentPreview,
  documentMarkdown,
  sidebarPdf,
  documentHtml,
  sidebarCodePreview,
  sidebarImage,
}

// Korean supplies keys whose other languages are already owned by feature dictionaries.
const supplementalSources: TranslationCatalog = {
  approval, chat, pluginManager, workspace,
  'settings.account': account,
  'settings.models': models,
  'settings.webSearch': webSearch,
  'agent-team': agentTeam,
  'session-log-download': sessionLogDownload,
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Missing translation entry: ${label}`)
  return value
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{[^{}]+\}/g)].map(match => match[0]).sort()
}

describe('community desktop translations', () => {
  it('translates the new sidebar and conversation More controls', () => {
    for (const locale of localeIds) {
      expect(translations[locale].sidebar?.['panels.more']).toBeTruthy()
      for (const key of ['workspace.unavailable', 'workspace.failed', 'workspace.retry'] as const) {
        expect(translations[locale].sidebar?.[key], `${locale}:sidebar.${key}`).toBeTruthy()
        expect(placeholders(required(translations[locale].sidebar?.[key], `${locale}:sidebar.${key}`))).toEqual(placeholders(sidebar[key]))
      }
      expect(translations[locale].conversation?.['session.moreViews']).toBeTruthy()
      expect(placeholders(required(translations[locale].conversation?.['session.moreViewsCurrent'], `${locale}:conversation.session.moreViewsCurrent`)))
        .toEqual(['{name}'])
    }
  })
  it('translates every current feedback field in all desktop locales', () => {
    for (const locale of localeIds) {
      for (const key of Object.keys(feedback)) {
        expect(translations[locale].feedback?.[key], `${locale}:feedback.${key}`).toBeTruthy()
      }
    }
  })
  it('covers the shared snapshot surface and retains source-backed Korean supplemental keys', () => {
    const reference = translations.ja
    const namespaces = Object.keys(reference).sort()
    for (const locale of localeIds) {
      const dictionaries = translations[locale]
      for (const namespace of namespaces) {
        expect(
          Object.keys(required(dictionaries[namespace], `${locale}:${namespace}`)).sort(),
          `${locale}:${namespace} keys`,
        ).toEqual(expect.arrayContaining(Object.keys(required(reference[namespace], `ja:${namespace}`)).sort()))
      }
      for (const [namespace, dictionary] of Object.entries(dictionaries)) {
        for (const key of Object.keys(dictionary)) {
          if (reference[namespace]?.[key] !== undefined) continue
          expect(locale, `${namespace}.${key} supplemental owner`).toBe('ko')
          expect(supplementalSources[namespace]?.[key], `en:${namespace}.${key}`).toBeTruthy()
        }
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
            placeholders(required(reference[namespace]?.[key] ?? supplementalSources[namespace]?.[key], `source:${namespace}.${key}`)),
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

  it('uses feature-owned wording for new tab-menu translations in existing official languages', () => {
    const official = {
      ja: officialSidebarRight.ja, es: officialSidebarRight.es, fr: officialSidebarRight.fr,
      de: officialSidebarRight.de, 'pt-BR': officialSidebarRight.pt, ru: officialSidebarRight.ru,
    }
    for (const [locale, dictionary] of Object.entries(official)) {
      for (const key of ['menu.close', 'menu.closeOthers', 'menu.closeRight'] as const) {
        expect(translations[locale as keyof typeof translations].sidebarRight?.[key], `${locale}:${key}`).toBe(dictionary[key])
      }
    }
  })

  it('matches every current right-sidebar and document-preview source key', () => {
    for (const locale of localeIds) {
      for (const [namespace, source] of Object.entries(currentSurfaceKeys)) {
        // Current supplements match their owner exactly; merged runtime catalogs also retain historical snapshot keys.
        const surface: TranslationCatalog = { ...COMMUNITY_SURFACE_TRANSLATIONS[locale] }
        const translated = required(surface[namespace] ?? translations[locale][namespace], `${locale}:${namespace}`)
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

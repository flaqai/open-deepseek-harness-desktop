import { describe, expect, it } from 'vitest'
import { en, ja, es, fr, de, ru, pt } from '../src/client/locales.ts'

const locales = { ja, es, fr, de, ru, pt }

describe('community settings translations', () => {
  for (const [language, dictionary] of Object.entries(locales)) {
    it(`keeps restored plugin diagnostics and recovery copy localized in ${language}`, () => {
      for (const key of ['restore.title', 'diagnostics.title', 'external.title'] as const) {
        expect(dictionary[key], key).not.toBe(en[key])
      }
    })
    it(`has no unreviewed English fallback in ${language}`, () => {
      const unchanged = new Set([
        'portableExport.target.windows', 'portableExport.target.macos', 'portableExport.target.linux',
        'portableExport.target.x64', 'portableExport.target.arm64', 'lab.progress', 'lab.duration', 'discovery.elapsed',
        'external.capability.browser.backend.devtools', 'external.capability.browser.backend.stagehand',
        'external.capability.computer.backend.mcp', 'external.runtime.ptc.title', 'external.terminal.signal',
        'diagnostics.issue.phase', 'diagnostics.incompatible', 'moduleLabel', 'configuration',
        'external.action.pause', 'restore.development.offline', 'runtime',
      ])
      for (const key of Object.keys(en) as (keyof typeof en)[]) {
        if (!unchanged.has(key)) expect(dictionary[key], key).not.toBe(en[key])
      }
    })
    it(`retains the English interpolation contract in ${language}`, () => {
      for (const [key, value] of Object.entries(en)) {
        const placeholders = (copy: string): string[] => [...copy.matchAll(/\{([a-zA-Z]\w*)\}/g)].map(match => match[1]!).sort()
        expect(placeholders(dictionary[key as keyof typeof en]), key).toEqual(placeholders(value))
      }
    })
  }
})

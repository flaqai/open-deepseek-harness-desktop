import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  createDesktopPreferencesStore, DEFAULT_DESKTOP_PREFERENCES, normalizeDesktopPreferences,
  parseDesktopPreferencesPatch,
} from '../src/preferences.ts'

describe('desktop preferences', () => {
  it('normalizes missing and invalid fields independently', () => {
    expect(normalizeDesktopPreferences({ closeBehavior: 'quit', notificationsEnabled: 'yes' })).toEqual({
      closeBehavior: 'quit', notificationsEnabled: true, launchAtLoginEnabled: false,
    })
    expect(normalizeDesktopPreferences(null)).toEqual(DEFAULT_DESKTOP_PREFERENCES)
  })

  it('rejects unknown and mistyped renderer fields', () => {
    expect(() => parseDesktopPreferencesPatch({ closeBehavior: 'hide' })).toThrow()
    expect(() => parseDesktopPreferencesPatch({ extra: true })).toThrow()
    expect(parseDesktopPreferencesPatch({ notificationsEnabled: false })).toEqual({ notificationsEnabled: false })
  })

  it('writes complete JSON atomically and falls back on corrupt data', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-desktop-preferences-'))
    const path = join(directory, 'preferences.json')
    const report = vi.fn()
    try {
      const store = createDesktopPreferencesStore(path, report)
      store.write({ closeBehavior: 'quit', notificationsEnabled: false, launchAtLoginEnabled: true })
      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
        closeBehavior: 'quit', notificationsEnabled: false, launchAtLoginEnabled: true,
      })
      writeFileSync(path, '{broken', 'utf8')
      expect(store.read()).toEqual(DEFAULT_DESKTOP_PREFERENCES)
      expect(report).toHaveBeenCalledOnce()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

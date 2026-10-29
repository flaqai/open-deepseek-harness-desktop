import { describe, expect, it } from 'vitest'
import { shellMessages, trayMessages, dataHomeMessages } from '../src/locales/shell.ts'

describe('desktop tray locales', () => {
  it.each([
    ['zh-CN', '打开窗口'], ['ja-JP', 'ウインドウを開く'], ['ko-KR', '창 열기'],
    ['es-ES', 'Abrir ventana'], ['fr-FR', 'Ouvrir la fenêtre'], ['de-DE', 'Fenster öffnen'],
    ['pt-BR', 'Abrir janela'], ['ru-RU', 'Открыть окно'],
  ])('uses the active desktop language for %s', (locale, openLabel) => {
    expect(trayMessages(locale).open).toBe(openLabel)
  })

  it('falls back to English for an unsupported language', () => {
    expect(trayMessages('it-IT').open).toBe('Open Window')
  })
})

describe('desktop offline plugin restore dialogs', () => {
  it('keeps the imported transfer and approval actions in their original order', () => {
    for (const [locale, title, count] of [
      ['en', 'Use the imported offline transfer?', 'Install 2 plugins offline'],
      ['zh-CN', '使用已导入的离线包？', '将离线安装 2 个插件'],
    ] as const) {
      const copy = shellMessages(locale)
      expect(copy.useImportedTransferTitle).toBe(title)
      expect(copy.installPluginsOffline(2)).toBe(count)
      expect([copy.cancel, copy.useImportedTransfer, copy.chooseAnotherTransfer]).toHaveLength(3)
      expect([copy.cancel, copy.install]).toHaveLength(2)
    }
  })
})

describe('community native dialog languages', () => {
  it.each(['ja-JP', 'es-ES', 'fr-FR', 'de-DE', 'ru-RU', 'pt-BR', 'ko-KR'])(
    'localizes every shell and import-result message for %s without losing dynamic details', (locale) => {
      const english = shellMessages('en')
      const translated = shellMessages(locale)
      expect(Object.keys(translated).sort()).toEqual(Object.keys(english).sort())
      for (const key of Object.keys(english) as (keyof typeof english)[]) {
        if (key !== 'productName' && typeof english[key] === 'string') expect(translated[key], key).not.toBe(english[key])
      }
      expect(translated.processRecoveryFailed('UNIQUE-DETAIL')).toContain('UNIQUE-DETAIL')
      expect(translated.installPluginsOffline(37)).toContain('37')
      expect(translated.permissionTitle('UNIQUE-APP')).toContain('UNIQUE-APP')
      expect(translated.permissionMessage('UNIQUE-CAPABILITY')).toContain('UNIQUE-CAPABILITY')
      expect(translated.confirmPlugin('UNIQUE-PLUGIN')).toContain('UNIQUE-PLUGIN')
      expect(translated.initializeFailed('UNIQUE-ERROR')).toContain('UNIQUE-ERROR')
      expect(translated.harnessHttpFailed(503)).toContain('503')
      expect(translated.bundledPreparationFailed('UNIQUE-PREPARATION')).toContain('UNIQUE-PREPARATION')
      const imported = dataHomeMessages(locale)
      for (const key of Object.keys(imported) as (keyof typeof imported)[]) {
        expect(imported[key]).not.toBe(dataHomeMessages('en')[key])
      }
    },
  )

  it('normalizes Portuguese and falls back only for unsupported native-dialog languages', () => {
    expect(shellMessages('pt-PT')).toBe(shellMessages('pt-BR'))
    expect(shellMessages('it-IT')).toBe(shellMessages('en'))
    expect(dataHomeMessages('it-IT')).toEqual(dataHomeMessages('en'))
  })
})

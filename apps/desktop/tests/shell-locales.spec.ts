import { describe, expect, it } from 'vitest'
import { shellMessages, trayMessages } from '../src/locales/shell.ts'

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

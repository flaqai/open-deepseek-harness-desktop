/** Localized editing and local-spelling menu commands. */
export const EDITABLE_MENU_NS = 'desktop-editable-menu'
/** English local editing-menu labels. */
export const en = {
  undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select all',
  toggle: 'Check spelling while typing', add: 'Add to dictionary', none: 'No spelling suggestions',
  unavailable: 'Local spelling dictionary unavailable', failed: 'The input changed. Open its menu again to retry.',
}
/** Locale-owned keys for the editable Desktop menu. */
export type EditableMenuKey = keyof typeof en
/** Simplified Chinese local editing-menu labels. */
export const zh: Record<EditableMenuKey, string> = {
  undo: '撤销', redo: '重做', cut: '剪切', copy: '复制', paste: '粘贴', selectAll: '全选',
  toggle: '输入时检查拼写', add: '加入词典', none: '没有拼写建议', unavailable: '本地拼写词典不可用',
  failed: '输入内容已变化，请重新打开菜单后再试。',
}
/** Japanese local editing-menu labels. */
export const ja: Record<EditableMenuKey, string> = {
  undo: '元に戻す', redo: 'やり直す', cut: '切り取り', copy: 'コピー', paste: '貼り付け', selectAll: 'すべて選択',
  toggle: '入力中にスペルをチェック', add: '辞書に追加', none: '修正候補なし', unavailable: 'ローカル辞書を利用できません',
  failed: '入力が変更されました。メニューを開き直してください。',
}
/** Korean local editing-menu labels. */
export const ko: Record<EditableMenuKey, string> = {
  undo: '실행 취소', redo: '다시 실행', cut: '잘라내기', copy: '복사', paste: '붙여넣기', selectAll: '모두 선택',
  toggle: '입력 중 맞춤법 검사', add: '사전에 추가', none: '맞춤법 제안 없음', unavailable: '로컬 사전을 사용할 수 없음',
  failed: '입력 내용이 변경되었습니다. 메뉴를 다시 열어 주세요.',
}
/** German local editing-menu labels. */
export const de: Record<EditableMenuKey, string> = {
  undo: 'Rückgängig', redo: 'Wiederholen', cut: 'Ausschneiden', copy: 'Kopieren', paste: 'Einfügen', selectAll: 'Alles auswählen',
  toggle: 'Rechtschreibung beim Tippen prüfen', add: 'Zum Wörterbuch hinzufügen', none: 'Keine Rechtschreibvorschläge',
  unavailable: 'Lokales Wörterbuch nicht verfügbar', failed: 'Die Eingabe wurde geändert. Öffnen Sie das Menü erneut.',
}
/** French local editing-menu labels. */
export const fr: Record<EditableMenuKey, string> = {
  undo: 'Annuler', redo: 'Rétablir', cut: 'Couper', copy: 'Copier', paste: 'Coller', selectAll: 'Tout sélectionner',
  toggle: 'Vérifier l’orthographe pendant la saisie', add: 'Ajouter au dictionnaire', none: 'Aucune suggestion orthographique',
  unavailable: 'Dictionnaire local indisponible', failed: 'La saisie a changé. Rouvrez le menu pour réessayer.',
}
/** Spanish local editing-menu labels. */
export const es: Record<EditableMenuKey, string> = {
  undo: 'Deshacer', redo: 'Rehacer', cut: 'Cortar', copy: 'Copiar', paste: 'Pegar', selectAll: 'Seleccionar todo',
  toggle: 'Revisar ortografía al escribir', add: 'Añadir al diccionario', none: 'Sin sugerencias ortográficas',
  unavailable: 'Diccionario local no disponible', failed: 'El texto ha cambiado. Vuelve a abrir el menú.',
}
/** Brazilian Portuguese local editing-menu labels. */
export const pt: Record<EditableMenuKey, string> = {
  undo: 'Desfazer', redo: 'Refazer', cut: 'Recortar', copy: 'Copiar', paste: 'Colar', selectAll: 'Selecionar tudo',
  toggle: 'Verificar ortografia ao digitar', add: 'Adicionar ao dicionário', none: 'Sem sugestões ortográficas',
  unavailable: 'Dicionário local indisponível', failed: 'O texto mudou. Abra o menu novamente.',
}
/** Russian local editing-menu labels. */
export const ru: Record<EditableMenuKey, string> = {
  undo: 'Отменить', redo: 'Повторить', cut: 'Вырезать', copy: 'Копировать', paste: 'Вставить', selectAll: 'Выбрать всё',
  toggle: 'Проверять правописание при вводе', add: 'Добавить в словарь', none: 'Нет вариантов исправления',
  unavailable: 'Локальный словарь недоступен', failed: 'Текст изменился. Откройте меню ещё раз.',
}

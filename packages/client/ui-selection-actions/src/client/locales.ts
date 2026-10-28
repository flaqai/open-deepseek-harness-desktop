/** Selected-text action labels and feedback. */

/** Dictionary namespace owned by the selected-text action plugin. */
export const NS = 'selectionActions'

/** Simplified Chinese dictionary. */
export const zh = {
  'action.copy': '复制',
  'action.ask': '在新对话询问',
  'action.append': '添加到当前对话',
  'action.restart': '快速重启',
  'status.copied': '已复制选中文字',
  'status.added': '已添加到当前对话',
  'status.newConversation': '已添加到新对话草稿',
  'error.copy': '复制失败',
  'error.action': '操作失败，请重试',
  'error.restart': '无法快速重启，请稍后再试',
  'prompt.ask': '请回答以下选中内容：',
  'toolbar.aria': '选中文字操作',
  'menu.aria': '选中文字菜单',
} satisfies Record<string, string>

/** Dictionary key union. */
export type SelectionActionsKey = keyof typeof zh

/** English dictionary. */
export const en = {
  'action.copy': 'Copy',
  'action.ask': 'Ask in new conversation',
  'action.append': 'Add to current conversation',
  'action.restart': 'Quick restart',
  'status.copied': 'Selected text copied',
  'status.added': 'Added to the current conversation',
  'status.newConversation': 'Added to a new conversation draft',
  'error.copy': 'Copy failed',
  'error.action': 'Action failed. Try again.',
  'error.restart': 'Could not restart. Try again shortly.',
  'prompt.ask': 'Please answer the following selected text:',
  'toolbar.aria': 'Selected text actions',
  'menu.aria': 'Selected text menu',
} satisfies Record<SelectionActionsKey, string>

/** Japanese dictionary. */
export const ja = {
  ...en,
  'action.copy': 'コピー',
  'action.ask': '新しい会話で質問',
  'action.append': '現在の会話に追加',
  'action.restart': 'クイック再起動',
  'status.copied': '選択したテキストをコピーしました',
  'status.added': '現在の会話に追加しました',
  'status.newConversation': '新しい会話の下書きに追加しました',
  'error.copy': 'コピーできませんでした',
  'error.action': '操作に失敗しました。もう一度お試しください。',
  'error.restart': '再起動できませんでした。しばらくしてからお試しください。',
  'prompt.ask': '次の選択したテキストについて回答してください：',
  'toolbar.aria': '選択したテキストの操作',
  'menu.aria': '選択したテキストのメニュー',
} satisfies Record<SelectionActionsKey, string>

/** Korean dictionary. */
export const ko = {
  ...en,
  'action.copy': '복사',
  'action.ask': '새 대화에서 질문',
  'action.append': '현재 대화에 추가',
  'action.restart': '빠른 재시작',
  'status.copied': '선택한 텍스트를 복사했습니다',
  'status.added': '현재 대화에 추가했습니다',
  'status.newConversation': '새 대화 초안에 추가했습니다',
  'error.copy': '복사하지 못했습니다',
  'error.action': '작업에 실패했습니다. 다시 시도하세요.',
  'error.restart': '재시작하지 못했습니다. 잠시 후 다시 시도하세요.',
  'prompt.ask': '다음 선택한 텍스트에 답변하세요:',
  'toolbar.aria': '선택한 텍스트 작업',
  'menu.aria': '선택한 텍스트 메뉴',
} satisfies Record<SelectionActionsKey, string>

/** Spanish dictionary. */
export const es = {
  ...en,
  'action.copy': 'Copiar',
  'action.ask': 'Preguntar en una conversación nueva',
  'action.append': 'Añadir a la conversación actual',
  'action.restart': 'Reinicio rápido',
  'status.copied': 'Texto seleccionado copiado',
  'status.added': 'Añadido a la conversación actual',
  'status.newConversation': 'Añadido al borrador de una conversación nueva',
  'error.copy': 'No se pudo copiar',
  'error.action': 'La acción falló. Inténtalo de nuevo.',
  'error.restart': 'No se pudo reiniciar. Inténtalo de nuevo en unos instantes.',
  'prompt.ask': 'Responde al siguiente texto seleccionado:',
  'toolbar.aria': 'Acciones del texto seleccionado',
  'menu.aria': 'Menú del texto seleccionado',
} satisfies Record<SelectionActionsKey, string>

/** French dictionary. */
export const fr = {
  ...en,
  'action.copy': 'Copier',
  'action.ask': 'Demander dans une nouvelle conversation',
  'action.append': 'Ajouter à la conversation actuelle',
  'action.restart': 'Redémarrage rapide',
  'status.copied': 'Texte sélectionné copié',
  'status.added': 'Ajouté à la conversation actuelle',
  'status.newConversation': 'Ajouté au brouillon d’une nouvelle conversation',
  'error.copy': 'Échec de la copie',
  'error.action': 'Échec de l’action. Réessayez.',
  'error.restart': 'Échec du redémarrage. Réessayez dans un instant.',
  'prompt.ask': 'Répondez au texte sélectionné suivant :',
  'toolbar.aria': 'Actions sur le texte sélectionné',
  'menu.aria': 'Menu du texte sélectionné',
} satisfies Record<SelectionActionsKey, string>

/** German dictionary. */
export const de = {
  ...en,
  'action.copy': 'Kopieren',
  'action.ask': 'In einer neuen Unterhaltung fragen',
  'action.append': 'Zur aktuellen Unterhaltung hinzufügen',
  'action.restart': 'Schnell neu starten',
  'status.copied': 'Ausgewählten Text kopiert',
  'status.added': 'Zur aktuellen Unterhaltung hinzugefügt',
  'status.newConversation': 'Zum Entwurf einer neuen Unterhaltung hinzugefügt',
  'error.copy': 'Kopieren fehlgeschlagen',
  'error.action': 'Aktion fehlgeschlagen. Bitte erneut versuchen.',
  'error.restart': 'Neustart fehlgeschlagen. Bitte gleich erneut versuchen.',
  'prompt.ask': 'Beantworte den folgenden ausgewählten Text:',
  'toolbar.aria': 'Aktionen für ausgewählten Text',
  'menu.aria': 'Menü für ausgewählten Text',
} satisfies Record<SelectionActionsKey, string>

/** Brazilian Portuguese dictionary. */
export const ptBR = {
  ...en,
  'action.copy': 'Copiar',
  'action.ask': 'Perguntar em uma nova conversa',
  'action.append': 'Adicionar à conversa atual',
  'action.restart': 'Reinício rápido',
  'status.copied': 'Texto selecionado copiado',
  'status.added': 'Adicionado à conversa atual',
  'status.newConversation': 'Adicionado ao rascunho de uma nova conversa',
  'error.copy': 'Falha ao copiar',
  'error.action': 'A ação falhou. Tente novamente.',
  'error.restart': 'Falha ao reiniciar. Tente novamente em instantes.',
  'prompt.ask': 'Responda ao seguinte texto selecionado:',
  'toolbar.aria': 'Ações do texto selecionado',
  'menu.aria': 'Menu do texto selecionado',
} satisfies Record<SelectionActionsKey, string>

/** Russian dictionary supplied by the ru-locale contributor. */
export const ru = {
  ...en,
  'action.copy': 'Копировать',
  'action.ask': 'Спросить в новом диалоге',
  'action.append': 'Добавить в текущий диалог',
  'action.restart': 'Быстрый перезапуск',
  'status.copied': 'Выделенный текст скопирован',
  'status.added': 'Добавлено в текущий диалог',
  'status.newConversation': 'Добавлено в черновик нового диалога',
  'error.copy': 'Не удалось скопировать',
  'error.action': 'Операция не удалась. Повторите попытку.',
  'error.restart': 'Не удалось перезапустить. Повторите чуть позже.',
  'prompt.ask': 'Ответьте на следующий выделенный текст:',
  'toolbar.aria': 'Действия с выделенным текстом',
  'menu.aria': 'Меню выделенного текста',
} satisfies Record<SelectionActionsKey, string>

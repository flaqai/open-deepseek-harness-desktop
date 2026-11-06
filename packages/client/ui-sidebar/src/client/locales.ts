/** `sidebar` namespace dictionaries for shell controls and global panels. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'session.new': '新会话',
  'session.new.label': '新建会话',
  'toggle.open': '打开侧边栏',
  'toggle.collapse': '收起侧边栏',
  'panels.label': '全局面板',
  'navigation.label': '导航',
  'panels.more': '更多',
  'version.copied': '版本号复制成功',
  'workspace.unavailable': '工作区暂不可用',
  'workspace.failed': '工作区暂时无法显示。',
  'workspace.retry': '重试显示工作区',
} satisfies Record<string, string>

/** The sidebar namespace key union. */
export type SidebarKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'session.new': 'New Session',
  'session.new.label': 'New session',
  'toggle.open': 'Open sidebar',
  'toggle.collapse': 'Collapse sidebar',
  'panels.label': 'Global panels',
  'navigation.label': 'Navigation',
  'panels.more': 'More',
  'version.copied': 'Version copied',
  'workspace.unavailable': 'Workspaces unavailable',
  'workspace.failed': 'Workspaces could not be displayed.',
  'workspace.retry': 'Retry workspaces',
} satisfies Record<SidebarKey, string>

/** Japanese copy, checked against the English keys. */
export const ja = {
  ...en,
  'session.new': '新規セッション',
  'session.new.label': '新規セッション',
  'toggle.open': 'サイドバーを開く',
  'toggle.collapse': 'サイドバーを折りたたむ',
  'panels.label': 'グローバルパネル',
  'navigation.label': 'ナビゲーション',
  'panels.more': 'その他',
  'version.copied': 'バージョンをコピーしました',
  'workspace.unavailable': 'ワークスペースを利用できません',
  'workspace.failed': 'ワークスペースを表示できませんでした。',
  'workspace.retry': 'ワークスペースを再試行',
} satisfies Record<keyof typeof en, string>

/** Spanish dictionary, checked against the English keys. */
export const es = {
  ...en,
  'session.new': 'Nueva sesión',
  'session.new.label': 'Nueva sesión',
  'toggle.open': 'Abrir barra lateral',
  'toggle.collapse': 'Contraer barra lateral',
  'panels.label': 'Paneles globales',
  'navigation.label': 'Navegación',
  'panels.more': 'Más',
  'version.copied': 'Versión copiada',
  'workspace.unavailable': 'Espacios de trabajo no disponibles',
  'workspace.failed': 'No se pudieron mostrar los espacios de trabajo.',
  'workspace.retry': 'Reintentar espacios de trabajo',
} satisfies Record<keyof typeof en, string>

/** French dictionary, checked against the English keys. */
export const fr = {
  ...en,
  'session.new': 'Nouvelle séance',
  'session.new.label': 'Nouvelle séance',
  'toggle.open': 'Ouvrir la barre latérale',
  'toggle.collapse': 'Réduire la barre latérale',
  'panels.label': 'Panneaux globaux',
  'navigation.label': 'Navigation',
  'panels.more': 'Plus',
  'version.copied': 'Version copiée',
  'workspace.unavailable': 'Espaces de travail indisponibles',
  'workspace.failed': 'Les espaces de travail n’ont pas pu être affichés.',
  'workspace.retry': 'Réessayer les espaces de travail',
} satisfies Record<keyof typeof en, string>

/** German dictionary, checked against the English keys. */
export const de = {
  ...en,
  'session.new': 'Neue Sitzung',
  'session.new.label': 'Neue Sitzung',
  'toggle.open': 'Seitenleiste öffnen',
  'toggle.collapse': 'Seitenleiste einklappen',
  'panels.label': 'Globale Bereiche',
  'navigation.label': 'Navigation',
  'panels.more': 'Mehr',
  'version.copied': 'Version kopiert',
  'workspace.unavailable': 'Arbeitsbereiche nicht verfügbar',
  'workspace.failed': 'Die Arbeitsbereiche konnten nicht angezeigt werden.',
  'workspace.retry': 'Arbeitsbereiche erneut laden',
} satisfies Record<keyof typeof en, string>

/** Russian dictionary, checked against the English keys. */
export const ru = {
  ...en,
  'session.new': 'Новая сессия',
  'session.new.label': 'Новая сессия',
  'toggle.open': 'Открыть боковую панель',
  'toggle.collapse': 'Свернуть боковую панель',
  'panels.label': 'Глобальные панели',
  'navigation.label': 'Навигация',
  'panels.more': 'Ещё',
  'version.copied': 'Версия скопирована',
  'workspace.unavailable': 'Рабочие пространства недоступны',
  'workspace.failed': 'Не удалось отобразить рабочие пространства.',
  'workspace.retry': 'Повторить загрузку рабочих пространств',
} satisfies Record<keyof typeof en, string>

/** Portuguese dictionary, checked against the English keys. */
export const pt = {
  ...en,
  'session.new': 'Nova sessão',
  'session.new.label': 'Nova sessão',
  'toggle.open': 'Abrir barra lateral',
  'toggle.collapse': 'Recolher barra lateral',
  'panels.label': 'Painéis globais',
  'navigation.label': 'Navegação',
  'panels.more': 'Mais',
  'version.copied': 'Versão copiada',
  'workspace.unavailable': 'Espaços de trabalho indisponíveis',
  'workspace.failed': 'Não foi possível apresentar os espaços de trabalho.',
  'workspace.retry': 'Tentar novamente os espaços de trabalho',
} satisfies Record<keyof typeof en, string>

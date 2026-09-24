/** `open-in-app` namespace dictionaries: the workspace split button and the document-preview path controls. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'open-in-app'

/** Application labels shared verbatim by both dictionaries (product names). */
const PRODUCT_NAMES = {
  'app.cursor': 'Cursor',
  'app.vscode': 'VS Code',
  'app.vscodeinsiders': 'VS Code Insiders',
  'app.windsurf': 'Windsurf',
  'app.zed': 'Zed',
  'app.sublimetext': 'Sublime Text',
  'app.xcode': 'Xcode',
  'app.androidstudio': 'Android Studio',
  'app.intellij': 'IntelliJ IDEA',
  'app.pycharm': 'PyCharm',
  'app.webstorm': 'WebStorm',
  'app.phpstorm': 'PhpStorm',
  'app.goland': 'GoLand',
  'app.rider': 'Rider',
  'app.rustrover': 'RustRover',
  'app.fork': 'Fork',
  'app.sourcetree': 'Sourcetree',
  'app.github': 'GitHub Desktop',
  'app.tower': 'Tower',
  'app.gitkraken': 'GitKraken',
  'app.smartgit': 'SmartGit',
  'app.sublimemerge': 'Sublime Merge',
  'app.ghostty': 'Ghostty',
  'app.warp': 'Warp',
  'app.iterm': 'iTerm2',
  'app.kitty': 'kitty',
  'app.windowsterminal': 'Windows Terminal',
  'app.gitbash': 'Git Bash',
  'app.gnometerminal': 'GNOME Terminal',
  'app.konsole': 'Konsole',
} as const

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'open.title': '用 {app} 打开',
  'path.appDefault': '{app}（默认）',
  'path.appsError': '无法获取应用列表',
  'shortcut.busy': '正在打开工作区',
  'shortcut.unavailable': '当前工作区或本地应用不可用',
  'open.tooltip': '在本地打开',
  'path.open': '打开',
  'path.more': '更多打开方式',
  'path.reveal': '显示文件位置',
  'path.openError': '打开失败，请重试',
  'path.revealError': '无法显示文件位置，请重试',
  ...PRODUCT_NAMES,
  'app.finder': '访达',
  'app.explorer': '文件资源管理器',
  'app.filemanager': '文件管理器',
  'app.terminal': '终端',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<OpenInAppKey, string> = {
  'open.title': 'Open in {app}',
  'path.appDefault': '{app} (default)',
  'path.appsError': 'Could not load applications',
  'shortcut.busy': 'Opening workspace',
  'shortcut.unavailable': 'Current workspace or local application unavailable',
  'open.tooltip': 'Open locally',
  'path.open': 'Open',
  'path.more': 'More ways to open',
  'path.reveal': 'Show file location',
  'path.openError': 'Could not open. Try again.',
  'path.revealError': 'Could not show the file location. Try again.',
  ...PRODUCT_NAMES,
  'app.finder': 'Finder',
  'app.explorer': 'File Explorer',
  'app.filemanager': 'Files',
  'app.terminal': 'Terminal',
}

/** Key domain of the `open-in-app` namespace (zh is the source of truth). */
export type OpenInAppKey = keyof typeof zh

/** Russian dictionary, key-identical to the Chinese source of truth. */
export const ru: Record<OpenInAppKey, string> = {
  ...en,
  'open.title': 'Открыть рабочую область в {app}',
  ...PRODUCT_NAMES,
  'app.finder': 'Finder',
  'app.explorer': 'Проводник',
  'app.filemanager': 'Файлы',
  'app.terminal': 'Терминал',
}

/** Japanese dictionary. */
export const ja: Record<OpenInAppKey, string> = {
  ...en,
  'open.title': '{app} でワークスペースを開く',
  'app.finder': 'Finder', 'app.explorer': 'エクスプローラー', 'app.filemanager': 'ファイル', 'app.terminal': 'ターミナル',
}

/** Korean dictionary. */
export const ko: Record<OpenInAppKey, string> = {
  ...en,
  'open.title': '{app}에서 작업 공간 열기',
  'app.finder': 'Finder', 'app.explorer': '파일 탐색기', 'app.filemanager': '파일', 'app.terminal': '터미널',
}

/** Spanish dictionary. */
export const es: Record<OpenInAppKey, string> = {
  ...en,
  'open.title': 'Abrir el espacio de trabajo en {app}',
  'app.finder': 'Finder', 'app.explorer': 'Explorador de archivos', 'app.filemanager': 'Archivos', 'app.terminal': 'Terminal',
}

/** French dictionary. */
export const fr: Record<OpenInAppKey, string> = {
  ...en,
  'open.title': 'Ouvrir l’espace de travail dans {app}',
  'app.finder': 'Finder', 'app.explorer': 'Explorateur de fichiers', 'app.filemanager': 'Fichiers', 'app.terminal': 'Terminal',
}

/** German dictionary. */
export const de: Record<OpenInAppKey, string> = {
  ...en,
  'open.title': 'Arbeitsbereich in {app} öffnen',
  'app.finder': 'Finder', 'app.explorer': 'Datei-Explorer', 'app.filemanager': 'Dateien', 'app.terminal': 'Terminal',
}

/** Brazilian Portuguese dictionary. */
export const ptBR: Record<OpenInAppKey, string> = {
  ...en,
  'open.title': 'Abrir o espaço de trabalho no {app}',
  'app.finder': 'Finder', 'app.explorer': 'Explorador de Arquivos', 'app.filemanager': 'Arquivos', 'app.terminal': 'Terminal',
}

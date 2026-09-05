/** Shared native application commands and platform-specific menu presentation. */
import type { MenuItemConstructorOptions } from 'electron'

/** Fixed commands accepted by the desktop host; never executable renderer input. */
export const DESKTOP_COMMANDS = [
  'about', 'settings', 'updates', 'new-session', 'open-config', 'open-web', 'close', 'quit',
  'undo', 'redo', 'cut', 'copy', 'paste', 'select-all', 'zoom-in', 'zoom-out', 'zoom-reset',
  'fullscreen', 'market', 'plugin-restore', 'diagnostics', 'snapshots', 'external-tools',
  'phone', 'im', 'data-home', 'restart', 'show', 'minimize', 'maximize',
  'docs', 'repository', 'feedback', 'logs', 'devtools', 'emoji',
] as const
/** Whitelisted desktop command identifier. */
export type DesktopCommand = typeof DESKTOP_COMMANDS[number]
/** Product navigation commands delivered only to the Harness renderer. */
export const CLIENT_COMMANDS = [
  'new-session', 'settings', 'updates', 'market', 'plugin-restore', 'diagnostics',
  'snapshots', 'external-tools', 'phone', 'im', 'data-home',
] as const satisfies readonly DesktopCommand[]

const en = {
  app: 'Open DSH Desktop', file: 'File', edit: 'Edit', view: 'View', tools: 'Tools', window: 'Window', help: 'Help', more: 'More',
  about: 'About Open DSH Desktop', settings: 'Settings…', updates: 'Check for Updates…',
  'new-session': 'New Conversation', 'open-config': 'Open Configuration File', 'open-web': 'Open in Browser', close: 'Close Window', quit: 'Quit Completely',
  undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', 'select-all': 'Select All',
  'zoom-in': 'Zoom In', 'zoom-out': 'Zoom Out', 'zoom-reset': 'Actual Size', fullscreen: 'Enter Full Screen',
  'leave-fullscreen': 'Exit Full Screen', market: 'Plugin Market', 'plugin-restore': 'Plugin Recovery',
  diagnostics: 'Diagnostics', snapshots: 'Plugin Snapshots', 'external-tools': 'External Tools',
  phone: 'Phone Access', im: 'IM Bots', 'data-home': 'Switch Data Directory…', restart: 'Quick Restart',
  show: 'Show Main Window', minimize: 'Minimize', maximize: 'Maximize', restore: 'Restore',
  docs: 'Documentation', repository: 'Project Repository', feedback: 'Report an Issue', logs: 'Open Log Directory',
  devtools: 'Developer Tools', services: 'Services', hide: 'Hide Open DSH Desktop', 'hide-others': 'Hide Others',
  unhide: 'Show All', emoji: 'Emoji & Symbols', error: 'Unable to Complete Action',
  unavailable: 'This action is unavailable while the client is starting, disconnected, or recovering.',
  busy: 'A plugin operation or recovery is in progress. Wait for it to finish before restarting or quitting.',
  tray: 'The system tray is unavailable. Cancel to keep the window open, or quit completely.',
  cancel: 'Cancel', community: 'Maintained by FLAQ AI. An independent community distribution, not an official DeepSeek product.',
}
const zh: typeof en = {
  app: 'Open DSH Desktop', file: '文件', edit: '编辑', view: '视图', tools: '工具', window: '窗口', help: '帮助', more: '更多',
  about: '关于 Open DSH Desktop', settings: '设置…', updates: '检查更新…', 'new-session': '新对话',
  'open-config': '打开配置文件', 'open-web': '在浏览器中打开', close: '关闭窗口', quit: '完整退出', undo: '撤销', redo: '重做', cut: '剪切',
  copy: '复制', paste: '粘贴', 'select-all': '全选', 'zoom-in': '放大', 'zoom-out': '缩小', 'zoom-reset': '实际大小',
  fullscreen: '进入全屏', 'leave-fullscreen': '退出全屏', market: '插件市场', 'plugin-restore': '插件恢复',
  diagnostics: '诊断中心', snapshots: '插件快照', 'external-tools': '外部工具', phone: '手机访问', im: 'IM 机器人',
  'data-home': '切换配置目录…', restart: '快速重启', show: '显示主窗口', minimize: '最小化', maximize: '最大化',
  restore: '还原', docs: '使用文档', repository: '项目仓库', feedback: '反馈问题', logs: '打开日志目录',
  devtools: '开发者工具', services: '服务', hide: '隐藏 Open DSH Desktop', 'hide-others': '隐藏其他应用',
  unhide: '显示全部', emoji: '表情与符号', error: '无法完成操作',
  unavailable: '客户端正在启动、已断开连接或正在恢复，暂时无法执行此操作。',
  busy: '插件操作或恢复正在进行，请等待完成后再重启或退出。',
  tray: '系统托盘不可用。可以取消并保留窗口，或完整退出客户端。', cancel: '取消',
  community: '由 FLAQ AI 维护的社区独立发行版，并非 DeepSeek 官方产品。',
}
/** Resolve native menu copy; unsupported languages fall back to English. @param locale - App locale. @returns Menu dictionary. */
export function menuCopy(locale: string): typeof en { return locale.toLowerCase().startsWith('zh') ? zh : en }

/** Presentation state published by the trusted host. */
export interface DesktopMenuState {
  platform: NodeJS.Platform
  locale: string
  ready: boolean
  busy: boolean
  maximized: boolean
  fullscreen: boolean
  development: boolean
}
/** Validate an IPC command. @param value - Wire input. @returns Whether it is allowlisted. */
export function isDesktopCommand(value: unknown): value is DesktopCommand {
  return typeof value === 'string' && (DESKTOP_COMMANDS as readonly string[]).includes(value)
}
/** Evaluate at display and dispatch time.
 * @param command - Command.
 * @param state - Live state.
 * @returns Whether execution is allowed.
 */
export function commandEnabled(command: DesktopCommand, state: DesktopMenuState): boolean {
  if ((CLIENT_COMMANDS as readonly string[]).includes(command)) return state.ready && !state.busy
  // Loading and titlebar pages share file://; never write that origin's zoom preference.
  if (command === 'zoom-in' || command === 'zoom-out' || command === 'zoom-reset') return state.ready
  if (command === 'open-web') return state.ready && (state.platform === 'darwin' || state.platform === 'win32')
  if (command === 'quit' || command === 'restart') return !state.busy
  if (command === 'devtools') return state.development
  return true
}

/** Build native menu groups shared with titlebar popups.
 * @param state - Live state.
 * @param execute - Guarded command dispatcher.
 * @returns Native template.
 */
export function applicationMenuTemplate(
  state: DesktopMenuState, execute: (command: DesktopCommand) => void,
): MenuItemConstructorOptions[] {
  const t = menuCopy(state.locale)
  const mac = state.platform === 'darwin'
  const shortcuts: Partial<Record<DesktopCommand, string>> = {
    'new-session': 'CmdOrCtrl+N', settings: 'CmdOrCtrl+,', close: 'CmdOrCtrl+W', quit: mac ? 'Command+Q' : 'Ctrl+Q',
    undo: 'CmdOrCtrl+Z', redo: mac ? 'Command+Shift+Z' : 'Ctrl+Y', cut: 'CmdOrCtrl+X', copy: 'CmdOrCtrl+C',
    paste: 'CmdOrCtrl+V', 'select-all': 'CmdOrCtrl+A', 'zoom-in': 'CmdOrCtrl+Plus',
    'zoom-out': 'CmdOrCtrl+-', 'zoom-reset': 'CmdOrCtrl+0', fullscreen: mac ? 'Control+Command+F' : 'F11',
  }
  const item = (command: DesktopCommand): MenuItemConstructorOptions => ({
    id: command,
    label: command === 'maximize' && state.maximized ? t.restore
      : command === 'fullscreen' && state.fullscreen ? t['leave-fullscreen'] : t[command],
    enabled: commandEnabled(command, state),
    ...(mac && ['undo', 'redo', 'cut', 'copy', 'paste', 'select-all'].includes(command)
      ? { role: (command === 'select-all' ? 'selectAll' : command) as 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll' } : {}),
    ...(shortcuts[command] === undefined ? {} : { accelerator: shortcuts[command] }),
    click: () => { execute(command) },
  })
  const separator: MenuItemConstructorOptions = { type: 'separator' }
  const group = (id: 'file' | 'edit' | 'view' | 'tools' | 'window' | 'help', submenu: MenuItemConstructorOptions[]): MenuItemConstructorOptions => ({ id, label: t[id], submenu })
  return [
    ...(mac ? [{ id: 'app', label: t.app, submenu: [item('about'), separator, item('settings'), item('updates'), separator,
      { label: t.services, role: 'services' as const }, separator, { label: t.hide, role: 'hide' as const },
      { label: t['hide-others'], role: 'hideOthers' as const }, { label: t.unhide, role: 'unhide' as const }, separator, item('quit')] }] : []),
    group('file', [item('new-session'), item('open-config'),
      ...(['darwin', 'win32'].includes(state.platform) ? [item('open-web')] : []), separator,
      ...(!mac ? [item('settings'), separator] : []), item('close'), ...(!mac ? [item('quit')] : [])]),
    group('edit', [item('undo'), item('redo'), separator, item('cut'), item('copy'), item('paste'), item('select-all'),
      ...(mac ? [separator, item('emoji')] : [])]),
    group('view', [item('zoom-in'), item('zoom-out'), item('zoom-reset'), separator, item('fullscreen'),
      ...(state.development ? [separator, item('devtools')] : [])]),
    group('tools', ['market', 'plugin-restore', 'diagnostics', 'snapshots', 'external-tools', 'phone', 'im', 'data-home', 'restart'].map(command => item(command as DesktopCommand))),
    group('window', [item('show'), item('minimize'), item('maximize')]),
    group('help', [item('docs'), item('repository'), item('feedback'), item('logs'), ...(!mac ? [separator, item('updates'), item('about')] : [])]),
  ]
}

/** Settings copy for the floating ball and its restricted capabilities. */
export const zh = {
  nav: '悬浮球', title: '悬浮球', description: '在本机桌面上快速查看会话与发起对话。',
  unavailable: 'NAS 模式下只能使用远程会话；本机悬浮球和电脑操作不可用。',
  loading: '正在读取悬浮球设置…', error: '读取设置失败，请重试。', retry: '重试',
  display: '显示与启动', visible: '显示悬浮球', showAtStartup: '启动桌面应用时显示',
  appearance: '外观和位置', avatar: '头像', deepseek: 'DeepSeek', minimal: '简洁', anchor: '停靠位置', left: '左侧', right: '右侧',
  selection: '划词与快捷键', selectionHint: '划词工具栏和全局快捷键仍在适配当前桌面架构；暂时不可开启。',
  computer: 'Computer Use 后端与系统权限', computerHint: '本机截图、点击和输入会影响工作区外的数据；首次使用时须授予系统权限。',
  orbBackend: '作者式后端', officialNative: '官方原生驱动', officialMcp: '官方 MCP 驱动',
  backendPending: '切换后端需要安全修改 Profile。完成兼容验证前，此操作暂不可用。',
  tools: '前往工具与能力安装官方驱动',
  background: '后台任务与审批', backgroundHint: '后台命令、文件修改和计划确认仍使用现有审批；悬浮球不会自动批准。',
  saveError: '保存失败，请检查诊断日志后重试。',
} as const

export type OrbSettingsKey = keyof typeof zh

export const en: Record<OrbSettingsKey, string> = {
  nav: 'Floating Ball', title: 'Floating Ball', description: 'Quickly view conversations and start chats from the local desktop.',
  unavailable: 'Only remote chat is available in NAS mode; the local floating ball and computer controls are disabled.',
  loading: 'Loading floating-ball settings…', error: 'Unable to load settings. Try again.', retry: 'Retry',
  display: 'Display and startup', visible: 'Show floating ball', showAtStartup: 'Show when the desktop app starts',
  appearance: 'Appearance and position', avatar: 'Avatar', deepseek: 'DeepSeek', minimal: 'Minimal', anchor: 'Dock edge', left: 'Left', right: 'Right',
  selection: 'Selection and shortcuts', selectionHint: 'The selection toolbar and global shortcut are still being adapted to this Desktop architecture.',
  computer: 'Computer Use backend and system permissions', computerHint: 'Local screenshots, clicks, and typing can change data outside the workspace. System permission is required on first use.',
  orbBackend: 'Orb backend', officialNative: 'Official native driver', officialMcp: 'Official MCP driver',
  backendPending: 'Switching backends requires a managed Profile change. This is unavailable until compatibility validation is complete.',
  tools: 'Install an official driver in Tools & Capabilities',
  background: 'Background tasks and approvals', backgroundHint: 'Background commands, file changes, and plan confirmation keep their current approvals; the ball never auto-approves them.',
  saveError: 'Unable to save. Check diagnostics and try again.',
}

/** Settings copy for the floating ball and its restricted capabilities. */
export const zh = {
  nav: '悬浮球', title: '悬浮球', description: '在本机桌面上快速查看会话与发起对话。',
  unavailable: 'NAS 模式下悬浮球可连接远程会话；本机截图、输入、划词和后台任务不可用。',
  loading: '正在读取悬浮球设置…', error: '读取设置失败，请重试。', retry: '重试',
  display: '显示与启动', visible: '显示悬浮球', showAtStartup: '启动桌面应用时显示',
  appearance: '外观和位置', avatar: '头像', deepseek: 'DeepSeek', minimal: '简洁', anchor: '停靠位置', left: '左侧', right: '右侧',
  selection: '划词与快捷键', selectionToolbar: '启用复制后快捷键', selectionHint: '启用后先复制文字，再按 Cmd/Ctrl+Shift+O。跨应用自动划词工具栏尚未接入。', selectionReady: '复制文字后按 Cmd/Ctrl+Shift+O，文本会追加到悬浮聊天草稿，不会自动发送。',
  computer: 'Computer Use 后端与系统权限', computerHint: '本机截图、点击和输入会影响工作区外的数据；首次使用时须授予系统权限。',
  backend: '当前后端', orbBackend: '作者式后端', officialNative: '官方原生驱动', officialMcp: '官方 MCP 驱动',
  backendPending: '切换后端需要安全修改 Profile。完成兼容验证前，此操作暂不可用。',
  statusUnavailable: '尚未取得本机能力状态，暂不可切换后端。', backendBusy: '任务正在运行；任务结束后才能切换后端。', restartPending: '后端切换已登记，快速重启后生效。', backendInstall: '当前后端尚未安装。', backendUnsupported: '此后端尚未完成桌面集成。', backendReady: '切换后端将更新当前 Profile，需快速重启后生效。',
  taskStatusUnknown: '暂时无法确认后台任务状态，不能安全切换后端。',
  restartNow: '快速重启以应用',
  backendUnknown: '暂时无法确认插件状态，请重试或查看诊断日志。',
  screenPermission: '屏幕录制', accessibilityPermission: '辅助功能', permissionGranted: '已授权', permissionDenied: '未授权', permissionUnknown: '未检测',
  tools: '前往工具与能力安装官方驱动',
  background: '后台任务与审批', backgroundHint: '后台命令、文件修改和计划确认仍使用现有审批；悬浮球不会自动批准。', backgroundUnavailable: '后台任务状态暂不可用。', activeTasks: '运行中的任务：{count}', observing: '正在观察屏幕；悬浮窗不会出现在截图中。',
  saveError: '保存失败，请检查诊断日志后重试。',
} as const

/** Keys shared by the floating-ball Settings dictionaries. */
export type OrbSettingsKey = keyof typeof zh

/** English floating-ball Settings copy. */
export const en: Record<OrbSettingsKey, string> = {
  nav: 'Floating Ball', title: 'Floating Ball', description: 'Quickly view conversations and start chats from the local desktop.',
  unavailable: 'In NAS mode, the floating ball can open remote chat. Local capture, input, selection, and background tasks stay disabled.',
  loading: 'Loading floating-ball settings…', error: 'Unable to load settings. Try again.', retry: 'Retry',
  display: 'Display and startup', visible: 'Show floating ball', showAtStartup: 'Show when the desktop app starts',
  appearance: 'Appearance and position', avatar: 'Avatar', deepseek: 'DeepSeek', minimal: 'Minimal', anchor: 'Dock edge', left: 'Left', right: 'Right',
  selection: 'Selection and shortcuts', selectionToolbar: 'Enable copied-text shortcut', selectionHint: 'When enabled, copy text and press Cmd/Ctrl+Shift+O. Automatic cross-app selection is not connected yet.', selectionReady: 'Copy text and press Cmd/Ctrl+Shift+O to append it to the floating chat draft. It will not be sent automatically.',
  computer: 'Computer Use backend and system permissions', computerHint: 'Local screenshots, clicks, and typing can change data outside the workspace. System permission is required on first use.',
  backend: 'Current backend', orbBackend: 'Orb backend', officialNative: 'Official native driver', officialMcp: 'Official MCP driver',
  backendPending: 'Switching backends requires a managed Profile change. This is unavailable until compatibility validation is complete.',
  statusUnavailable: 'Local capability status is unavailable; backend switching is disabled.', backendBusy: 'A task is running. Switch backends after it finishes.', restartPending: 'Backend switch queued. Quick restart to apply it.', backendInstall: 'The current backend is not installed.', backendUnsupported: 'This backend is not fully integrated with Desktop yet.', backendReady: 'Switching backends updates the current Profile and requires a quick restart.',
  taskStatusUnknown: 'Background task status is unknown; backend switching is disabled.',
  restartNow: 'Quick restart to apply',
  backendUnknown: 'Unable to confirm plugin state. Retry or check diagnostics.',
  screenPermission: 'Screen recording', accessibilityPermission: 'Accessibility', permissionGranted: 'Allowed', permissionDenied: 'Not allowed', permissionUnknown: 'Not checked',
  tools: 'Install an official driver in Tools & Capabilities',
  background: 'Background tasks and approvals', backgroundHint: 'Background commands, file changes, and plan confirmation keep their current approvals; the ball never auto-approves them.', backgroundUnavailable: 'Background task status is unavailable.', activeTasks: 'Running tasks: {count}', observing: 'Observing the screen; the floating window is excluded from screenshots.',
  saveError: 'Unable to save. Check diagnostics and try again.',
}

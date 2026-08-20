/** Desktop shell settings and update copy. */

export const zh = {
  'close.title': '关闭窗口时',
  'close.description': '选择关闭按钮是隐藏窗口并保持任务运行，还是完整退出客户端。',
  'close.tray': '隐藏到托盘',
  'close.quit': '退出客户端',
  'notifications.title': '系统通知',
  'notifications.description': 'Harness 异常退出、连续失败或恢复时发送桌面通知。',
  'launch.title': '开机自启',
  'launch.description': '登录 macOS 后在后台启动 DeepSeek Harness。',
  'launch.unavailable': '仅 macOS 安装版支持',
  'enabled': '已开启',
  'disabled': '已关闭',
  'release.title': '客户端版本',
  'release.check': '检查更新',
  'release.checking': '正在检查…',
  'release.current': '当前已是最新版本',
  'release.available': '发现新版本 {version}',
  'release.open': '查看下载',
  'release.error': '更新检查失败',
  'release.unsupported': '源码模式使用底层源码更新器',
  'release.badge': '新版本 {version}',
} satisfies Record<string, string>

/** Desktop-shell dictionary key union. */
export type DesktopShellKey = keyof typeof zh

/** English dictionary checked against the Chinese key source. */
export const en = {
  'close.title': 'When closing the window',
  'close.description': 'Hide the window and keep tasks running, or quit the desktop client completely.',
  'close.tray': 'Hide to tray',
  'close.quit': 'Quit client',
  'notifications.title': 'System notifications',
  'notifications.description': 'Notify when Harness exits, repeatedly fails, or recovers.',
  'launch.title': 'Launch at login',
  'launch.description': 'Start DeepSeek Harness in the background after signing in to macOS.',
  'launch.unavailable': 'Available only in the packaged macOS app',
  'enabled': 'On',
  'disabled': 'Off',
  'release.title': 'Desktop version',
  'release.check': 'Check for updates',
  'release.checking': 'Checking…',
  'release.current': 'This is the latest version',
  'release.available': 'Version {version} is available',
  'release.open': 'View download',
  'release.error': 'Update check failed',
  'release.unsupported': 'Source runs use the core source updater',
  'release.badge': 'Version {version}',
} satisfies Record<DesktopShellKey, string>

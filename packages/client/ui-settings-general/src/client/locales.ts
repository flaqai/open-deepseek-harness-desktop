/** Shell chrome and General-nav dictionaries; feature rows own their copy. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'trigger': '设置',
  'title': '设置',
  'close': '关闭',
  'nav.reorder': '拖动调整设置项顺序',
  'openDocument': '打开配置文件',
  'openDocument.error': '无法打开配置文件',
  'general.nav': '通用设置',
  'onboarding.start': '开始使用',
  'onboarding.step.models': '连接模型',
  'onboarding.step.phone': '连接手机',
  'onboarding.step.messages': '连接 IM 机器人',
  'onboarding.step.codex': '连接 Codex',
  'onboarding.step.ready': '准备完成',
  'onboarding.back': '返回步骤',
  'onboarding.done': '完成此项',
  'onboarding.sectionUnavailable.title': '设置页面尚未就绪',
  'onboarding.sectionUnavailable.description': '对应插件尚未加载或当前不可用。请返回后稍后重试；如果一直无法打开，请在插件恢复或诊断中检查该插件。',
  'connection.error': '连接异常',
  'connection.retry': '立即重连',
  'connection.connecting': '自动重连中',
  'connection.connected': '连接成功',
  'connection.reconnect': '连接异常，点击立即重连',
  'connection.restart': '连接中断，正在自动重试，点击立即重连',
} satisfies Record<string, string>

/** The settings namespace key union. */
export type SettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'trigger': 'Settings',
  'title': 'Settings',
  'close': 'Close',
  'nav.reorder': 'Drag to reorder settings',
  'openDocument': 'Open configuration file',
  'openDocument.error': 'Could not open configuration file',
  'general.nav': 'General',
  'onboarding.start': 'Get started',
  'onboarding.step.models': 'Connect a model',
  'onboarding.step.phone': 'Connect your phone',
  'onboarding.step.messages': 'Connect IM bots',
  'onboarding.step.codex': 'Connect Codex',
  'onboarding.step.ready': 'Ready',
  'onboarding.back': 'Back to steps',
  'onboarding.done': 'Complete step',
  'onboarding.sectionUnavailable.title': 'Settings page is not ready',
  'onboarding.sectionUnavailable.description': 'The corresponding plugin has not loaded or is unavailable. Go back and retry shortly. If it remains unavailable, check the plugin in Plugin Recovery or Diagnostics.',
  'connection.error': 'Disconnected',
  'connection.retry': 'Reconnect now',
  'connection.connecting': 'Reconnecting',
  'connection.connected': 'Connected',
  'connection.reconnect': 'Disconnected, reconnect now',
  'connection.restart': 'Reconnecting automatically, reconnect now',
} satisfies Record<SettingsKey, string>

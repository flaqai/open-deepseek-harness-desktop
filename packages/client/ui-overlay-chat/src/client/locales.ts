/** Copy for the compact Desktop chat surface. */
export const zh = {
  title: '悬浮聊天',
  history: '历史会话',
  new: '新会话',
  collapse: '收起悬浮球',
  openMain: '打开主窗口',
  empty: '选择历史会话或新建会话',
  untitled: '未命名会话',
} as const

export type OrbChatKey = keyof typeof zh

export const en: Record<OrbChatKey, string> = {
  title: 'Floating chat',
  history: 'Conversation history',
  new: 'New conversation',
  collapse: 'Collapse floating ball',
  openMain: 'Open main window',
  empty: 'Choose a conversation or start a new one',
  untitled: 'Untitled conversation',
}

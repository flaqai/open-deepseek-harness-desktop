/** Copy for the compact Desktop chat surface. */
export const zh = {
  title: '悬浮聊天',
  history: '历史会话',
  new: '新会话',
  collapse: '收起悬浮球',
  openMain: '打开主窗口',
  untitled: '未命名会话',
  running: '运行中的会话：{count}', idle: '没有运行中的会话', runningShort: '运行中',
  selectionPending: '已获取选中文字，等待会话就绪后插入草稿。', insertSelection: '插入草稿',
} as const

/** Keys shared by the compact-chat dictionaries. */
export type OrbChatKey = keyof typeof zh

/** English copy for the compact Desktop chat surface. */
export const en: Record<OrbChatKey, string> = {
  title: 'Floating chat',
  history: 'Conversation history',
  new: 'New conversation',
  collapse: 'Collapse floating ball',
  openMain: 'Open main window',
  untitled: 'Untitled conversation',
  running: 'Running conversations: {count}', idle: 'No running conversations', runningShort: 'Running',
  selectionPending: 'Selected text is waiting for a conversation. It will enter the draft only.', insertSelection: 'Insert into draft',
}

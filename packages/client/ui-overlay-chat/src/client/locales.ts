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
  backgroundTitle: '后台任务', backgroundRefresh: '刷新', backgroundChecking: '正在检查本机任务…',
  backgroundUnavailable: '暂时无法读取后台任务。请重试。', backgroundTaskLabel: '交给后台处理的任务',
  backgroundSubmit: '开始后台任务', backgroundWorking: '处理中…', backgroundEmpty: '暂无后台任务',
  backgroundWorker: '后台会话', backgroundIdle: '未运行', backgroundOpen: '打开', backgroundStop: '停止',
  backgroundQueued: '任务已加入后台会话。打开会话可处理审批、计划和提问。',
  backgroundSubmitUncertain: '未能确认任务是否已提交。请先刷新列表，再决定是否重试。',
  backgroundStopped: '已请求停止任务。', backgroundStopUncertain: '未能确认停止结果。请刷新列表。',
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
  backgroundTitle: 'Background tasks', backgroundRefresh: 'Refresh', backgroundChecking: 'Checking local tasks…',
  backgroundUnavailable: 'Background tasks are temporarily unavailable. Please retry.', backgroundTaskLabel: 'Task for the background',
  backgroundSubmit: 'Start background task', backgroundWorking: 'Working…', backgroundEmpty: 'No background tasks yet',
  backgroundWorker: 'Background conversation', backgroundIdle: 'Not running', backgroundOpen: 'Open', backgroundStop: 'Stop',
  backgroundQueued: 'Task queued in a background conversation. Open it for approvals, plans, and questions.',
  backgroundSubmitUncertain: 'Could not confirm whether the task was submitted. Refresh the list before retrying.',
  backgroundStopped: 'Stop requested.', backgroundStopUncertain: 'Could not confirm the stop result. Refresh the list.',
}

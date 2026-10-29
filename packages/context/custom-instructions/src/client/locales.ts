import { customInstructionsAdditionalLocales } from './locales-extra.ts'

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  nav: '自定义提示词',
  rowTitle: '自定义提示词',
  rowDescription: '为所有对话或单个工作区添加长期生效的补充说明。',
  configure: '配置',
  title: '自定义提示词',
  description: '这些内容会作为额外上下文注入后续模型请求，不会改写已有消息。内容仅保存在本机。',
  scope: '应用范围',
  global: '全局',
  globalDescription: '应用于所有对话与任务。',
  workspaceDescription: '仅应用于此工作区；与全局提示词同时生效，并排在全局提示词之后。',
  prompt: '提示词内容',
  placeholder: '例如：回复一律使用中文；代码示例优先使用 TypeScript。',
  characterCount: '{used} / {limit}',
  save: '保存',
  saving: '正在保存…',
  saved: '已保存',
  disabled: '此范围当前未启用自定义提示词。',
  emptyDisables: '清空并保存会停用此范围。',
  loading: '正在读取设置…',
  unavailable: '当前环境无法读取或修改自定义提示词。',
  saveFailed: '保存失败，请重新加载后再试。',
  precedence: '项目提示词优先于全局提示词，但不能覆盖应用的安全与开发者规则。',
  diagnosticTitle: '会话诊断导出',
  diagnosticDescription: '恢复导出前询问后，下次会再次选择是否包含提示词原文。',
  diagnosticAsk: '恢复导出前询问',
} satisfies Record<string, string>

/** Locale keys owned by the custom-instructions Settings surfaces. */
export type CustomInstructionsLocaleKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en = {
  nav: 'Custom prompts',
  rowTitle: 'Custom prompts',
  rowDescription: 'Add durable guidance for every conversation or for one workspace.',
  configure: 'Configure',
  title: 'Custom prompts',
  description: 'This content is added as context to later model requests without rewriting existing messages. It stays on this device.',
  scope: 'Applies to',
  global: 'Global',
  globalDescription: 'Applies to every conversation and task.',
  workspaceDescription: 'Applies only to this workspace. It is combined with, and follows, the global prompt.',
  prompt: 'Prompt content',
  placeholder: 'For example: Always reply in Chinese; prefer TypeScript in code examples.',
  characterCount: '{used} / {limit}',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved',
  disabled: 'Custom prompts are currently disabled for this scope.',
  emptyDisables: 'Saving an empty value disables this scope.',
  loading: 'Reading settings…',
  unavailable: 'Custom prompts cannot be read or changed in this environment.',
  saveFailed: 'Could not save. Reload and try again.',
  precedence: 'Workspace prompts take precedence over global prompts, but cannot override application safety or developer rules.',
  diagnosticTitle: 'Conversation diagnostic export',
  diagnosticDescription: 'Restore the confirmation so the next export asks whether to include prompt plaintext.',
  diagnosticAsk: 'Ask before exporting again',
} satisfies Record<CustomInstructionsLocaleKey, string>

/** Japanese custom-instructions settings copy. */
export const ja = customInstructionsAdditionalLocales.ja
/** Spanish custom-instructions settings copy. */
export const es = customInstructionsAdditionalLocales.es
/** French custom-instructions settings copy. */
export const fr = customInstructionsAdditionalLocales.fr
/** German custom-instructions settings copy. */
export const de = customInstructionsAdditionalLocales.de
/** Russian custom-instructions settings copy. */
export const ru = customInstructionsAdditionalLocales.ru
/** Portuguese custom-instructions settings copy. */
export const pt = customInstructionsAdditionalLocales.pt
/** Korean custom-instructions settings copy. */
export const ko = customInstructionsAdditionalLocales.ko

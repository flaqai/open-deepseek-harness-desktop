/** Browser Tool plugin: whole-call composition and keyed atomic Tool views. */
export { apply, inject } from './apply.ts'
export type {
  StartedToolCallViewProps, ToolCallCommonProps, ToolCallOwnerProps, ToolCallPhaseProps, ToolCallViewProps,
  ToolCallHookContext, ToolCallInjected, ToolHostInfoInjected, ToolTreeProps, UseToolCallArgumentsPartial,
  UserQuestionPanels, UserQuestionRecord,
} from './contract/slots.ts'

/** Composer adapter for one pending tool-approval waterfall. */
import type { ApprovalComposerProps } from './contract/slots.ts'

const ESCALATION_AUDIT_PREFIX = /^escalate sandbox to [^:]+:\s*/u

function approvalExplanation(reason: string | undefined, fallback: string): string {
  if (reason === undefined) return fallback
  const explanation = reason.replace(ESCALATION_AUDIT_PREFIX, '').trim()
  return explanation.length > 0 ? explanation : fallback
}

/**
 * Render the shared card using the tool approval's one-shot decision policy.
 * @param props Selector-matched request and standard Slot props.
 * @returns The approval composer takeover.
 */
export function ApprovalPanel(props: ApprovalComposerProps) {
  const approval = props.matched
  const reason = approval.displayReason === undefined ? approval.reason : props.resolveReason(approval.displayReason)
  return props.renderFactorySlot('conversation.approval.card', {
    requestKey: approval.key,
    title: approvalExplanation(reason, props.t('escalation', { toolName: approval.toolName })),
    ...(approval.callId === undefined ? {} : { callId: approval.callId }),
    canAnswer: () => approval.answerable,
    onAllow: () => approval.answer('allowed-once'),
    onReject: () => approval.answer('rejected'),
  })
}

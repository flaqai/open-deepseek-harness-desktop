/** Feedback outlives the conversation-owned action popup. */
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'

interface FeedbackInjected {
  hooks: { feedback: HostObservable<{ seq: number; text: string } | null> }
  clear: () => void
}

/** Shell-owned transient action feedback. */
export function SelectionActionsFeedback({ useFeedback, clear }: InjectFace<FeedbackInjected>) {
  const feedback = useFeedback(value => value)
  return feedback === null ? null : <Toast key={feedback.seq} text={feedback.text} onDone={clear} />
}

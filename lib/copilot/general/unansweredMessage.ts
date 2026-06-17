export type MenuReason = 'unknown' | 'low-confidence'

/**
 * Honest, deterministic acknowledgment when General Mode cannot answer a question.
 * The capability suggestions are shown BELOW this line as optional follow-ups —
 * they never stand in for an answer. We do not fabricate understanding of the
 * question (charter Law 1/2): an out-of-set question gets a plain "no answer",
 * an ambiguous one gets a "didn't understand".
 */
export function unansweredMessage(reason: MenuReason): string {
  return reason === 'low-confidence' ? 'לא בטוח שהבנתי את השאלה.' : 'אין לי תשובה לשאלה הזו.'
}

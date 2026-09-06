import type { AgentAnswer } from '@/lib/agent/types'
import type { ActionOutcome } from '@/lib/agent/actions/types'

/**
 * What the agent surface renders. UI state only — no business logic.
 *
 * An agent turn is a STATE MACHINE, not a message: it appears the moment the
 * question is sent, reports which capability is running while it works, and is
 * then replaced in place by an answer or an error. Rendering thinking and
 * answering as two separate entries would make the thread jump as the first is
 * removed and the second inserted.
 */
export type AgentUiTurn =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'agent'; status: 'thinking'; tools: string[] }
  | {
      id: string
      role: 'agent'
      status: 'done'
      answer: AgentAnswer
      investigationId?: string
      /**
       * The Action Runtime's verdict, when the answer proposed an action.
       *
       * Kept BESIDE the answer rather than merged into it: the answer is the
       * model's prose and this is the application's record of what actually
       * happened, and the whole point of the boundary is that the second one
       * wins. A headline that says a task was created next to an outcome of
       * AWAITING_APPROVAL means the prose is wrong, not that a task exists.
       */
      actionOutcome?: ActionOutcome | null
      /** True while an approve/reject decision is in flight from this client. */
      actionPending?: boolean
    }
  | { id: string; role: 'agent'; status: 'error'; message: string }

/**
 * Hebrew labels for the tools, shown while each one runs.
 *
 * They describe the WORK in the rep's terms — "reading the conversation", not
 * `get_conversation` — because an internal tool name on screen is jargon, and a
 * generic "thinking…" would be theatre. Product terminology only: ליד, נציג,
 * סטטוס.
 *
 * A tool with no entry here falls back to the neutral label rather than showing
 * its identifier, so adding a tool server-side can never leak a symbol into the
 * UI before this map catches up.
 */
export const TOOL_LABELS: Record<string, string> = {
  get_today_state: 'בודק מה דורש טיפול היום',
  get_business_summary: 'בודק את מצב העסק',
  get_lead_segment: 'אוסף את הלידים הרלוונטיים',
  find_lead: 'מחפש את הליד',
  get_lead: 'קורא את פרטי הליד',
  get_conversation: 'קורא את השיחה',
  get_lead_health: 'בודק את מצב ספר הלידים',
  get_follow_up_health: 'בודק את המעקבים',
  get_activity_trends: 'משווה את הפעילות לתקופה הקודמת',
}

/**
 * What each action state means to the rep, in their words.
 *
 * The states are the Action Runtime's `ActionReport`, unchanged: the UI does not
 * collapse them, because the differences are exactly what the rep needs. "It ran
 * but I could not confirm it" and "it ran and I checked" must never read the
 * same, and "I could not tell what happened" must never read as either.
 */
type ActionTone = 'wait' | 'ok' | 'bad' | 'warn'

/**
 * The status line, in the rep's words — and in the RIGHT words for the action.
 *
 * A follow-up is never a task. Rendering "המשימה נוצרה" for a follow-up would be
 * the UI contradicting the product's own vocabulary, and a rep who reads it
 * would go looking in the wrong place. So the states that NAME the object are
 * per-action; the ones that do not are shared.
 *
 * The states themselves are the Action Runtime's `ActionReport`, uncollapsed:
 * "it ran and I checked" and "it ran but I could not confirm it" must never read
 * the same, and "I could not tell what happened" must never read as either.
 */
const NEUTRAL_LABELS: Record<string, { title: string; tone: ActionTone }> = {
  AWAITING_APPROVAL: { title: 'ממתין לאישור שלך', tone: 'wait' },
  REJECTED: { title: 'ביטלת את הפעולה', tone: 'bad' },
  NOT_EXECUTED: { title: 'הפעולה לא בוצעה', tone: 'bad' },
  FAILED: { title: 'הפעולה נכשלה', tone: 'bad' },
  UNKNOWN_RECONCILE: { title: 'לא ברור אם הפעולה בוצעה — נדרשת בדיקה ידנית', tone: 'warn' },
}

const PER_ACTION_LABELS: Record<string, Record<string, { title: string; tone: ActionTone }>> = {
  create_task: {
    VERIFIED_SUCCESS: { title: 'המשימה נוצרה ואומתה', tone: 'ok' },
    EXECUTED_UNVERIFIED: { title: 'המשימה נשלחה, אבל לא הצלחתי לאמת אותה', tone: 'warn' },
    DUPLICATE_NOOP: { title: 'המשימה כבר נוצרה קודם — לא נוצרה שוב', tone: 'ok' },
  },
  create_follow_up: {
    VERIFIED_SUCCESS: { title: 'המעקב נקבע ואומת', tone: 'ok' },
    EXECUTED_UNVERIFIED: { title: 'המעקב נשלח, אבל לא הצלחתי לאמת אותו', tone: 'warn' },
    DUPLICATE_NOOP: { title: 'המעקב כבר נקבע קודם — לא נקבע שוב', tone: 'ok' },
  },
}

export const ACTION_REPORT_FALLBACK = { title: 'סטטוס הפעולה לא ידוע', tone: 'warn' as const }

export function actionReportLabel(report?: string | null, actionType?: string | null) {
  if (!report) return ACTION_REPORT_FALLBACK
  const perAction = actionType ? PER_ACTION_LABELS[actionType]?.[report] : undefined
  return perAction ?? NEUTRAL_LABELS[report] ?? ACTION_REPORT_FALLBACK
}

export const TOOL_LABEL_FALLBACK = 'בודק את הנתונים'

export function toolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? TOOL_LABEL_FALLBACK
}

/**
 * What the rep is told when an investigation does not produce an answer.
 *
 * Each reason is a real outcome of the runtime, and each gets its own sentence:
 * "I could not ground this" and "you have reached today's limit" are different
 * situations and collapsing them into "something went wrong" would leave the rep
 * with no idea whether to retry, rephrase, or wait.
 *
 * `no_evidence` is deliberately NOT phrased as a failure. The validator refusing
 * an ungrounded answer is the system working — the honest report is that it had
 * nothing solid to say, not that it broke.
 *
 * `deadline` names the outcome and offers the two things that actually help —
 * retry, or narrow the question — and nothing else. The runtime distinguishes a
 * wall-clock abort from a provider error so this line can be specific, but the
 * mechanism stays on the server: no signal, no SDK, no timeout value, no
 * provider name. The rep is told what happened to their request, not how the
 * request was made.
 */
export const FAILURE_MESSAGES: Record<string, string> = {
  no_evidence: 'לא מצאתי מספיק נתונים כדי לענות על זה בביטחון. אפשר לנסות לשאול על ליד מסוים.',
  gate_denied: 'הסוכן לא זמין כרגע. אפשר לנסות שוב מאוחר יותר.',
  deadline: 'לא הספקתי להשלים את הבדיקה בזמן. אפשר לנסות שוב, או לשאול משהו ממוקד יותר.',
  step_ceiling: 'הגעתי למגבלת הבדיקות לשאלה אחת. אפשר לפצל את השאלה לשתיים.',
  error: 'משהו השתבש בדרך. אפשר לנסות שוב.',
}

export const FAILURE_FALLBACK = 'לא הצלחתי להשלים את הבדיקה. אפשר לנסות שוב.'

export function failureMessage(reason?: string): string {
  return (reason && FAILURE_MESSAGES[reason]) || FAILURE_FALLBACK
}

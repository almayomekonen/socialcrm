import type { AgentAnswer } from '@/lib/agent/types'

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
  | { id: string; role: 'agent'; status: 'done'; answer: AgentAnswer; investigationId?: string }
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
 */
export const FAILURE_MESSAGES: Record<string, string> = {
  no_evidence: 'לא מצאתי מספיק נתונים כדי לענות על זה בביטחון. אפשר לנסות לשאול על ליד מסוים.',
  gate_denied: 'הסוכן לא זמין כרגע. אפשר לנסות שוב מאוחר יותר.',
  deadline: 'הבדיקה ארכה יותר מדי זמן. אפשר לנסות לשאול משהו ממוקד יותר.',
  step_ceiling: 'הגעתי למגבלת הבדיקות לשאלה אחת. אפשר לפצל את השאלה לשתיים.',
  error: 'משהו השתבש בדרך. אפשר לנסות שוב.',
}

export const FAILURE_FALLBACK = 'לא הצלחתי להשלים את הבדיקה. אפשר לנסות שוב.'

export function failureMessage(reason?: string): string {
  return (reason && FAILURE_MESSAGES[reason]) || FAILURE_FALLBACK
}

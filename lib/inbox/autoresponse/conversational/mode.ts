/**
 * Conversation mode: what KIND of conversation this turn is, read by the model in
 * the same call that writes the reply (no extra model call). Pure; no I/O.
 *
 * TONE IS NOT INTENT. Slang ("אחי כמה עולה?") is a business question asked
 * casually; a formal message can be personal. Tone stays in responseProfile.ts
 * and decides HOW to reply. The mode decides WHAT kind of reply fits.
 *
 * THE MEMORY IS A HINT, NEVER A LABEL. One message never fixes a conversation:
 *   - the mode of the CURRENT turn always comes from the current message and its
 *     recent context, in that model call;
 *   - the stored mode only tells the next turn what the last one looked like, and
 *     the prompt says so;
 *   - it expires (HINT_TTL_MS), and low confidence never drives a gate.
 * It is stored in the agent's own memory (`conversation_ai_state.qualification.
 * conversation`), one row per conversation, so it is scoped to one agency and
 * one contact by construction.
 */

export const CONVERSATION_MODES = [
  'personal',
  'prospect',
  'existing_customer',
  'support',
  'service_request',
  'scheduling',
  'pricing',
  'follow_up',
  'mixed',
  'unclear',
] as const
export type ConversationMode = (typeof CONVERSATION_MODES)[number]

export const MODE_CONFIDENCES = ['low', 'medium', 'high'] as const
export type ModeConfidence = (typeof MODE_CONFIDENCES)[number]

export type ConversationMemory = {
  mode: ConversationMode
  confidence: ModeConfidence
  /** ISO time of the turn that set it. */
  updatedAt: string
  /** Agent turns spent on personal talk; they never consume the discovery-question budget. */
  personalTurns: number
  /** ISO time the owner was told the agent is handling a personal conversation. Once per conversation. */
  personalNotifiedAt?: string
}

/** How long a remembered mode may inform the next turn. */
export const HINT_TTL_MS = 12 * 60 * 60 * 1000

export const isConversationMode = (v: unknown): v is ConversationMode =>
  typeof v === 'string' && (CONVERSATION_MODES as readonly string[]).includes(v)
export const isModeConfidence = (v: unknown): v is ModeConfidence =>
  typeof v === 'string' && (MODE_CONFIDENCES as readonly string[]).includes(v)

/** Modes whose reply must not sell: no service, price, call to action or handoff. */
export const isPersonalMode = (m: ConversationMode | null | undefined): boolean => m === 'personal'
/** Personal talk is part of the conversation: the turn rules let a social message reach the model. */
export const isSocialMode = (m: ConversationMode | null | undefined): boolean => m === 'personal' || m === 'mixed'

/** A stored value that is not a valid memory is no memory. */
export function parseConversationMemory(raw: unknown): ConversationMemory | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!isConversationMode(r.mode) || !isModeConfidence(r.confidence) || typeof r.updatedAt !== 'string') return null
  if (Number.isNaN(Date.parse(r.updatedAt))) return null
  const personalTurns = Number.isSafeInteger(r.personalTurns) && (r.personalTurns as number) >= 0 ? (r.personalTurns as number) : 0
  const notified = typeof r.personalNotifiedAt === 'string' && !Number.isNaN(Date.parse(r.personalNotifiedAt)) ? r.personalNotifiedAt : undefined
  return { mode: r.mode, confidence: r.confidence, updatedAt: r.updatedAt, personalTurns, ...(notified ? { personalNotifiedAt: notified } : {}) }
}

/** The remembered mode, when it is still fresh enough to be a hint. */
export function freshHint(memory: ConversationMemory | null, nowMs: number): ConversationMemory | null {
  if (!memory) return null
  return nowMs - Date.parse(memory.updatedAt) <= HINT_TTL_MS ? memory : null
}

/**
 * A remembered social mode strong enough to let a short social message reach the
 * model instead of being silenced by the sales turn rules.
 */
export function socialHintHolds(memory: ConversationMemory | null, nowMs: number): boolean {
  const hint = freshHint(memory, nowMs)
  return !!hint && isSocialMode(hint.mode) && hint.confidence !== 'low'
}

/** The memory after an agent turn: the turn's own reading replaces the old one. */
export function nextConversationMemory(
  prev: ConversationMemory | null,
  turn: { mode: ConversationMode; confidence: ModeConfidence; nowMs: number; notified?: boolean },
): ConversationMemory {
  const personalTurns = (prev?.personalTurns ?? 0) + (isPersonalMode(turn.mode) ? 1 : 0)
  const notifiedAt = prev?.personalNotifiedAt ?? (turn.notified ? new Date(turn.nowMs).toISOString() : undefined)
  return {
    mode: turn.mode,
    confidence: turn.confidence,
    updatedAt: new Date(turn.nowMs).toISOString(),
    personalTurns,
    ...(notifiedAt ? { personalNotifiedAt: notifiedAt } : {}),
  }
}

/**
 * The owner hears about a personal conversation ONCE: the first turn the model
 * reads as personal with at least medium confidence.
 */
export function shouldNotifyPersonal(prev: ConversationMemory | null, turn: { mode: ConversationMode; confidence: ModeConfidence }): boolean {
  return isPersonalMode(turn.mode) && turn.confidence !== 'low' && !prev?.personalNotifiedAt
}

/** Personal turns never consume the discovery-question budget meant for sales. */
export function businessTurnCount(aiTurnCount: number, memory: ConversationMemory | null): number {
  return Math.max(0, aiTurnCount - (memory?.personalTurns ?? 0))
}

/** The prompt line for the hint. Null when there is none. */
export function formatModeHint(memory: ConversationMemory | null, nowMs: number): string | null {
  const hint = freshHint(memory, nowMs)
  if (!hint) return null
  return [
    `רמז מהתור הקודם בשיחה הזו: המצב נקרא "${hint.mode}" (ביטחון ${hint.confidence}).`,
    'זה רמז בלבד. ההודעה הנוכחית וההקשר האחרון קובעים. אם השיחה עברה נושא, עבור/עברי איתה בטבעיות בלי להכריז על כך.',
  ].join('\n')
}

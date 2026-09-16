/**
 * WhatsApp Agent — who owns a conversation, and how ownership moves.
 *
 * Pure and deterministic. The three ways a human comes to own a conversation:
 *
 *   1. They send a message to the customer.  (recordHumanTakeover, at send time)
 *   2. They press "take over".               (this module's `decideTakeOver`)
 *   3. The agent hands off to them.          (markEscalated, on a human request)
 *
 * And exactly one way it goes back: a person presses "return to agent". There is
 * no timer, no inactivity sweep, and no state machine edge that quietly hands a
 * conversation back. If a rep answered a customer in their own words, the agent
 * stays out until a human says otherwise.
 *
 * WHAT IS NOT OWNERSHIP. Opening the conversation is not ownership, and neither
 * is reading it, scrolling it, or focusing the composer. Typing is *presence* —
 * a short TTL that pauses the current turn and lapses on its own (see
 * humanPresence.ts). The distinction matters because a rep who opens a thread to
 * see what the agent said must not thereby silence it forever; that is a
 * conversation nobody is answering.
 *
 * TWO STATES THIS WILL NOT RESUME, EVER:
 *
 *   opted_out  The CUSTOMER asked us to stop. That is not a rep's to undo, and
 *              a "return to agent" that could override it would turn a safety
 *              stop into a button.
 *   closed     The conversation reached its end. Re-engaging someone who said
 *              goodbye is not resumption, it is a new unsolicited approach.
 *
 * Refusing both is why "return to agent" can be a plain, unguarded control
 * everywhere else.
 */
import type { AiState } from './qualification'

/** A human owns the conversation and the agent is paused. */
export const HUMAN_OWNED_STATES = ['human_active', 'escalated'] as const

/** The customer's own stop, or a finished conversation. Never resumed here. */
export const NEVER_RESUMABLE_STATES = ['opted_out', 'closed'] as const

export type ReturnToAgentRefusal = 'opted_out' | 'closed' | 'already_active'

export type TakeOverDecision =
  | { allowed: true }
  | { allowed: false; reason: 'already_human_owned' | 'opted_out' }

export type ReturnToAgentDecision = { allowed: true } | { allowed: false; reason: ReturnToAgentRefusal }

export function isHumanOwned(aiState: AiState): boolean {
  return (HUMAN_OWNED_STATES as readonly string[]).includes(aiState)
}

export function isNeverResumable(aiState: AiState): boolean {
  return (NEVER_RESUMABLE_STATES as readonly string[]).includes(aiState)
}

/**
 * May a rep explicitly take this conversation over?
 *
 * Idempotent in spirit: taking over something already human-owned is not an
 * error the rep needs to see, but it is reported so the caller can skip the
 * write and leave `stoppedReason` describing how ownership was actually
 * acquired — "they sent a message" and "they pressed the button" are different
 * histories and overwriting one with the other loses the first.
 */
export function decideTakeOver(aiState: AiState): TakeOverDecision {
  // An opted-out conversation is already silent. Taking it over changes nothing
  // and would replace the customer's stop with a weaker reason.
  if (aiState === 'opted_out') return { allowed: false, reason: 'opted_out' }
  if (isHumanOwned(aiState)) return { allowed: false, reason: 'already_human_owned' }
  return { allowed: true }
}

/**
 * May the agent be handed this conversation back?
 *
 * Only from a state a human is holding. Everything else is either already the
 * agent's or is a stop that a rep does not get to lift.
 */
export function decideReturnToAgent(aiState: AiState): ReturnToAgentDecision {
  if (aiState === 'opted_out') return { allowed: false, reason: 'opted_out' }
  if (aiState === 'closed') return { allowed: false, reason: 'closed' }
  if (!isHumanOwned(aiState)) return { allowed: false, reason: 'already_active' }
  return { allowed: true }
}

/**
 * The state a conversation returns to.
 *
 * `ai_qualifying`, never `new`. The agent has spoken here before, and `new`
 * would re-arm the first-contact greeting — the customer would be welcomed to a
 * business they have been talking to for twenty messages. `aiTurnCount` is left
 * alone for the same reason.
 */
export const RESUMED_STATE: AiState = 'ai_qualifying'

/**
 * Does recording an agent turn imply the conversation is the agent's?
 *
 * No — and assuming it did was a live resurrection path. `recordTurn` wrote
 * `aiState = 'ai_qualifying'` unconditionally, so any turn recorded against a
 * human-owned, opted-out or closed conversation silently handed it back to the
 * agent. Nothing reaches `recordTurn` in those states today because
 * decidePreGeneration stops first, which is precisely why the bug was invisible:
 * it was one reordering away from messaging a customer who had opted out.
 */
export function stateAfterAgentTurn(current: AiState | null | undefined): AiState | null {
  if (!current) return RESUMED_STATE
  if (isHumanOwned(current) || isNeverResumable(current)) return null
  return RESUMED_STATE
}

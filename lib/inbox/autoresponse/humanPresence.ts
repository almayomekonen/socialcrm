/**
 * WhatsApp Agent — Human Presence safety model. Pure and deterministic (no I/O).
 *
 * THE INVARIANT
 *   The agent runs autonomously until the human נציג starts typing. The instant
 *   typing begins the agent stops, and no autonomous reply belonging to that turn
 *   may ever reach the customer.
 *
 * THREE STATES, ONE ROW (conversation_ai_state — no parallel state system):
 *   AI_ACTIVE    the agent may operate.
 *   HUMAN_TYPING transient presence. A TTL (`humanTypingUntil`) refreshed while
 *                keystrokes continue. Never a latch: a closed tab, a dead
 *                network or a rep who walked away lets it lapse, and the agent
 *                resumes on the next turn. Nothing here is permanent.
 *   HUMAN_ACTIVE permanent. The rep sent a message; they own the conversation.
 *                Expressed as the existing `aiState = 'human_active'`.
 *
 * WHY TWO TIMESTAMPS. A TTL alone cannot close the race this model exists to
 * prevent:
 *
 *   customer message → agent starts generating → rep starts typing
 *   → agent finishes generating → agent attempts to send
 *
 * By the time the generation returns, a short TTL may already have lapsed, so
 * "is a human typing right now" would answer "no" and the stale reply would go
 * out. `humanTypingAt` is therefore compared against the TURN EPOCH: if any
 * keystroke landed at or after the moment this turn began, every send belonging
 * to that turn is refused — during generation, after it, from a queue, or from a
 * retry. The reply is discarded, not deferred.
 *
 * The turn epoch is the job's `createdAt`, which makes the refusal survive job
 * retries, and — because it comes from the database clock, like the typing
 * timestamps — immune to skew between the worker process and Postgres. It is
 * still not permanent: the next customer message creates a new job with a later
 * epoch, and an agent that is no longer being typed over may answer it.
 */
import type { AiState } from './qualification'

/**
 * How long one keystroke keeps the conversation marked as human-present.
 * Long enough to survive a pause for thought and a few dropped beats; short
 * enough that an abandoned tab frees the conversation within seconds.
 */
export const HUMAN_TYPING_TTL_MS = 12_000

/** Composer heartbeat cadence while typing continues. Three beats fit in one TTL. */
export const HUMAN_TYPING_REFRESH_MS = 4_000

/** Cadence of the in-flight generation watcher that cancels on human presence. */
export const HUMAN_PRESENCE_POLL_MS = 1_500

export type HumanPresence = 'AI_ACTIVE' | 'HUMAN_TYPING' | 'HUMAN_ACTIVE'

export type AgentSendBlockReason =
  /** The rep sent a message. Permanent. */
  | 'human_active'
  /** Opt-out is a customer-side stop, kept here so the boundary has one answer. */
  | 'opted_out'
  /** A keystroke landed at or after this turn began. The reply is discarded. */
  | 'human_typing_this_turn'
  /** A human is present right now (TTL live). */
  | 'human_typing'
  /** Presence could not be read. The boundary fails closed — see agentSendGuard. */
  | 'presence_unavailable'

export type AgentSendAuthorization =
  | { authorized: true }
  | { authorized: false; reason: AgentSendBlockReason }

export interface HumanPresenceFacts {
  aiState: AiState
  /** TTL expiry of the transient typing signal (ISO), or null when never typed. */
  humanTypingUntil: string | null
  /** Last keystroke heartbeat (ISO), or null when never typed. */
  humanTypingAt: string | null
  /** Server clock for the TTL comparison — same clock that wrote the two above. */
  now: string
}

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? t : null
}

/** True while the transient typing TTL has not lapsed. */
export function isHumanTypingLive(f: Pick<HumanPresenceFacts, 'humanTypingUntil' | 'now'>): boolean {
  const until = ms(f.humanTypingUntil)
  const now = ms(f.now)
  if (until == null || now == null) return false
  return until > now
}

/** True when a keystroke landed at or after the turn epoch — this turn is poisoned. */
export function typedDuringTurn(f: Pick<HumanPresenceFacts, 'humanTypingAt'>, turnStartedAt: string): boolean {
  const typedAt = ms(f.humanTypingAt)
  const epoch = ms(turnStartedAt)
  if (typedAt == null || epoch == null) return false
  return typedAt >= epoch
}

/**
 * Does human typing block THIS turn — live presence or a keystroke already
 * inside it? The pre-generation gate's question, asked before an AI call is
 * spent. Deliberately excludes takeover and opt-out: those are separate
 * lifecycle decisions with their own reasons and their own state writes.
 */
export function humanTypingBlocksTurn(f: HumanPresenceFacts, turnStartedAt: string): boolean {
  if (f.aiState === 'human_active' || f.aiState === 'opted_out') return false
  return typedDuringTurn(f, turnStartedAt) || isHumanTypingLive(f)
}

/**
 * Presence right now, independent of any turn. Used by the in-flight watcher and
 * by observability. HUMAN_ACTIVE outranks HUMAN_TYPING: it is the stronger and
 * permanent claim.
 */
export function classifyHumanPresence(f: HumanPresenceFacts): HumanPresence {
  if (f.aiState === 'human_active') return 'HUMAN_ACTIVE'
  if (isHumanTypingLive(f)) return 'HUMAN_TYPING'
  return 'AI_ACTIVE'
}

/**
 * THE FINAL OUTBOUND AUTHORIZATION. Every autonomous WhatsApp send is evaluated
 * here, server-side, immediately before the Graph call — never from a decision
 * cached earlier in the turn.
 *
 * Order is deliberate: permanent stops first, then the turn-scoped race guard
 * (the more specific reason), then live presence.
 */
export function authorizeAgentSend(
  f: HumanPresenceFacts,
  turnStartedAt: string,
): AgentSendAuthorization {
  if (f.aiState === 'human_active') return { authorized: false, reason: 'human_active' }
  if (f.aiState === 'opted_out') return { authorized: false, reason: 'opted_out' }
  if (typedDuringTurn(f, turnStartedAt)) return { authorized: false, reason: 'human_typing_this_turn' }
  if (isHumanTypingLive(f)) return { authorized: false, reason: 'human_typing' }
  return { authorized: true }
}

/**
 * Should an in-flight generation be abandoned? Same facts, evaluated while the
 * model is still running. Cancelling is an optimisation — the authorization above
 * is what makes the guarantee, and it runs whether or not cancellation landed.
 */
export function shouldCancelGeneration(f: HumanPresenceFacts, turnStartedAt: string): boolean {
  return authorizeAgentSend(f, turnStartedAt).authorized === false
}

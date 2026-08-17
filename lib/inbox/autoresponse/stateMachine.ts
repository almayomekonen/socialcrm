/**
 * AI Lead Qualifier — pure state machine (no I/O, fully unit-tested).
 *
 * The worker calls this twice per claimed qualify_turn job:
 *   1. decidePreGeneration  — BEFORE spending an AI call: stop conditions + gates.
 *   2. decidePostGeneration — AFTER generation: escalate vs send the reply.
 *
 * "Human always wins" and opt-out are evaluated first and unconditionally.
 */
import type { AiState } from './qualification'
import type { SalesMove } from './salesIntent'

/** Soft budget is agency maxTurns. Hard ceiling stops runaway generation. */
export const IRE_HARD_CEILING_CAP = 8

export function ireHardCeiling(maxTurns: number): number {
  const n = Number.isFinite(maxTurns) ? Math.floor(maxTurns) : 5
  return Math.min(Math.max(n, 1) + 2, IRE_HARD_CEILING_CAP)
}

// ── Pre-generation ──────────────────────────────────────────────────────────
export interface PreFacts {
  aiState: AiState
  masterEnabled: boolean
  channelEnabled: boolean
  humanTookOver: boolean // a human customer-facing outbound exists (metadata.source != auto_response)
  optOut: boolean // latest inbound is an opt-out request
  hasUnansweredInbound: boolean // there is a customer message awaiting a reply (turn-taking)
  withinQuietHours: boolean
  withinWindow: boolean // inside WhatsApp's 24h service window
  sentTodayForAgency: number
  dailyCap: number
  turnCount: number // AI turns already sent in this conversation
  maxTurns: number
  /**
   * Explicit human-request inbound (classifier HANDOFF_REQUEST / detectHumanRequest).
   * Evaluated before the hard ceiling so a customer asking for a person is never silenced.
   */
  humanRequest?: boolean
}

export type PreDecision =
  | { action: 'stop'; state: Extract<AiState, 'human_active' | 'opted_out'>; reason: string }
  | { action: 'skip'; reason: string }
  | { action: 'handoff'; reason: 'human_request' }
  | { action: 'proceed' }

export function decidePreGeneration(f: PreFacts): PreDecision {
  // Terminal states never re-engage.
  if (f.aiState === 'human_active') return { action: 'skip', reason: 'human_active' }
  if (f.aiState === 'opted_out') return { action: 'skip', reason: 'opted_out' }
  // Human always wins — before any other consideration. No exceptions.
  if (f.humanTookOver) return { action: 'stop', state: 'human_active', reason: 'human_active' }
  if (f.optOut) return { action: 'stop', state: 'opted_out', reason: 'opt_out' }
  // Feature gates.
  if (!f.masterEnabled) return { action: 'skip', reason: 'feature_off' }
  if (!f.channelEnabled) return { action: 'skip', reason: 'channel_off' }
  if (f.aiState === 'escalated') return { action: 'skip', reason: 'already_escalated' }
  // Turn-taking: a human request still needs an unanswered inbound.
  if (!f.hasUnansweredInbound) return { action: 'skip', reason: 'no_pending_inbound' }
  // Explicit human request hands off immediately — including at the hard ceiling.
  if (f.humanRequest) return { action: 'handoff', reason: 'human_request' }
  if (f.turnCount >= ireHardCeiling(f.maxTurns)) return { action: 'skip', reason: 'max_turns' }
  // Remaining policy gates (sales qualification only).
  if (!f.withinWindow) return { action: 'skip', reason: 'outside_window' }
  if (f.withinQuietHours) return { action: 'skip', reason: 'quiet_hours' }
  if (f.sentTodayForAgency >= f.dailyCap) return { action: 'skip', reason: 'daily_cap' }
  // 'new' | 'ai_qualifying' | 'dormant' (resumes) → engage.
  return { action: 'proceed' }
}

// ── Post-generation ─────────────────────────────────────────────────────────
export interface PostFacts {
  /** Observability only. LLM/regex hotness must not escalate. */
  hotSignal: boolean
  uncertain: boolean // kept for callers; no longer auto-escalates
  requiredComplete: boolean // kept for callers; stating a need is not a handoff
  turnCount: number // AI turns already sent (before this one)
  maxTurns: number
  /**
   * Classifier sales move — the only commercial-handoff authority here is
   * HANDOFF_REQUEST. BUYING_SIGNAL continues. Soft maxTurns is not a handoff.
   */
  salesMove?: SalesMove | null
}

export type PostDecision = { action: 'escalate'; reason: string } | { action: 'send' }

export function decidePostGeneration(f: PostFacts): PostDecision {
  if (f.salesMove === 'HANDOFF_REQUEST') return { action: 'escalate', reason: 'human_request' }
  // Soft maxTurns is a budget, not a handoff. Hard ceiling is pre-generation.
  // LLM hotSignal / LLM salesMove / BUYING_SIGNAL are not escalation authorities.
  return { action: 'send' }
}

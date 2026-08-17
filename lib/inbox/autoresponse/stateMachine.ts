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
}

export type PreDecision =
  | { action: 'stop'; state: Extract<AiState, 'human_active' | 'opted_out'>; reason: string }
  | { action: 'skip'; reason: string }
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
  if (f.turnCount >= ireHardCeiling(f.maxTurns)) return { action: 'skip', reason: 'max_turns' }
  // Turn-taking + policy gates.
  if (!f.hasUnansweredInbound) return { action: 'skip', reason: 'no_pending_inbound' }
  if (!f.withinWindow) return { action: 'skip', reason: 'outside_window' }
  if (f.withinQuietHours) return { action: 'skip', reason: 'quiet_hours' }
  if (f.sentTodayForAgency >= f.dailyCap) return { action: 'skip', reason: 'daily_cap' }
  // 'new' | 'ai_qualifying' | 'dormant' (resumes) → engage.
  return { action: 'proceed' }
}

// ── Post-generation ─────────────────────────────────────────────────────────
export interface PostFacts {
  hotSignal: boolean // explicit human/price/demo intent → escalate
  uncertain: boolean // kept for callers; no longer auto-escalates
  requiredComplete: boolean // kept for callers; stating a need is not a handoff
  turnCount: number // AI turns already sent (before this one)
  maxTurns: number
  /** Deterministic sales move. Soft maxTurns must not hand off on its own. */
  salesMove?: SalesMove | null
}

export type PostDecision = { action: 'escalate'; reason: string } | { action: 'send' }

export function decidePostGeneration(f: PostFacts): PostDecision {
  if (f.hotSignal) return { action: 'escalate', reason: 'hot_signal' }
  if (f.salesMove === 'HANDOFF_REQUEST' || f.salesMove === 'BUYING_SIGNAL') {
    return { action: 'escalate', reason: 'hot_signal' }
  }
  // Soft maxTurns is a budget, not a handoff. Hard ceiling is pre-generation.
  return { action: 'send' }
}

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
  if (f.turnCount >= f.maxTurns) return { action: 'skip', reason: 'max_turns' }
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
  hotSignal: boolean // buying intent → escalate immediately, before required fields complete
  uncertain: boolean // AI not confident → escalate, never guess
  requiredComplete: boolean // all required fields collected after this turn's extraction
  turnCount: number // AI turns already sent (before this one)
  maxTurns: number
}

export type PostDecision = { action: 'escalate'; reason: string } | { action: 'send' }

export function decidePostGeneration(f: PostFacts): PostDecision {
  if (f.hotSignal) return { action: 'escalate', reason: 'hot_signal' }
  if (f.uncertain) return { action: 'escalate', reason: 'uncertain' }
  if (f.requiredComplete) return { action: 'escalate', reason: 'qualified' }
  // Sending now would consume the final allowed turn → make it the handoff instead.
  if (f.turnCount + 1 >= f.maxTurns) return { action: 'escalate', reason: 'max_turns' }
  return { action: 'send' }
}

// Today brief — classification, priority ordering, and dedup (INV-1,3,4,6,7,16).
// Pure. classifyLead checks states in STATE_PRIORITY order and returns the first
// match, so a lead satisfying several states is attributed to its highest one and
// (via orderAndDedupe) appears exactly once.

import {
  DAY_MS,
  HOUR_MS,
  INBOUND_CHANNEL_PREFIXES,
  PROMISED_WAITING_RECENCY_DAYS,
  SLA_HOURS_BY_STATUS,
  STALE_CEILING_DAYS,
  STATE_PRIORITY,
  TERMINAL_STATUSES,
} from './constants'
import { reasonFor } from './labels'
import type { BriefItem, LeadFact, NowCtx, QualifyingState, TargetSurface } from './types'

function isTerminal(status: string | null): boolean {
  return status != null && (TERMINAL_STATUSES as readonly string[]).includes(status)
}

export function isInboundSource(leadSource: string | null): boolean {
  return leadSource != null && INBOUND_CHANNEL_PREFIXES.some((p) => leadSource.startsWith(p))
}

function isWaitingReply(f: LeadFact, ctx: NowCtx): boolean {
  if (f.lastInboundAt == null) return false
  if (f.lastInboundAt <= (f.lastHumanOutboundAt ?? Number.NEGATIVE_INFINITY)) return false
  return f.lastInboundAt >= ctx.nowMs - PROMISED_WAITING_RECENCY_DAYS * DAY_MS
}

function isOpenLoopSla(f: LeadFact, ctx: NowCtx): boolean {
  if (f.status == null) return false
  const slaHours = SLA_HOURS_BY_STATUS[f.status]
  if (slaHours == null) return false // only statuses with a defined SLA
  if (f.nextFollowUpAt != null) return false // a next step is already scheduled
  if (f.hasOpenTask) return false // an open task is a scheduled next step (overdue → OVERDUE_TASK)
  if (f.lastActivityAt == null) return false // age indeterminate → not here
  const agedPastSla = f.lastActivityAt < ctx.nowMs - slaHours * HOUR_MS
  const withinCeiling = f.lastActivityAt >= ctx.nowMs - STALE_CEILING_DAYS * DAY_MS
  return agedPastSla && withinCeiling
}

/** The single owed action's execution surface (M2). */
export function targetSurfaceFor(state: QualifyingState): TargetSurface {
  return state === 'WAITING_REPLY' ? 'inbox' : 'lead'
}

/** Highest-priority qualifying state for a lead, or null if it does not qualify. */
export function classifyLead(f: LeadFact, ctx: NowCtx): QualifyingState | null {
  if (isTerminal(f.status)) return null
  if (isWaitingReply(f, ctx)) return 'WAITING_REPLY'
  if (f.nextFollowUpAt != null && f.nextFollowUpAt < ctx.dayStart) return 'FOLLOWUP_OVERDUE'
  if (f.nextFollowUpAt != null && f.nextFollowUpAt >= ctx.dayStart && f.nextFollowUpAt < ctx.dayEnd)
    return 'FOLLOWUP_DUE_TODAY'
  if (f.status === 'new' && isInboundSource(f.leadSource)) return 'NEW_INBOUND'
  if (f.earliestOpenTaskDueAt != null && f.earliestOpenTaskDueAt < ctx.dayStart) return 'OVERDUE_TASK'
  if (isOpenLoopSla(f, ctx)) return 'OPEN_LOOP_SLA'
  return null
}

const PRIORITY_INDEX: Record<QualifyingState, number> = STATE_PRIORITY.reduce(
  (acc, s, i) => ((acc[s] = i), acc),
  {} as Record<QualifyingState, number>,
)

// Deterministic intra-state tiebreak: oldest-waiting / most-overdue / earliest /
// newest-inbound / longest-untouched first; final tiebreak by id for stability.
function tiebreakKey(f: LeadFact, state: QualifyingState): number {
  switch (state) {
    case 'WAITING_REPLY':
      return f.lastInboundAt ?? 0 // ascending → oldest waiting first
    case 'FOLLOWUP_OVERDUE':
    case 'FOLLOWUP_DUE_TODAY':
      return f.nextFollowUpAt ?? 0 // ascending → most overdue / earliest first
    case 'NEW_INBOUND':
      return -(f.createdAt ?? 0) // descending createdAt → newest first
    default:
      return f.lastActivityAt ?? 0 // ascending → longest untouched first
  }
}

/**
 * Classify every fact, drop non-qualifiers, dedupe by id (keeping the
 * highest-priority state), and order by priority then intra-state tiebreak then id.
 */
export function orderAndDedupe(facts: readonly LeadFact[], ctx: NowCtx): BriefItem[] {
  const byId = new Map<number, { fact: LeadFact; state: QualifyingState }>()
  for (const fact of facts) {
    const state = classifyLead(fact, ctx)
    if (state == null) continue
    const existing = byId.get(fact.id)
    if (!existing || PRIORITY_INDEX[state] < PRIORITY_INDEX[existing.state]) byId.set(fact.id, { fact, state })
  }

  return [...byId.values()]
    .sort((a, b) => {
      const byPriority = PRIORITY_INDEX[a.state] - PRIORITY_INDEX[b.state]
      if (byPriority !== 0) return byPriority
      const byTiebreak = tiebreakKey(a.fact, a.state) - tiebreakKey(b.fact, b.state)
      if (byTiebreak !== 0) return byTiebreak
      return a.fact.id - b.fact.id
    })
    .map(({ fact, state }) => ({
      id: fact.id,
      name: fact.name,
      phone: fact.phone,
      state,
      reason: reasonFor(state),
      targetSurface: targetSurfaceFor(state),
    }))
}

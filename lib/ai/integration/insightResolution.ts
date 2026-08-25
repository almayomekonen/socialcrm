import { classifyLead } from '@/lib/today/classify'
import { businessDayBounds } from '@/lib/today/time'
import { readLeadFact as defaultReadLeadFact } from '@/db/ai/leadFacts'
import { listOpenInsights as defaultListOpen, closeInsight as defaultCloseInsight, type InsightRow } from '@/db/ai/insights'
import { EXPECTED_STATE } from './preconditions'
import { isNotificationsEnabled } from '@/lib/notifications/flags'
import type { ExpectationKind } from './detectors/registry'

/**
 * The resolution sweep — how an insight stops being true.
 *
 * An insight is a claim about the business, and the business moves. The rep calls
 * the ליד, the follow-up is rescheduled, the deal closes. When that happens the
 * conclusion is not wrong-in-hindsight, it is simply no longer live, and leaving
 * it open would mean holding its dedup key against a conclusion that might
 * genuinely be worth making again later.
 *
 * `classifyLead` IS THE SOLE CLASSIFIER, and this is the same predicate the
 * admission precondition P4 uses. One function decides both "may we investigate
 * this?" and "is this conclusion still live?", so the two can never drift into
 * disagreeing about whether a follow-up is still overdue.
 *
 * TERMINAL STATES NEVER REOPEN. `closeInsight` targets `status = 'open'`, so a
 * repeated sweep over a resolved row is a no-op. The sweep is idempotent by
 * construction rather than by care.
 *
 * READING IS NOT RESOLVING. Nothing here consults `readAt`, `seenAt` or any
 * notification state. A rep having seen a notification says nothing about whether
 * the underlying business fact still holds — conflating them would let the bell
 * decide what is true.
 *
 * NO NEW SCHEDULER. This runs inside the existing notifications-dispatch cron.
 */

/** An insight nobody acted on eventually stops being worth holding open. */
export const INSIGHT_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface ResolutionSummary {
  scanned: number
  resolvedStale: number
  expired: number
  errored: number
}

export interface ResolutionDeps {
  listOpenInsights?: typeof defaultListOpen
  closeInsight?: typeof defaultCloseInsight
  readLeadFact?: typeof defaultReadLeadFact
}

export interface ResolutionOptions {
  now?: Date
  limit?: number
  ttlMs?: number
  deps?: ResolutionDeps
}

/**
 * Is this insight's conclusion still live?
 *
 * Returns the reason it is NOT, or null when it still holds. Deterministic; no
 * model, no notification state.
 */
export async function staleReasonFor(
  insight: InsightRow,
  opts: { now: Date; ttlMs: number; readLeadFact: typeof defaultReadLeadFact },
): Promise<'business_state' | 'entity_gone' | 'expired' | null> {
  const age = opts.now.getTime() - Date.parse(insight.createdAt)
  if (Number.isFinite(age) && age >= opts.ttlMs) return 'expired'

  const leadId = Number(insight.subjectId)
  if (!Number.isInteger(leadId) || leadId <= 0) return 'entity_gone'

  const fact = await opts.readLeadFact({ agencyId: insight.agencyId }, leadId)
  // Gone, terminal, or invisible under the plan — all mean the same thing here.
  if (!fact) return 'entity_gone'

  const expected = EXPECTED_STATE[insight.expectation as ExpectationKind]
  if (!expected) return 'business_state'

  const state = classifyLead(fact, businessDayBounds(opts.now.getTime()))
  return state === expected ? null : 'business_state'
}

/**
 * Walk the open insights and close the ones that no longer hold. Never throws;
 * always returns a summary.
 */
export async function sweepInsightResolution(opts: ResolutionOptions = {}): Promise<ResolutionSummary> {
  const summary: ResolutionSummary = { scanned: 0, resolvedStale: 0, expired: 0, errored: 0 }

  // OFF MEANS OFF: a disabled notification system runs no sweep QUERY either,
  // matching the cron's own posture.
  if (!isNotificationsEnabled()) return summary

  const now = opts.now ?? new Date()
  const ttlMs = opts.ttlMs ?? INSIGHT_TTL_MS
  const d = opts.deps ?? {}
  const listOpen = d.listOpenInsights ?? defaultListOpen
  const close = d.closeInsight ?? defaultCloseInsight
  const readLeadFact = d.readLeadFact ?? defaultReadLeadFact

  let open: InsightRow[] = []
  try {
    open = await listOpen(opts.limit ?? 100)
  } catch (err) {
    console.error('[insight-resolution] list failed:', (err as Error).message)
    return summary
  }

  for (const insight of open) {
    summary.scanned += 1
    try {
      const reason = await staleReasonFor(insight, { now, ttlMs, readLeadFact })
      if (reason === null) continue
      const status = reason === 'expired' ? 'expired' : 'resolved'
      await close(insight.id, status, reason)
      if (reason === 'expired') summary.expired += 1
      else summary.resolvedStale += 1
    } catch (err) {
      summary.errored += 1
      console.error(`[insight-resolution] insight=${insight.id}:`, (err as Error).message)
    }
  }

  return summary
}

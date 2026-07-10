/**
 * "התחל כאן" — the single recommended next contact (Dashboard Phase 1).
 *
 * Transparent, explainable rule (no scores, no AI, no black box): promised
 * follow-ups first (most overdue), then the freshest new lead (speed-to-lead),
 * then the longest-waiting cold lead. Every pick carries a plain-language reason.
 * It is a SUGGESTION only — the lead also remains visible in its lane.
 */

import { startOfBusinessDay } from '@/lib/time/businessDay'

export type RecommendInput = {
  id: number
  name: string
  phone: string | null
  status: string | null
  nextFollowUpAt: string | Date | null
  createdAt?: string | Date | null
  lastOutcomeType?: string | null
}

export type Recommendation = { lead: RecommendInput; reason: string }

function dueMs(lead: RecommendInput, nowMs: number): number | null {
  const fu = lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt).getTime() : null
  return fu != null && !Number.isNaN(fu) && fu <= nowMs ? fu : null
}

/** Plain-Hebrew explanation for why this lead is surfaced. Uses the shared
 *  business-day (Asia/Jerusalem) boundary so "overdue" / "from this morning" are
 *  consistent with the rest of the app and correct on the UTC server. */
export function recommendReason(lead: RecommendInput, nowMs: number): string {
  const due = dueMs(lead, nowMs)
  if (due != null) return due < startOfBusinessDay(nowMs) ? 'מעקב באיחור' : 'מעקב להיום'

  if (lead.status === 'new') {
    const created = lead.createdAt ? new Date(lead.createdAt).getTime() : null
    return created != null && created >= startOfBusinessDay(nowMs) ? 'ליד חדש מהבוקר' : 'ליד חדש'
  }

  if (lead.lastOutcomeType === 'call_no_answer') return 'לא נענה בפעם האחרונה'
  return 'ממתין לטיפול'
}

/**
 * Pick the one recommended lead across the (already-ordered) due worklist and
 * new-leads list. `due` is expected most-overdue-first; `newLeads` newest-first.
 */
export function pickRecommended(due: RecommendInput[], newLeads: RecommendInput[], nowMs: number): Recommendation | null {
  const dueFollowUp = due.find((r) => dueMs(r, nowMs) != null)
  if (dueFollowUp) return { lead: dueFollowUp, reason: recommendReason(dueFollowUp, nowMs) }

  if (newLeads.length > 0) return { lead: newLeads[0], reason: recommendReason(newLeads[0], nowMs) }

  if (due.length > 0) return { lead: due[0], reason: recommendReason(due[0], nowMs) }

  return null
}

/**
 * Top-N recommended contacts for the spotlight. Takes the head of the
 * already-ordered due worklist, then guarantees at least one new lead is
 * represented (speed-to-lead) by swapping it into the last slot if none made it.
 * Each item carries its plain-Hebrew reason. Returns up to `n` items.
 */
export function pickTopRecommended(
  due: RecommendInput[],
  newLeads: RecommendInput[],
  n: number,
  nowMs: number,
): Recommendation[] {
  const items: Recommendation[] = due.slice(0, n).map((lead) => ({ lead, reason: recommendReason(lead, nowMs) }))

  if (newLeads.length > 0 && !items.some((it) => it.lead.status === 'new')) {
    const fresh: Recommendation = { lead: newLeads[0], reason: recommendReason(newLeads[0], nowMs) }
    if (items.length < n) items.push(fresh)
    else items[items.length - 1] = fresh
  }

  return items.slice(0, n)
}

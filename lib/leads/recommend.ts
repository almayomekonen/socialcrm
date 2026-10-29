/**
 * "התחל כאן" — the single recommended next contact (Dashboard Phase 1).
 *
 * Transparent, explainable rule (no scores, no AI, no black box): promised
 * follow-ups first (most overdue), then the freshest new lead (speed-to-lead),
 * then the longest-waiting cold lead. Every pick carries a plain-language reason.
 * It is a SUGGESTION only — the lead also remains visible in its lane.
 */

import type { UiLocale } from '@/lib/i18n/config'
import { reasonLabel } from '@/lib/today/labels'
import type { ReasonCode } from '@/lib/today/types'

export type RecommendInput = {
  id: number
  name: string
  phone: string | null
  status: string | null
  nextFollowUpAt: string | Date | null
  createdAt?: string | Date | null
  lastOutcomeType?: string | null
}

/**
 * `reason` is display text in the interface locale; `reasonCode` is what logic
 * reads. Every producer here sets it; it is optional only so hand-built
 * recommendations (tests, older callers) still type-check — a missing code
 * means "no tone", never a fallback to reading the text.
 */
export type Recommendation = { lead: RecommendInput; reason: string; reasonCode?: ReasonCode }

function startOfDay(nowMs: number): number {
  const d = new Date(nowMs)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function dueMs(lead: RecommendInput, nowMs: number): number | null {
  const fu = lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt).getTime() : null
  return fu != null && !Number.isNaN(fu) && fu <= nowMs ? fu : null
}

/** Why this lead is surfaced, as a stable code (the decision; no display text). */
export function recommendReasonCode(lead: RecommendInput, nowMs: number): ReasonCode {
  const due = dueMs(lead, nowMs)
  if (due != null) return due < startOfDay(nowMs) ? 'FOLLOWUP_OVERDUE' : 'FOLLOWUP_DUE_TODAY'

  if (lead.status === 'new') {
    const created = lead.createdAt ? new Date(lead.createdAt).getTime() : null
    return created != null && created >= startOfDay(nowMs) ? 'NEW_INBOUND_TODAY' : 'NEW_INBOUND'
  }

  if (lead.lastOutcomeType === 'call_no_answer') return 'NO_ANSWER_LAST'
  return 'OPEN_LOOP_SLA'
}

/** Plain-language explanation for why this lead is surfaced (Hebrew by default). */
export function recommendReason(lead: RecommendInput, nowMs: number, locale: UiLocale = 'he'): string {
  return reasonLabel(recommendReasonCode(lead, nowMs), locale)
}

function recommend(lead: RecommendInput, nowMs: number, locale: UiLocale): Recommendation {
  const reasonCode = recommendReasonCode(lead, nowMs)
  return { lead, reason: reasonLabel(reasonCode, locale), reasonCode }
}

/**
 * Pick the one recommended lead across the (already-ordered) due worklist and
 * new-leads list. `due` is expected most-overdue-first; `newLeads` newest-first.
 */
export function pickRecommended(
  due: RecommendInput[],
  newLeads: RecommendInput[],
  nowMs: number,
  locale: UiLocale = 'he',
): Recommendation | null {
  const dueFollowUp = due.find((r) => dueMs(r, nowMs) != null)
  if (dueFollowUp) return recommend(dueFollowUp, nowMs, locale)

  if (newLeads.length > 0) return recommend(newLeads[0], nowMs, locale)

  if (due.length > 0) return recommend(due[0], nowMs, locale)

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
  locale: UiLocale = 'he',
): Recommendation[] {
  const items: Recommendation[] = due.slice(0, n).map((lead) => recommend(lead, nowMs, locale))

  if (newLeads.length > 0 && !items.some((it) => it.lead.status === 'new')) {
    const fresh: Recommendation = recommend(newLeads[0], nowMs, locale)
    if (items.length < n) items.push(fresh)
    else items[items.length - 1] = fresh
  }

  return items.slice(0, n)
}

/**
 * Dashboard V2 — P0 correctness layer.
 *
 * Canonical membership rule for the "needs attention now" worklist (the
 * "דורש טיפול" lane). This is the SINGLE source of truth: the getDueWorklist
 * SQL WHERE (db/worklist.ts) mirrors it 1:1, and it is proven equal to
 * bucketDashboardLeads' "overdue" membership (see __tests__/leads/dueWorklist.test.ts).
 *
 * Rules (identical to the Follow-Up Engine):
 *  - closed / lost are never members (null status is NOT closed/lost → eligible).
 *  - an explicit follow-up OVERRIDES SLA: due (<= now) → member; future → NOT a
 *    member (future follow-up suppresses SLA urgency).
 *  - with NO follow-up, a lead is a member iff SLA-cold: time since statusChangedAt
 *    has reached the per-status SLA (new 2h / contacted 24h / interested 72h).
 */

export const SLA_HOURS: Record<string, number> = { new: 2, contacted: 24, interested: 72 }

export type DueWorklistInput = {
  status: string | null
  nextFollowUpAt: string | Date | null
  statusChangedAt: string | Date | null
}

export function isDueWorklistMember(lead: DueWorklistInput, nowMs: number): boolean {
  if (lead.status === 'closed' || lead.status === 'lost') return false

  // Explicit follow-up wins over SLA entirely.
  const fuRaw = lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt).getTime() : null
  const fu = fuRaw !== null && !Number.isNaN(fuRaw) ? fuRaw : null
  if (fu !== null) return fu <= nowMs // due → member; future → suppressed

  // No follow-up → member iff SLA-cold.
  const sla = lead.status ? SLA_HOURS[lead.status] : undefined
  if (sla == null || !lead.statusChangedAt) return false
  const elapsedHours = (nowMs - new Date(lead.statusChangedAt).getTime()) / 3_600_000
  return elapsedHours >= sla
}
